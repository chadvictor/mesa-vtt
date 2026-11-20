import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Dices,
  Flame,
  MapPin,
  Minus,
  Plus,
  Search,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Users,
  Wand2,
} from 'lucide-react';
import {
  tagmarBestiary,
  tagmarCombatTechniques,
  tagmarConditions,
  tagmarCoreProfessions,
  tagmarEquipment,
  tagmarProfessions,
  tagmarRaces,
  tagmarRules,
  tagmarSkills,
  tagmarSpells,
  type TagmarArmor,
  type TagmarCombatTechnique,
  type TagmarCreature,
  type TagmarGear,
  type TagmarSkill,
  type TagmarSpell,
  type TagmarWeapon,
} from '@systems/tagmar/compendium';
import {
  readTagmarData,
  spawnBestiaryMonster,
  tagmar3Engine,
} from '@systems/tagmar/engine';
import {
  TAGMAR_COLOR_META,
  getAllResolutionRows,
  getResistanceTarget,
  resolveTagmarRoll,
} from '@systems/tagmar/resolutionTable';
import type {
  TagmarColorDamage,
  TagmarCombatEntry,
  TagmarEquipmentEntry,
  TagmarSkillEntry,
  TagmarSpellEntry,
} from '@systems/types';
import { useCampaignStore } from '@/lib/store';

type TagmarSection =
  | 'races'
  | 'professions'
  | 'skills'
  | 'spells'
  | 'equipment'
  | 'bestiary'
  | 'conditions'
  | 'rules';

const TAGMAR_SECTIONS: Array<{ id: TagmarSection; label: string }> = [
  { id: 'races', label: `Raças (${tagmarRaces.length})` },
  { id: 'professions', label: `Profissões (${tagmarProfessions.length})` },
  { id: 'skills', label: `Hab. & Téc. (${tagmarSkills.length + tagmarCombatTechniques.length})` },
  { id: 'spells', label: `Magias (${tagmarSpells.length})` },
  {
    id: 'equipment',
    label: `Equip. (${tagmarEquipment.weapons.length + tagmarEquipment.armor.length + tagmarEquipment.gear.length})`,
  },
  { id: 'bestiary', label: `Bestiário (${tagmarBestiary.length})` },
  { id: 'conditions', label: `Condições (${tagmarConditions.length})` },
  { id: 'rules', label: 'Tabela & Regras' },
];

const PROF_LABEL: Record<string, string> = {
  guerreiro: 'Guerreiro',
  ladino: 'Ladino',
  sacerdote: 'Sacerdote',
  mago: 'Mago',
  rastreador: 'Rastreador',
  bardo: 'Bardo',
};

const ATTR_ABBR: Record<string, string> = {
  intelecto: 'INT',
  aura: 'AUR',
  carisma: 'CAR',
  forca: 'FOR',
  fisico: 'FIS',
  agilidade: 'AGI',
};

function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function formatRange(r: [number, number] | null): string {
  if (!r) return '—';
  return r[0] === r[1] ? String(r[0]) : `${r[0]}-${r[1]}`;
}

