import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  mbAbilities,
  mbConditions,
  mbEquipment,
  mbRules,
  mbSpells,
} from '@systems/mighty-blade-3e/compendium';
import { mightyBlade3eEngine } from '@systems/mighty-blade-3e/engine';
import { genericRpgEngine } from '@systems/generic-rpg/engine';
import { interpolateFormula } from '@systems/sandbox';
import type {
  Character,
  CharacterAbilityEntry,
  CharacterEquipmentEntry,
  CharacterSpellEntry,
  GenericActionEntry,
  GenericAttributeEntry,
  GenericRpgSystemData,
  MightyBladeAttributes,
  MightyBladeSystemData,
  Visibility,
} from '@systems/types';
import { FALLBACK_ASSET_MANIFEST, fetchAssetManifest, type AssetEntry } from '@/lib/api';
import type { CharacterSheetModalProps } from '@/lib/componentProps';
import { useCampaignStore } from '@/lib/store';
import { TagmarSheetContent } from './TagmarSheetContent';

type SheetTab = 'combat' | 'skills' | 'equipment' | 'bio';

const MB_ATTRS: Array<{ key: keyof MightyBladeAttributes; label: string; abbr: string }> = [
  { key: 'forca', label: 'Força', abbr: 'FOR' },
  { key: 'agilidade', label: 'Agilidade', abbr: 'AGI' },
  { key: 'inteligencia', label: 'Inteligência', abbr: 'INT' },
  { key: 'vontade', label: 'Vontade', abbr: 'VON' },
];

const DIFFICULTY_PRESETS = [
  { label: 'Livre', value: undefined },
  { label: 'Fácil (8)', value: 8 },
  { label: 'Normal (10)', value: 10 },
  { label: 'Desafiadora (12)', value: 12 },
  { label: 'Difícil (14)', value: 14 },
  { label: 'Muito Difícil (16)', value: 16 },
];

function readMBData(character: Character): MightyBladeSystemData {
  const raw = (character.systemData ?? {}) as Partial<MightyBladeSystemData>;
  const attrs = raw.attributes ?? { forca: 3, agilidade: 3, inteligencia: 3, vontade: 3 };
  return {
    raceId: raw.raceId ?? 'humano',
    raceName: raw.raceName ?? 'Humano',
    classId: raw.classId ?? 'guerreiro',
    className: raw.className ?? 'Guerreiro',
    level: Math.max(1, Math.min(10, Number(raw.level ?? 1))),
    xp: Math.max(0, Number(raw.xp ?? 0)),
    attributes: {
      forca: Number(attrs.forca ?? 3),
      agilidade: Number(attrs.agilidade ?? 3),
      inteligencia: Number(attrs.inteligencia ?? 3),
      vontade: Number(attrs.vontade ?? 3),
    },
    pvBonus: Number(raw.pvBonus ?? 0),
    pmBonus: Number(raw.pmBonus ?? 0),
    defenseBonus: Number(raw.defenseBonus ?? 0),
    movementModifier: Number(raw.movementModifier ?? 0),
    size: raw.size ?? 'Médio',
    money: Number(raw.money ?? 400),
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    abilities: Array.isArray(raw.abilities) ? raw.abilities : [],
    spells: Array.isArray(raw.spells) ? raw.spells : [],
    languages: Array.isArray(raw.languages) ? raw.languages : ['Comum'],
    background: raw.background ?? '',
    notes: raw.notes ?? '',
  };
}

function readGenericData(character: Character): GenericRpgSystemData {
  const raw = (character.systemData ?? {}) as Partial<GenericRpgSystemData>;
  return {
    level: Number(raw.level ?? 1),
    archetype: raw.archetype ?? 'Aventureiro',
    attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
    customBars: Array.isArray(raw.customBars) ? raw.customBars : [],
    actions: Array.isArray(raw.actions) ? raw.actions : [],
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    notes: raw.notes ?? '',
  };
}

