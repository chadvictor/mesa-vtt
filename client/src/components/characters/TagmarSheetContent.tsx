import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  Backpack,
  BookOpen,
  Check,
  Coffee,
  Crosshair,
  Dices,
  Flame,
  FlaskConical,
  Heart,
  Minus,
  Moon,
  Plus,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import {
  getSpecializationsForProfession,
  tagmarCombatTechniques,
  tagmarConditions,
  tagmarEquipment,
  tagmarRules,
  tagmarSkills,
  tagmarSpells,
} from '@systems/tagmar/compendium';
import {
  advanceStage,
  buildAttributeRoll,
  buildResistanceRoll,
  buildSkillRoll,
  buildSpellRoll,
  buildWeaponAttackRoll,
  readTagmarData,
  spendKarma,
  tagmar3Engine,
} from '@systems/tagmar/engine';
import type {
  Character,
  TagmarAttributes,
  TagmarColorDamage,
  TagmarEquipmentEntry,
  TagmarSpellEntry,
  TagmarSystemData,
  Visibility,
} from '@systems/types';
import type { AssetEntry } from '@/lib/api';
import { useCampaignStore } from '@/lib/store';
import { TagmarDamagePills } from '@/components/library/TagmarCompendiumView';

type TagmarSheetTab = 'combat' | 'skills' | 'spells' | 'equipment' | 'bio';

const TAGMAR_ATTRS: Array<{ key: keyof TagmarAttributes; label: string; abbr: string }> = [
  { key: 'intelecto', label: 'Intelecto', abbr: 'INT' },
  { key: 'aura', label: 'Aura', abbr: 'AUR' },
  { key: 'carisma', label: 'Carisma', abbr: 'CAR' },
  { key: 'forca', label: 'Força', abbr: 'FOR' },
  { key: 'fisico', label: 'Físico', abbr: 'FIS' },
  { key: 'agilidade', label: 'Agilidade', abbr: 'AGI' },
];

function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export interface TagmarSheetContentProps {
  character: Character;
  canEdit: boolean;
  portraits: AssetEntry[];
  onClose: () => void;
}