export function TagmarDamagePills({
  damage,
  compact = false,
}: {
  damage: TagmarColorDamage;
  compact?: boolean;
}) {
  const tiers: Array<{ label: string; value: number | undefined; color: string; bg: string }> = [
    { label: '25%', value: damage.verde, color: '#86efac', bg: 'rgba(34,197,94,0.22)' },
    { label: '50%', value: damage.amarelo, color: '#fde047', bg: 'rgba(234,179,8,0.22)' },
    { label: '75%', value: damage.laranja, color: '#fdba74', bg: 'rgba(249,115,22,0.24)' },
    { label: '100%', value: damage.vermelho, color: '#fca5a5', bg: 'rgba(239,68,68,0.25)' },
  ];
  if (typeof damage.azul === 'number' && damage.azul > 0) {
    tiers.push({ label: 'Crít', value: damage.azul, color: '#7dd3fc', bg: 'rgba(56,189,248,0.25)' });
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
      {tiers.map((t) => (
        <span
          key={t.label}
          title={`Faixa ${t.label}: ${t.value}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            padding: compact ? '1px 5px' : '2px 6px',
            borderRadius: 4,
            fontSize: compact ? 10 : 10.5,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            background: t.bg,
            border: `1px solid ${t.color}66`,
            color: t.color,
          }}
        >
          {!compact && <span style={{ opacity: 0.78, fontSize: 9 }}>{t.label}:</span>}
          <span>{t.value}</span>
        </span>
      ))}
    </div>
  );
}

export interface TagmarCompendiumViewProps {
  compact?: boolean;
}

export function TagmarCompendiumView({ compact = false }: TagmarCompendiumViewProps) {
  const {
    characters,
    activeCharacter,
    activeScene,
    isGm,
    patchCharacter,
    createCharacter,
    createToken,
    rollDice,
    pushToast,
  } = useCampaignStore();

  const [section, setSection] = useState<TagmarSection>('skills');
  const [query, setQuery] = useState('');
  const [subFilter, setSubFilter] = useState<string>('all');
  const [secondFilter, setSecondFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [targetCharId, setTargetCharId] = useState<string>('');
  const [spawningId, setSpawningId] = useState<string | null>(null);

  // Interactive Resolution & Resistance Table consultant state
  const [consultCol, setConsultCol] = useState<number>(6);
  const [consultD20, setConsultD20] = useState<number>(12);
  const [consultFa, setConsultFa] = useState<number>(8);
  const [consultFd, setConsultFd] = useState<number>(4);
  const [showFullTable, setShowFullTable] = useState<boolean>(false);

  const tagmarChars = useMemo(
    () => characters.filter((c) => c.systemId === 'tagmar-3'),
    [characters]
  );

  const selectedChar = useMemo(() => {
    if (targetCharId) return characters.find((c) => c.id === targetCharId) ?? activeCharacter;
    if (activeCharacter?.systemId === 'tagmar-3') return activeCharacter;
    return tagmarChars.find((c) => c.kind === 'pc') ?? tagmarChars[0] ?? activeCharacter ?? characters[0] ?? null;
  }, [characters, tagmarChars, targetCharId, activeCharacter]);

  const norm = query.trim().toLowerCase();

  const handleSectionChange = (next: TagmarSection) => {
    setSection(next);
    setSubFilter('all');
    setSecondFilter('all');
    setExpandedId(null);
  };

  // Distinct filters
  const skillGroups = useMemo(
    () => Array.from(new Set(tagmarSkills.map((s) => s.group))).sort(),
    []
  );

  const spellGroups = useMemo(() => {
    const base =
      subFilter === 'all'
        ? tagmarSpells
        : tagmarSpells.filter((s) => s.professionIds.includes(subFilter));
    return Array.from(new Set(base.map((s) => s.group))).sort();
  }, [subFilter]);

  const bestiaryCategories = useMemo(
    () => Array.from(new Set(tagmarBestiary.map((b) => b.category))).sort(),
    []
  );

  // 1-Click Add to Sheet handlers
  const ensureTagmarTarget = () => {
    if (!selectedChar) {
      pushToast('Selecione ou crie uma ficha Tagmar 3.0 primeiro.', 'warning');
      return null;
    }
    if (selectedChar.systemId !== 'tagmar-3') {
      pushToast(`"${selectedChar.name}" não é uma ficha Tagmar 3.0.`, 'warning');
      return null;
    }
    return selectedChar;
  };

  const addSkillToSheet = (sk: TagmarSkill) => {
    const ch = ensureTagmarTarget();
    if (!ch) return;
    const data = readTagmarData(ch);
    if (data.skills.some((e) => e.skillId === sk.id || e.name === sk.name)) {
      pushToast(`${ch.name} já possui a habilidade "${sk.name}".`, 'info');
      return;
    }
    const entry: TagmarSkillEntry = {
      id: `sk-${sk.id}-${Date.now().toString(36)}`,
      skillId: sk.id,
      name: sk.name,
      group: sk.group,
      attribute: sk.attribute,
      level: 1,
      restricted: sk.restricted,
      description: sk.description,
    };
    const nextSys = { ...data, skills: [...data.skills, entry] };
    const draft = { ...ch, systemData: nextSys as unknown as Record<string, unknown> };
    const { computed } = tagmar3Engine.computeDerivedStats(draft);
    patchCharacter(ch.id, { systemData: draft.systemData, computed });
    pushToast(`Habilidade "${sk.name}" adicionada à ficha de ${ch.name}!`, 'success');
  };

  const addTechniqueToSheet = (ct: TagmarCombatTechnique) => {
    const ch = ensureTagmarTarget();
    if (!ch) return;
    const data = readTagmarData(ch);
    if (data.combatTechniques.some((e) => e.techniqueId === ct.id || e.name === ct.name)) {
      pushToast(`${ch.name} já possui a técnica "${ct.name}".`, 'info');
      return;
    }
    const entry: TagmarCombatEntry = {
      id: `ct-${ct.id}-${Date.now().toString(36)}`,
      techniqueId: ct.id,
      name: ct.name,
      category: ct.category,
      attribute: ct.attribute,
      level: 1,
      description: ct.description,
      automation: ct.automation,
    };
    const nextSys = { ...data, combatTechniques: [...data.combatTechniques, entry] };
    const draft = { ...ch, systemData: nextSys as unknown as Record<string, unknown> };
    const { computed } = tagmar3Engine.computeDerivedStats(draft);
    patchCharacter(ch.id, { systemData: draft.systemData, computed });
    pushToast(`Técnica "${ct.name}" adicionada à ficha de ${ch.name}!`, 'success');
  };

  const addSpellToSheet = (sp: TagmarSpell) => {
    const ch = ensureTagmarTarget();
    if (!ch) return;
    const data = readTagmarData(ch);
    if (data.spells.some((e) => e.spellId === sp.id || e.name === sp.name)) {
      pushToast(`${ch.name} já conhece "${sp.name}".`, 'info');
      return;
    }
    const entry: TagmarSpellEntry = {
      id: `sp-${sp.id}-${Date.now().toString(36)}`,
      spellId: sp.id,
      name: sp.name,
      group: sp.group,
      professionIds: sp.professionIds,
      level: 1,
      karmaCost: sp.karmaCost,
      evocationTime: sp.evocationTime,
      range: sp.range,
      duration: sp.duration,
      resistance: sp.resistance,
      effectLevels: sp.effectLevels,
      description: sp.description,
      automation: sp.automation,
    };
    const nextSys = { ...data, spells: [...data.spells, entry] };
    patchCharacter(ch.id, { systemData: nextSys as unknown as Record<string, unknown> });
    pushToast(`Magia "${sp.name}" adicionada ao grimório de ${ch.name}!`, 'success');
  };

  const addEquipmentToSheet = (
    item: TagmarWeapon | TagmarArmor | TagmarGear,
    kind: 'weapon' | 'armor' | 'gear'
  ) => {
    const ch = ensureTagmarTarget();
    if (!ch) return;
    const data = readTagmarData(ch);

    let entry: TagmarEquipmentEntry;
    if (kind === 'weapon') {
      const w = item as TagmarWeapon;
      entry = {
        id: `eq-${w.id}-${Date.now().toString(36)}`,
        itemId: w.id,
        name: w.name,
        category: 'weapon',
        equipped: true,
        quantity: 1,
        damage: { ...w.damage },
        damageType: w.damageType,
        hands: w.hands,
        minFor: w.minFor,
        columnBonus: w.columnBonus,
        range: w.range,
        weaponGroup: w.category,
        price: w.price,
        weight: w.weight,
        properties: w.properties,
        description: w.description,
      };
    } else if (kind === 'armor') {
      const a = item as TagmarArmor;
      const cat = a.slot === 'shield' ? 'shield' : a.slot === 'helmet' ? 'helmet' : 'armor';
      entry = {
        id: `eq-${a.id}-${Date.now().toString(36)}`,
        itemId: a.id,
        name: a.name,
        category: cat,
        slot: a.slot,
        equipped: false,
        quantity: 1,
        armorClass: a.armorClass,
        absorcao: a.absorcao,
        defPassiveBonus: a.defPassiveBonus,
        defActiveBonus: a.defActiveBonus,
        agilityPenalty: a.agilityPenalty,
        minFor: a.minFor,
        price: a.price,
        weight: a.weight,
        description: a.description,
      };
    } else {
      const g = item as TagmarGear;
      const isCons = Boolean(
        g.effect?.healEf ||
          g.effect?.healEh ||
          g.effect?.restoreKarma ||
          g.effect?.cureCondition
      );
      const isMagic =
        g.category.toLowerCase().includes('mágic') ||
        g.category.toLowerCase().includes('relíq') ||
        (g.rarity !== undefined && g.rarity !== 'Comum');
      entry = {
        id: `eq-${g.id}-${Date.now().toString(36)}`,
        itemId: g.id,
        name: g.name,
        category: isCons ? 'consumable' : isMagic ? 'magic' : 'gear',
        equipped: false,
        quantity: 1,
        price: g.price,
        weight: g.weight,
        effect: g.effect,
        description: g.description,
      };
    }

    const nextSys = { ...data, inventory: [...data.inventory, entry] };
    const draft = { ...ch, systemData: nextSys as unknown as Record<string, unknown> };
    const { computed } = tagmar3Engine.computeDerivedStats(draft);
    patchCharacter(ch.id, { systemData: draft.systemData, computed });
    pushToast(`"${entry.name}" adicionado ao inventário de ${ch.name}!`, 'success');
  };

  const handleSpawnCreature = async (creature: TagmarCreature) => {
    setSpawningId(creature.id);
    try {
      const draft = spawnBestiaryMonster(creature.id);
      if (!draft) {
        pushToast('Não foi possível instanciar a criatura.', 'error');
        return;
      }
      const created = await createCharacter(draft);
      if (created && activeScene) {
        const cx = Math.max(
          1,
          Math.floor((activeScene.grid.cols || 24) / 2) + Math.floor(Math.random() * 3 - 1)
        );
        const cy = Math.max(
          1,
          Math.floor((activeScene.grid.rows || 18) / 2) + Math.floor(Math.random() * 3 - 1)
        );
        createToken(activeScene.id, {
          characterId: created.id,
          name: created.name,
          imageUrl: created.portraitUrl,
          x: cx,
          y: cy,
          size: 1,
          rotation: 0,
          color: '#ef4444',
          layer: 'tokens',
          showBars: true,
          hp: created.resources?.eh?.current ?? creature.ehMax,
          hpMax: created.resources?.eh?.max ?? creature.ehMax,
          mp: created.resources?.ef?.current ?? creature.efMax,
          mpMax: created.resources?.ef?.max ?? creature.efMax,
          conditions: [],
          controlledByUserIds: [],
        });
        pushToast(`${creature.name} invocado na cena "${activeScene.name}"!`, 'success');
      } else if (created) {
        pushToast(`${creature.name} adicionado aos NPCs & Monstros!`, 'success');
      }
    } finally {
      setSpawningId(null);
    }
  };

  // Filtered views
  const filteredRaces = useMemo(
    () =>
      tagmarRaces.filter((r) => {
        if (subFilter === 'core' && r.officialStatus !== 'core') return false;
        if (subFilter === 'expansion' && r.officialStatus === 'core') return false;
        if (!norm) return true;
        return (
          r.name.toLowerCase().includes(norm) ||
          r.source.toLowerCase().includes(norm) ||
          r.description.toLowerCase().includes(norm)
        );
      }),
    [norm, subFilter]
  );

  const filteredProfessions = useMemo(
    () =>
      tagmarProfessions.filter((p) => {
        if (subFilter === 'core' && p.isSpecialization) return false;
        if (subFilter === 'spec' && !p.isSpecialization) return false;
        if (
          subFilter !== 'all' &&
          subFilter !== 'core' &&
          subFilter !== 'spec' &&
          p.id !== subFilter &&
          p.baseProfessionId !== subFilter
        ) {
          return false;
        }
        if (!norm) return true;
        return (
          p.name.toLowerCase().includes(norm) ||
          p.role.toLowerCase().includes(norm) ||
          p.organizationType.toLowerCase().includes(norm) ||
          (p.deity ?? '').toLowerCase().includes(norm) ||
          p.description.toLowerCase().includes(norm)
        );
      }),
    [norm, subFilter]
  );

  const filteredSkills = useMemo(
    () =>
      tagmarSkills.filter((s) => {
        if (secondFilter !== 'all' && s.group !== secondFilter) return false;
        if (!norm) return true;
        return (
          s.name.toLowerCase().includes(norm) ||
          s.group.toLowerCase().includes(norm) ||
          s.description.toLowerCase().includes(norm)
        );
      }),
    [norm, secondFilter]
  );

  const filteredTechniques = useMemo(
    () =>
      tagmarCombatTechniques.filter((t) => {
        if (secondFilter !== 'all' && t.category !== secondFilter) return false;
        if (!norm) return true;
        return (
          t.name.toLowerCase().includes(norm) ||
          t.category.toLowerCase().includes(norm) ||
          t.description.toLowerCase().includes(norm)
        );
      }),
    [norm, secondFilter]
  );

  const filteredSpells = useMemo(
    () =>
      tagmarSpells.filter((s) => {
        if (subFilter !== 'all' && !s.professionIds.includes(subFilter)) return false;
        if (secondFilter !== 'all' && s.group !== secondFilter) return false;
        if (!norm) return true;
        return (
          s.name.toLowerCase().includes(norm) ||
          s.group.toLowerCase().includes(norm) ||
          s.description.toLowerCase().includes(norm)
        );
      }),
    [norm, subFilter, secondFilter]
  );

  const filteredWeapons = useMemo(
    () =>
      tagmarEquipment.weapons.filter(
        (w) =>
          !norm ||
          w.name.toLowerCase().includes(norm) ||
          w.category.toLowerCase().includes(norm) ||
          w.damageType.toLowerCase().includes(norm) ||
          w.description.toLowerCase().includes(norm)
      ),
    [norm]
  );

  const filteredArmor = useMemo(
    () =>
      tagmarEquipment.armor.filter(
        (a) =>
          !norm ||
          a.name.toLowerCase().includes(norm) ||
          a.slot.toLowerCase().includes(norm) ||
          a.description.toLowerCase().includes(norm)
      ),
    [norm]
  );

  const filteredGear = useMemo(
    () =>
      tagmarEquipment.gear.filter(
        (g) =>
          !norm ||
          g.name.toLowerCase().includes(norm) ||
          g.category.toLowerCase().includes(norm) ||
          (g.rarity ?? '').toLowerCase().includes(norm) ||
          g.description.toLowerCase().includes(norm)
      ),
    [norm]
  );

  const filteredBestiary = useMemo(
    () =>
      tagmarBestiary.filter((b) => {
        if (subFilter !== 'all' && b.category !== subFilter) return false;
        if (!norm) return true;
        return (
          b.name.toLowerCase().includes(norm) ||
          b.category.toLowerCase().includes(norm) ||
          b.description.toLowerCase().includes(norm)
        );
      }),
    [norm, subFilter]
  );

  const filteredConditions = useMemo(
    () =>
      tagmarConditions.filter(
        (c) =>
          !norm ||
          c.name.toLowerCase().includes(norm) ||
          c.description.toLowerCase().includes(norm)
      ),
    [norm]
  );

  const consultResult = useMemo(
    () => resolveTagmarRoll(consultD20, consultCol),
    [consultD20, consultCol]
  );
  const consultResTarget = useMemo(
    () => getResistanceTarget(consultFa, consultFd),
    [consultFa, consultFd]
  );
  const allRows = useMemo(() => getAllResolutionRows(), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Section Pills + Search + Filters */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TAGMAR_SECTIONS.map((s) => {
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSectionChange(s.id)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: active ? 'var(--emerald-soft)' : 'var(--bg-obsidian)',
                  border: `1px solid ${active ? 'rgba(74, 222, 128, 0.55)' : 'var(--border-subtle)'}`,
                  color: active ? 'var(--emerald-400)' : 'var(--text-muted)',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {section !== 'rules' && (
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 9,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar no Compêndio Tagmar 3.0 + Expansões..."
              className="mesa-input"
              style={{ padding: '6px 10px 6px 30px', fontSize: 12 }}
            />
          </div>
        )}

        {/* Section-specific sub-filters */}
        {section === 'races' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'all', label: `Todas (${tagmarRaces.length})` },
              { id: 'core', label: 'Livro Básico (6)' },
              { id: 'expansion', label: 'Expansões (9)' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubFilter(t.id)}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: subFilter === t.id ? 'var(--bg-elevated)' : 'transparent',
                  border: `1px solid ${subFilter === t.id ? 'rgba(74,222,128,0.5)' : 'var(--border-subtle)'}`,
                  color: subFilter === t.id ? 'var(--emerald-400)' : 'var(--text-muted)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {section === 'professions' && (
          <select
            className="mesa-select"
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 11 }}
          >
            <option value="all">Todas Profissões & Especializações ({tagmarProfessions.length})</option>
            <option value="core">6 Profissões Base (Livro de Regras)</option>
            <option value="spec">36 Especializações, Colégios & Ordens</option>
            {tagmarCoreProfessions.map((p) => (
              <option key={p.id} value={p.id}>
                Trilha de {p.name}
              </option>
            ))}
          </select>
        )}

        {section === 'skills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'all', label: `Habilidades (${tagmarSkills.length})` },
                { id: 'techniques', label: `Técnicas de Combate (${tagmarCombatTechniques.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSubFilter(t.id);
                    setSecondFilter('all');
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: 11,
                    fontWeight: 600,
                    background: subFilter === t.id ? 'var(--bg-elevated)' : 'transparent',
                    border: `1px solid ${subFilter === t.id ? 'rgba(74,222,128,0.5)' : 'var(--border-subtle)'}`,
                    color: subFilter === t.id ? 'var(--emerald-400)' : 'var(--text-muted)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <select
              className="mesa-select"
              value={secondFilter}
              onChange={(e) => setSecondFilter(e.target.value)}
              style={{ padding: '5px 8px', fontSize: 11 }}
            >
              <option value="all">
                {subFilter === 'techniques' ? 'Todas as Categorias' : 'Todos os Grupos'}
              </option>
              {(subFilter === 'techniques'
                ? ['melee', 'ranged', 'defense', 'maneuver']
                : skillGroups
              ).map((g) => (
                <option key={g} value={g}>
                  {g === 'melee'
                    ? 'Corpo a Corpo'
                    : g === 'ranged'
                      ? 'À Distância'
                      : g === 'defense'
                        ? 'Defesa'
                        : g === 'maneuver'
                          ? 'Manobra'
                          : g}
                </option>
              ))}
            </select>
          </div>
        )}

        {section === 'spells' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: 'Todas' },
                { id: 'mago', label: 'Mago' },
                { id: 'sacerdote', label: 'Sacerdote' },
                { id: 'bardo', label: 'Bardo' },
                { id: 'rastreador', label: 'Rastreador' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSubFilter(p.id);
                    setSecondFilter('all');
                  }}
                  style={{
                    flex: 1,
                    minWidth: 54,
                    padding: '4px 5px',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: subFilter === p.id ? 'var(--sapphire-soft)' : 'transparent',
                    border: `1px solid ${subFilter === p.id ? 'var(--sapphire-400)' : 'var(--border-subtle)'}`,
                    color: subFilter === p.id ? 'var(--sapphire-400)' : 'var(--text-muted)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <select
              className="mesa-select"
              value={secondFilter}
              onChange={(e) => setSecondFilter(e.target.value)}
              style={{ padding: '5px 8px', fontSize: 11 }}
            >
              <option value="all">Todos Colégios & Ordens ({filteredSpells.length})</option>
              {spellGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        )}

        {section === 'equipment' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'all', label: `Armas (${tagmarEquipment.weapons.length})` },
              { id: 'armor', label: `Armaduras (${tagmarEquipment.armor.length})` },
              { id: 'gear', label: `Itens & Relíquias (${tagmarEquipment.gear.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubFilter(tab.id)}
                style={{
                  flex: 1,
                  padding: '4px 5px',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: subFilter === tab.id ? 'var(--bg-elevated)' : 'transparent',
                  border: `1px solid ${subFilter === tab.id ? 'var(--border-gold)' : 'var(--border-subtle)'}`,
                  color: subFilter === tab.id ? 'var(--gold-400)' : 'var(--text-muted)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {section === 'bestiary' && (
          <select
            className="mesa-select"
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 11 }}
          >
            <option value="all">Todas as Criaturas ({tagmarBestiary.length})</option>
            {bestiaryCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        )}

        {/* Target Tagmar Character Picker */}
        {(section === 'skills' || section === 'spells' || section === 'equipment') &&
          tagmarChars.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>Destino:</span>
              <select
                value={selectedChar?.id ?? ''}
                onChange={(e) => setTargetCharId(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'var(--bg-obsidian)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '3px 6px',
                  fontSize: 11,
                  color: 'var(--emerald-400)',
                }}
              >
                {tagmarChars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
      </div>

      {/* Scrollable Results List */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '8px 10px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        {/* 1. RACES (15) */}
        {section === 'races' &&
          filteredRaces.map((r) => {
            const open = expandedId === r.id;
            const adj = r.attributeAdjustments;
            return (
              <div
                key={r.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : r.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: compact ? '10px' : '8px 10px',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Users size={13} style={{ color: 'var(--emerald-400)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{r.name}</span>
                  </div>
                  <span className="mesa-badge" style={{ fontSize: 9.5 }}>
                    EF {r.baseEF} · VB {r.baseVB}
                  </span>
                </button>
                {open && (
                  <div
                    style={{
                      padding: '0 10px 10px',
                      fontSize: 11.5,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <p>{r.description}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontFamily: 'var(--font-mono)' }}>
                      {(['intelecto', 'aura', 'carisma', 'forca', 'fisico', 'agilidade'] as const).map((k) => (
                        <span
                          key={k}
                          className={`mesa-badge ${
                            adj[k] > 0 ? 'mesa-badge--emerald' : adj[k] < 0 ? 'mesa-badge--crimson' : ''
                          }`}
                          style={{ fontSize: 10 }}
                        >
                          {ATTR_ABBR[k]} {fmtSigned(adj[k])}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <span className="mesa-badge">{r.source}</span>
                      <span className="mesa-badge">Tam: {r.size}</span>
                      {r.extraAttributePoints > 0 && (
                        <span className="mesa-badge mesa-badge--gold">+{r.extraAttributePoints} pt livre</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      <strong>Profissões:</strong>{' '}
                      {r.allowedProfessions.map((pid) => PROF_LABEL[pid] ?? pid).join(', ')}
                    </div>
                    {r.racialAbilities.map((ab) => (
                      <div
                        key={ab.id}
                        style={{
                          padding: 7,
                          borderRadius: 6,
                          background: 'var(--bg-obsidian)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <strong style={{ color: 'var(--emerald-400)' }}>{ab.name}:</strong>{' '}
                        {ab.description}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        {/* 2. PROFESSIONS & SPECIALIZATIONS (42) */}
        {section === 'professions' &&
          filteredProfessions.map((p) => {
            const open = expandedId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: `1px solid ${p.isSpecialization ? 'var(--border-subtle)' : 'var(--border-gold)'}`,
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : p.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: compact ? '10px' : '8px 10px',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Swords
                      size={13}
                      style={{ color: p.isMystic ? 'var(--sapphire-400)' : 'var(--gold-400)', flexShrink: 0 }}
                    />
                    <span style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <span className="mesa-badge mesa-badge--gold" style={{ fontSize: 9.5 }}>
                      EH {p.baseEH}
                    </span>
                    {p.isMystic && (
                      <span className="mesa-badge mesa-badge--sapphire" style={{ fontSize: 9.5 }}>
                        Místico
                      </span>
                    )}
                  </div>
                </button>
                {open && (
                  <div
                    style={{
                      padding: '0 10px 10px',
                      fontSize: 11.5,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <p>{p.description}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <span className="mesa-badge">{p.organizationType}</span>
                      {p.baseProfessionId && (
                        <span className="mesa-badge mesa-badge--emerald">
                          Base: {PROF_LABEL[p.baseProfessionId] ?? p.baseProfessionId} (Est. {p.minStage}+)
                        </span>
                      )}
                      {p.deity && <span className="mesa-badge mesa-badge--gold">Deus: {p.deity}</span>}
                      <span className="mesa-badge">{p.source}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      <strong>Karma:</strong> {p.karmaRule}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      <strong>Pontos Iniciais:</strong> {p.startingPoints.skills} Hab ·{' '}
                      {p.startingPoints.combatTechniques} Comb · Magia: {p.startingPoints.magicFormula}
                    </div>
                    {p.startingEquipment.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        <strong>Equip. Inicial:</strong> {p.startingEquipment.join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {/* 3. SKILLS (66) & COMBAT TECHNIQUES (37) */}
        {section === 'skills' &&
          subFilter === 'all' &&
          filteredSkills.map((sk) => {
            const open = expandedId === sk.id;
            return (
              <div
                key={sk.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : sk.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <Sparkles size={12} style={{ color: 'var(--emerald-400)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sk.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span className="mesa-badge" style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)' }}>
                      {ATTR_ABBR[sk.attribute] ?? sk.attribute}
                    </span>
                    {sk.restricted && (
                      <span className="mesa-badge mesa-badge--crimson" style={{ fontSize: 9.5 }}>
                        Restrita
                      </span>
                    )}
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      onClick={() => addSkillToSheet(sk)}
                      style={{ minHeight: 24, padding: '2px 7px', fontSize: 10.5 }}
                    >
                      <Plus size={11} /> Ficha
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  <strong style={{ color: 'var(--text-muted)' }}>[{sk.group}]</strong>{' '}
                  {open ? sk.description : sk.description.slice(0, 108) + (sk.description.length > 108 ? '…' : '')}
                </div>
                {open && sk.specializations && sk.specializations.length > 0 && (
                  <div style={{ fontSize: 10.5, color: 'var(--gold-400)' }}>
                    Especializações: {sk.specializations.join(', ')}
                  </div>
                )}
              </div>
            );
          })}

        {section === 'skills' &&
          subFilter === 'techniques' &&
          filteredTechniques.map((ct) => {
            const open = expandedId === ct.id;
            return (
              <div
                key={ct.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : ct.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <Swords size={12} style={{ color: 'var(--gold-400)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ct.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span className="mesa-badge" style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)' }}>
                      {ATTR_ABBR[ct.attribute] ?? ct.attribute}
                    </span>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      onClick={() => addTechniqueToSheet(ct)}
                      style={{ minHeight: 24, padding: '2px 7px', fontSize: 10.5 }}
                    >
                      <Plus size={11} /> Ficha
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {open ? ct.description : ct.description.slice(0, 110) + (ct.description.length > 110 ? '…' : '')}
                </div>
              </div>
            );
          })}

        {/* 4. SPELLS (187) */}
        {section === 'spells' &&
          filteredSpells.slice(0, 100).map((sp) => {
            const open = expandedId === sp.id;
            return (
              <div
                key={sp.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : sp.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <Wand2 size={12} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sp.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span className="mesa-badge mesa-badge--sapphire" style={{ fontSize: 10 }}>
                      {sp.karmaCost} Karma
                    </span>
                    {sp.resistance && sp.resistance !== 'none' && (
                      <span className="mesa-badge mesa-badge--crimson" style={{ fontSize: 9.5 }}>
                        {sp.resistance.toUpperCase()}
                      </span>
                    )}
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      onClick={() => addSpellToSheet(sp)}
                      style={{ minHeight: 24, padding: '2px 7px', fontSize: 10.5 }}
                    >
                      <Plus size={11} /> Ficha
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--sapphire-400)', fontWeight: 600 }}>
                  {sp.group} · {sp.range} · {sp.duration}
                </div>
                {sp.automation?.damageByColor && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: 'var(--crimson-400)', fontWeight: 700 }}>Dano:</span>
                    <TagmarDamagePills damage={sp.automation.damageByColor} compact />
                  </div>
                )}
                {sp.automation?.healByColor && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: 'var(--emerald-400)', fontWeight: 700 }}>Cura:</span>
                    <TagmarDamagePills damage={sp.automation.healByColor} compact />
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {open ? sp.description : sp.description.slice(0, 108) + (sp.description.length > 108 ? '…' : '')}
                </div>
                {open && sp.effectLevels.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    {sp.effectLevels.map((el) => (
                      <div
                        key={el.level}
                        style={{
                          fontSize: 10.5,
                          padding: '3px 6px',
                          borderRadius: 4,
                          background: 'var(--bg-obsidian)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <strong style={{ color: 'var(--gold-400)' }}>Nív. {el.level}:</strong> {el.summary}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        {/* 5. EQUIPMENT (52 Weapons, 28 Armor, 68 Gear & Relics) */}
        {section === 'equipment' &&
          subFilter === 'all' &&
          filteredWeapons.map((w) => (
            <div
              key={w.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <Swords size={12} style={{ color: 'var(--crimson-400)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{w.name}</span>
                </div>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold mesa-btn--sm"
                  onClick={() => addEquipmentToSheet(w, 'weapon')}
                  style={{ minHeight: 24, padding: '2px 7px', fontSize: 10.5 }}
                >
                  <Plus size={11} /> Ficha
                </button>
              </div>
              <TagmarDamagePills damage={w.damage} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span className="mesa-badge">{w.damageType}</span>
                <span className="mesa-badge mesa-badge--gold">FOR {w.minFor}</span>
                <span className="mesa-badge">{w.hands}M · {w.range}</span>
                <span className="mesa-badge">{w.priceDisplay ?? `${w.price} MP`}</span>
              </div>
            </div>
          ))}

        {section === 'equipment' &&
          subFilter === 'armor' &&
          filteredArmor.map((a) => (
            <div
              key={a.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <Shield size={12} style={{ color: 'var(--sapphire-400)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{a.name}</span>
                </div>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold mesa-btn--sm"
                  onClick={() => addEquipmentToSheet(a, 'armor')}
                  style={{ minHeight: 24, padding: '2px 7px', fontSize: 10.5 }}
                >
                  <Plus size={11} /> Ficha
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span className="mesa-badge mesa-badge--gold">Classe {a.armorClass}</span>
                <span className="mesa-badge mesa-badge--emerald">Abs {a.absorcao}</span>
                {a.defActiveBonus !== 0 && <span className="mesa-badge">DA {fmtSigned(a.defActiveBonus)}</span>}
                {a.defPassiveBonus !== 0 && <span className="mesa-badge">DP {fmtSigned(a.defPassiveBonus)}</span>}
                {a.agilityPenalty !== 0 && (
                  <span className="mesa-badge mesa-badge--crimson">AGI -{Math.abs(a.agilityPenalty)}</span>
                )}
                <span className="mesa-badge">{a.priceDisplay ?? `${a.price} MP`}</span>
              </div>
            </div>
          ))}

        {section === 'equipment' &&
          subFilter === 'gear' &&
          filteredGear.map((g) => (
            <div
              key={g.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 12.5 }}>{g.name}</span>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold mesa-btn--sm"
                  onClick={() => addEquipmentToSheet(g, 'gear')}
                  style={{ minHeight: 24, padding: '2px 7px', fontSize: 10.5 }}
                >
                  <Plus size={11} /> Ficha
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span className="mesa-badge">{g.category}</span>
                {g.rarity && g.rarity !== 'Comum' && (
                  <span className="mesa-badge mesa-badge--amethyst">{g.rarity}</span>
                )}
                {g.effect?.healEf ? (
                  <span className="mesa-badge mesa-badge--crimson">+{g.effect.healEf} EF</span>
                ) : null}
                {g.effect?.healEh ? (
                  <span className="mesa-badge mesa-badge--emerald">+{g.effect.healEh} EH</span>
                ) : null}
                {g.effect?.restoreKarma ? (
                  <span className="mesa-badge mesa-badge--sapphire">+{g.effect.restoreKarma} Karma</span>
                ) : null}
                <span className="mesa-badge">{g.priceDisplay ?? `${g.price} MP`}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{g.description}</div>
            </div>
          ))}

        {/* 6. BESTIARY — LIVRO DAS CRIATURAS (48) */}
        {section === 'bestiary' &&
          filteredBestiary.map((mob) => (
            <div
              key={mob.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  src={mob.portrait || './assets/monsters/goblin-raider.svg'}
                  alt={mob.name}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    objectFit: 'cover',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                    {mob.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {mob.category} · Estágio {mob.stage} · EH {mob.ehMax} · EF {mob.efMax}
                    {mob.karmaMax > 0 ? ` · Karma ${mob.karmaMax}` : ''}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span className="mesa-badge mesa-badge--gold">DA {mob.defesaAtiva} / DP {mob.defesaPassiva}</span>
                <span className="mesa-badge mesa-badge--emerald">Abs {mob.absorcao}</span>
                <span className="mesa-badge">RF {mob.rf} / RM {mob.rm}</span>
                <span className="mesa-badge">VB {mob.vb}m</span>
              </div>

              {mob.attacks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {mob.attacks.slice(0, 2).map((atk, idx) => (
                    <div key={idx} style={{ fontSize: 11, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {atk.name} (Col {atk.column}):
                      </strong>
                      <TagmarDamagePills damage={atk.damage} compact />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{mob.description}</div>

              {isGm && (
                <button
                  type="button"
                  className="mesa-btn mesa-btn--danger mesa-btn--sm"
                  disabled={spawningId === mob.id}
                  onClick={() => void handleSpawnCreature(mob)}
                  style={{ width: '100%' }}
                >
                  <MapPin size={13} />
                  {spawningId === mob.id ? 'Invocando...' : 'Invocar no Mapa'}
                </button>
              )}
            </div>
          ))}

        {/* 7. CONDITIONS (24) */}
        {section === 'conditions' &&
          filteredConditions.map((cond) => (
            <div
              key={cond.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderLeft: `3px solid ${cond.color ?? 'var(--emerald-500)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                  {cond.emoji ? `${cond.emoji} ` : ''}
                  {cond.name}
                </span>
                <span className="mesa-badge">{cond.category}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {cond.modifiers.columnShift !== 0 && (
                  <span className="mesa-badge mesa-badge--crimson">
                    Col {fmtSigned(cond.modifiers.columnShift)}
                  </span>
                )}
                {cond.modifiers.daDelta !== 0 && (
                  <span className="mesa-badge">DA {fmtSigned(cond.modifiers.daDelta)}</span>
                )}
                {cond.modifiers.usesPassiveDefense && (
                  <span className="mesa-badge mesa-badge--gold">Usa DP</span>
                )}
                {cond.modifiers.skipTurn && (
                  <span className="mesa-badge mesa-badge--crimson">Perde Turno</span>
                )}
                {cond.saveRule && (
                  <span className="mesa-badge mesa-badge--sapphire">
                    {cond.saveRule.resistanceType.toUpperCase()} FA {cond.saveRule.attackForce}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {cond.description}
              </div>
            </div>
          ))}

        {/* 8. INTERACTIVE TABELA DE RESOLUÇÃO, RESISTÊNCIAS & RULES */}
        {section === 'rules' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Interactive Resolution Table Consultant */}
            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--parchment-bg)',
                border: '1px solid var(--border-gold)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--gold-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <BookOpen size={14} /> Tabela de Resolução Interativa
                </span>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--emerald mesa-btn--sm"
                  style={{ minHeight: 24, padding: '2px 8px', fontSize: 10.5 }}
                  onClick={() =>
                    rollDice({
                      formula: '1d20',
                      label: `Tabela de Resolução (Col. ${consultCol})`,
                      characterId: activeCharacter?.id,
                      tagmarColumn: consultCol,
                      systemMeta: { systemId: 'tagmar-3', kind: 'tagmar_table', tagmarColumn: consultCol },
                    })
                  }
                >
                  <Dices size={11} /> Rolar Col. {consultCol}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>COLUNA (-7 a 30)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultCol((c) => Math.max(-7, c - 1))}
                    >
                      <Minus size={11} />
                    </button>
                    <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--gold-400)' }}>
                      {consultCol}
                    </span>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultCol((c) => Math.min(30, c + 1))}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>RESULTADO 1d20</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultD20((d) => Math.max(1, d - 1))}
                    >
                      <Minus size={11} />
                    </button>
                    <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {consultD20}
                    </span>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultD20((d) => Math.min(20, d + 1))}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Live Color Result Preview */}
              <div
                style={{
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-xs)',
                  background: `${consultResult.hex}2e`,
                  border: `1px solid ${consultResult.hex}`,
                  color: '#fff',
                  textAlign: 'center',
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {consultResult.label}
                {consultResult.directToEf ? ' · Dano direto na EF!' : ''}
                {consultResult.overflowSteps > 0
                  ? ` (Overflow Col ${consultResult.effectiveColumn} +${consultResult.overflowTiers} faixas)`
                  : ''}
              </div>

              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={() => setShowFullTable((v) => !v)}
                style={{ fontSize: 11 }}
              >
                {showFullTable ? 'Ocultar Tabela Completa (-7..20)' : 'Ver Tabela Completa (-7..20)'}
              </button>

              {showFullTable && (
                <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      textAlign: 'center',
                    }}
                  >
                    <thead>
                      <tr style={{ background: 'var(--bg-obsidian)', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '4px 3px', color: 'var(--gold-400)' }}>Col</th>
                        <th style={{ padding: '4px 2px', color: '#fca5a5' }}>EC</th>
                        <th style={{ padding: '4px 2px', color: '#94a3b8' }}>Fal</th>
                        <th style={{ padding: '4px 2px', color: '#4ade80' }}>25%</th>
                        <th style={{ padding: '4px 2px', color: '#fde047' }}>50%</th>
                        <th style={{ padding: '4px 2px', color: '#fb923c' }}>75%</th>
                        <th style={{ padding: '4px 2px', color: '#f87171' }}>100%</th>
                        <th style={{ padding: '4px 2px', color: '#38bdf8' }}>Crít</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRows.map((row) => {
                        const isSel = row.column === consultResult.effectiveColumn;
                        return (
                          <tr
                            key={row.column}
                            onClick={() => setConsultCol(row.column)}
                            style={{
                              cursor: 'pointer',
                              background: isSel ? 'rgba(212,168,79,0.22)' : 'transparent',
                              borderBottom: '1px solid var(--border-subtle)',
                            }}
                          >
                            <td style={{ padding: '3px', fontWeight: 800, color: 'var(--gold-400)' }}>{row.column}</td>
                            <td style={{ padding: '3px', color: '#fca5a5' }}>{formatRange(row.erroCritico)}</td>
                            <td style={{ padding: '3px', color: '#94a3b8' }}>{formatRange(row.falha)}</td>
                            <td style={{ padding: '3px', color: '#4ade80' }}>{formatRange(row.verde)}</td>
                            <td style={{ padding: '3px', color: '#fde047' }}>{formatRange(row.amarelo)}</td>
                            <td style={{ padding: '3px', color: '#fb923c' }}>{formatRange(row.laranja)}</td>
                            <td style={{ padding: '3px', color: '#f87171' }}>{formatRange(row.vermelho)}</td>
                            <td style={{ padding: '3px', color: '#38bdf8', fontWeight: 700 }}>{formatRange(row.azul)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Interactive Resistance Table Consultant (RF / RM) */}
            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--sapphire-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Shield size={13} /> Tabela de Resistências (RF & RM)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>FORÇA ATAQUE (FA)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultFa((v) => Math.max(1, v - 1))}
                    >
                      <Minus size={11} />
                    </button>
                    <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                      {consultFa}
                    </span>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultFa((v) => Math.min(25, v + 1))}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>FORÇA DEFESA (FD)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultFd((v) => Math.max(-2, v - 1))}
                    >
                      <Minus size={11} />
                    </button>
                    <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                      {consultFd}
                    </span>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      style={{ minHeight: 26, padding: '0 7px' }}
                      onClick={() => setConsultFd((v) => Math.min(25, v + 1))}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  padding: '6px 9px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--bg-obsidian)',
                  fontSize: 12,
                }}
              >
                <span>
                  Alvo para resistir: <strong style={{ color: 'var(--emerald-400)', fontFamily: 'var(--font-mono)' }}>1d20 ≥ {consultResTarget}</strong>
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['rf', 'rm'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      style={{ minHeight: 24, padding: '2px 7px', fontSize: 10.5 }}
                      onClick={() =>
                        rollDice({
                          formula: '1d20',
                          label: `Resistência ${k.toUpperCase()} (FD ${consultFd} vs FA ${consultFa})`,
                          characterId: activeCharacter?.id,
                          difficulty: consultResTarget,
                          tagmarResistance: { kind: k, fa: consultFa, fd: consultFd },
                          systemMeta: {
                            systemId: 'tagmar-3',
                            kind: 'resistance',
                            resistanceKind: k,
                            fa: consultFa,
                            fd: consultFd,
                            target: consultResTarget,
                          },
                        })
                      }
                    >
                      {k.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Formulas Summary */}
            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                fontSize: 11.5,
                color: 'var(--text-secondary)',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--gold-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Flame size={13} /> Fórmulas Tagmar {tagmarRules.edition}
              </div>
              <div><strong>EF (Energia Física):</strong> EF Base da Raça + FOR + FIS (≤0 Inconsciente, ≤-15 Morto)</div>
              <div><strong>EH (Energia Heróica):</strong> EH Base da Profissão + FIS (+ tabela 1d10 por Estágio)</div>
              <div><strong>Dano Normal:</strong> EH absorve primeiro → Absorção da armadura → EF</div>
              <div><strong>Golpe Crítico (Azul):</strong> Ignora EH e Absorção normal — dano direto na EF!</div>
              <div><strong>Karma:</strong> (AUR + 1) × (Estágio + 1) para místicos com AUR ≥ 1</div>
              <div><strong>RF / RM:</strong> Estágio + FIS (RF) · Estágio + AUR (RM)</div>
              <div><strong>DA / DP:</strong> DA = Armadura + AGI + Escudo · DP = Armadura + Escudo</div>
              <div><strong>Iniciativa:</strong> 1d10 + AGI · <strong>VB:</strong> VB da Raça + FIS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {(['verde', 'amarelo', 'laranja', 'vermelho', 'azul'] as const).map((c) => (
                  <span
                    key={c}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: `${TAGMAR_COLOR_META[c].hex}26`,
                      border: `1px solid ${TAGMAR_COLOR_META[c].hex}`,
                      color: '#fff',
                    }}
                  >
                    {TAGMAR_COLOR_META[c].shortLabel}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Respectful Projeto Tagmar CC BY-NC-SA 3.0 BR License Footer */}
      <div
        style={{
          padding: '6px 10px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'rgba(7, 9, 13, 0.72)',
          fontSize: 10,
          color: 'var(--text-muted)',
          textAlign: 'center',
          lineHeight: 1.35,
          flexShrink: 0,
        }}
      >
        Conteúdo Tagmar 3.0 ©{' '}
        <a
          href="https://www.tagmar.com.br"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--emerald-400)' }}
        >
          Projeto Tagmar (tagmar.com.br)
        </a>{' '}
        — CC BY-NC-SA 3.0 BR
      </div>
    </div>
  );
}

export default TagmarCompendiumView;