export function CharacterSheetModal({
  characterId,
  onClose,
  isMobile = false,
}: CharacterSheetModalProps) {
  const {
    characters,
    targetCharacterId,
    setTargetCharacterId,
    targetCharacter,
    isGm,
    user,
    patchCharacter,
    deleteCharacter,
    rollDice,
    sendChat,
    uploadImage,
    pushToast,
  } = useCampaignStore();

  const character = useMemo(
    () => characters.find((c) => c.id === characterId) ?? null,
    [characters, characterId]
  );

  const [activeTab, setActiveTab] = useState<SheetTab>('combat');
  const [portraitPickerOpen, setPortraitPickerOpen] = useState(false);
  const [portraits, setPortraits] = useState<AssetEntry[]>(FALLBACK_ASSET_MANIFEST.portraits);
  const [uploadingPortrait, setUploadingPortrait] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Mighty Blade UI popovers
  const [attrRollPopover, setAttrRollPopover] = useState<keyof MightyBladeAttributes | null>(null);
  const [rollDiceMode, setRollDiceMode] = useState<'normal' | 'inapto' | 'vantagem'>('normal');
  const [rollDifficulty, setRollDifficulty] = useState<number | undefined>(undefined);
  const [rollExtraMod, setRollExtraMod] = useState<number>(0);

  const [conditionMenuOpen, setConditionMenuOpen] = useState(false);
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [evoChoice, setEvoChoice] = useState<string>('pv5_pm5');
  const [attrLevelChoice, setAttrLevelChoice] = useState<keyof MightyBladeAttributes>('forca');

  // Quick compendium add drawers inside sheet
  const [addSkillDrawer, setAddSkillDrawer] = useState<'ability' | 'spell' | null>(null);
  const [addItemDrawer, setAddItemDrawer] = useState<boolean>(false);
  const [drawerQuery, setDrawerQuery] = useState('');

  // Generic RPG state
  const [genericDiceBase, setGenericDiceBase] = useState('1d20');
  const [newAttrLabel, setNewAttrLabel] = useState('');
  const [newAttrValue, setNewAttrValue] = useState(0);
  const [newBarLabel, setNewBarLabel] = useState('');
  const [newBarMax, setNewBarMax] = useState(10);
  const [newActionName, setNewActionName] = useState('');
  const [newActionFormula, setNewActionFormula] = useState('1d20 + @fisico');
  const [newActionDmg, setNewActionDmg] = useState('');

  useEffect(() => {
    if (!characterId) return;
    void fetchAssetManifest().then((m) => {
      const combined = [...m.portraits, ...m.monsters];
      if (combined.length > 0) setPortraits(combined);
    });
  }, [characterId]);

  if (!characterId || !character) return null;

  const isTagmar = character.systemId === 'tagmar-3';
  const isMightyBlade = character.systemId === 'mighty-blade-3e';
  const canEdit =
    isGm ||
    character.ownerUserId === user.id ||
    character.controlledByUserIds?.includes(user.id);

  if (isTagmar) {
    return (
      <div
        className="mesa-modal-backdrop"
        style={isMobile ? { alignItems: 'flex-end', padding: 0 } : undefined}
        onClick={onClose}
      >
        <div
          className="mesa-modal"
          style={{
            maxWidth: isMobile ? '100%' : 940,
            maxHeight: isMobile ? '94dvh' : '92dvh',
            height: isMobile ? '94dvh' : undefined,
            borderColor: 'rgba(74, 222, 128, 0.45)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <TagmarSheetContent
            character={character}
            canEdit={canEdit}
            portraits={portraits}
            onClose={onClose}
          />
        </div>
      </div>
    );
  }

  // Live derived stats recomputation for Mighty Blade
  const mbData = isMightyBlade ? readMBData(character) : null;
  const mbDerived = isMightyBlade ? mightyBlade3eEngine.computeDerivedStats(character) : null;
  const mbComp = (mbDerived?.computed ?? character.computed ?? {}) as Record<string, unknown>;

  const genericData = !isMightyBlade ? readGenericData(character) : null;
  const genericDerived = !isMightyBlade ? genericRpgEngine.computeDerivedStats(character) : null;
  const genericComp = (genericDerived?.computed ?? character.computed ?? {}) as Record<string, unknown>;

  const updateMBData = (nextSys: MightyBladeSystemData, extraPatch?: Partial<Character>) => {
    const draft: Character = {
      ...character,
      ...extraPatch,
      systemData: nextSys as unknown as Record<string, unknown>,
    };
    const { computed, resourceMax } = mightyBlade3eEngine.computeDerivedStats(draft);
    const curPv = draft.resources?.pv ?? { current: resourceMax.pv, max: resourceMax.pv };
    const curPm = draft.resources?.pm ?? { current: resourceMax.pm, max: resourceMax.pm };
    patchCharacter(character.id, {
      ...extraPatch,
      systemData: draft.systemData,
      computed,
      resources: {
        ...draft.resources,
        pv: { ...curPv, max: resourceMax.pv, current: Math.min(curPv.current, resourceMax.pv) },
        pm: { ...curPm, max: resourceMax.pm, current: Math.min(curPm.current, resourceMax.pm) },
      },
    });
  };

  const adjustResource = (key: string, delta: number) => {
    const bar = character.resources?.[key];
    if (!bar) return;
    const minVal = key === 'pv' ? -20 : 0;
    const nextCurrent = Math.max(minVal, Math.min(bar.max, bar.current + delta));
    const nextResources = {
      ...character.resources,
      [key]: { ...bar, current: nextCurrent },
    };
    const draft = { ...character, resources: nextResources };
    if (isMightyBlade) {
      const { computed } = mightyBlade3eEngine.computeDerivedStats(draft);
      patchCharacter(character.id, { resources: nextResources, computed });
    } else {
      const { computed } = genericRpgEngine.computeDerivedStats(draft);
      patchCharacter(character.id, { resources: nextResources, computed });
    }
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
    const engine = isMightyBlade ? mightyBlade3eEngine : genericRpgEngine;
    const patch = engine.rest(character, kind);
    patchCharacter(character.id, patch);
    sendChat({
      kind: 'combat_action',
      content:
        kind === 'short'
          ? `${character.name} realizou um Descanso Curto${isMightyBlade ? ' (+5 PV / +5 PM)' : ''}.`
          : `${character.name} realizou um Descanso Longo${isMightyBlade ? ' (+30 PV / +30 PM)' : ''}.`,
    });
    pushToast(kind === 'short' ? 'Descanso Curto aplicado!' : 'Descanso Longo aplicado!', 'success');
  };

  const handleToggleCondition = (condId: string) => {
    const engine = isMightyBlade ? mightyBlade3eEngine : genericRpgEngine;
    const has = character.conditions.some((c) => c.id === condId);
    const patch = has
      ? engine.removeCondition(character, condId)
      : engine.applyCondition(character, condId);
    patchCharacter(character.id, patch);
  };

  // --- Mighty Blade Roll & Action Handlers ---
  const handleRollMBAttribute = (
    attrKey: keyof MightyBladeAttributes,
    customMode?: 'normal' | 'inapto' | 'vantagem',
    customDiff?: number,
    customMod?: number
  ) => {
    if (!mbData) return;
    const mode = customMode ?? 'normal';
    const diff = customDiff;
    const extra = customMod ?? 0;
    const attrVal = mbData.attributes[attrKey];
    const testDelta = Number(mbComp.testDelta ?? 0);
    const baseDice = mode === 'inapto' ? 1 : mode === 'vantagem' ? 3 : 2;
    const totalMod = attrVal + extra + testDelta;
    const modStr = totalMod === 0 ? '' : totalMod > 0 ? ` + ${totalMod}` : ` - ${Math.abs(totalMod)}`;
    const attrLabel = MB_ATTRS.find((a) => a.key === attrKey)?.label ?? attrKey;
    const modeTag = mode === 'inapto' ? ' (Inapto)' : mode === 'vantagem' ? ' (Vantagem)' : '';

    rollDice({
      formula: `${baseDice}d6${modStr}`,
      label: `Teste de ${attrLabel}${modeTag}`,
      characterId: character.id,
      difficulty: diff,
      systemMeta: {
        systemId: 'mighty-blade-3e',
        kind: 'attribute',
        attrKey,
        inapto: baseDice === 1,
        difficulty: diff,
      },
    });
    setAttrRollPopover(null);
  };

  const handleMBWeaponAttack = (weaponId: string) => {
    const plan = mightyBlade3eEngine.planAttack(character, weaponId, targetCharacter ?? undefined);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      targetCharacterId: plan.targetCharacterId,
      targetDefense: plan.targetDefense,
      systemMeta: plan.systemMeta,
    });
  };

  const handleMBWeaponDamage = (weaponName: string, baseDamage: number, damageType: string) => {
    if (targetCharacter) {
      const patch = mightyBlade3eEngine.applyDamage(targetCharacter, baseDamage, damageType);
      patchCharacter(targetCharacter.id, patch);
      sendChat({
        kind: 'combat_action',
        content: `${character.name} causou ${baseDamage} de dano (${damageType}) com ${weaponName} em ${targetCharacter.name}!`,
      });
      pushToast(`${baseDamage} de dano aplicado em ${targetCharacter.name}!`, 'success');
    } else {
      sendChat({
        kind: 'combat_action',
        content: `${character.name} causou ${baseDamage} de dano (${damageType}) com ${weaponName}.`,
      });
    }
  };

  const handleUseMBAbility = (ab: CharacterAbilityEntry) => {
    const cost = ab.manaCost ?? 0;
    if (cost > 0) {
      const spend = mightyBlade3eEngine.spendMana(character, cost);
      if (spend.error) {
        pushToast(spend.error, 'error');
        return;
      }
      if (spend.patch) patchCharacter(character.id, spend.patch);
    }
    const plan = mightyBlade3eEngine.planAbility(character, ab.abilityId ?? ab.id, targetCharacter ?? undefined);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      difficulty: plan.difficulty,
      targetCharacterId: plan.targetCharacterId,
      targetDefense: plan.targetDefense,
      systemMeta: { ...plan.systemMeta, manaCost: cost, manaAlreadySpent: cost > 0 },
    });
  };

  const handleCastMBSpell = (sp: CharacterSpellEntry) => {
    if (Boolean(mbComp.cannotCastSpells)) {
      pushToast('Uma condição ativa impede conjurar magias!', 'warning');
    }
    const cost = sp.manaCost ?? 0;
    if (cost > 0) {
      const spend = mightyBlade3eEngine.spendMana(character, cost);
      if (spend.error) {
        pushToast(spend.error, 'error');
        return;
      }
      if (spend.patch) patchCharacter(character.id, spend.patch);
    }
    const plan = mightyBlade3eEngine.planSpell(character, sp.spellId ?? sp.id, targetCharacter ?? undefined);
    rollDice({
      formula: plan.formula,
      label: plan.label,
      characterId: character.id,
      difficulty: plan.difficulty,
      targetCharacterId: plan.targetCharacterId,
      targetDefense: plan.targetDefense,
      systemMeta: { ...plan.systemMeta, manaCost: cost, manaAlreadySpent: cost > 0 },
    });
  };

  const handleToggleEquipItem = (itemId: string) => {
    if (!mbData) return;
    const nextInv = mbData.inventory.map((it) =>
      it.id === itemId ? { ...it, equipped: !it.equipped } : it
    );
    updateMBData({ ...mbData, inventory: nextInv });
  };

  const handleUseConsumable = (item: CharacterEquipmentEntry) => {
    if (!mbData) return;
    const eff = (item.effect ?? {}) as Record<string, unknown>;
    let updatedChar: Character = { ...character };
    const notes: string[] = [];

    if (typeof eff.healPv === 'number' && eff.healPv > 0) {
      const p = mightyBlade3eEngine.applyHealing(updatedChar, eff.healPv);
      updatedChar = { ...updatedChar, ...p };
      notes.push(`+${eff.healPv} PV`);
    }
    if (typeof eff.healPm === 'number' && eff.healPm > 0) {
      const pm = updatedChar.resources?.pm ?? { current: 0, max: 60 };
      updatedChar = {
        ...updatedChar,
        resources: {
          ...updatedChar.resources,
          pm: { ...pm, current: Math.min(pm.max, pm.current + eff.healPm) },
        },
      };
      notes.push(`+${eff.healPm} PM`);
    }
    if (typeof eff.removeCondition === 'string') {
      const p = mightyBlade3eEngine.removeCondition(updatedChar, eff.removeCondition);
      updatedChar = { ...updatedChar, ...p };
      notes.push(`removeu ${eff.removeCondition}`);
    }

    const nextInv = mbData.inventory
      .map((it) => (it.id === item.id ? { ...it, quantity: (it.quantity ?? 1) - 1 } : it))
      .filter((it) => it.quantity > 0);

    const nextSys = { ...mbData, inventory: nextInv };
    updatedChar.systemData = nextSys as unknown as Record<string, unknown>;
    const { computed } = mightyBlade3eEngine.computeDerivedStats(updatedChar);

    patchCharacter(character.id, {
      resources: updatedChar.resources,
      conditions: updatedChar.conditions,
      systemData: updatedChar.systemData,
      computed,
    });

    sendChat({
      kind: 'combat_action',
      content: `${character.name} usou ${item.name}${notes.length ? ` (${notes.join(', ')})` : ''}.`,
    });
    pushToast(`Usou ${item.name}!`, 'success');
  };

  const handleConfirmLevelUp = () => {
    if (isMightyBlade) {
      const patch = mightyBlade3eEngine.levelUp(character, {
        evolutionChoice: evoChoice,
        attributeChoice: attrLevelChoice,
      });
      patchCharacter(character.id, patch);
      sendChat({
        kind: 'system',
        content: `🎉 ${character.name} subiu para o Nível ${(mbData?.level ?? 1) + 1}!`,
      });
      pushToast('Nível aumentado com sucesso!', 'success');
      setLevelUpOpen(false);
    } else {
      const patch = genericRpgEngine.levelUp(character, { hpBonus: 5, mpBonus: 3 });
      patchCharacter(character.id, patch);
      pushToast('Nível aumentado!', 'success');
    }
  };

  // Next level progression info (Mighty Blade)
  const nextLevelRow = mbData
    ? mbRules.levelProgression.table.find((r) => r.level === mbData.level + 1)
    : undefined;

  const equippedWeapons = (mbComp.equippedWeapons as Array<{
    id: string;
    name: string;
    rollAttr: keyof MightyBladeAttributes;
    diceCount: number;
    inapto: boolean;
    fn: number;
    attackFormula: string;
    baseDamage: number;
    damageType: string;
    range: string;
  }>) ?? [];

  const cargaStatus = String(mbComp.cargaStatus ?? 'basica');
  const fnArmorInapto = Boolean(mbComp.fnArmorInapto);

  // Generic RPG helpers
  const updateGenericData = (next: GenericRpgSystemData, extra?: Partial<Character>) => {
    const draft: Character = {
      ...character,
      ...extra,
      systemData: next as unknown as Record<string, unknown>,
    };
    const { computed } = genericRpgEngine.computeDerivedStats(draft);
    patchCharacter(character.id, { ...extra, systemData: draft.systemData, computed });
  };

  const handleAddGenericAttr = () => {
    if (!genericData || !newAttrLabel.trim()) return;
    const key = newAttrLabel
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_');
    const entry: GenericAttributeEntry = { key, label: newAttrLabel.trim(), value: newAttrValue };
    updateGenericData({ ...genericData, attributes: [...genericData.attributes, entry] });
    setNewAttrLabel('');
    setNewAttrValue(0);
  };

  const handleAddGenericBar = () => {
    if (!genericData || !newBarLabel.trim()) return;
    const key = newBarLabel
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_');
    const maxVal = Math.max(1, newBarMax);
    const nextBars = [
      ...(genericData.customBars ?? []),
      { key, label: newBarLabel.trim(), color: '#a855f7', max: maxVal },
    ];
    updateGenericData(
      { ...genericData, customBars: nextBars },
      { resources: { ...character.resources, [key]: { current: maxVal, max: maxVal } } }
    );
    setNewBarLabel('');
    setNewBarMax(10);
  };

  const handleAddGenericAction = () => {
    if (!genericData || !newActionName.trim()) return;
    const entry: GenericActionEntry = {
      id: `act-${Date.now().toString(36)}`,
      name: newActionName.trim(),
      formula: newActionFormula.trim() || '1d20',
      damageFormula: newActionDmg.trim() || undefined,
    };
    updateGenericData({ ...genericData, actions: [...genericData.actions, entry] });
    setNewActionName('');
    setNewActionDmg('');
  };

  const pv = character.resources?.pv ?? character.resources?.hp;
  const pm = character.resources?.pm ?? character.resources?.mp;

  return (
    <div
      className="mesa-modal-backdrop"
      style={isMobile ? { alignItems: 'flex-end', padding: 0 } : undefined}
      onClick={onClose}
    >
      <div
        className="mesa-modal"
        style={{
          maxWidth: isMobile ? '100%' : 920,
          maxHeight: isMobile ? '94dvh' : '92dvh',
          height: isMobile ? '94dvh' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP CHARACTER HEADER */}
        <div
          className="mesa-modal__header"
          style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}
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
                border: '2px solid var(--gold-400)',
                boxShadow: 'var(--gold-glow)',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {canEdit ? (
                  <input
                    type="text"
                    value={character.name}
                    onChange={(e) => patchCharacter(character.id, { name: e.target.value })}
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 19,
                      fontWeight: 700,
                      color: 'var(--gold-400)',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px dashed rgba(212,168,79,0.35)',
                      padding: '0 2px',
                      maxWidth: 260,
                    }}
                  />
                ) : (
                  <h2 className="mesa-modal__title" style={{ fontSize: 19 }}>
                    {character.name}
                  </h2>
                )}

                <span className="mesa-badge mesa-badge--gold">
                  Nível {isMightyBlade ? mbData?.level : genericData?.level}
                </span>
                <span className="mesa-badge">
                  {isMightyBlade ? `${mbData?.className} · ${mbData?.raceName}` : genericData?.archetype}
                </span>
              </div>

              {/* XP Bar (Mighty Blade) */}
              {isMightyBlade && mbData && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span>XP:</span>
                    <strong style={{ color: 'var(--gold-400)', fontFamily: 'var(--font-mono)' }}>
                      {mbData.xp}
                    </strong>
                    {nextLevelRow && <span>/ {nextLevelRow.xpRequired}</span>}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => updateMBData({ ...mbData, xp: mbData.xp + 1 })}
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
                </div>
              )}
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
                  title="Descanso Curto (+5 PV e +5 PM)"
                >
                  <Coffee size={13} />
                  Curto
                </button>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--sm"
                  onClick={() => handleRest('long')}
                  title="Descanso Longo (+30 PV e +30 PM)"
                >
                  <Moon size={13} />
                  Longo
                </button>
                {(!isMightyBlade || (mbData && mbData.level < 10)) && (
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--gold mesa-btn--sm"
                    onClick={() => (isMightyBlade ? setLevelUpOpen((v) => !v) : handleConfirmLevelUp())}
                  >
                    <ArrowUpCircle size={13} />
                    Subir Nível
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

        {/* Scrollable Sheet Body */}
        <div className="mesa-modal__body" style={{ gap: 14 }}>
          {/* Portrait Picker Drawer */}
          {portraitPickerOpen && canEdit && (
            <div
              style={{
                padding: 12,
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-obsidian)',
                border: '1px solid var(--border-gold)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)' }}>
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

          {/* Mighty Blade Level Up Popover */}
          {levelUpOpen && isMightyBlade && mbData && nextLevelRow && (
            <div
              style={{
                padding: 14,
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, rgba(212,168,79,0.16), var(--bg-obsidian))',
                border: '1px solid var(--gold-400)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--gold-400)' }}>
                Subir para Nível {nextLevelRow.level} ({nextLevelRow.notes})
              </div>
              {nextLevelRow.evolutionPointsGained > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {mbRules.levelProgression.evolutionChoiceOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`mesa-btn mesa-btn--sm ${evoChoice === opt.id ? 'mesa-btn--gold' : ''}`}
                      onClick={() => setEvoChoice(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {nextLevelRow.attributePointsGained > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>+1 Atributo em:</span>
                  {MB_ATTRS.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      className={`mesa-btn mesa-btn--sm ${attrLevelChoice === a.key ? 'mesa-btn--gold' : ''}`}
                      onClick={() => setAttrLevelChoice(a.key)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="mesa-btn mesa-btn--ghost mesa-btn--sm" onClick={() => setLevelUpOpen(false)}>
                  Cancelar
                </button>
                <button type="button" className="mesa-btn mesa-btn--gold mesa-btn--sm" onClick={handleConfirmLevelUp}>
                  <Check size={13} /> Confirmar Evolução
                </button>
              </div>
            </div>
          )}

          {/* RESOURCES STRIP (PV & PM with -5/-1/+1/+5 steppers) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {pv && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-obsidian)',
                  border: `1px solid ${pv.current <= 0 ? 'var(--crimson-500)' : 'rgba(34,197,94,0.35)'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--emerald-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Heart size={13} /> Pontos de Vida (PV)
                    {pv.current <= -10 && <span className="mesa-badge mesa-badge--crimson">MORTO</span>}
                    {pv.current <= 0 && pv.current > -10 && <span className="mesa-badge mesa-badge--crimson">INCONSCIENTE</span>}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800 }}>
                    {pv.current} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/ {pv.max}</span>
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, (pv.current / Math.max(1, pv.max)) * 100))}%`,
                      height: '100%',
                      background: pv.current <= pv.max * 0.3 ? 'var(--crimson-500)' : 'var(--emerald-500)',
                    }}
                  />
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[-5, -1, 1, 5].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        className="mesa-btn mesa-btn--sm"
                        onClick={() => adjustResource(isMightyBlade ? 'pv' : 'hp', delta)}
                        style={{ flex: 1, minHeight: 28, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pm && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid rgba(59,130,246,0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sapphire-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Zap size={13} /> {isMightyBlade ? 'Pontos de Mana (PM)' : 'Energia (PE/PM)'}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800 }}>
                    {pm.current} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/ {pm.max}</span>
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, (pm.current / Math.max(1, pm.max)) * 100))}%`,
                      height: '100%',
                      background: 'var(--sapphire-500)',
                    }}
                  />
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[-5, -1, 1, 5].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        className="mesa-btn mesa-btn--sm"
                        onClick={() => adjustResource(isMightyBlade ? 'pm' : 'mp', delta)}
                        style={{ flex: 1, minHeight: 28, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Extra Generic Custom Bars */}
            {!isMightyBlade &&
              (genericData?.customBars ?? []).map((barDef) => {
                const bar = character.resources?.[barDef.key] ?? { current: barDef.max, max: barDef.max };
                return (
                  <div
                    key={barDef.key}
                    style={{
                      padding: 10,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-obsidian)',
                      border: `1px solid ${barDef.color}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: barDef.color }}>
                        {barDef.label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 800 }}>
                        {bar.current}/{bar.max}
                      </span>
                    </div>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[-1, 1].map((d) => (
                          <button
                            key={d}
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            onClick={() => adjustResource(barDef.key, d)}
                            style={{ flex: 1, minHeight: 26 }}
                          >
                            {d > 0 ? `+${d}` : d}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* MIGHTY BLADE: 4 ATTRIBUTES + DERIVED DEFENSES */}
          {isMightyBlade && mbData && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                {MB_ATTRS.map((attr) => {
                  const val = mbData.attributes[attr.key];
                  const popoverActive = attrRollPopover === attr.key;
                  return (
                    <div
                      key={attr.key}
                      style={{
                        position: 'relative',
                        padding: 10,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-elevated)',
                        border: `1px solid ${popoverActive ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                        {attr.label.toUpperCase()}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() =>
                              updateMBData({
                                ...mbData,
                                attributes: { ...mbData.attributes, [attr.key]: Math.max(0, val - 1) },
                              })
                            }
                            style={{ padding: 3, color: 'var(--text-muted)' }}
                            aria-label={`Diminuir ${attr.label}`}
                          >
                            <Minus size={12} />
                          </button>
                        )}
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 800, color: 'var(--gold-400)', lineHeight: 1 }}>
                          {val}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() =>
                              updateMBData({
                                ...mbData,
                                attributes: { ...mbData.attributes, [attr.key]: Math.min(12, val + 1) },
                              })
                            }
                            style={{ padding: 3, color: 'var(--text-muted)' }}
                            aria-label={`Aumentar ${attr.label}`}
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 4, width: '100%' }}>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--gold mesa-btn--sm"
                          style={{ flex: 1, minHeight: 30, fontSize: 11.5 }}
                          onClick={() => handleRollMBAttribute(attr.key)}
                        >
                          <Dices size={13} />
                          2d6 + {val}
                        </button>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--sm"
                          title="Opções: Inapto / Vantagem / Dificuldade"
                          onClick={() =>
                            setAttrRollPopover(popoverActive ? null : attr.key)
                          }
                          style={{ minHeight: 30, padding: '0 7px' }}
                        >
                          <SlidersHorizontal size={12} />
                        </button>
                      </div>

                      {/* Quick Inapto / Vantagem / Difficulty Popover */}
                      {popoverActive && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 'calc(100% + 6px)',
                            left: 0,
                            right: 0,
                            minWidth: 210,
                            zIndex: 25,
                            padding: 10,
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--bg-obsidian)',
                            border: '1px solid var(--gold-400)',
                            boxShadow: 'var(--shadow-lg)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 7,
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold-400)' }}>
                            Teste de {attr.label}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {[
                              { id: 'inapto', label: 'Inapto 1d6' },
                              { id: 'normal', label: '2d6' },
                              { id: 'vantagem', label: 'Vant. 3d6' },
                            ].map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => setRollDiceMode(m.id as 'normal' | 'inapto' | 'vantagem')}
                                style={{
                                  flex: 1,
                                  padding: '4px',
                                  borderRadius: 5,
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  background: rollDiceMode === m.id ? 'var(--gold-soft)' : 'var(--bg-elevated)',
                                  border: `1px solid ${rollDiceMode === m.id ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                                  color: rollDiceMode === m.id ? 'var(--gold-400)' : 'var(--text-secondary)',
                                }}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {DIFFICULTY_PRESETS.map((p) => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => setRollDifficulty(p.value)}
                                style={{
                                  padding: '3px 6px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  background: rollDifficulty === p.value ? 'var(--sapphire-soft)' : 'var(--bg-elevated)',
                                  border: `1px solid ${rollDifficulty === p.value ? 'var(--sapphire-400)' : 'var(--border-subtle)'}`,
                                  color: rollDifficulty === p.value ? 'var(--sapphire-400)' : 'var(--text-secondary)',
                                }}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            <span>Mod extra:</span>
                            <input
                              type="number"
                              value={rollExtraMod}
                              onChange={(e) => setRollExtraMod(Number(e.target.value) || 0)}
                              style={{
                                width: 54,
                                padding: '3px 6px',
                                background: 'var(--bg-elevated)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 4,
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--gold mesa-btn--sm"
                            onClick={() =>
                              handleRollMBAttribute(attr.key, rollDiceMode, rollDifficulty, rollExtraMod)
                            }
                          >
                            <Dices size={12} /> Rolar Agora
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Derived Defense & Load Strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: 7 }}>
                {[
                  { label: 'Bloqueio', value: String(mbComp.bloqueio ?? 8), accent: 'var(--gold-400)' },
                  { label: 'Esquiva', value: String(mbComp.esquiva ?? 8), accent: 'var(--emerald-400)' },
                  { label: 'Determinação', value: String(mbComp.determinacao ?? 11), accent: 'var(--sapphire-400)' },
                  {
                    label: 'Deslocamento',
                    value: `${mbComp.deslocamento ?? 6}m (${mbComp.deslocamentoQuadrados ?? 4}q)`,
                    accent: 'var(--text-primary)',
                  },
                  {
                    label: 'Carga',
                    value: `${mbComp.cargaAtual ?? 0}/${mbComp.cargaBasica ?? 21} kg`,
                    accent:
                      cargaStatus === 'maxima'
                        ? 'var(--crimson-400)'
                        : cargaStatus === 'pesada'
                          ? 'var(--amber-400)'
                          : 'var(--text-primary)',
                  },
                ].map((st) => (
                  <div
                    key={st.label}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-obsidian)',
                      border: '1px solid var(--border-subtle)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      {st.label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 800, color: st.accent, marginTop: 2 }}>
                      {st.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* FN / Overload Alerts */}
              {(fnArmorInapto || cargaStatus !== 'basica') && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(245, 158, 11, 0.14)',
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    color: '#fde68a',
                    fontSize: 12,
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>
                    {fnArmorInapto && 'Armadura/Escudo acima da sua Força (FN): você está Inapto (1d6)! '}
                    {cargaStatus === 'pesada' && 'Sobrecarga Pesada: deslocamento reduzido pela metade.'}
                    {cargaStatus === 'maxima' && 'Sobrecarga Máxima: deslocamento reduzido a 0m!'}
                  </span>
                </div>
              )}
            </>
          )}

          {/* GENERIC RPG: DYNAMIC CUSTOM ATTRIBUTES */}
          {!isMightyBlade && genericData && (
            <div
              style={{
                padding: 12,
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-obsidian)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--gold-400)' }}>
                  Atributos Dinâmicos · Defesa {String(genericComp.defesa ?? 10)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Dado base:</span>
                  <select
                    value={genericDiceBase}
                    onChange={(e) => setGenericDiceBase(e.target.value)}
                    className="mesa-select"
                    style={{ width: 'auto', padding: '3px 8px', fontSize: 11 }}
                  >
                    <option value="1d20">1d20</option>
                    <option value="2d6">2d6</option>
                    <option value="3d6">3d6</option>
                    <option value="1d100">1d100</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: 8 }}>
                {genericData.attributes.map((attr) => (
                  <div
                    key={attr.key}
                    style={{
                      padding: 9,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {attr.label}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            updateGenericData({
                              ...genericData,
                              attributes: genericData.attributes.filter((a) => a.key !== attr.key),
                            })
                          }
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            updateGenericData({
                              ...genericData,
                              attributes: genericData.attributes.map((a) =>
                                a.key === attr.key ? { ...a, value: a.value - 1 } : a
                              ),
                            })
                          }
                        >
                          <Minus size={12} />
                        </button>
                      )}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 800, color: 'var(--gold-400)' }}>
                        {attr.value >= 0 ? `+${attr.value}` : attr.value}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            updateGenericData({
                              ...genericData,
                              attributes: genericData.attributes.map((a) =>
                                a.key === attr.key ? { ...a, value: a.value + 1 } : a
                              ),
                            })
                          }
                        >
                          <Plus size={12} />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      style={{ width: '100%', minHeight: 28, fontSize: 11 }}
                      onClick={() =>
                        rollDice({
                          formula: `${genericDiceBase}${attr.value >= 0 ? ` + ${attr.value}` : ` - ${Math.abs(attr.value)}`}`,
                          label: `Teste de ${attr.label}`,
                          characterId: character.id,
                          systemMeta: { systemId: 'generic-rpg', kind: 'attribute', attrKey: attr.key },
                        })
                      }
                    >
                      <Dices size={12} /> Rolar
                    </button>
                  </div>
                ))}
              </div>

              {canEdit && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
                  <input
                    type="text"
                    className="mesa-input"
                    value={newAttrLabel}
                    onChange={(e) => setNewAttrLabel(e.target.value)}
                    placeholder="Novo atributo (ex: Carisma, Sorte)"
                    style={{ flex: 1, minWidth: 140, padding: '6px 9px', fontSize: 12 }}
                  />
                  <input
                    type="number"
                    className="mesa-input"
                    value={newAttrValue}
                    onChange={(e) => setNewAttrValue(Number(e.target.value) || 0)}
                    style={{ width: 70, padding: '6px 9px', fontSize: 12 }}
                  />
                  <button type="button" className="mesa-btn mesa-btn--sm" onClick={handleAddGenericAttr}>
                    <Plus size={12} /> Atributo
                  </button>

                  <input
                    type="text"
                    className="mesa-input"
                    value={newBarLabel}
                    onChange={(e) => setNewBarLabel(e.target.value)}
                    placeholder="Nova barra (ex: Sanidade)"
                    style={{ flex: 1, minWidth: 130, padding: '6px 9px', fontSize: 12 }}
                  />
                  <input
                    type="number"
                    className="mesa-input"
                    value={newBarMax}
                    onChange={(e) => setNewBarMax(Number(e.target.value) || 10)}
                    style={{ width: 65, padding: '6px 9px', fontSize: 12 }}
                  />
                  <button type="button" className="mesa-btn mesa-btn--sm" onClick={handleAddGenericBar}>
                    <Plus size={12} /> Barra
                  </button>
                </div>
              )}
            </div>
          )}

          {/* INTERACTIVE CONDITIONS BAR */}
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
                <Plus size={11} /> Condição
              </button>
            )}
          </div>

          {conditionMenuOpen && canEdit && (
            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-obsidian)',
                border: '1px solid var(--border-gold)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {(isMightyBlade
                ? mbConditions
                : (genericRpgEngine.getCompendium().conditions as Array<{ id: string; name: string; emoji?: string; description?: string }>)
              ).map((cond) => {
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
                      fontSize: 11.5,
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

          {/* TARGET SELECTOR STRIP */}
          {characters.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Crosshair size={13} style={{ color: 'var(--crimson-400)' }} />
              <span style={{ color: 'var(--text-muted)' }}>Alvo para ataques/magias:</span>
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
                      {c.name} (Def {String(c.computed?.defesa ?? c.computed?.bloqueio ?? '?')})
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* SHEET NAVIGATION TABS */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              borderBottom: '1px solid var(--border-subtle)',
              paddingBottom: 6,
              overflowX: 'auto',
            }}
          >
            {[
              { id: 'combat', label: 'Combate & Ações', icon: <Swords size={13} /> },
              { id: 'skills', label: isMightyBlade ? 'Habilidades & Magias' : 'Ações Customizadas', icon: <Wand2 size={13} /> },
              { id: 'equipment', label: 'Equipamento', icon: <Backpack size={13} /> },
              { id: 'bio', label: 'Biografia & Notas', icon: <BookOpen size={13} /> },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as SheetTab)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12.5,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    background: active ? 'var(--gold-soft)' : 'transparent',
                    border: `1px solid ${active ? 'var(--border-gold)' : 'transparent'}`,
                    color: active ? 'var(--gold-400)' : 'var(--text-muted)',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* TAB 1: COMBAT & ACTIONS */}
          {activeTab === 'combat' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isMightyBlade ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)' }}>
                      Armas Equipadas
                    </div>
                    {equippedWeapons.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Nenhuma arma equipada. Equipe uma arma na aba Equipamento ou ataque desarmado abaixo.
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
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <strong style={{ fontSize: 13.5 }}>{w.name}</strong>
                              {w.inapto && (
                                <span className="mesa-badge mesa-badge--crimson">Inapto (FN {w.fn})</span>
                              )}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                              Ataque <code style={{ color: 'var(--gold-400)' }}>{w.attackFormula}</code> · Dano Fixo{' '}
                              <strong style={{ color: '#fca5a5' }}>{w.baseDamage} {w.damageType}</strong> · {w.range}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="mesa-btn mesa-btn--gold mesa-btn--sm"
                              onClick={() => handleMBWeaponAttack(w.id)}
                            >
                              <Swords size={13} /> Atacar
                            </button>
                            <button
                              type="button"
                              className="mesa-btn mesa-btn--danger mesa-btn--sm"
                              onClick={() => handleMBWeaponDamage(w.name, w.baseDamage, w.damageType)}
                            >
                              Dano ({w.baseDamage})
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Quick Combat Maneuvers */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      onClick={() => {
                        const plan = mightyBlade3eEngine.planInitiative(character);
                        rollDice({ formula: plan.formula, label: plan.label, characterId: character.id, systemMeta: plan.systemMeta });
                      }}
                    >
                      <Dices size={13} /> Rolar Iniciativa
                    </button>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      onClick={() => handleMBWeaponAttack('__unarmed__')}
                    >
                      Ataque Desarmado
                    </button>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      onClick={() => handleRollMBAttribute('agilidade', 'normal', 10)}
                    >
                      <Shield size={13} /> Esquiva / Reflexos
                    </button>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      onClick={() => handleRollMBAttribute('vontade', 'normal', 10)}
                    >
                      Resistir / Estabilizar (Dif 10)
                    </button>
                  </div>
                </>
              ) : (
                /* Generic RPG Combat Quick Actions */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(genericData?.actions ?? []).map((act) => (
                    <div
                      key={act.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '9px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 13 }}>{act.name}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {act.formula}
                          {act.damageFormula ? ` · Dano: ${act.damageFormula}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--gold mesa-btn--sm"
                        onClick={() => {
                          const plan = genericRpgEngine.planAttack(character, act.id, targetCharacter ?? undefined);
                          rollDice({
                            formula: plan.formula,
                            label: plan.label,
                            characterId: character.id,
                            difficulty: plan.difficulty,
                            targetCharacterId: plan.targetCharacterId,
                            targetDefense: plan.targetDefense,
                            systemMeta: plan.systemMeta,
                          });
                        }}
                      >
                        <Dices size={13} /> Rolar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ABILITIES & SPELLS (MB) OR CUSTOM ACTIONS (GENERIC) */}
          {activeTab === 'skills' && isMightyBlade && mbData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    onClick={() => {
                      setAddSkillDrawer(addSkillDrawer === 'ability' ? null : 'ability');
                      setDrawerQuery('');
                    }}
                  >
                    <Plus size={13} /> Adicionar Habilidade do Compêndio
                  </button>
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    onClick={() => {
                      setAddSkillDrawer(addSkillDrawer === 'spell' ? null : 'spell');
                      setDrawerQuery('');
                    }}
                  >
                    <Wand2 size={13} /> Adicionar Magia do Compêndio
                  </button>
                </div>
              )}

              {addSkillDrawer && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-obsidian)',
                    border: '1px solid var(--border-gold)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <input
                    type="text"
                    className="mesa-input"
                    value={drawerQuery}
                    onChange={(e) => setDrawerQuery(e.target.value)}
                    placeholder={addSkillDrawer === 'ability' ? 'Buscar habilidade...' : 'Buscar magia ou caminho...'}
                    style={{ padding: '6px 9px', fontSize: 12 }}
                    autoFocus
                  />
                  <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {addSkillDrawer === 'ability'
                      ? mbAbilities
                          .filter(
                            (a) =>
                              !drawerQuery.trim() ||
                              a.name.toLowerCase().includes(drawerQuery.toLowerCase()) ||
                              a.classId.toLowerCase().includes(drawerQuery.toLowerCase())
                          )
                          .slice(0, 25)
                          .map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => {
                                updateMBData({
                                  ...mbData,
                                  abilities: [
                                    ...mbData.abilities,
                                    {
                                      id: `${a.id}-${Date.now().toString(36)}`,
                                      abilityId: a.id,
                                      name: a.name,
                                      category: a.category,
                                      manaCost: a.manaCost ?? 0,
                                      difficulty: a.difficulty ?? undefined,
                                      range: a.range,
                                      duration: a.duration,
                                      description: a.description,
                                      automation: a.automation,
                                    },
                                  ],
                                });
                                pushToast(`"${a.name}" adicionada!`, 'success');
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
                                <strong>{a.name}</strong> ({a.classId})
                              </span>
                              <span style={{ color: 'var(--gold-400)' }}>+ Adicionar</span>
                            </button>
                          ))
                      : mbSpells
                          .filter(
                            (s) =>
                              !drawerQuery.trim() ||
                              s.name.toLowerCase().includes(drawerQuery.toLowerCase()) ||
                              s.path.toLowerCase().includes(drawerQuery.toLowerCase())
                          )
                          .slice(0, 25)
                          .map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                updateMBData({
                                  ...mbData,
                                  spells: [
                                    ...mbData.spells,
                                    {
                                      id: `${s.id}-${Date.now().toString(36)}`,
                                      spellId: s.id,
                                      name: s.name,
                                      path: s.path,
                                      type: s.type,
                                      manaCost: s.manaCost,
                                      difficulty: s.difficulty,
                                      range: s.range,
                                      duration: s.duration,
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
                                <strong>{s.name}</strong> [{s.path}] · {s.manaCost} PM
                              </span>
                              <span style={{ color: 'var(--sapphire-400)' }}>+ Adicionar</span>
                            </button>
                          ))}
                  </div>
                </div>
              )}

              {/* Abilities List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)' }}>
                  Habilidades ({mbData.abilities.length})
                </div>
                {mbData.abilities.map((ab) => (
                  <div
                    key={ab.id}
                    style={{
                      padding: '9px 11px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={13} style={{ color: 'var(--gold-400)' }} />
                        <strong style={{ fontSize: 13 }}>{ab.name}</strong>
                        {ab.manaCost ? (
                          <span className="mesa-badge mesa-badge--sapphire">{ab.manaCost} PM</span>
                        ) : null}
                        {ab.difficulty ? (
                          <span className="mesa-badge mesa-badge--gold">Dif {ab.difficulty}</span>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--gold mesa-btn--sm"
                          onClick={() => handleUseMBAbility(ab)}
                        >
                          <Zap size={12} /> Usar
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                            onClick={() =>
                              updateMBData({
                                ...mbData,
                                abilities: mbData.abilities.filter((x) => x.id !== ab.id),
                              })
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ab.description}</div>
                  </div>
                ))}
              </div>

              {/* Spells List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sapphire-400)' }}>
                  Magias ({mbData.spells.length})
                </div>
                {mbData.spells.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Nenhuma magia no grimório.
                  </div>
                ) : (
                  mbData.spells.map((sp) => (
                    <div
                      key={sp.id}
                      style={{
                        padding: '9px 11px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-elevated)',
                        border: '1px solid rgba(59, 130, 246, 0.25)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Wand2 size={13} style={{ color: 'var(--sapphire-400)' }} />
                          <strong style={{ fontSize: 13 }}>{sp.name}</strong>
                          {sp.path && <span className="mesa-badge">{sp.path}</span>}
                          <span className="mesa-badge mesa-badge--sapphire">{sp.manaCost} PM</span>
                          <span className="mesa-badge mesa-badge--gold">Dif {sp.difficulty}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--gold mesa-btn--sm"
                            onClick={() => handleCastMBSpell(sp)}
                          >
                            <Wand2 size={12} /> Conjurar
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                              onClick={() =>
                                updateMBData({
                                  ...mbData,
                                  spells: mbData.spells.filter((x) => x.id !== sp.id),
                                })
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sp.description}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 2 (GENERIC RPG): Custom Actions Builder */}
          {activeTab === 'skills' && !isMightyBlade && genericData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {canEdit && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-obsidian)',
                    border: '1px solid var(--border-gold)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 8,
                  }}
                >
                  <input
                    type="text"
                    className="mesa-input"
                    value={newActionName}
                    onChange={(e) => setNewActionName(e.target.value)}
                    placeholder="Nome da ação/magia"
                    style={{ padding: '6px 9px', fontSize: 12 }}
                  />
                  <input
                    type="text"
                    className="mesa-input"
                    value={newActionFormula}
                    onChange={(e) => setNewActionFormula(e.target.value)}
                    placeholder="Fórmula (ex: 1d20 + @fisico)"
                    style={{ padding: '6px 9px', fontSize: 12 }}
                  />
                  <input
                    type="text"
                    className="mesa-input"
                    value={newActionDmg}
                    onChange={(e) => setNewActionDmg(e.target.value)}
                    placeholder="Dano opcional (ex: 2d6 + 2)"
                    style={{ padding: '6px 9px', fontSize: 12 }}
                  />
                  <button type="button" className="mesa-btn mesa-btn--gold mesa-btn--sm" onClick={handleAddGenericAction}>
                    <Plus size={12} /> Adicionar Ação
                  </button>
                </div>
              )}

              {genericData.actions.map((act) => (
                <div
                  key={act.id}
                  style={{
                    padding: '9px 11px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div>
                    <strong>{act.name}</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {act.formula}
                      {act.damageFormula ? ` · Dano ${act.damageFormula}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      onClick={() => {
                        const formula = interpolateFormula(act.formula, { character, target: targetCharacter ?? undefined });
                        rollDice({
                          formula,
                          label: act.name,
                          characterId: character.id,
                          targetCharacterId: targetCharacter?.id,
                          systemMeta: { damageFormula: act.damageFormula },
                        });
                      }}
                    >
                      <Dices size={12} /> Rolar
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                        onClick={() =>
                          updateGenericData({
                            ...genericData,
                            actions: genericData.actions.filter((a) => a.id !== act.id),
                          })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: EQUIPMENT */}
          {activeTab === 'equipment' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isMightyBlade && mbData && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Moedas (TO):</span>
                    <input
                      type="number"
                      className="mesa-input"
                      disabled={!canEdit}
                      value={mbData.money ?? 0}
                      onChange={(e) => updateMBData({ ...mbData, money: Math.max(0, Number(e.target.value) || 0) })}
                      style={{ width: 92, padding: '4px 8px', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    />
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
              )}

              {addItemDrawer && isMightyBlade && mbData && (
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
                    placeholder="Buscar arma, armadura, escudo ou poção..."
                    style={{ padding: '6px 9px', fontSize: 12 }}
                    autoFocus
                  />
                  <div style={{ maxHeight: 170, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[
                      ...mbEquipment.weapons.map((w) => ({
                        id: w.id,
                        name: w.name,
                        tag: `Arma · FN ${w.fn} · +${w.damageBonus}`,
                        entry: {
                          id: `eq-${w.id}-${Date.now().toString(36)}`,
                          itemId: w.id,
                          name: w.name,
                          category: 'weapon' as const,
                          equipped: true,
                          quantity: 1,
                          fn: w.fn,
                          damageBonus: w.damageBonus,
                          damageAttribute: w.damageAttribute ?? 'forca',
                          damageType: w.damageType,
                          weight: w.weight ?? 2,
                          range: w.range,
                        },
                      })),
                      ...mbEquipment.armor.map((a) => ({
                        id: a.id,
                        name: a.name,
                        tag: `${a.slot === 'shield' ? 'Escudo' : 'Armadura'} · +${a.defenseBonus} Bloq`,
                        entry: {
                          id: `eq-${a.id}-${Date.now().toString(36)}`,
                          itemId: a.id,
                          name: a.name,
                          category: (a.slot === 'shield' ? 'shield' : 'armor') as 'shield' | 'armor',
                          equipped: false,
                          quantity: 1,
                          fn: a.fn,
                          defenseBonus: a.defenseBonus,
                          agilityPenalty: Math.abs(a.agilityPenalty ?? a.dodgePenalty ?? 0),
                          weight: a.weight ?? 5,
                        },
                      })),
                      ...mbEquipment.gear.map((g) => ({
                        id: g.id,
                        name: g.name,
                        tag: g.consumable ? 'Consumível' : 'Item',
                        entry: {
                          id: `eq-${g.id}-${Date.now().toString(36)}`,
                          itemId: g.id,
                          name: g.name,
                          category: (g.consumable ? 'consumable' : 'gear') as 'consumable' | 'gear',
                          equipped: false,
                          quantity: 1,
                          weight: g.weight ?? 0.5,
                          effect: g.effect,
                          description: g.description,
                        },
                      })),
                    ]
                      .filter(
                        (x) =>
                          !drawerQuery.trim() ||
                          x.name.toLowerCase().includes(drawerQuery.toLowerCase()) ||
                          x.tag.toLowerCase().includes(drawerQuery.toLowerCase())
                      )
                      .slice(0, 24)
                      .map((x) => (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => {
                            updateMBData({ ...mbData, inventory: [...mbData.inventory, x.entry] });
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
              {(isMightyBlade ? mbData?.inventory ?? [] : genericData?.inventory ?? []).map((item) => {
                const equippable =
                  item.category === 'weapon' || item.category === 'armor' || item.category === 'shield';
                const isConsumable = item.category === 'consumable' || Boolean(item.effect);
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
                      border: `1px solid ${item.equipped ? 'var(--border-gold)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ fontSize: 13 }}>{item.name}</strong>
                        {item.quantity > 1 && <span className="mesa-badge">×{item.quantity}</span>}
                        {item.fn !== undefined && item.fn > 0 && <span className="mesa-badge">FN {item.fn}</span>}
                        {item.defenseBonus ? (
                          <span className="mesa-badge mesa-badge--emerald">+{item.defenseBonus} Bloq</span>
                        ) : null}
                        {item.damageBonus ? (
                          <span className="mesa-badge mesa-badge--crimson">+{item.damageBonus} Dano</span>
                        ) : null}
                      </div>
                      {item.description && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                          {item.description}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 5 }}>
                      {equippable && canEdit && isMightyBlade && (
                        <button
                          type="button"
                          className={`mesa-btn mesa-btn--sm ${item.equipped ? 'mesa-btn--gold' : ''}`}
                          onClick={() => handleToggleEquipItem(item.id)}
                        >
                          {item.equipped ? 'Equipado' : 'Equipar'}
                        </button>
                      )}
                      {isConsumable && canEdit && isMightyBlade && (
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                          onClick={() => handleUseConsumable(item)}
                        >
                          <FlaskConical size={12} /> Usar
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                          onClick={() => {
                            if (isMightyBlade && mbData) {
                              updateMBData({
                                ...mbData,
                                inventory: mbData.inventory.filter((x) => x.id !== item.id),
                              });
                            } else if (genericData) {
                              updateGenericData({
                                ...genericData,
                                inventory: genericData.inventory.filter((x) => x.id !== item.id),
                              });
                            }
                          }}
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

          {/* TAB 4: BIOGRAPHY & NOTES */}
          {activeTab === 'bio' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {isMightyBlade && mbData && (
                <div>
                  <label className="mesa-label">História & Antecedentes</label>
                  <textarea
                    className="mesa-textarea"
                    rows={4}
                    disabled={!canEdit}
                    value={mbData.background ?? ''}
                    onChange={(e) => updateMBData({ ...mbData, background: e.target.value })}
                    placeholder="História do herói..."
                  />
                </div>
              )}

              <div>
                <label className="mesa-label">Anotações da Sessão</label>
                <textarea
                  className="mesa-textarea"
                  rows={5}
                  disabled={!canEdit}
                  value={isMightyBlade ? (mbData?.notes ?? '') : (genericData?.notes ?? '')}
                  onChange={(e) => {
                    if (isMightyBlade && mbData) {
                      updateMBData({ ...mbData, notes: e.target.value });
                    } else if (genericData) {
                      updateGenericData({ ...genericData, notes: e.target.value });
                    }
                  }}
                  placeholder="Pistas, NPCs encontrados, objetivos..."
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
      </div>
    </div>
  );
}

export default CharacterSheetModal;