export function TagmarSheetContent({
  character,
  canEdit,
  portraits,
  onClose,
}: TagmarSheetContentProps) {
  const {
    characters,
    targetCharacterId,
    setTargetCharacterId,
    targetCharacter,
    isGm,
    patchCharacter,
    deleteCharacter,
    rollDice,
    sendChat,
    uploadImage,
    pushToast,
  } = useCampaignStore();

  const [activeTab, setActiveTab] = useState<TagmarSheetTab>('combat');
  const [portraitPickerOpen, setPortraitPickerOpen] = useState(false);
  const [uploadingPortrait, setUploadingPortrait] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [attrPopover, setAttrPopover] = useState<keyof TagmarAttributes | null>(null);
  const [extraColMod, setExtraColMod] = useState<number>(0);
  const [resistFa, setResistFa] = useState<number>(8);
  const [conditionMenuOpen, setConditionMenuOpen] = useState(false);

  const [stageUpOpen, setStageUpOpen] = useState(false);
  const [stageEhRoll, setStageEhRoll] = useState<number>(6);
  const [stageSpecId, setStageSpecId] = useState<string>('');

  const [addSkillDrawer, setAddSkillDrawer] = useState<'skill' | 'technique' | null>(null);
  const [addSpellDrawer, setAddSpellDrawer] = useState(false);
  const [addItemDrawer, setAddItemDrawer] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState('');

  const data = useMemo(() => readTagmarData(character), [character]);
  const derived = useMemo(() => tagmar3Engine.computeDerivedStats(character), [character]);
  const comp = derived.computed as Record<string, unknown>;

  const nextStageRow = useMemo(
    () => tagmarRules.stageProgression.stages.find((s) => s.stage === data.stage + 1),
    [data.stage]
  );

  const availableSpecs = useMemo(
    () => getSpecializationsForProfession(data.professionId),
    [data.professionId]
  );

  const updateTagmarData = (nextSys: TagmarSystemData, extraPatch?: Partial<Character>) => {
    const draft: Character = {
      ...character,
      ...extraPatch,
      systemData: nextSys as unknown as Record<string, unknown>,
    };
    const { computed, resourceMax } = tagmar3Engine.computeDerivedStats(draft);
    const curEh = draft.resources?.eh ?? { current: resourceMax.eh, max: resourceMax.eh };
    const curEf = draft.resources?.ef ?? {
      current: resourceMax.ef,
      max: resourceMax.ef,
      temp: Number(computed.absorcao ?? 0),
    };
    const curKarma = draft.resources?.karma ?? { current: resourceMax.karma, max: resourceMax.karma };
    const newAbs = Number(computed.absorcao ?? 0);

    patchCharacter(character.id, {
      ...extraPatch,
      systemData: draft.systemData,
      computed,
      resources: {
        ...draft.resources,
        eh: { ...curEh, max: resourceMax.eh, current: Math.min(curEh.current, resourceMax.eh) },
        ef: {
          ...curEf,
          max: resourceMax.ef,
          current: Math.min(curEf.current, resourceMax.ef),
          temp: Math.min(curEf.temp ?? newAbs, newAbs),
        },
        karma: {
          ...curKarma,
          max: resourceMax.karma,
          current: Math.min(curKarma.current, resourceMax.karma),
        },
      },
    });
  };

  const adjustResource = (key: 'eh' | 'ef' | 'karma', delta: number) => {
    const bar = character.resources?.[key] ?? {
      current: derived.resourceMax[key] ?? 0,
      max: derived.resourceMax[key] ?? 0,
    };
    const minVal = key === 'ef' ? -20 : 0;
    const nextCurrent = Math.max(minVal, Math.min(bar.max, bar.current + delta));
    const nextResources = {
      ...character.resources,
      [key]: { ...bar, current: nextCurrent },
    };
    const draft = { ...character, resources: nextResources };
    const { computed } = tagmar3Engine.computeDerivedStats(draft);
    patchCharacter(character.id, { resources: nextResources, computed });
  };

  const handleUploadPortrait = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPortrait(true);
    const url = await uploadImage(file);
    setUploadingPortrait(false);
    if (url) {
      patchCharacter(character.id, { portraitUrl: url });
      setPortraitPickerOpen(false);
      pushToast('Retrato atualizado!', 'success');
    }
  };

  const handleRest = (kind: 'short' | 'long') => {
    const patch = tagmar3Engine.rest(character, kind);
    patchCharacter(character.id, patch);
    sendChat({
      kind: 'combat_action',
      content:
        kind === 'short'
          ? `${character.name} realizou um Descanso Curto (+2 EH / +1 Karma).`
          : `${character.name} realizou um Descanso Longo (+16 EH / +1 EF / 100% Karma / Absorção reparada).`,
    });
    pushToast(kind === 'short' ? 'Descanso Curto aplicado!' : 'Descanso Longo aplicado!', 'success');
  };

  const handleConfirmStageUp = () => {
    const patch = advanceStage(character, {
      ehRoll: stageEhRoll,
      specializationId: !data.specializationId && data.stage + 1 >= 5 && stageSpecId ? stageSpecId : undefined,
    });
    patchCharacter(character.id, patch);
    sendChat({
      kind: 'system',
      content: `🎉 ${character.name} alcançou o Estágio ${data.stage + 1} em Tagmar 3.0!`,
    });
    pushToast(`Subiu para o Estágio ${data.stage + 1}!`, 'success');
    setStageUpOpen(false);
  };

  const handleToggleCondition = (condId: string) => {
    const has = character.conditions.some((c) => c.id === condId);
    const patch = has
      ? tagmar3Engine.removeCondition(character, condId)
      : tagmar3Engine.applyCondition(character, condId);
    patchCharacter(character.id, patch);
  };

  const handleRollAttribute = (attrKey: keyof TagmarAttributes, bonus = 0) => {
    const plan = buildAttributeRoll(character, attrKey, { bonus });
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      tagmarColumn: plan.tagmarColumn,
      systemMeta: plan.systemMeta,
    });
    setAttrPopover(null);
  };

  const handleRollResistance = (kind: 'rf' | 'rm') => {
    const plan = buildResistanceRoll(character, kind, resistFa);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      difficulty: plan.difficulty,
      tagmarResistance: plan.tagmarResistance,
      systemMeta: plan.systemMeta,
    });
  };

  const handleRollInitiative = () => {
    const plan = tagmar3Engine.planInitiative(character);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      systemMeta: plan.systemMeta,
    });
  };

  const handleWeaponAttack = (weaponId: string) => {
    const plan = buildWeaponAttackRoll(character, weaponId, targetCharacter ?? undefined);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      targetCharacterId: plan.targetCharacterId,
      targetDefense: plan.targetDefense,
      tagmarColumn: plan.tagmarColumn,
      systemMeta: plan.systemMeta,
    });
  };

  const handleRollSkillOrTech = (id: string) => {
    const plan = buildSkillRoll(character, id);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      tagmarColumn: plan.tagmarColumn,
      systemMeta: plan.systemMeta,
    });
  };

  const handleCastSpell = (sp: TagmarSpellEntry) => {
    if (Boolean(comp.cannotCastSpells)) {
      pushToast('Uma condição ativa impede evocar magias!', 'warning');
    }
    const cost = sp.karmaCost ?? 0;
    if (cost > 0) {
      const spend = spendKarma(character, cost);
      if (spend.error) {
        pushToast(spend.error, 'error');
        return;
      }
      if (spend.patch) patchCharacter(character.id, spend.patch);
    }
    const plan = buildSpellRoll(character, sp.id, targetCharacter ?? undefined);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      targetCharacterId: plan.targetCharacterId,
      tagmarColumn: plan.tagmarColumn,
      systemMeta: { ...plan.systemMeta, karmaCost: cost, karmaAlreadySpent: cost > 0 },
    });
  };

  const handleToggleEquip = (itemId: string) => {
    const nextInv = data.inventory.map((it) =>
      it.id === itemId ? { ...it, equipped: !it.equipped } : it
    );
    const nextSys = { ...data, inventory: nextInv };
    const draft: Character = { ...character, systemData: nextSys as unknown as Record<string, unknown> };
    const { computed, resourceMax } = tagmar3Engine.computeDerivedStats(draft);
    const newAbs = Number(computed.absorcao ?? 0);
    const curEf = character.resources?.ef ?? { current: resourceMax.ef, max: resourceMax.ef };
    patchCharacter(character.id, {
      systemData: draft.systemData,
      computed,
      resources: {
        ...character.resources,
        ef: { ...curEf, temp: newAbs },
      },
    });
  };

  const handleUseConsumable = (item: TagmarEquipmentEntry) => {
    const eff = (item.effect ?? {}) as Record<string, unknown>;
    const curEh = character.resources?.eh ?? { current: derived.resourceMax.eh, max: derived.resourceMax.eh };
    const curEf = character.resources?.ef ?? { current: derived.resourceMax.ef, max: derived.resourceMax.ef };
    const curKarma = character.resources?.karma ?? { current: derived.resourceMax.karma, max: derived.resourceMax.karma };

    let nextEh = curEh.current;
    let nextEf = curEf.current;
    let nextKarma = curKarma.current;
    const notes: string[] = [];

    if (typeof eff.healEf === 'number' && eff.healEf > 0) {
      nextEf = Math.min(curEf.max, nextEf + eff.healEf);
      notes.push(`+${eff.healEf} EF`);
    }
    if (typeof eff.healEh === 'number' && eff.healEh > 0) {
      nextEh = Math.min(curEh.max, nextEh + eff.healEh);
      notes.push(`+${eff.healEh} EH`);
    }
    if (typeof eff.restoreKarma === 'number' && eff.restoreKarma > 0) {
      nextKarma = Math.min(curKarma.max, nextKarma + eff.restoreKarma);
      notes.push(`+${eff.restoreKarma} Karma`);
    }

    const curedIds = new Set<string>();
    if (typeof eff.cureCondition === 'string' && eff.cureCondition.trim()) {
      curedIds.add(eff.cureCondition.trim());
      notes.push(`curou ${eff.cureCondition.trim()}`);
    } else if (Array.isArray(eff.cureCondition)) {
      for (const cid of eff.cureCondition) {
        if (typeof cid === 'string' && cid.trim()) {
          curedIds.add(cid.trim());
          notes.push(`curou ${cid.trim()}`);
        }
      }
    }

    const nextInv = data.inventory
      .map((it) => (it.id === item.id ? { ...it, quantity: (it.quantity ?? 1) - 1 } : it))
      .filter((it) => it.quantity > 0);

    const nextSys = { ...data, inventory: nextInv };
    const nextResources = {
      ...character.resources,
      eh: { ...curEh, current: nextEh },
      ef: { ...curEf, current: nextEf },
      karma: { ...curKarma, current: nextKarma },
    };
    const nextConditions = character.conditions.filter((c) => {
      if (curedIds.has(c.id)) return false;
      if (nextEf > 0 && (c.id === 'inconsciente' || c.id === 'agonizando')) return false;
      return true;
    });
    const draft: Character = {
      ...character,
      resources: nextResources,
      conditions: nextConditions,
      systemData: nextSys as unknown as Record<string, unknown>,
    };
    const { computed } = tagmar3Engine.computeDerivedStats(draft);

    patchCharacter(character.id, {
      resources: nextResources,
      conditions: nextConditions,
      systemData: draft.systemData,
      computed,
    });
    sendChat({
      kind: 'combat_action',
      content: `${character.name} usou ${item.name}${notes.length ? ` (${notes.join(', ')})` : ''}.`,
    });
    pushToast(`Usou ${item.name}!`, 'success');
  };

  const eh = character.resources?.eh ?? { current: derived.resourceMax.eh, max: derived.resourceMax.eh };
  const ef = character.resources?.ef ?? {
    current: derived.resourceMax.ef,
    max: derived.resourceMax.ef,
    temp: Number(comp.absorcao ?? 0),
  };
  const karma = character.resources?.karma ?? {
    current: derived.resourceMax.karma,
    max: derived.resourceMax.karma,
  };

  const equippedWeapons =
    (comp.equippedWeapons as Array<{
      id: string;
      name: string;
      column: number;
      damage: TagmarColorDamage;
      damageType: string;
      range: string;
      techniqueName?: string;
      underMinFor: boolean;
    }>) ?? [];

  const condShift = Number(comp.conditionColumnShift ?? 0);
  const usesPassiveDef = Boolean(comp.usesPassiveDefense);
  const dq = drawerQuery.trim().toLowerCase();

  return (
    <>
      {/* TOP HEADER */}
      <div
        className="mesa-modal__header"
        style={{
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-start',
          background: 'linear-gradient(180deg, rgba(34, 197, 94, 0.12) 0%, transparent 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 220 }}>
          <button
            type="button"
            onClick={() => canEdit && setPortraitPickerOpen((v) => !v)}
            title={canEdit ? 'Clique para trocar retrato' : undefined}
            style={{
              width: 62,
              height: 62,
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              border: '2px solid var(--emerald-400)',
              boxShadow: 'var(--emerald-glow)',
              flexShrink: 0,
              background: 'var(--bg-obsidian)',
              cursor: canEdit ? 'pointer' : 'default',
            }}
          >
            <img
              src={character.portraitUrl || './assets/portraits/human-warrior.svg'}
              alt={character.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              {canEdit ? (
                <input
                  type="text"
                  value={character.name}
                  onChange={(e) => patchCharacter(character.id, { name: e.target.value })}
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 19,
                    fontWeight: 700,
                    color: 'var(--emerald-400)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px dashed rgba(74, 222, 128, 0.4)',
                    padding: '0 2px',
                    maxWidth: 260,
                  }}
                />
              ) : (
                <h2 className="mesa-modal__title" style={{ fontSize: 19, color: 'var(--emerald-400)' }}>
                  {character.name}
                </h2>
              )}

              <span className="mesa-badge mesa-badge--emerald">Estágio {data.stage}</span>
              <span className="mesa-badge mesa-badge--gold">
                {data.professionName}
                {data.specializationName ? ` · ${data.specializationName}` : ''} · {data.raceName}
              </span>
            </div>

            {/* XP Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>XP:</span>
                <strong style={{ color: 'var(--gold-400)', fontFamily: 'var(--font-mono)' }}>
                  {data.xp}
                </strong>
                {nextStageRow && <span>/ {nextStageRow.xpMin}</span>}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => updateTagmarData({ ...data, xp: data.xp + 1 })}
                    style={{
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 10,
                      color: 'var(--gold-400)',
                    }}
                  >
                    +1 XP
                  </button>
                )}
              </div>
              <span className="mesa-badge" style={{ fontSize: 9.5 }}>
                Tagmar 3.0
              </span>
            </div>
          </div>
        </div>

        {/* Header Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {canEdit && (
            <>
              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={() => handleRest('short')}
                title="Descanso Curto (+2 EH e +1 Karma)"
              >
                <Coffee size={13} /> Curto
              </button>
              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={() => handleRest('long')}
                title="Descanso Longo (+16 EH, +1 EF, 100% Karma e repara Absorção)"
              >
                <Moon size={13} /> Longo
              </button>
              {data.stage < 20 && (
                <button
                  type="button"
                  className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                  onClick={() => setStageUpOpen((v) => !v)}
                >
                  <ArrowUpCircle size={13} /> Subir Estágio
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="mesa-btn mesa-btn--ghost mesa-btn--icon"
            onClick={onClose}
            aria-label="Fechar ficha"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* SCROLLABLE BODY */}
      <div className="mesa-modal__body" style={{ gap: 13 }}>
        {/* Portrait Picker Drawer */}
        {portraitPickerOpen && canEdit && (
          <div
            style={{
              padding: 12,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-obsidian)',
              border: '1px solid rgba(74, 222, 128, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--emerald-400)' }}>
                Escolher Retrato ou Enviar Imagem
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleUploadPortrait}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="mesa-btn mesa-btn--sm"
                  disabled={uploadingPortrait}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={12} />
                  {uploadingPortrait ? 'Enviando...' : 'Upload'}
                </button>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                  onClick={() => setPortraitPickerOpen(false)}
                >
                  Fechar
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 6 }}>
              {portraits.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    patchCharacter(character.id, { portraitUrl: p.url });
                    setPortraitPickerOpen(false);
                  }}
                  className={`avatar-picker-btn ${character.portraitUrl === p.url ? 'avatar-picker-btn--selected' : ''}`}
                  title={p.name}
                >
                  <img src={p.url} alt={p.name} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stage Up Popover */}
        {stageUpOpen && canEdit && (
          <div
            style={{
              padding: 13,
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.16), var(--bg-obsidian))',
              border: '1px solid var(--emerald-400)',
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--emerald-400)' }}>
              Subir para Estágio {data.stage + 1}
              {nextStageRow ? ` (XP ref: ${nextStageRow.xpMin})` : ''}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
              <span>Resultado 1d10 na tabela de EH:</span>
              <input
                type="number"
                min={1}
                max={10}
                value={stageEhRoll}
                onChange={(e) => setStageEhRoll(Math.max(1, Math.min(10, Number(e.target.value) || 5)))}
                className="mesa-input"
                style={{ width: 64, padding: '4px 8px', fontFamily: 'var(--font-mono)' }}
              />
              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={() => setStageEhRoll(Math.floor(Math.random() * 10) + 1)}
              >
                <Dices size={12} /> Sortear 1d10
              </button>
            </div>
            {!data.specializationId && data.stage + 1 >= 5 && availableSpecs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11.5, color: 'var(--gold-400)', fontWeight: 700 }}>
                  Desbloqueado no Estágio 5! Escolher Especialização / Ordem / Colégio:
                </span>
                <select
                  className="mesa-select"
                  value={stageSpecId}
                  onChange={(e) => setStageSpecId(e.target.value)}
                  style={{ padding: '5px 8px', fontSize: 12 }}
                >
                  <option value="">Escolher depois...</option>
                  {availableSpecs.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.organizationType})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="mesa-btn mesa-btn--ghost mesa-btn--sm" onClick={() => setStageUpOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="mesa-btn mesa-btn--emerald mesa-btn--sm" onClick={handleConfirmStageUp}>
                <Check size={13} /> Confirmar Estágio {data.stage + 1}
              </button>
            </div>
          </div>
        )}

        {/* 3 INTERACTIVE RESOURCE BARS: EH, EF (with Unconscious/Dead indicators) & KARMA */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 9 }}>
          {/* EH — Energia Heróica */}
          <div
            style={{
              padding: 10,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-obsidian)',
              border: '1px solid rgba(234, 179, 8, 0.42)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--gold-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Shield size={13} /> EH · Energia Heróica
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15.5, fontWeight: 800 }}>
                {eh.current} <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>/ {eh.max}</span>
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, (eh.current / Math.max(1, eh.max)) * 100))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #eab308, #22c55e)',
                  transition: 'width 180ms ease',
                }}
              />
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 4 }}>
                {[-5, -1, 1, 5].map((d) => (
                  <button
                    key={`eh-${d}`}
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    onClick={() => adjustResource('eh', d)}
                    style={{ flex: 1, minHeight: 26, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  >
                    {d > 0 ? `+${d}` : d}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* EF — Energia Física */}
          <div
            style={{
              padding: 10,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-obsidian)',
              border: `1px solid ${ef.current <= 0 ? 'var(--crimson-500)' : 'rgba(239, 68, 68, 0.45)'}`,
              boxShadow: ef.current <= 0 ? '0 0 14px rgba(239, 68, 68, 0.28)' : undefined,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--crimson-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Heart size={13} /> EF · Energia Física
                {ef.current <= -15 && <span className="mesa-badge mesa-badge--crimson">MORTO</span>}
                {ef.current < 0 && ef.current > -15 && (
                  <span className="mesa-badge mesa-badge--crimson">AGONIZANDO</span>
                )}
                {ef.current === 0 && <span className="mesa-badge mesa-badge--crimson">INCONSCIENTE</span>}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15.5, fontWeight: 800 }}>
                {ef.current} <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>/ {ef.max}</span>
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, (ef.current / Math.max(1, ef.max)) * 100))}%`,
                  height: '100%',
                  background: ef.current <= 0 ? '#991b1b' : 'linear-gradient(90deg, #dc2626, #f87171)',
                  transition: 'width 180ms ease',
                }}
              />
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 4 }}>
                {[-5, -1, 1, 5].map((d) => (
                  <button
                    key={`ef-${d}`}
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    onClick={() => adjustResource('ef', d)}
                    style={{ flex: 1, minHeight: 26, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  >
                    {d > 0 ? `+${d}` : d}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* KARMA */}
          <div
            style={{
              padding: 10,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-obsidian)',
              border: '1px solid rgba(56, 189, 248, 0.42)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Sparkles size={13} /> Karma
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15.5, fontWeight: 800 }}>
                {karma.current} <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>/ {karma.max}</span>
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${karma.max > 0 ? Math.max(0, Math.min(100, (karma.current / karma.max) * 100)) : 0}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #0284c7, #38bdf8)',
                  transition: 'width 180ms ease',
                }}
              />
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 4 }}>
                {[-5, -1, 1, 5].map((d) => (
                  <button
                    key={`km-${d}`}
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    disabled={karma.max === 0 && d < 0}
                    onClick={() => adjustResource('karma', d)}
                    style={{ flex: 1, minHeight: 26, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  >
                    {d > 0 ? `+${d}` : d}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 6 ATTRIBUTE CARDS WITH 1-TAP 1d20 TESTS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(126px, 1fr))', gap: 7 }}>
          {TAGMAR_ATTRS.map((attr) => {
            const val = data.attributes[attr.key];
            const effectiveCol = val + condShift;
            const popoverOpen = attrPopover === attr.key;
            return (
              <div
                key={attr.key}
                style={{
                  position: 'relative',
                  padding: '8px 9px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elevated)',
                  border: `1px solid ${popoverOpen ? 'var(--emerald-400)' : 'var(--border-subtle)'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                  {attr.abbr} · {attr.label.slice(0, 5)}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        updateTagmarData({
                          ...data,
                          attributes: { ...data.attributes, [attr.key]: Math.max(-4, val - 1) },
                        })
                      }
                      style={{ padding: 2, color: 'var(--text-muted)' }}
                      aria-label={`Diminuir ${attr.label}`}
                    >
                      <Minus size={11} />
                    </button>
                  )}
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 23,
                      fontWeight: 800,
                      color: val > 0 ? 'var(--emerald-400)' : val < 0 ? 'var(--crimson-400)' : 'var(--gold-400)',
                      lineHeight: 1,
                    }}
                  >
                    {fmtSigned(val)}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        updateTagmarData({
                          ...data,
                          attributes: { ...data.attributes, [attr.key]: Math.min(6, val + 1) },
                        })
                      }
                      style={{ padding: 2, color: 'var(--text-muted)' }}
                      aria-label={`Aumentar ${attr.label}`}
                    >
                      <Plus size={11} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 3, width: '100%' }}>
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                    style={{ flex: 1, minHeight: 28, padding: '2px 5px', fontSize: 10.5 }}
                    onClick={() => handleRollAttribute(attr.key)}
                    title={`Teste de ${attr.label} na Tabela de Resolução (Coluna ${effectiveCol})`}
                  >
                    <Dices size={11} /> Col {effectiveCol}
                  </button>
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    style={{ minHeight: 28, padding: '0 6px' }}
                    title="Ajustar coluna antes de rolar"
                    onClick={() => setAttrPopover(popoverOpen ? null : attr.key)}
                  >
                    <SlidersHorizontal size={11} />
                  </button>
                </div>

                {popoverOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 5px)',
                      left: 0,
                      minWidth: 185,
                      zIndex: 25,
                      padding: 9,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-obsidian)',
                      border: '1px solid var(--emerald-400)',
                      boxShadow: 'var(--shadow-lg)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--emerald-400)' }}>
                      Teste de {attr.label} (Base {effectiveCol})
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <span>Ajuste Col:</span>
                      <input
                        type="number"
                        value={extraColMod}
                        onChange={(e) => setExtraColMod(Number(e.target.value) || 0)}
                        style={{
                          width: 56,
                          padding: '3px 6px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                      onClick={() => handleRollAttribute(attr.key, extraColMod)}
                    >
                      <Dices size={12} /> Rolar 1d20 (Col {effectiveCol + extraColMod})
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* DERIVED STATS STRIP: DA, DP, Absorção, RF (1-tap), RM (1-tap), VB, Iniciativa */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 6 }}>
          <div
            style={{
              padding: '7px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-obsidian)',
              border: `1px solid ${usesPassiveDef ? 'var(--crimson-500)' : 'var(--border-subtle)'}`,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700 }}>DEF. ATIVA (DA)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: 'var(--gold-400)' }}>
              {String(comp.defesaAtiva ?? 0)}
            </div>
          </div>

          <div
            style={{
              padding: '7px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-obsidian)',
              border: '1px solid var(--border-subtle)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700 }}>DEF. PASSIVA (DP)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
              {String(comp.defesaPassiva ?? 0)}
            </div>
          </div>

          <div
            style={{
              padding: '7px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-obsidian)',
              border: '1px solid var(--border-subtle)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700 }}>
              ABSORÇÃO ({String(comp.armorClass ?? 'L')})
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: 'var(--emerald-400)' }}>
              {ef.temp ?? Number(comp.absorcao ?? 0)}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/{String(comp.absorcao ?? 0)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleRollResistance('rf')}
            title={`Rolar Resistência Física (RF ${String(comp.rf ?? 1)}) contra FA ${resistFa}`}
            style={{
              padding: '7px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(74, 222, 128, 0.35)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, color: 'var(--emerald-400)', fontWeight: 700 }}>RF (1-TAP)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: '#fff' }}>
              {String(comp.rf ?? 1)}
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleRollResistance('rm')}
            title={`Rolar Resistência à Magia (RM ${String(comp.rm ?? 1)}) contra FA ${resistFa}`}
            style={{
              padding: '7px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, color: '#38bdf8', fontWeight: 700 }}>RM (1-TAP)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: '#fff' }}>
              {String(comp.rm ?? 1)}
            </div>
          </button>

          <div
            style={{
              padding: '7px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-obsidian)',
              border: '1px solid var(--border-subtle)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700 }}>VELOCIDADE (VB)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
              {String(comp.vb ?? 20)}m ({String(comp.vbQuadrados ?? 13)}q)
            </div>
          </div>

          <button
            type="button"
            onClick={handleRollInitiative}
            title="Rolar Iniciativa Tagmar (1d10 + AGI)"
            style={{
              padding: '7px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--gold-soft)',
              border: '1px solid var(--border-gold)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, color: 'var(--gold-400)', fontWeight: 700 }}>INICIATIVA</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: '#fff' }}>
              1d10{fmtSigned(Number(comp.iniciativa ?? 0))}
            </div>
          </button>
        </div>

        {/* Active Conditions Alert */}
        {(condShift !== 0 || usesPassiveDef) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 11px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#fde68a',
              fontSize: 11.5,
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>
              {condShift !== 0 && `Modificador de condições na Coluna: ${fmtSigned(condShift)}. `}
              {usesPassiveDef && 'Usando Defesa Passiva (DP) devido a condição ativa.'}
            </span>
          </div>
        )}

        {/* INTERACTIVE TAGMAR CONDITIONS BAR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Condições:</span>
          {character.conditions.length === 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>Nenhuma</span>
          )}
          {character.conditions.map((cond) => (
            <span
              key={cond.id}
              className="mesa-badge mesa-badge--amethyst"
              style={{ gap: 5, padding: '3px 8px' }}
            >
              <Flame size={11} />
              {cond.name}
              {cond.roundsRemaining ? ` (${cond.roundsRemaining}t)` : ''}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleToggleCondition(cond.id)}
                  aria-label={`Remover ${cond.name}`}
                  style={{ color: 'inherit', marginLeft: 2 }}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {canEdit && (
            <button
              type="button"
              className="mesa-btn mesa-btn--sm"
              onClick={() => setConditionMenuOpen((v) => !v)}
              style={{ minHeight: 26, padding: '2px 8px', fontSize: 11 }}
            >
              <Plus size={11} /> Condição Tagmar ({tagmarConditions.length})
            </button>
          )}
        </div>

        {conditionMenuOpen && canEdit && (
          <div
            style={{
              padding: 10,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-obsidian)',
              border: '1px solid rgba(74, 222, 128, 0.5)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 5,
            }}
          >
            {tagmarConditions.map((cond) => {
              const active = character.conditions.some((c) => c.id === cond.id);
              return (
                <button
                  key={cond.id}
                  type="button"
                  title={cond.description}
                  onClick={() => handleToggleCondition(cond.id)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 11,
                    fontWeight: 600,
                    background: active ? 'var(--amethyst-soft)' : 'var(--bg-elevated)',
                    border: `1px solid ${active ? 'var(--amethyst-400)' : 'var(--border-subtle)'}`,
                    color: active ? '#e9d5ff' : 'var(--text-secondary)',
                  }}
                >
                  {cond.emoji ? `${cond.emoji} ` : ''}
                  {cond.name}
                </button>
              );
            })}
          </div>
        )}

        {/* TARGET SELECTOR & RESISTANCE FA INPUT */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
          {characters.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 210 }}>
              <Crosshair size={13} style={{ color: 'var(--crimson-400)', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-muted)' }}>Alvo:</span>
              <select
                value={targetCharacterId ?? ''}
                onChange={(e) => setTargetCharacterId(e.target.value || null)}
                className="mesa-select"
                style={{ flex: 1, maxWidth: 260, padding: '4px 8px', fontSize: 12 }}
              >
                <option value="">Sem alvo selecionado</option>
                {characters
                  .filter((c) => c.id !== character.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (DA {String(c.computed?.defesaAtiva ?? c.computed?.defesa ?? '?')} / DP{' '}
                      {String(c.computed?.defesaPassiva ?? '?')})
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>FA p/ RF/RM:</span>
            <input
              type="number"
              min={1}
              max={25}
              value={resistFa}
              onChange={(e) => setResistFa(Math.max(1, Number(e.target.value) || 5))}
              className="mesa-input"
              style={{ width: 54, padding: '3px 6px', fontSize: 12, fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>

        {/* 5 SHEET TABS */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: 6,
            overflowX: 'auto',
          }}
        >
          {(
            [
              { id: 'combat', label: 'Combate', icon: <Swords size={13} /> },
              {
                id: 'skills',
                label: `Habilidades & Téc. (${data.skills.length + data.combatTechniques.length})`,
                icon: <Sparkles size={13} />,
              },
              { id: 'spells', label: `Magias (${data.spells.length})`, icon: <Wand2 size={13} /> },
              { id: 'equipment', label: 'Equip. & Moedas', icon: <Backpack size={13} /> },
              { id: 'bio', label: 'Biografia', icon: <BookOpen size={13} /> },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 11px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  background: active ? 'var(--emerald-soft)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(74, 222, 128, 0.5)' : 'transparent'}`,
                  color: active ? 'var(--emerald-400)' : 'var(--text-muted)',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: COMBATE */}
        {activeTab === 'combat' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--emerald-400)' }}>
              Armas Equipadas (Dano Colorido 25% / 50% / 75% / 100% / Crítico)
            </div>

            {equippedWeapons.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Nenhuma arma equipada. Equipe na aba <strong>Equip. & Moedas</strong> ou use Ataque Desarmado.
              </div>
            ) : (
              equippedWeapons.map((w) => (
                <div
                  key={w.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13.5 }}>{w.name}</strong>
                      <span className="mesa-badge mesa-badge--gold" style={{ fontFamily: 'var(--font-mono)' }}>
                        Col. {w.column}
                      </span>
                      <span className="mesa-badge">{w.damageType} · {w.range}</span>
                      {w.underMinFor && (
                        <span className="mesa-badge mesa-badge--crimson">FOR insuficiente (-2 Col)</span>
                      )}
                    </div>
                    <TagmarDamagePills damage={w.damage} />
                  </div>

                  <button
                    type="button"
                    className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                    onClick={() => handleWeaponAttack(w.id)}
                  >
                    <Swords size={13} /> Atacar 1d20
                  </button>
                </div>
              ))
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
              <button type="button" className="mesa-btn mesa-btn--sm" onClick={handleRollInitiative}>
                <Zap size={13} /> Iniciativa (1d10{fmtSigned(Number(comp.iniciativa ?? 0))})
              </button>
              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={() => handleWeaponAttack('__unarmed__')}
              >
                Ataque Desarmado (1d20)
              </button>
              <button type="button" className="mesa-btn mesa-btn--sm" onClick={() => handleRollResistance('rf')}>
                <Shield size={13} /> Rolar RF (FA {resistFa})
              </button>
              <button type="button" className="mesa-btn mesa-btn--sm" onClick={() => handleRollResistance('rm')}>
                <Sparkles size={13} /> Rolar RM (FA {resistFa})
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: HABILIDADES & TÉCNICAS */}
        {activeTab === 'skills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--sm"
                  onClick={() => {
                    setAddSkillDrawer(addSkillDrawer === 'skill' ? null : 'skill');
                    setDrawerQuery('');
                  }}
                >
                  <Plus size={13} /> Adicionar Habilidade ({tagmarSkills.length})
                </button>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--sm"
                  onClick={() => {
                    setAddSkillDrawer(addSkillDrawer === 'technique' ? null : 'technique');
                    setDrawerQuery('');
                  }}
                >
                  <Swords size={13} /> Adicionar Técnica ({tagmarCombatTechniques.length})
                </button>
              </div>
            )}

            {addSkillDrawer && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid rgba(74, 222, 128, 0.45)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                }}
              >
                <input
                  type="text"
                  className="mesa-input"
                  value={drawerQuery}
                  onChange={(e) => setDrawerQuery(e.target.value)}
                  placeholder={addSkillDrawer === 'skill' ? 'Buscar habilidade...' : 'Buscar técnica de combate...'}
                  style={{ padding: '6px 9px', fontSize: 12 }}
                  autoFocus
                />
                <div style={{ maxHeight: 170, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {addSkillDrawer === 'skill'
                    ? tagmarSkills
                        .filter(
                          (s) =>
                            !dq ||
                            s.name.toLowerCase().includes(dq) ||
                            s.group.toLowerCase().includes(dq)
                        )
                        .slice(0, 25)
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              updateTagmarData({
                                ...data,
                                skills: [
                                  ...data.skills,
                                  {
                                    id: `sk-${s.id}-${Date.now().toString(36)}`,
                                    skillId: s.id,
                                    name: s.name,
                                    group: s.group,
                                    attribute: s.attribute,
                                    level: 1,
                                    restricted: s.restricted,
                                    description: s.description,
                                  },
                                ],
                              });
                              pushToast(`"${s.name}" adicionada!`, 'success');
                            }}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              padding: '5px 8px',
                              borderRadius: 5,
                              background: 'var(--bg-elevated)',
                              fontSize: 12,
                              textAlign: 'left',
                            }}
                          >
                            <span>
                              <strong>{s.name}</strong> ({s.group})
                            </span>
                            <span style={{ color: 'var(--emerald-400)' }}>+ Adicionar</span>
                          </button>
                        ))
                    : tagmarCombatTechniques
                        .filter(
                          (t) =>
                            !dq ||
                            t.name.toLowerCase().includes(dq) ||
                            t.category.toLowerCase().includes(dq)
                        )
                        .slice(0, 25)
                        .map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              updateTagmarData({
                                ...data,
                                combatTechniques: [
                                  ...data.combatTechniques,
                                  {
                                    id: `ct-${t.id}-${Date.now().toString(36)}`,
                                    techniqueId: t.id,
                                    name: t.name,
                                    category: t.category,
                                    attribute: t.attribute,
                                    level: 1,
                                    description: t.description,
                                    automation: t.automation,
                                  },
                                ],
                              });
                              pushToast(`Técnica "${t.name}" adicionada!`, 'success');
                            }}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              padding: '5px 8px',
                              borderRadius: 5,
                              background: 'var(--bg-elevated)',
                              fontSize: 12,
                              textAlign: 'left',
                            }}
                          >
                            <span>
                              <strong>{t.name}</strong> ({t.category})
                            </span>
                            <span style={{ color: 'var(--gold-400)' }}>+ Adicionar</span>
                          </button>
                        ))}
                </div>
              </div>
            )}

            {/* Habilidades List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--emerald-400)' }}>
                Habilidades ({data.skills.length})
              </div>
              {data.skills.map((sk) => {
                const attrVal = data.attributes[sk.attribute] ?? 0;
                const col = attrVal + sk.level + (sk.bonus ?? 0) + (sk.specialized ? 2 : 0) + condShift;
                return (
                  <div
                    key={sk.id}
                    style={{
                      padding: '8px 11px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 13 }}>{sk.name}</strong>
                        <span className="mesa-badge" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                          Nív {sk.level} · {sk.attribute.slice(0, 3).toUpperCase()} {fmtSigned(attrVal)}
                        </span>
                        <span className="mesa-badge mesa-badge--emerald" style={{ fontFamily: 'var(--font-mono)' }}>
                          Col {col}
                        </span>
                        {sk.specialized && <span className="mesa-badge mesa-badge--gold">Esp +2</span>}
                      </div>
                      {sk.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {sk.description.slice(0, 110)}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            style={{ minHeight: 26, padding: '0 6px' }}
                            onClick={() =>
                              updateTagmarData({
                                ...data,
                                skills: data.skills.map((x) =>
                                  x.id === sk.id ? { ...x, level: Math.max(0, x.level - 1) } : x
                                ),
                              })
                            }
                          >
                            <Minus size={11} />
                          </button>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            style={{ minHeight: 26, padding: '0 6px' }}
                            onClick={() =>
                              updateTagmarData({
                                ...data,
                                skills: data.skills.map((x) =>
                                  x.id === sk.id ? { ...x, level: x.level + 1 } : x
                                ),
                              })
                            }
                          >
                            <Plus size={11} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                        onClick={() => handleRollSkillOrTech(sk.id)}
                      >
                        <Dices size={12} /> 1d20
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                          onClick={() =>
                            updateTagmarData({
                              ...data,
                              skills: data.skills.filter((x) => x.id !== sk.id),
                            })
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Técnicas de Combate List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)' }}>
                Técnicas de Combate ({data.combatTechniques.length})
              </div>
              {data.combatTechniques.map((ct) => {
                const attrKey = ct.attribute ?? 'agilidade';
                const attrVal = data.attributes[attrKey] ?? 0;
                const col = attrVal + ct.level + (ct.bonus ?? 0) + condShift;
                return (
                  <div
                    key={ct.id}
                    style={{
                      padding: '8px 11px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Swords size={12} style={{ color: 'var(--gold-400)' }} />
                        <strong style={{ fontSize: 13 }}>{ct.name}</strong>
                        <span className="mesa-badge" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                          Nív {ct.level}
                        </span>
                        <span className="mesa-badge mesa-badge--gold" style={{ fontFamily: 'var(--font-mono)' }}>
                          Col {col}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            style={{ minHeight: 26, padding: '0 6px' }}
                            onClick={() =>
                              updateTagmarData({
                                ...data,
                                combatTechniques: data.combatTechniques.map((x) =>
                                  x.id === ct.id ? { ...x, level: Math.max(0, x.level - 1) } : x
                                ),
                              })
                            }
                          >
                            <Minus size={11} />
                          </button>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            style={{ minHeight: 26, padding: '0 6px' }}
                            onClick={() =>
                              updateTagmarData({
                                ...data,
                                combatTechniques: data.combatTechniques.map((x) =>
                                  x.id === ct.id ? { ...x, level: x.level + 1 } : x
                                ),
                              })
                            }
                          >
                            <Plus size={11} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--gold mesa-btn--sm"
                        onClick={() => handleRollSkillOrTech(ct.id)}
                      >
                        <Dices size={12} /> 1d20
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                          onClick={() =>
                            updateTagmarData({
                              ...data,
                              combatTechniques: data.combatTechniques.filter((x) => x.id !== ct.id),
                            })
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: MAGIAS */}
        {activeTab === 'spells' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {canEdit && (
              <div>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--sm"
                  onClick={() => {
                    setAddSpellDrawer((v) => !v);
                    setDrawerQuery('');
                  }}
                >
                  <Wand2 size={13} /> Adicionar Magia do Compêndio ({tagmarSpells.length})
                </button>
              </div>
            )}

            {addSpellDrawer && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid rgba(56, 189, 248, 0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                }}
              >
                <input
                  type="text"
                  className="mesa-input"
                  value={drawerQuery}
                  onChange={(e) => setDrawerQuery(e.target.value)}
                  placeholder="Buscar magia, colégio ou ordem divina..."
                  style={{ padding: '6px 9px', fontSize: 12 }}
                  autoFocus
                />
                <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tagmarSpells
                    .filter(
                      (s) =>
                        !dq ||
                        s.name.toLowerCase().includes(dq) ||
                        s.group.toLowerCase().includes(dq)
                    )
                    .slice(0, 28)
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          updateTagmarData({
                            ...data,
                            spells: [
                              ...data.spells,
                              {
                                id: `sp-${s.id}-${Date.now().toString(36)}`,
                                spellId: s.id,
                                name: s.name,
                                group: s.group,
                                professionIds: s.professionIds,
                                level: 1,
                                karmaCost: s.karmaCost,
                                evocationTime: s.evocationTime,
                                range: s.range,
                                duration: s.duration,
                                resistance: s.resistance,
                                effectLevels: s.effectLevels,
                                description: s.description,
                                automation: s.automation,
                              },
                            ],
                          });
                          pushToast(`Magia "${s.name}" adicionada!`, 'success');
                        }}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '5px 8px',
                          borderRadius: 5,
                          background: 'var(--bg-elevated)',
                          fontSize: 12,
                          textAlign: 'left',
                        }}
                      >
                        <span>
                          <strong>{s.name}</strong> [{s.group}] · {s.karmaCost} Karma
                        </span>
                        <span style={{ color: '#38bdf8' }}>+ Adicionar</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {data.spells.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Nenhuma magia no grimório.
              </div>
            ) : (
              data.spells.map((sp) => (
                <div
                  key={sp.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Wand2 size={13} style={{ color: '#38bdf8' }} />
                      <strong style={{ fontSize: 13 }}>{sp.name}</strong>
                      <span className="mesa-badge mesa-badge--sapphire">{sp.karmaCost} Karma</span>
                      <span className="mesa-badge" style={{ fontFamily: 'var(--font-mono)' }}>
                        Nív {sp.level}
                      </span>
                      {sp.resistance && sp.resistance !== 'none' && (
                        <span className="mesa-badge mesa-badge--crimson">
                          {sp.resistance.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            style={{ minHeight: 26, padding: '0 6px' }}
                            onClick={() =>
                              updateTagmarData({
                                ...data,
                                spells: data.spells.map((x) =>
                                  x.id === sp.id ? { ...x, level: Math.max(1, x.level - 1) } : x
                                ),
                              })
                            }
                          >
                            <Minus size={11} />
                          </button>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            style={{ minHeight: 26, padding: '0 6px' }}
                            onClick={() =>
                              updateTagmarData({
                                ...data,
                                spells: data.spells.map((x) =>
                                  x.id === sp.id ? { ...x, level: x.level + 1 } : x
                                ),
                              })
                            }
                          >
                            <Plus size={11} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                        onClick={() => handleCastSpell(sp)}
                      >
                        <Sparkles size={12} /> Evocar 1d20
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                          onClick={() =>
                            updateTagmarData({
                              ...data,
                              spells: data.spells.filter((x) => x.id !== sp.id),
                            })
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#38bdf8' }}>
                    {sp.group} {sp.range ? `· ${sp.range}` : ''} {sp.duration ? `· ${sp.duration}` : ''}
                  </div>
                  {sp.automation?.damageByColor && (
                    <TagmarDamagePills damage={sp.automation.damageByColor} compact />
                  )}
                  {sp.automation?.healByColor && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 10.5, color: 'var(--emerald-400)', fontWeight: 700 }}>Cura:</span>
                      <TagmarDamagePills damage={sp.automation.healByColor} compact />
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sp.description}</div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: EQUIPAMENTOS & MOEDAS (MO / MP / MC) */}
        {activeTab === 'equipment' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {(
                  [
                    { key: 'mo', label: 'MO', color: '#facc15' },
                    { key: 'mp', label: 'MP', color: '#cbd5e1' },
                    { key: 'mc', label: 'MC', color: '#fb923c' },
                  ] as const
                ).map((coin) => (
                  <div key={coin.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: coin.color }}>{coin.label}:</span>
                    <input
                      type="number"
                      className="mesa-input"
                      disabled={!canEdit}
                      value={data.money[coin.key] ?? 0}
                      onChange={(e) =>
                        updateTagmarData({
                          ...data,
                          money: { ...data.money, [coin.key]: Math.max(0, Number(e.target.value) || 0) },
                        })
                      }
                      style={{ width: 68, padding: '4px 7px', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                ))}
                <span className="mesa-badge">Peso: {String(comp.totalWeight ?? 0)} kg</span>
              </div>

              {canEdit && (
                <button
                  type="button"
                  className="mesa-btn mesa-btn--sm"
                  onClick={() => {
                    setAddItemDrawer((v) => !v);
                    setDrawerQuery('');
                  }}
                >
                  <Plus size={13} /> Adicionar do Compêndio
                </button>
              )}
            </div>

            {addItemDrawer && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid var(--border-gold)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                }}
              >
                <input
                  type="text"
                  className="mesa-input"
                  value={drawerQuery}
                  onChange={(e) => setDrawerQuery(e.target.value)}
                  placeholder="Buscar arma, armadura, escudo, elmo, erva ou relíquia..."
                  style={{ padding: '6px 9px', fontSize: 12 }}
                  autoFocus
                />
                <div style={{ maxHeight: 175, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    ...tagmarEquipment.weapons.map((w) => ({
                      id: `w-${w.id}`,
                      name: w.name,
                      tag: `Arma · ${w.damage.verde}/${w.damage.amarelo}/${w.damage.laranja}/${w.damage.vermelho}`,
                      entry: {
                        id: `eq-${w.id}-${Date.now().toString(36)}`,
                        itemId: w.id,
                        name: w.name,
                        category: 'weapon' as const,
                        equipped: true,
                        quantity: 1,
                        damage: { ...w.damage },
                        damageType: w.damageType,
                        hands: w.hands,
                        minFor: w.minFor,
                        columnBonus: w.columnBonus,
                        range: w.range,
                        weaponGroup: w.category,
                        weight: w.weight,
                        description: w.description,
                      },
                    })),
                    ...tagmarEquipment.armor.map((a) => ({
                      id: `a-${a.id}`,
                      name: a.name,
                      tag: `${a.slot} (${a.armorClass}) · Abs ${a.absorcao} · DA ${fmtSigned(a.defActiveBonus)}`,
                      entry: {
                        id: `eq-${a.id}-${Date.now().toString(36)}`,
                        itemId: a.id,
                        name: a.name,
                        category: (a.slot === 'shield' ? 'shield' : a.slot === 'helmet' ? 'helmet' : 'armor') as
                          | 'shield'
                          | 'helmet'
                          | 'armor',
                        slot: a.slot,
                        equipped: false,
                        quantity: 1,
                        armorClass: a.armorClass,
                        absorcao: a.absorcao,
                        defActiveBonus: a.defActiveBonus,
                        defPassiveBonus: a.defPassiveBonus,
                        agilityPenalty: a.agilityPenalty,
                        minFor: a.minFor,
                        weight: a.weight,
                        description: a.description,
                      },
                    })),
                    ...tagmarEquipment.gear.map((g) => ({
                      id: `g-${g.id}`,
                      name: g.name,
                      tag: g.category,
                      entry: {
                        id: `eq-${g.id}-${Date.now().toString(36)}`,
                        itemId: g.id,
                        name: g.name,
                        category: (g.effect?.healEf ||
                        g.effect?.healEh ||
                        g.effect?.restoreKarma ||
                        g.effect?.cureCondition
                          ? 'consumable'
                          : 'gear') as 'consumable' | 'gear',
                        equipped: false,
                        quantity: 1,
                        weight: g.weight,
                        effect: g.effect,
                        description: g.description,
                      },
                    })),
                  ]
                    .filter(
                      (x) =>
                        !dq ||
                        x.name.toLowerCase().includes(dq) ||
                        x.tag.toLowerCase().includes(dq)
                    )
                    .slice(0, 26)
                    .map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => {
                          updateTagmarData({ ...data, inventory: [...data.inventory, x.entry] });
                          pushToast(`"${x.name}" adicionado ao inventário!`, 'success');
                        }}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '5px 8px',
                          borderRadius: 5,
                          background: 'var(--bg-elevated)',
                          fontSize: 12,
                          textAlign: 'left',
                        }}
                      >
                        <span>
                          <strong>{x.name}</strong> <span style={{ color: 'var(--text-muted)' }}>({x.tag})</span>
                        </span>
                        <span style={{ color: 'var(--gold-400)' }}>+ Pegar</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Inventory List */}
            {data.inventory.map((item) => {
              const equippable =
                item.category === 'weapon' ||
                item.category === 'armor' ||
                item.category === 'shield' ||
                item.category === 'helmet';
              const isConsumable =
                item.category === 'consumable' ||
                Boolean(
                  item.effect?.healEf ||
                    item.effect?.healEh ||
                    item.effect?.restoreKarma ||
                    item.effect?.cureCondition
                );
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '8px 11px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    border: `1px solid ${item.equipped ? 'rgba(74, 222, 128, 0.55)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{item.name}</strong>
                      {item.quantity > 1 && <span className="mesa-badge">×{item.quantity}</span>}
                      {item.armorClass && <span className="mesa-badge mesa-badge--gold">Classe {item.armorClass}</span>}
                      {item.absorcao ? <span className="mesa-badge mesa-badge--emerald">Abs {item.absorcao}</span> : null}
                      {item.defActiveBonus ? <span className="mesa-badge">DA {fmtSigned(item.defActiveBonus)}</span> : null}
                      {item.defPassiveBonus ? <span className="mesa-badge">DP {fmtSigned(item.defPassiveBonus)}</span> : null}
                    </div>
                    {item.damage && <TagmarDamagePills damage={item.damage} compact />}
                    {item.description && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.description}</div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 5 }}>
                    {equippable && canEdit && (
                      <button
                        type="button"
                        className={`mesa-btn mesa-btn--sm ${item.equipped ? 'mesa-btn--emerald' : ''}`}
                        onClick={() => handleToggleEquip(item.id)}
                      >
                        {item.equipped ? 'Equipado' : 'Equipar'}
                      </button>
                    )}
                    {isConsumable && canEdit && (
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--gold mesa-btn--sm"
                        onClick={() => handleUseConsumable(item)}
                      >
                        <FlaskConical size={12} /> Usar
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                        onClick={() =>
                          updateTagmarData({
                            ...data,
                            inventory: data.inventory.filter((x) => x.id !== item.id),
                          })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 5: BIOGRAFIA */}
        {activeTab === 'bio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.languages && data.languages.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700 }}>Idiomas:</span>
                {data.languages.map((lang) => (
                  <span key={lang} className="mesa-badge">{lang}</span>
                ))}
              </div>
            )}

            <div>
              <label className="mesa-label">História & Origem em Tagmar</label>
              <textarea
                className="mesa-textarea"
                rows={4}
                disabled={!canEdit}
                value={data.biography ?? ''}
                onChange={(e) => updateTagmarData({ ...data, biography: e.target.value })}
                placeholder="Origem, feitos, divindade patrona, objetivos..."
              />
            </div>

            <div>
              <label className="mesa-label">Anotações da Sessão</label>
              <textarea
                className="mesa-textarea"
                rows={5}
                disabled={!canEdit}
                value={data.notes ?? ''}
                onChange={(e) => updateTagmarData({ ...data, notes: e.target.value })}
                placeholder="Pistas, NPCs, tesouros, alianças..."
              />
            </div>

            {isGm && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mesa-label" style={{ marginBottom: 0 }}>
                    Visibilidade da Ficha:
                  </span>
                  <select
                    className="mesa-select"
                    value={character.visibility}
                    onChange={(e) =>
                      patchCharacter(character.id, { visibility: e.target.value as Visibility })
                    }
                    style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}
                  >
                    <option value="all_players">🌐 Todos os Jogadores</option>
                    <option value="gm_only">🔒 Só Mestre</option>
                  </select>
                </div>

                <button
                  type="button"
                  className="mesa-btn mesa-btn--danger mesa-btn--sm"
                  onClick={async () => {
                    await deleteCharacter(character.id);
                    pushToast(`"${character.name}" removido da campanha.`, 'info');
                    onClose();
                  }}
                >
                  <Trash2 size={13} /> Excluir Personagem
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default TagmarSheetContent;
