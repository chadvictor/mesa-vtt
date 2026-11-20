import React, { useMemo, useState } from 'react';
import {
  Check,
  Crosshair,
  Dices,
  Flame,
  Heart,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Skull,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import { getSystemEngine, tagmar3Engine } from '@systems/registry';
import {
  resolveTagmarResistance,
  resolveTagmarRoll,
} from '@systems/tagmar/resolutionTable';
import type {
  ChatMessage,
  InteractiveAction,
  RolledDie,
  RollOutcome,
  TagmarResolutionColor,
  TagmarResistanceRequest,
} from '@systems/types';
import { useCampaignStore } from '@/lib/store';

export interface RollCardProps {
  message: ChatMessage;
  compact?: boolean;
}

interface TagmarBannerTheme {
  title: string;
  subtitle?: string;
  accent: string;
  bg: string;
  border: string;
  text: string;
  glow?: string;
}

const TAGMAR_BANNER_STYLES: Record<TagmarResolutionColor, TagmarBannerTheme> = {
  erro_critico: {
    title: 'ERRO CRÍTICO!',
    subtitle: 'Falha catastrófica na Tabela de Resolução',
    accent: '#991b1b',
    bg: 'linear-gradient(90deg, rgba(127, 29, 29, 0.55), rgba(153, 27, 27, 0.72), rgba(127, 29, 29, 0.55))',
    border: 'rgba(248, 113, 113, 0.78)',
    text: '#fee2e2',
    glow: '0 0 20px rgba(153, 27, 27, 0.45)',
  },
  falha: {
    title: 'FALHA',
    subtitle: 'Sem efeito na Tabela de Resolução',
    accent: '#64748b',
    bg: 'linear-gradient(90deg, rgba(51, 65, 85, 0.45), rgba(71, 85, 105, 0.58), rgba(51, 65, 85, 0.45))',
    border: 'rgba(148, 163, 184, 0.5)',
    text: '#e2e8f0',
  },
  verde: {
    title: 'VERDE (25%)',
    subtitle: 'Sucesso Leve · 25% de Dano/Efeito',
    accent: '#22c55e',
    bg: 'linear-gradient(90deg, rgba(22, 163, 74, 0.25), rgba(34, 197, 94, 0.4), rgba(22, 163, 74, 0.25))',
    border: 'rgba(74, 222, 128, 0.72)',
    text: '#dcfce7',
    glow: '0 0 16px rgba(34, 197, 94, 0.22)',
  },
  amarelo: {
    title: 'AMARELO (50%)',
    subtitle: 'Sucesso Moderado · 50% de Dano/Efeito',
    accent: '#eab308',
    bg: 'linear-gradient(90deg, rgba(202, 138, 4, 0.28), rgba(234, 179, 8, 0.44), rgba(202, 138, 4, 0.28))',
    border: 'rgba(250, 204, 21, 0.76)',
    text: '#fef9c3',
    glow: '0 0 16px rgba(234, 179, 8, 0.24)',
  },
  laranja: {
    title: 'LARANJA (75%)',
    subtitle: 'Sucesso Forte · 75% de Dano/Efeito',
    accent: '#f97316',
    bg: 'linear-gradient(90deg, rgba(234, 88, 12, 0.3), rgba(249, 115, 22, 0.46), rgba(234, 88, 12, 0.3))',
    border: 'rgba(251, 146, 60, 0.8)',
    text: '#ffedd5',
    glow: '0 0 18px rgba(249, 115, 22, 0.28)',
  },
  vermelho: {
    title: 'VERMELHO (100%)',
    subtitle: 'Sucesso Pleno · 100% de Dano/Efeito',
    accent: '#ef4444',
    bg: 'linear-gradient(90deg, rgba(220, 38, 38, 0.32), rgba(239, 68, 68, 0.52), rgba(220, 38, 38, 0.32))',
    border: 'rgba(248, 113, 113, 0.85)',
    text: '#fee2e2',
    glow: '0 0 20px rgba(239, 68, 68, 0.32)',
  },
  azul: {
    title: 'AZUL — CRÍTICO! (Dano direto na EF!)',
    subtitle: 'Ignora EH e Absorção normal · Efeito Crítico',
    accent: '#38bdf8',
    bg: 'linear-gradient(90deg, rgba(2, 132, 199, 0.38), rgba(56, 189, 248, 0.58), rgba(2, 132, 199, 0.38))',
    border: 'rgba(125, 211, 252, 0.92)',
    text: '#e0f2fe',
    glow: '0 0 26px rgba(56, 189, 248, 0.44)',
  },
};

function getDieHighlight(die: RolledDie): 'max' | 'min' | 'normal' {
  if (die.dropped) return 'normal';
  if (die.value === die.sides) return 'max';
  if (die.value === 1) return 'min';
  return 'normal';
}

function getActionToneStyle(style: InteractiveAction['style'], directToEf?: boolean): React.CSSProperties {
  if (directToEf && style === 'damage') {
    return {
      background: 'rgba(56, 189, 248, 0.2)',
      borderColor: 'rgba(56, 189, 248, 0.72)',
      color: '#bae6fd',
    };
  }
  switch (style) {
    case 'damage':
      return {
        background: 'rgba(239, 68, 68, 0.16)',
        borderColor: 'rgba(239, 68, 68, 0.45)',
        color: '#fca5a5',
      };
    case 'heal':
      return {
        background: 'rgba(34, 197, 94, 0.16)',
        borderColor: 'rgba(34, 197, 94, 0.45)',
        color: '#86efac',
      };
    case 'mana':
      return {
        background: 'rgba(59, 130, 246, 0.16)',
        borderColor: 'rgba(59, 130, 246, 0.45)',
        color: '#93c5fd',
      };
    case 'condition':
      return {
        background: 'rgba(168, 85, 247, 0.16)',
        borderColor: 'rgba(168, 85, 247, 0.45)',
        color: '#d8b4fe',
      };
    case 'roll':
      return {
        background: 'rgba(212, 168, 79, 0.16)',
        borderColor: 'rgba(212, 168, 79, 0.45)',
        color: '#f2cc7b',
      };
    default:
      return {
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-default)',
        color: 'var(--text-primary)',
      };
  }
}

