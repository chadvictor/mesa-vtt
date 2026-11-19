import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Flame,
  MapPin,
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
  mbAbilities,
  mbBestiary,
  mbClasses,
  mbConditions,
  mbEquipment,
  mbRaces,
  mbRules,
  mbSpells,
  type MBAbility,
  type MBArmor,
  type MBCreature,
  type MBGear,
  type MBSpell,
  type MBWeapon,
} from '@systems/mighty-blade-3e/compendium';
import { mightyBlade3eEngine } from '@systems/mighty-blade-3e/engine';
import type {
  CharacterAbilityEntry,
  CharacterEquipmentEntry,
  CharacterSpellEntry,
  MightyBladeSystemData,
} from '@systems/types';
import { useCampaignStore } from '@/lib/store';

type CompendiumSection =
  | 'races'
  | 'classes'
  | 'abilities'
  | 'spells'
  | 'equipment'
  | 'bestiary'
  | 'conditions'
  | 'rules';

const SECTIONS: Array<{ id: CompendiumSection; label: string }> = [
  { id: 'abilities', label: 'Habilidades' },
  { id: 'spells', label: 'Magias' },
  { id: 'equipment', label: 'Equip.' },
  { id: 'bestiary', label: 'Bestiário' },
  { id: 'races', label: 'Raças' },
  { id: 'classes', label: 'Classes' },
  { id: 'conditions', label: 'Condições' },
  { id: 'rules', label: 'Regras' },
];

export interface CompendiumPanelProps {
  compact?: boolean;
}