function renderActionIcon(action: InteractiveAction) {
  switch (action.actionType) {
    case 'apply_damage':
      return action.payload.directToEf ? <Sparkles size={13} /> : <Swords size={13} />;
    case 'apply_heal':
      return <Heart size={13} />;
    case 'spend_mana':
    case 'spend_karma':
    case 'spend_resource':
      return action.actionType === 'spend_karma' || action.payload.resource === 'karma' ? (
        <Sparkles size={13} />
      ) : (
        <Zap size={13} />
      );
    case 'apply_condition':
      return <Flame size={13} />;
    case 'roll_followup':
      return <Dices size={13} />;
    default:
      return <Sparkles size={13} />;
  }
}

export function RollCard({ message, compact = false }: RollCardProps) {
  const {
    campaign,
    characters,
    activeCharacter,
    targetCharacter,
    executeChatAction,
    rollDice,
    patchCharacter,
    sendChat,
    pushToast,
    user,
  } = useCampaignStore();

  const roll = message.roll;
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [localExecuted, setLocalExecuted] = useState<Record<string, string>>({});
  const [showQuickApply, setShowQuickApply] = useState(false);

  const systemId = campaign?.systemId ?? 'mighty-blade-3e';
  const isTagmarCampaign = systemId === 'tagmar-3';
  const engine = useMemo(() => getSystemEngine(systemId), [systemId]);

  const actor = useMemo(
    () => characters.find((c) => c.id === message.characterId) ?? activeCharacter ?? undefined,
    [characters, message.characterId, activeCharacter]
  );

  const meta = (roll?.systemMeta ?? {}) as Record<string, unknown>;
  const defaultTargetId =
    (typeof meta.targetCharacterId === 'string' && meta.targetCharacterId) ||
    targetCharacter?.id ||
    '';

  const effectiveTargetId = selectedTargetId || defaultTargetId;
  const resolvedTarget = useMemo(
    () => characters.find((c) => c.id === effectiveTargetId) ?? undefined,
    [characters, effectiveTargetId]
  );

  const evaluated = useMemo(() => {
    if (!roll) return null;
    return engine.resolveRollOutcome(roll, actor, resolvedTarget);
  }, [engine, roll, actor, resolvedTarget]);

  // Tagmar 3.0 Resolution Table & Resistance metadata resolution
  const tagmarInfo = useMemo(() => {
    if (!roll) return null;
    const activeDice = roll.dice.filter((d) => !d.dropped);
    const d20Die = activeDice.find((d) => d.sides === 20);
    const d20Val = d20Die?.value ?? roll.total;

    // Resistance roll check (RF / RM)
    const rawRes =
      roll.tagmarResistance ??
      (meta.kind === 'resistance'
        ? {
            kind: (meta.resistanceKind === 'rm' ? 'rm' : 'rf') as 'rf' | 'rm',
            fa: Number(meta.fa ?? 5),
            fd: Number(meta.fd ?? 1),
            target: Number(meta.target ?? 11),
            resisted: false,
          }
        : undefined);

    if (rawRes && d20Die) {
      const res = resolveTagmarResistance(d20Val, rawRes.fa, rawRes.fd);
      return {
        mode: 'resistance' as const,
        kind: rawRes.kind,
        d20: d20Val,
        fa: res.fa,
        fd: res.fd,
        target: res.target,
        resisted: typeof roll.tagmarResistance?.resisted === 'boolean' ? roll.tagmarResistance.resisted : res.resisted,
        isCritical: res.isCritical,
        isFumble: res.isFumble,
      };
    }

    // Resolution Table check (Col + d20 -> Color)
    const col =
      typeof roll.tagmarColumn === 'number'
        ? roll.tagmarColumn
        : typeof meta.tagmarColumn === 'number'
          ? meta.tagmarColumn
          : undefined;

    if (roll.tagmarColor || (col !== undefined && d20Die)) {
      const resolved = col !== undefined ? resolveTagmarRoll(d20Val, col) : null;
      const color: TagmarResolutionColor = roll.tagmarColor ?? resolved?.color ?? 'falha';
      return {
        mode: 'table' as const,
        color,
        d20: d20Val,
        column: col,
        effectiveColumn: resolved?.effectiveColumn,
        overflowSteps: resolved?.overflowSteps ?? 0,
        overflowTiers: resolved?.overflowTiers ?? 0,
        percent: resolved?.percent ?? 0,
        directToEf: roll.tagmarDirectToEf ?? resolved?.directToEf ?? color === 'azul',
      };
    }

    return null;
  }, [roll, meta]);

  if (!roll) return null;

  const outcome: RollOutcome | undefined = roll.outcome ?? evaluated?.outcome;
  const serverActions = message.actions && message.actions.length > 0 ? message.actions : [];
  const rawActions: InteractiveAction[] =
    serverActions.length > 0 ? serverActions : (evaluated?.actions ?? []);

  const isTagmarTable = tagmarInfo?.mode === 'table';
  const isTagmarResistance = tagmarInfo?.mode === 'resistance';
  const tagmarTheme = isTagmarTable ? TAGMAR_BANNER_STYLES[tagmarInfo.color] : null;

  const isCrit = outcome?.kind === 'critical';
  const isFumble = outcome?.kind === 'fumble';
  const isSuccess = outcome?.kind === 'success';
  const isFailure = outcome?.kind === 'failure';

  const karmaSpent =
    typeof meta.karmaCost === 'number' && meta.karmaCost > 0
      ? meta.karmaCost
      : typeof meta.karmaSpent === 'number' && meta.karmaSpent > 0
        ? meta.karmaSpent
        : 0;
  const karmaAlreadySpent = Boolean(meta.karmaAlreadySpent);

  const manaSpent =
    typeof meta.manaCost === 'number' && meta.manaCost > 0
      ? meta.manaCost
      : typeof meta.manaSpent === 'number' && meta.manaSpent > 0
        ? meta.manaSpent
        : 0;
  const manaAlreadySpent = Boolean(meta.manaAlreadySpent);

  const actions = rawActions.filter((a) => {
    const isSpend =
      a.actionType === 'spend_mana' ||
      a.actionType === 'spend_karma' ||
      a.actionType === 'spend_resource';
    if (!isSpend) return true;
    const resName = typeof a.payload.resource === 'string' ? a.payload.resource.toLowerCase() : '';
    const isKarmaAction =
      a.actionType === 'spend_karma' ||
      resName === 'karma' ||
      (a.actionType === 'spend_mana' && isTagmarCampaign);
    const isManaAction =
      resName === 'pm' ||
      resName === 'mp' ||
      (a.actionType === 'spend_mana' && !isTagmarCampaign);
    if (isKarmaAction && karmaAlreadySpent) return false;
    if (isManaAction && manaAlreadySpent) return false;
    return true;
  });

  const isDamageRoll =
    meta.kind === 'damage' ||
    roll.label.toLowerCase().includes('dano') ||
    typeof meta.criticalMultiplier === 'number';
  const isHealRoll = meta.kind === 'heal' || roll.label.toLowerCase().includes('cura');

  const cardBorder = tagmarTheme
    ? tagmarTheme.border
    : isTagmarResistance
      ? tagmarInfo.resisted
        ? 'rgba(74, 222, 128, 0.72)'
        : 'rgba(248, 113, 113, 0.72)'
      : isCrit
        ? 'rgba(242, 204, 123, 0.8)'
        : isFumble
          ? 'rgba(239, 68, 68, 0.72)'
          : isSuccess
            ? 'rgba(34, 197, 94, 0.45)'
            : isFailure
              ? 'rgba(239, 68, 68, 0.35)'
              : 'var(--border-gold)';

  const cardBg = tagmarTheme
    ? `linear-gradient(155deg, ${tagmarTheme.accent}22 0%, rgba(16, 21, 30, 0.97) 58%)`
    : isTagmarResistance
      ? tagmarInfo.resisted
        ? 'linear-gradient(155deg, rgba(34, 197, 94, 0.16) 0%, rgba(16, 21, 30, 0.97) 58%)'
        : 'linear-gradient(155deg, rgba(239, 68, 68, 0.16) 0%, rgba(16, 21, 30, 0.97) 58%)'
      : isCrit
        ? 'linear-gradient(155deg, rgba(212, 168, 79, 0.16) 0%, rgba(20, 25, 34, 0.96) 55%)'
        : isFumble
          ? 'linear-gradient(155deg, rgba(239, 68, 68, 0.15) 0%, rgba(20, 25, 34, 0.96) 55%)'
          : 'linear-gradient(160deg, rgba(27, 34, 48, 0.92) 0%, rgba(15, 19, 27, 0.96) 100%)';

  const cardShadow = tagmarTheme?.glow
    ? tagmarTheme.glow
    : isCrit
      ? '0 0 22px rgba(212, 168, 79, 0.22)'
      : isFumble
        ? '0 0 18px rgba(239, 68, 68, 0.2)'
        : 'var(--shadow-sm)';

  const handleActionClick = (action: InteractiveAction) => {
    const isServerAction = serverActions.some((a) => a.id === action.id);
    const targetId = selectedTargetId || action.targetCharacterId || effectiveTargetId;
    const targetChar = characters.find((c) => c.id === targetId);

    if (action.actionType === 'roll_followup') {
      const formula = String(action.payload.formula ?? '1d6');
      const label = String(action.payload.label ?? `Dano · ${roll.label}`);
      const mult = Number(action.payload.criticalMultiplier ?? 1);
      const rawRes = action.payload.tagmarResistance as TagmarResistanceRequest | undefined;
      let tagmarResistance: TagmarResistanceRequest | undefined;
      if (rawRes) {
        const computedFd =
          rawRes.kind === 'rf'
            ? Number(targetChar?.computed?.rf ?? rawRes.fd ?? 1)
            : Number(targetChar?.computed?.rm ?? rawRes.fd ?? 1);
        tagmarResistance = {
          kind: rawRes.kind,
          fa: Number(rawRes.fa ?? 5),
          fd: computedFd,
        };
      }

      rollDice({
        formula: mult > 1 ? `(${formula}) * ${mult}` : formula,
        label,
        characterId: rawRes ? (targetChar?.id ?? activeCharacter?.id) : (message.characterId ?? activeCharacter?.id),
        targetCharacterId: targetId || undefined,
        tagmarResistance,
        systemMeta: {
          ...action.payload,
          systemId: rawRes ? 'tagmar-3' : systemId,
          kind: rawRes
            ? 'resistance'
            : label.toLowerCase().includes('cura')
              ? 'heal'
              : 'damage',
          resistanceKind: tagmarResistance?.kind,
          fa: tagmarResistance?.fa,
          fd: tagmarResistance?.fd,
          targetCharacterId: targetId || undefined,
          targetName: targetChar?.name,
        },
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      return;
    }

    // If it's a persisted server action and target wasn't overridden, run through WS
    if (isServerAction && (!selectedTargetId || selectedTargetId === action.targetCharacterId)) {
      executeChatAction(message.id, action.id);
      return;
    }

    // Execute directly via system engine + character.patch
    if (action.actionType === 'apply_damage') {
      if (!targetChar) {
        pushToast('Selecione um alvo para aplicar o dano.', 'warning');
        setShowQuickApply(true);
        return;
      }
      const amount = Math.max(0, Number(action.payload.amount ?? roll.total));
      const dmgType = typeof action.payload.damageType === 'string' ? action.payload.damageType : undefined;
      const directToEf = Boolean(action.payload.directToEf);
      const ignoreAbsorption = Boolean(action.payload.ignoreAbsorption);
      const targetEngine = getSystemEngine(targetChar.systemId);
      const patch =
        targetChar.systemId === 'tagmar-3'
          ? tagmar3Engine.applyDamage(targetChar, amount, {
              damageType: dmgType,
              directToEf,
              ignoreAbsorption,
            })
          : targetEngine.applyDamage(targetChar, amount, dmgType);
      patchCharacter(targetChar.id, patch);
      const tagmarModeNote =
        targetChar.systemId === 'tagmar-3'
          ? directToEf
            ? ' [Direto na EF — Crítico!]'
            : ' [EH→EF]'
          : '';
      sendChat({
        kind: 'combat_action',
        content: `${targetChar.name} sofreu ${amount} de dano${dmgType ? ` (${dmgType})` : ''}${tagmarModeNote}.`,
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`Aplicado ${amount} de dano em ${targetChar.name}${tagmarModeNote}.`, 'success');
      return;
    }

    if (action.actionType === 'apply_heal') {
      const healTarget = targetChar ?? actor;
      if (!healTarget) {
        pushToast('Selecione um personagem para aplicar cura.', 'warning');
        setShowQuickApply(true);
        return;
      }
      const amount = Math.max(0, Number(action.payload.amount ?? roll.total));
      const targetEngine = getSystemEngine(healTarget.systemId);
      const patch = targetEngine.applyHealing(healTarget, amount);
      patchCharacter(healTarget.id, patch);
      const unitLabel = healTarget.systemId === 'tagmar-3' ? 'EF/EH' : 'PV';
      sendChat({
        kind: 'combat_action',
        content: `${healTarget.name} recuperou ${amount} ${unitLabel}.`,
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`Curado ${amount} ${unitLabel} em ${healTarget.name}.`, 'success');
      return;
    }

    if (
      action.actionType === 'spend_mana' ||
      action.actionType === 'spend_karma' ||
      action.actionType === 'spend_resource'
    ) {
      const spendActor = targetChar && action.targetCharacterId ? targetChar : actor;
      if (!spendActor) {
        pushToast(
          isTagmarCampaign
            ? 'Nenhum personagem ativo para descontar Karma.'
            : 'Nenhum personagem ativo para descontar PM.',
          'warning'
        );
        return;
      }
      const resName =
        typeof action.payload.resource === 'string' ? action.payload.resource.toLowerCase() : '';
      const isKarma =
        action.actionType === 'spend_karma' ||
        resName === 'karma' ||
        (action.actionType === 'spend_mana' && spendActor.systemId === 'tagmar-3');
      const isMana =
        resName === 'pm' ||
        resName === 'mp' ||
        (action.actionType === 'spend_mana' && !isKarma);
      const amount = Math.max(0, Number(action.payload.amount ?? (isKarma ? karmaSpent : manaSpent)));

      if (isKarma || isMana || !resName) {
        const actorEngine = getSystemEngine(spendActor.systemId);
        const res = actorEngine.spendMana(spendActor, amount);
        if (res.error || !res.patch) {
          pushToast(res.error ?? (isKarma ? 'Karma insuficiente.' : 'Mana insuficiente.'), 'error');
          return;
        }
        patchCharacter(spendActor.id, res.patch);
        setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
        pushToast(`${spendActor.name} gastou ${amount} ${isKarma ? 'Karma' : 'PM'}.`, 'info');
        return;
      }

      const bar = spendActor.resources?.[resName];
      if (!bar || bar.current < amount) {
        pushToast(`Recurso ${resName.toUpperCase()} insuficiente.`, 'error');
        return;
      }
      patchCharacter(spendActor.id, {
        resources: {
          ...spendActor.resources,
          [resName]: { ...bar, current: Math.max(0, bar.current - amount) },
        },
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`${spendActor.name} gastou ${amount} ${resName.toUpperCase()}.`, 'info');
      return;
    }

    if (action.actionType === 'apply_condition') {
      const condTarget = targetChar ?? actor;
      if (!condTarget) {
        pushToast('Selecione um alvo para aplicar a condição.', 'warning');
        setShowQuickApply(true);
        return;
      }
      const conditionId = String(action.payload.conditionId ?? '');
      const rounds = typeof action.payload.rounds === 'number' ? action.payload.rounds : undefined;
      if (!conditionId) return;
      const targetEngine = getSystemEngine(condTarget.systemId);
      const patch = targetEngine.applyCondition(condTarget, conditionId, rounds);
      patchCharacter(condTarget.id, patch);
      sendChat({
        kind: 'combat_action',
        content: `${condTarget.name} recebeu a condição ${conditionId}.`,
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`Condição aplicada em ${condTarget.name}.`, 'info');
    }
  };

  const handleQuickApplyAmount = (kind: 'damage' | 'damage_ef' | 'heal') => {
    const targetChar =
      characters.find((c) => c.id === effectiveTargetId) ??
      (kind === 'heal' ? actor : undefined);
    if (!targetChar) {
      pushToast('Escolha um personagem no seletor de alvo acima.', 'warning');
      return;
    }
    const amount = Math.max(0, Math.floor(roll.total));
    const targetEngine = getSystemEngine(targetChar.systemId);
    const patch =
      kind === 'heal'
        ? targetEngine.applyHealing(targetChar, amount)
        : targetChar.systemId === 'tagmar-3'
          ? tagmar3Engine.applyDamage(targetChar, amount, {
              directToEf: kind === 'damage_ef',
              ignoreAbsorption: kind === 'damage_ef',
            })
          : targetEngine.applyDamage(targetChar, amount);
    patchCharacter(targetChar.id, patch);
    const isTargetTagmar = targetChar.systemId === 'tagmar-3';
    sendChat({
      kind: 'combat_action',
      content:
        kind === 'heal'
          ? `${targetChar.name} recuperou ${amount} ${isTargetTagmar ? 'EF/EH' : 'PV'}.`
          : kind === 'damage_ef'
            ? `${targetChar.name} sofreu ${amount} de dano DIRETO na EF (Crítico!).`
            : `${targetChar.name} sofreu ${amount} de dano${isTargetTagmar ? ' (EH→EF)' : ''}.`,
    });
    pushToast(
      kind === 'heal'
        ? `+${amount} ${isTargetTagmar ? 'EF/EH' : 'PV'} curado em ${targetChar.name}`
        : kind === 'damage_ef'
          ? `-${amount} EF (Crítico!) aplicado em ${targetChar.name}`
          : `-${amount} ${isTargetTagmar ? 'EH→EF' : 'PV'} aplicado em ${targetChar.name}`,
      'success'
    );
  };

  const hasApplyDamageAction = actions.some((a) => a.actionType === 'apply_damage');
  const hasApplyHealAction = actions.some((a) => a.actionType === 'apply_heal');

  return (
    <div
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        borderRadius: 'var(--radius-md)',
        padding: compact ? '10px 11px' : '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        boxShadow: cardShadow,
      }}
    >
      {/* TAGMAR 3.0 COLOR-CODED TABELA DE RESOLUÇÃO BANNER */}
      {isTagmarTable && tagmarTheme && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            padding: '7px 11px',
            borderRadius: 'var(--radius-xs)',
            background: tagmarTheme.bg,
            border: `1px solid ${tagmarTheme.border}`,
            color: tagmarTheme.text,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontFamily: 'var(--font-display)',
              fontSize: compact ? 12 : 13,
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {tagmarInfo.color === 'azul' ? (
              <Sparkles size={14} />
            ) : tagmarInfo.color === 'erro_critico' ? (
              <Skull size={14} />
            ) : (
              <Shield size={14} />
            )}
            <span>{tagmarTheme.title}</span>
          </div>
          <div
            style={{
              fontSize: 10.5,
              opacity: 0.92,
              fontFamily: 'var(--font-mono)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {tagmarInfo.column !== undefined && <span>Col. {tagmarInfo.column}</span>}
            <span>· 1d20 = {tagmarInfo.d20}</span>
            {tagmarInfo.overflowSteps > 0 && tagmarInfo.effectiveColumn !== undefined && (
              <span>
                · Overflow → Col. {tagmarInfo.effectiveColumn} (+{tagmarInfo.overflowTiers} faixas)
              </span>
            )}
            {outcome?.targetDefense !== undefined && (
              <span>· vs Def {outcome.targetDefense}</span>
            )}
          </div>
        </div>
      )}

      {/* TAGMAR 3.0 RESISTANCE BANNER (RF / RM) */}
      {isTagmarResistance && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            padding: '7px 11px',
            borderRadius: 'var(--radius-xs)',
            background: tagmarInfo.resisted
              ? 'linear-gradient(90deg, rgba(22, 163, 74, 0.28), rgba(34, 197, 94, 0.42), rgba(22, 163, 74, 0.28))'
              : 'linear-gradient(90deg, rgba(185, 28, 28, 0.3), rgba(239, 68, 68, 0.45), rgba(185, 28, 28, 0.3))',
            border: `1px solid ${tagmarInfo.resisted ? 'rgba(74, 222, 128, 0.75)' : 'rgba(248, 113, 113, 0.78)'}`,
            color: tagmarInfo.resisted ? '#dcfce7' : '#fee2e2',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 12.5, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>
            {tagmarInfo.resisted ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
            <span>
              {tagmarInfo.kind.toUpperCase()} — {tagmarInfo.resisted ? 'RESISTIU!' : 'AFETADO!'}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
            d20={tagmarInfo.d20} {tagmarInfo.resisted ? '≥' : '<'} {tagmarInfo.target} (FD {tagmarInfo.fd} vs FA {tagmarInfo.fa})
          </span>
        </div>
      )}

      {/* Non-Tagmar Dramatic Crit / Fumble Banner (Mighty Blade 6+6 / 1+1 etc.) */}
      {!isTagmarTable && !isTagmarResistance && isCrit && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 'var(--radius-xs)',
            background: 'linear-gradient(90deg, rgba(212,168,79,0.28), rgba(242,204,123,0.42), rgba(212,168,79,0.28))',
            border: '1px solid rgba(242, 204, 123, 0.7)',
            color: '#fef3c7',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <Sparkles size={14} />
          <span>{outcome?.badgeText ?? 'CRÍTICO! (2× Dano)'}</span>
        </div>
      )}

      {!isTagmarTable && !isTagmarResistance && isFumble && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 'var(--radius-xs)',
            background: 'linear-gradient(90deg, rgba(220,38,38,0.25), rgba(239,68,68,0.42), rgba(220,38,38,0.25))',
            border: '1px solid rgba(248, 113, 113, 0.65)',
            color: '#fee2e2',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <Skull size={14} />
          <span>{outcome?.badgeText ?? 'FALHA CRÍTICA!'}</span>
        </div>
      )}

      {/* Header: Roll label + formula + PM/Karma cost */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Dices size={15} style={{ color: tagmarTheme?.accent ?? 'var(--gold-400)', flexShrink: 0 }} />
          <span
            style={{
              fontWeight: 700,
              fontSize: compact ? 13 : 14,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {roll.label || 'Rolagem'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {karmaSpent > 0 && (
            <span className="mesa-badge mesa-badge--sapphire">
              <Sparkles size={11} />
              {karmaAlreadySpent ? `-${karmaSpent} Karma gastos` : `Custo ${karmaSpent} Karma`}
            </span>
          )}
          {manaSpent > 0 && karmaSpent === 0 && (
            <span className="mesa-badge mesa-badge--sapphire">
              <Zap size={11} />
              {manaAlreadySpent ? `-${manaSpent} PM gastos` : `Custo ${manaSpent} PM`}
            </span>
          )}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-muted)',
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: 'rgba(0,0,0,0.28)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {roll.formula}
          </span>
        </div>
      </div>

      {/* Dice faces & total breakdown */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          padding: '8px 10px',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(7, 9, 13, 0.55)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {roll.dice.map((die, idx) => {
            const hl = getDieHighlight(die);
            const tagmarDieColor = isTagmarTable && die.sides === 20 ? tagmarTheme?.accent : undefined;
            return (
              <span
                key={`${die.sides}-${idx}`}
                title={`d${die.sides}${die.dropped ? ' (descartado)' : ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 30,
                  height: 30,
                  padding: '0 6px',
                  borderRadius: 7,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  fontWeight: 800,
                  opacity: die.dropped ? 0.4 : 1,
                  textDecoration: die.dropped ? 'line-through' : 'none',
                  background: tagmarDieColor
                    ? `${tagmarDieColor}33`
                    : hl === 'max'
                      ? 'rgba(212, 168, 79, 0.24)'
                      : hl === 'min'
                        ? 'rgba(239, 68, 68, 0.22)'
                        : 'var(--bg-elevated)',
                  border: tagmarDieColor
                    ? `1px solid ${tagmarDieColor}`
                    : hl === 'max'
                      ? '1px solid rgba(242, 204, 123, 0.85)'
                      : hl === 'min'
                        ? '1px solid rgba(248, 113, 113, 0.7)'
                        : '1px solid var(--border-default)',
                  color: tagmarDieColor
                    ? '#ffffff'
                    : hl === 'max'
                      ? '#fde68a'
                      : hl === 'min'
                        ? '#fca5a5'
                        : 'var(--text-primary)',
                  boxShadow: tagmarDieColor
                    ? `0 0 10px ${tagmarDieColor}55`
                    : hl === 'max'
                      ? '0 0 10px rgba(212, 168, 79, 0.3)'
                      : undefined,
                }}
              >
                {die.value}
                <sub style={{ fontSize: 9, opacity: 0.65, marginLeft: 1 }}>d{die.sides}</sub>
              </span>
            );
          })}

          {roll.modifier !== 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                padding: '0 2px',
              }}
            >
              {roll.modifier > 0 ? `+ ${roll.modifier}` : `- ${Math.abs(roll.modifier)}`}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>=</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: compact ? 22 : 26,
              fontWeight: 800,
              lineHeight: 1,
              color: tagmarTheme
                ? tagmarTheme.accent
                : isTagmarResistance
                  ? tagmarInfo.resisted
                    ? '#4ade80'
                    : '#f87171'
                  : isCrit
                    ? '#fde68a'
                    : isFumble
                      ? '#f87171'
                      : isSuccess
                        ? '#4ade80'
                        : isFailure
                          ? '#fca5a5'
                          : 'var(--gold-400)',
            }}
          >
            {roll.total}
          </span>
        </div>
      </div>

      {/* Difficulty / Defense comparison badge (Non-Tagmar or target name display) */}
      {!isTagmarTable &&
        !isTagmarResistance &&
        outcome &&
        !isCrit &&
        !isFumble &&
        (outcome.difficulty !== undefined || outcome.targetDefense !== undefined) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 12,
            }}
          >
            <span
              className={`mesa-badge ${
                isSuccess ? 'mesa-badge--emerald' : isFailure ? 'mesa-badge--crimson' : 'mesa-badge--gold'
              }`}
            >
              <Shield size={11} />
              {outcome.badgeText ??
                (isSuccess
                  ? `Sucesso! vs ${outcome.targetDefense !== undefined ? `Def ${outcome.targetDefense}` : `Dif ${outcome.difficulty}`}`
                  : `Falha vs ${outcome.targetDefense !== undefined ? `Def ${outcome.targetDefense}` : `Dif ${outcome.difficulty}`}`)}
            </span>
            {outcome.targetName && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Alvo: <strong style={{ color: 'var(--text-secondary)' }}>{outcome.targetName}</strong>
              </span>
            )}
          </div>
        )}

      {/* Interactive 1-Click Automation Buttons + Target Picker */}
      {(actions.length > 0 || isDamageRoll || isHealRoll || showQuickApply) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 2 }}>
          {characters.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Crosshair size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <select
                aria-label="Alvo da ação"
                value={effectiveTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'rgba(7, 9, 13, 0.72)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '4px 8px',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                <option value="">Alvo automático / escolher personagem...</option>
                {characters.map((ch) => {
                  if (ch.systemId === 'tagmar-3') {
                    const eh = ch.resources?.eh;
                    const ef = ch.resources?.ef;
                    return (
                      <option key={ch.id} value={ch.id}>
                        {ch.name} {eh && ef ? `(EH ${eh.current}/${eh.max} · EF ${ef.current}/${ef.max})` : ''}
                      </option>
                    );
                  }
                  const hp = ch.resources?.pv ?? ch.resources?.hp;
                  return (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} {hp ? `(${hp.current}/${hp.max} PV)` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {actions.map((action) => {
              const executedBy = action.executedBy ?? localExecuted[action.id];
              const isDone = Boolean(executedBy);
              const isDirectEf = Boolean(action.payload.directToEf);
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleActionClick(action)}
                  disabled={isDone && action.actionType !== 'roll_followup'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid',
                    fontSize: 12,
                    fontWeight: 600,
                    minHeight: 30,
                    transition: 'filter 120ms ease, transform 100ms ease',
                    ...getActionToneStyle(action.style, isDirectEf),
                    opacity: isDone ? 0.72 : 1,
                  }}
                >
                  {isDone ? <Check size={13} /> : renderActionIcon(action)}
                  <span>{isDone ? `${action.label} (${executedBy})` : action.label}</span>
                </button>
              );
            })}

            {isDamageRoll && !hasApplyDamageAction && (
              <>
                <button
                  type="button"
                  onClick={() => handleQuickApplyAmount('damage')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid',
                    fontSize: 12,
                    fontWeight: 600,
                    minHeight: 30,
                    ...getActionToneStyle('damage'),
                  }}
                >
                  <Swords size={13} />
                  <span>
                    Aplicar {roll.total} Dano{isTagmarCampaign ? ' (EH→EF)' : ''}
                    {resolvedTarget ? ` em ${resolvedTarget.name}` : ''}
                  </span>
                </button>
                {isTagmarCampaign && (
                  <button
                    type="button"
                    onClick={() => handleQuickApplyAmount('damage_ef')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid',
                      fontSize: 12,
                      fontWeight: 600,
                      minHeight: 30,
                      ...getActionToneStyle('damage', true),
                    }}
                  >
                    <Sparkles size={13} />
                    <span>Aplicar {roll.total} Direto na EF (Crítico!)</span>
                  </button>
                )}
              </>
            )}

            {isHealRoll && !hasApplyHealAction && (
              <button
                type="button"
                onClick={() => handleQuickApplyAmount('heal')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid',
                  fontSize: 12,
                  fontWeight: 600,
                  minHeight: 30,
                  ...getActionToneStyle('heal'),
                }}
              >
                <Heart size={13} />
                <span>
                  Aplicar {roll.total} Cura{resolvedTarget ? ` em ${resolvedTarget.name}` : ''}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Subtle quick-apply toggle for arbitrary manual rolls (e.g. /r 2d6+3) */}
      {actions.length === 0 && !isDamageRoll && !isHealRoll && !showQuickApply && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button
            type="button"
            onClick={() => setShowQuickApply(true)}
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            Aplicar como Dano / Cura…
          </button>
        </div>
      )}

      {showQuickApply && actions.length === 0 && !isDamageRoll && !isHealRoll && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleQuickApplyAmount('damage')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid',
              fontSize: 11,
              fontWeight: 600,
              ...getActionToneStyle('damage'),
            }}
          >
            <Swords size={12} />
            Aplicar {roll.total} Dano{isTagmarCampaign ? ' (EH→EF)' : ''}
          </button>
          {isTagmarCampaign && (
            <button
              type="button"
              onClick={() => handleQuickApplyAmount('damage_ef')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 9px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid',
                fontSize: 11,
                fontWeight: 600,
                ...getActionToneStyle('damage', true),
              }}
            >
              <Sparkles size={12} />
              Direto na EF (Crítico!)
            </button>
          )}
          <button
            type="button"
            onClick={() => handleQuickApplyAmount('heal')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid',
              fontSize: 11,
              fontWeight: 600,
              ...getActionToneStyle('heal'),
            }}
          >
            <Heart size={12} />
            Aplicar {roll.total} Cura
          </button>
        </div>
      )}
    </div>
  );
}

export default RollCard;