export function CompendiumPanel({ compact = false }: CompendiumPanelProps) {
  const {
    characters,
    activeCharacter,
    activeScene,
    isGm,
    patchCharacter,
    createCharacter,
    createToken,
    pushToast,
  } = useCampaignStore();

  const [section, setSection] = useState<CompendiumSection>('abilities');
  const [query, setQuery] = useState('');
  const [subFilter, setSubFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [targetCharId, setTargetCharId] = useState<string>('');
  const [spawningId, setSpawningId] = useState<string | null>(null);

  const selectedChar = useMemo(() => {
    if (targetCharId) return characters.find((c) => c.id === targetCharId) ?? activeCharacter;
    return activeCharacter ?? characters.find((c) => c.kind === 'pc') ?? characters[0] ?? null;
  }, [characters, targetCharId, activeCharacter]);

  const norm = query.trim().toLowerCase();

  const spellPaths = useMemo(() => {
    const set = new Set(mbSpells.map((s) => s.path).filter(Boolean));
    return Array.from(set).sort();
  }, []);

  const abilityClasses = useMemo(() => {
    const set = new Set(mbAbilities.map((a) => a.classId).filter(Boolean));
    return Array.from(set).sort();
  }, []);

  const handleSectionChange = (next: CompendiumSection) => {
    setSection(next);
    setSubFilter('all');
    setExpandedId(null);
  };

  const addAbilityToSheet = (ab: MBAbility) => {
    if (!selectedChar) {
      pushToast('Selecione ou crie uma ficha primeiro para adicionar habilidades.', 'warning');
      return;
    }
    const sys = (selectedChar.systemData ?? {}) as Partial<MightyBladeSystemData>;
    const existing = Array.isArray(sys.abilities) ? sys.abilities : [];
    if (existing.some((e) => e.abilityId === ab.id || e.name === ab.name)) {
      pushToast(`${selectedChar.name} já possui "${ab.name}".`, 'info');
      return;
    }
    const entry: CharacterAbilityEntry = {
      id: `${ab.id}-${Date.now().toString(36)}`,
      abilityId: ab.id,
      name: ab.name,
      category: ab.category,
      manaCost: ab.manaCost ?? 0,
      difficulty: ab.difficulty ?? undefined,
      range: ab.range,
      duration: ab.duration,
      description: ab.description,
      automation: ab.automation,
    };
    const nextSys = { ...sys, abilities: [...existing, entry] };
    const draft = { ...selectedChar, systemData: nextSys as Record<string, unknown> };
    const { computed } = mightyBlade3eEngine.computeDerivedStats(draft);
    patchCharacter(selectedChar.id, { systemData: draft.systemData, computed });
    pushToast(`"${ab.name}" adicionada à ficha de ${selectedChar.name}!`, 'success');
  };

  const addSpellToSheet = (sp: MBSpell) => {
    if (!selectedChar) {
      pushToast('Selecione ou crie uma ficha primeiro para adicionar magias.', 'warning');
      return;
    }
    const sys = (selectedChar.systemData ?? {}) as Partial<MightyBladeSystemData>;
    const existing = Array.isArray(sys.spells) ? sys.spells : [];
    if (existing.some((e) => e.spellId === sp.id || e.name === sp.name)) {
      pushToast(`${selectedChar.name} já conhece "${sp.name}".`, 'info');
      return;
    }
    const entry: CharacterSpellEntry = {
      id: `${sp.id}-${Date.now().toString(36)}`,
      spellId: sp.id,
      name: sp.name,
      path: sp.path,
      type: sp.type,
      manaCost: sp.manaCost,
      difficulty: sp.difficulty,
      range: sp.range,
      duration: sp.duration,
      description: sp.description,
      automation: sp.automation,
    };
    const nextSys = { ...sys, spells: [...existing, entry] };
    patchCharacter(selectedChar.id, { systemData: nextSys as Record<string, unknown> });
    pushToast(`Magia "${sp.name}" adicionada ao grimório de ${selectedChar.name}!`, 'success');
  };

  const addEquipmentToSheet = (
    item: MBWeapon | MBArmor | MBGear,
    kind: 'weapon' | 'armor' | 'gear'
  ) => {
    if (!selectedChar) {
      pushToast('Selecione ou crie uma ficha primeiro para adicionar equipamento.', 'warning');
      return;
    }
    const sys = (selectedChar.systemData ?? {}) as Partial<MightyBladeSystemData>;
    const existing = Array.isArray(sys.inventory) ? sys.inventory : [];

    let entry: CharacterEquipmentEntry;
    if (kind === 'weapon') {
      const w = item as MBWeapon;
      entry = {
        id: `eq-${w.id}-${Date.now().toString(36)}`,
        itemId: w.id,
        name: w.name,
        category: 'weapon',
        equipped: true,
        quantity: 1,
        fn: w.fn,
        damageBonus: w.damageBonus,
        damageAttribute: w.damageAttribute ?? 'forca',
        damageType: w.damageType,
        weight: w.weight ?? 1.5,
        range: w.range ?? w.distance ?? 'Corpo a Corpo',
        properties: w.properties,
        description: w.description,
      };
    } else if (kind === 'armor') {
      const a = item as MBArmor;
      entry = {
        id: `eq-${a.id}-${Date.now().toString(36)}`,
        itemId: a.id,
        name: a.name,
        category: a.slot === 'shield' ? 'shield' : 'armor',
        equipped: false,
        quantity: 1,
        fn: a.fn,
        defenseBonus: a.defenseBonus,
        agilityPenalty: Math.abs(a.agilityPenalty ?? a.dodgePenalty ?? 0),
        rd: a.rd ?? 0,
        weight: a.weight ?? 5,
        properties: a.properties,
        description: a.description,
      };
    } else {
      const g = item as MBGear;
      entry = {
        id: `eq-${g.id}-${Date.now().toString(36)}`,
        itemId: g.id,
        name: g.name,
        category: g.consumable || g.category === 'consumable' ? 'consumable' : 'gear',
        equipped: false,
        quantity: 1,
        weight: g.weight ?? 0.5,
        effect: g.effect,
        description: g.description,
      };
    }

    const nextSys = { ...sys, inventory: [...existing, entry] };
    const draft = { ...selectedChar, systemData: nextSys as Record<string, unknown> };
    const { computed } = mightyBlade3eEngine.computeDerivedStats(draft);
    patchCharacter(selectedChar.id, { systemData: draft.systemData, computed });
    pushToast(`"${entry.name}" adicionado ao inventário de ${selectedChar.name}!`, 'success');
  };

  const spawnCreatureOnMap = async (creature: MBCreature) => {
    setSpawningId(creature.id);
    try {
      const draft = mightyBlade3eEngine.createCharacterFromBestiary?.(creature.id);
      if (!draft) {
        pushToast('Não foi possível instanciar a criatura.', 'error');
        return;
      }
      const created = await createCharacter(draft);
      if (created && activeScene) {
        const cx = Math.max(1, Math.floor((activeScene.grid.cols || 24) / 2) + Math.floor(Math.random() * 3 - 1));
        const cy = Math.max(1, Math.floor((activeScene.grid.rows || 18) / 2) + Math.floor(Math.random() * 3 - 1));
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
          hp: created.resources?.pv?.current ?? creature.pvMax,
          hpMax: created.resources?.pv?.max ?? creature.pvMax,
          mp: created.resources?.pm?.current ?? creature.pmMax,
          mpMax: created.resources?.pm?.max ?? creature.pmMax,
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

  // Filtered datasets
  const filteredRaces = useMemo(
    () =>
      mbRaces.filter(
        (r) =>
          !norm ||
          r.name.toLowerCase().includes(norm) ||
          r.description.toLowerCase().includes(norm) ||
          r.racialAbility.name.toLowerCase().includes(norm)
      ),
    [norm]
  );

  const filteredClasses = useMemo(
    () =>
      mbClasses.filter(
        (c) =>
          (!norm ||
            c.name.toLowerCase().includes(norm) ||
            c.description.toLowerCase().includes(norm) ||
            c.automaticAbility.name.toLowerCase().includes(norm)) &&
          (subFilter === 'all' || c.category === subFilter)
      ),
    [norm, subFilter]
  );

  const filteredAbilities = useMemo(
    () =>
      mbAbilities.filter(
        (a) =>
          (!norm ||
            a.name.toLowerCase().includes(norm) ||
            a.description.toLowerCase().includes(norm) ||
            a.classId.toLowerCase().includes(norm)) &&
          (subFilter === 'all' || a.classId === subFilter)
      ),
    [norm, subFilter]
  );

  const filteredSpells = useMemo(
    () =>
      mbSpells.filter(
        (s) =>
          (!norm ||
            s.name.toLowerCase().includes(norm) ||
            s.description.toLowerCase().includes(norm) ||
            s.path.toLowerCase().includes(norm)) &&
          (subFilter === 'all' || s.path === subFilter)
      ),
    [norm, subFilter]
  );

  const filteredWeapons = useMemo(
    () =>
      mbEquipment.weapons.filter(
        (w) =>
          !norm ||
          w.name.toLowerCase().includes(norm) ||
          (w.description ?? '').toLowerCase().includes(norm) ||
          w.damageType.toLowerCase().includes(norm)
      ),
    [norm]
  );

  const filteredArmor = useMemo(
    () =>
      mbEquipment.armor.filter(
        (a) =>
          !norm ||
          a.name.toLowerCase().includes(norm) ||
          (a.description ?? '').toLowerCase().includes(norm)
      ),
    [norm]
  );

  const filteredGear = useMemo(
    () =>
      mbEquipment.gear.filter(
        (g) =>
          !norm ||
          g.name.toLowerCase().includes(norm) ||
          (g.description ?? '').toLowerCase().includes(norm)
      ),
    [norm]
  );

  const filteredBestiary = useMemo(
    () =>
      mbBestiary.filter(
        (b) =>
          (!norm ||
            b.name.toLowerCase().includes(norm) ||
            (b.category ?? '').toLowerCase().includes(norm) ||
            (b.description ?? '').toLowerCase().includes(norm)) &&
          (subFilter === 'all' || String(b.challengeLevel ?? 1) === subFilter)
      ),
    [norm, subFilter]
  );

  const filteredConditions = useMemo(
    () =>
      mbConditions.filter(
        (c) =>
          !norm ||
          c.name.toLowerCase().includes(norm) ||
          c.description.toLowerCase().includes(norm)
      ),
    [norm]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Top Category Pills + Search + Target PC Selector */}
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
          {SECTIONS.map((s) => {
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSectionChange(s.id)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 11,
                  fontWeight: 600,
                  background: active ? 'var(--gold-soft)' : 'var(--bg-obsidian)',
                  border: `1px solid ${active ? 'var(--border-gold)' : 'var(--border-subtle)'}`,
                  color: active ? 'var(--gold-400)' : 'var(--text-muted)',
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
              placeholder="Filtrar Compêndio Mighty Blade 3e..."
              className="mesa-input"
              style={{ padding: '6px 10px 6px 30px', fontSize: 12 }}
            />
          </div>
        )}

        {/* Sub-filters */}
        {section === 'spells' && (
          <select
            className="mesa-select"
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 11 }}
          >
            <option value="all">Todos os Caminhos ({mbSpells.length})</option>
            {spellPaths.map((p) => (
              <option key={p} value={p}>
                Caminho: {p}
              </option>
            ))}
          </select>
        )}

        {section === 'abilities' && (
          <select
            className="mesa-select"
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 11 }}
          >
            <option value="all">Todas as Classes ({mbAbilities.length})</option>
            {abilityClasses.map((cid) => (
              <option key={cid} value={cid}>
                {mbClasses.find((c) => c.id === cid)?.name ?? cid}
              </option>
            ))}
          </select>
        )}

        {section === 'equipment' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'all', label: 'Armas' },
              { id: 'armor', label: 'Armaduras' },
              { id: 'gear', label: 'Poções & Itens' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubFilter(tab.id)}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 11,
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

        {/* Target PC selector for 1-click "Adicionar à Ficha" */}
        {(section === 'abilities' || section === 'spells' || section === 'equipment') &&
          characters.length > 0 && (
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
                  color: 'var(--gold-400)',
                }}
              >
                {characters.map((c) => (
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
        {/* RACES */}
        {section === 'races' &&
          filteredRaces.map((r) => {
            const open = expandedId === r.id;
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Users size={14} style={{ color: 'var(--gold-400)' }} />
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                    F{r.attributes.forca} A{r.attributes.agilidade} I{r.attributes.inteligencia} V{r.attributes.vontade}
                  </span>
                </button>
                {open && (
                  <div style={{ padding: '0 10px 10px', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p>{r.description}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <span className="mesa-badge">Tamanho: {r.size}</span>
                      {r.extraPoints > 0 && <span className="mesa-badge mesa-badge--gold">+{r.extraPoints} Ponto Livre</span>}
                      {r.pvBonus !== 0 && <span className="mesa-badge mesa-badge--emerald">{r.pvBonus > 0 ? `+${r.pvBonus}` : r.pvBonus} PV</span>}
                      {r.pmBonus !== 0 && <span className="mesa-badge mesa-badge--sapphire">{r.pmBonus > 0 ? `+${r.pmBonus}` : r.pmBonus} PM</span>}
                      {r.baseDefenseOverride && <span className="mesa-badge mesa-badge--gold">Def Base {r.baseDefenseOverride}</span>}
                    </div>
                    <div style={{ padding: 7, borderRadius: 6, background: 'var(--bg-obsidian)', border: '1px solid var(--border-subtle)' }}>
                      <strong style={{ color: 'var(--gold-400)' }}>{r.racialAbility.name}:</strong>{' '}
                      {r.racialAbility.description}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

        {/* CLASSES */}
        {section === 'classes' &&
          filteredClasses.map((c) => {
            const open = expandedId === c.id;
            const bonusText = Object.entries(c.attributeBonuses)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `+${v} ${k.slice(0, 3).toUpperCase()}`)
              .join(' ');
            return (
              <div
                key={c.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : c.id)}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Swords size={14} style={{ color: 'var(--gold-400)' }} />
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
                  </div>
                  <span className="mesa-badge mesa-badge--gold">{bonusText}</span>
                </button>
                {open && (
                  <div style={{ padding: '0 10px 10px', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p>{c.description}</p>
                    <div style={{ padding: 7, borderRadius: 6, background: 'var(--bg-obsidian)', border: '1px solid var(--border-subtle)' }}>
                      <strong style={{ color: 'var(--gold-400)' }}>{c.automaticAbility.name}:</strong>{' '}
                      {c.automaticAbility.description}
                    </div>
                    {c.allowedPaths.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--sapphire-400)' }}>
                        Caminhos de Magia: {c.allowedPaths.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {/* ABILITIES */}
        {section === 'abilities' &&
          filteredAbilities.slice(0, 80).map((ab) => {
            const open = expandedId === ab.id;
            return (
              <div
                key={ab.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : ab.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <Sparkles size={13} style={{ color: 'var(--gold-400)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ab.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {ab.manaCost ? (
                      <span className="mesa-badge mesa-badge--sapphire">{ab.manaCost} PM</span>
                    ) : null}
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      onClick={() => addAbilityToSheet(ab)}
                      title={`Adicionar à ficha de ${selectedChar?.name ?? 'personagem'}`}
                      style={{ minHeight: 26, padding: '2px 7px', fontSize: 11 }}
                    >
                      <Plus size={12} />
                      Ficha
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {open ? ab.description : ab.description.slice(0, 115) + (ab.description.length > 115 ? '…' : '')}
                </div>
                {open && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, fontSize: 10 }}>
                    <span className="mesa-badge">Classe: {ab.classId}</span>
                    {ab.difficulty && <span className="mesa-badge mesa-badge--gold">Dif {ab.difficulty}</span>}
                    {ab.range && <span className="mesa-badge">{ab.range}</span>}
                    {ab.requirement && <span className="mesa-badge">Req: {ab.requirement}</span>}
                  </div>
                )}
              </div>
            );
          })}

        {/* SPELLS */}
        {section === 'spells' &&
          filteredSpells.slice(0, 80).map((sp) => {
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
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : sp.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', flex: 1, minWidth: 0 }}
                  >
                    <Wand2 size={13} style={{ color: 'var(--sapphire-400)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sp.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span className="mesa-badge mesa-badge--sapphire">{sp.manaCost} PM</span>
                    <span className="mesa-badge mesa-badge--gold">Dif {sp.difficulty}</span>
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      onClick={() => addSpellToSheet(sp)}
                      style={{ minHeight: 26, padding: '2px 7px', fontSize: 11 }}
                    >
                      <Plus size={12} />
                      Ficha
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  <strong style={{ color: 'var(--sapphire-400)' }}>[{sp.path}]</strong>{' '}
                  {open ? sp.description : sp.description.slice(0, 110) + (sp.description.length > 110 ? '…' : '')}
                </div>
              </div>
            );
          })}

        {/* EQUIPMENT: Weapons / Armor / Gear */}
        {section === 'equipment' && subFilter === 'all' &&
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <Swords size={13} style={{ color: 'var(--crimson-400)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{w.name}</span>
                </div>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold mesa-btn--sm"
                  onClick={() => addEquipmentToSheet(w, 'weapon')}
                  style={{ minHeight: 26, padding: '2px 7px', fontSize: 11 }}
                >
                  <Plus size={12} />
                  Ficha
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span className="mesa-badge mesa-badge--crimson">
                  Dano +{w.damageBonus} ({w.damageType})
                </span>
                <span className="mesa-badge mesa-badge--gold">FN {w.fn}</span>
                {w.range && <span className="mesa-badge">{w.range}</span>}
                {w.price !== undefined && <span className="mesa-badge">{w.price} TO</span>}
              </div>
            </div>
          ))}

        {section === 'equipment' && subFilter === 'armor' &&
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <Shield size={13} style={{ color: 'var(--sapphire-400)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{a.name}</span>
                </div>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold mesa-btn--sm"
                  onClick={() => addEquipmentToSheet(a, 'armor')}
                  style={{ minHeight: 26, padding: '2px 7px', fontSize: 11 }}
                >
                  <Plus size={12} />
                  Ficha
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span className="mesa-badge mesa-badge--emerald">+{a.defenseBonus} Bloq</span>
                <span className="mesa-badge mesa-badge--gold">FN {a.fn}</span>
                {a.weight !== undefined && <span className="mesa-badge">{a.weight} kg</span>}
                {a.price !== undefined && <span className="mesa-badge">{a.price} TO</span>}
              </div>
            </div>
          ))}

        {section === 'equipment' && subFilter === 'gear' &&
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
                  style={{ minHeight: 26, padding: '2px 7px', fontSize: 11 }}
                >
                  <Plus size={12} />
                  Ficha
                </button>
              </div>
              {g.description && (
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{g.description}</div>
              )}
            </div>
          ))}

        {/* BESTIARY */}
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
                    {mob.category ?? 'Criatura'} · Nível {mob.challengeLevel ?? 1} · {mob.pvMax} PV
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span className="mesa-badge">Bloq {mob.bloqueio}</span>
                <span className="mesa-badge">Esq {mob.esquiva}</span>
                <span className="mesa-badge">Det {mob.determinacao}</span>
                <span className="mesa-badge mesa-badge--gold">XP {mob.xpReward ?? 1}</span>
              </div>

              {mob.description && (
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {mob.description}
                </div>
              )}

              {isGm && (
                <button
                  type="button"
                  className="mesa-btn mesa-btn--danger mesa-btn--sm"
                  disabled={spawningId === mob.id}
                  onClick={() => void spawnCreatureOnMap(mob)}
                  style={{ width: '100%' }}
                >
                  <MapPin size={13} />
                  {spawningId === mob.id ? 'Invocando...' : 'Invocar no Mapa'}
                </button>
              )}
            </div>
          ))}

        {/* CONDITIONS */}
        {section === 'conditions' &&
          filteredConditions.map((cond) => (
            <div
              key={cond.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderLeft: `3px solid ${cond.color ?? 'var(--gold-500)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>
                  {cond.emoji ? `${cond.emoji} ` : ''}
                  {cond.name}
                </span>
                <span className="mesa-badge">{cond.category}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                {cond.description}
              </div>
            </div>
          ))}

        {/* RULES QUICK REFERENCE */}
        {section === 'rules' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--parchment-bg)',
                border: '1px solid var(--parchment-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--gold-400)', marginBottom: 4 }}>
                <BookOpen size={14} />
                Mighty Blade 3ª Edição (v{mbRules.version})
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Teste padrão: <strong>2d6 + Atributo</strong> ≥ Dificuldade ou Defesa.<br />
                <strong>Crítico (6+6):</strong> Sucesso automático e <strong>Dano ×2</strong>.<br />
                <strong>Falha Crítica (1+1):</strong> Erro automático.<br />
                <strong>Inapto (Força &lt; FN):</strong> Rola apenas <strong>1d6 + Atributo</strong>.
              </div>
            </div>

            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--gold-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Flame size={13} /> Fórmulas Automáticas
              </div>
              <div><strong>PV / PM Inicial:</strong> 60 PV e 60 PM (+ bônus raciais)</div>
              <div><strong>Esquiva:</strong> 5 (6 se Pequeno) + Agilidade</div>
              <div><strong>Bloqueio:</strong> 5 (6 se Pequeno) + Força + Armadura + Escudo</div>
              <div><strong>Determinação:</strong> 8 + maior(Inteligência, Vontade)</div>
              <div><strong>Deslocamento:</strong> ⌊Agilidade / 2⌋ + 5 metros</div>
              <div><strong>Carga:</strong> Básica FOR×7 · Pesada FOR×14 · Máx FOR×21 kg</div>
              <div><strong>Descanso:</strong> Curto (+5 PV/PM) · Longo (+30 PV/PM)</div>
            </div>

            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--gold-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Skull size={13} /> Tabela de Dificuldades
              </div>
              {mbRules.coreRollMechanic.difficultyTable.map((row) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>{row.label}</span>
                  <strong style={{ color: 'var(--gold-400)', fontFamily: 'var(--font-mono)' }}>
                    Dif {row.target}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CompendiumPanel;
