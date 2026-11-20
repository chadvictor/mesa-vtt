import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Minus,
  Plus,
  Search,
  Shield,
  Sparkles,
  Swords,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  getSpecializationsForProfession,
  getSpellsByProfession,
  tagmarCombatTechniques,
  tagmarCoreProfessions,
  tagmarEquipment,
  tagmarRaces,
  tagmarSkills,
  tagmarSpecializations,
} from '@systems/tagmar/compendium';
import {
  computePointBuyCost,
  computeSingleAttributeCost,
  tagmar3Engine,
} from '@systems/tagmar/engine';
import type { Character, TagmarAttributes } from '@systems/types';
import { FALLBACK_ASSET_MANIFEST, fetchAssetManifest, type AssetEntry } from '@/lib/api';
import { useCampaignStore } from '@/lib/store';
import { TagmarDamagePills } from '@/components/library/TagmarCompendiumView';

export interface TagmarWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (character: Character) => void;
}

const STEPS = [
  { num: 1, label: 'Nome & Retrato' },
  { num: 2, label: 'Raça (15)' },
  { num: 3, label: 'Profissão & Ordem' },
  { num: 4, label: 'Atributos (15/16)' },
  { num: 5, label: 'Perícias, Magias & Kit' },
];

const ATTR_META: Array<{ key: keyof TagmarAttributes; label: string; abbr: string; hint: string }> = [
  { key: 'intelecto', label: 'Intelecto', abbr: 'INT', hint: 'Conhecimento, Magia de Mago' },
  { key: 'aura', label: 'Aura', abbr: 'AUR', hint: 'Karma, RM, Poder Místico' },
  { key: 'carisma', label: 'Carisma', abbr: 'CAR', hint: 'Influência, Magia Sacerdote/Bardo' },
  { key: 'forca', label: 'Força', abbr: 'FOR', hint: 'EF, Armas Pesadas, Esforço' },
  { key: 'fisico', label: 'Físico', abbr: 'FIS', hint: 'EF, EH, RF, Velocidade (VB)' },
  { key: 'agilidade', label: 'Agilidade', abbr: 'AGI', hint: 'DA, Iniciativa, Combate' },
];

const SUGGESTED_ALLOCATIONS: Record<string, Partial<TagmarAttributes>> = {
  guerreiro: { forca: 3, fisico: 3, agilidade: 2, intelecto: 0, aura: 0, carisma: 0 },
  ladino: { agilidade: 3, carisma: 2, intelecto: 2, fisico: 1, forca: 0, aura: 0 },
  sacerdote: { aura: 3, carisma: 3, fisico: 2, intelecto: 0, forca: 0, agilidade: 0 },
  mago: { intelecto: 3, aura: 3, agilidade: 2, fisico: 0, carisma: 0, forca: 0 },
  rastreador: { agilidade: 3, fisico: 2, aura: 2, forca: 1, intelecto: 1, carisma: 0 },
  bardo: { carisma: 3, aura: 2, agilidade: 2, intelecto: 2, fisico: 0, forca: 0 },
};

function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function normStr(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function TagmarWizard({ open, onClose, onCreated }: TagmarWizardProps) {
  const { user, createCharacter, setActiveCharacterId, uploadImage, pushToast } = useCampaignStore();

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [biography, setBiography] = useState('');
  const [portraitUrl, setPortraitUrl] = useState('./assets/portraits/human-warrior.svg');
  const [portraits, setPortraits] = useState<AssetEntry[]>(FALLBACK_ASSET_MANIFEST.portraits);

  const [raceId, setRaceId] = useState(tagmarRaces[0]?.id ?? 'humano');
  const [raceSearch, setRaceSearch] = useState('');
  const [raceFilter, setRaceFilter] = useState<'all' | 'core' | 'expansion'>('all');

  const [professionId, setProfessionId] = useState(tagmarCoreProfessions[0]?.id ?? 'guerreiro');
  const [specializationId, setSpecializationId] = useState<string>('');

  const [attrs, setAttrs] = useState<TagmarAttributes>({
    intelecto: 0,
    aura: 0,
    carisma: 0,
    forca: 3,
    fisico: 3,
    agilidade: 2,
  });

  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [selectedSpellIds, setSelectedSpellIds] = useState<string[]>([]);
  const [selectedWeaponId, setSelectedWeaponId] = useState<string>('espada-longa');
  const [selectedArmorId, setSelectedArmorId] = useState<string>('couro-rigido');

  const [step5Tab, setStep5Tab] = useState<'skills' | 'techniques' | 'spells' | 'gear'>('skills');
  const [step5Query, setStep5Query] = useState('');

  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchAssetManifest().then((m) => {
      if (m.portraits.length > 0) setPortraits(m.portraits);
    });
    if (selectedSkillIds.length === 0 && selectedTechIds.length === 0) {
      applySuggestedKit(selectedProfession);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedRace = useMemo(
    () => tagmarRaces.find((r) => r.id === raceId) ?? tagmarRaces[0],
    [raceId]
  );

  const selectedProfession = useMemo(
    () => tagmarCoreProfessions.find((p) => p.id === professionId) ?? tagmarCoreProfessions[0],
    [professionId]
  );

  const availableSpecs = useMemo(
    () => getSpecializationsForProfession(selectedProfession.id),
    [selectedProfession.id]
  );

  const selectedSpec = useMemo(
    () => (specializationId ? tagmarSpecializations.find((s) => s.id === specializationId) ?? null : null),
    [specializationId]
  );

  const effectiveProf = selectedSpec ?? selectedProfession;

  const pointBuy = useMemo(
    () => computePointBuyCost(selectedRace, attrs),
    [selectedRace, attrs]
  );

  // Live Derived Stats Preview
  const preview = useMemo(() => {
    const ef = Math.max(1, selectedRace.baseEF + attrs.forca + attrs.fisico);
    const eh = Math.max(1, effectiveProf.baseEH + attrs.fisico);
    const karma = effectiveProf.isMystic && attrs.aura >= 1 ? (attrs.aura + 1) * 2 : 0;
    const rf = 1 + attrs.fisico;
    const rm = 1 + attrs.aura;
    const vb = Math.max(1, selectedRace.baseVB + attrs.fisico);
    const armor = tagmarEquipment.armor.find((a) => a.id === selectedArmorId);
    const da = Math.max(
      0,
      attrs.agilidade - Math.abs(armor?.agilityPenalty ?? 0) + (armor?.defActiveBonus ?? 0)
    );
    const dp = Math.max(0, armor?.defPassiveBonus ?? 0);
    const absorcao = armor?.absorcao ?? 0;
    return { ef, eh, karma, rf, rm, vb, da, dp, absorcao, iniciativa: attrs.agilidade };
  }, [selectedRace, effectiveProf, attrs, selectedArmorId]);

  const applySuggestedAttributes = (
    race = selectedRace,
    profId = selectedProfession.id
  ) => {
    const base = race.attributeAdjustments;
    const targetDeltas = SUGGESTED_ALLOCATIONS[profId] ?? SUGGESTED_ALLOCATIONS.guerreiro;
    const next: TagmarAttributes = {
      intelecto: base.intelecto,
      aura: base.aura,
      carisma: base.carisma,
      forca: base.forca,
      fisico: base.fisico,
      agilidade: base.agilidade,
    };

    const budget = 15 + (race.extraAttributePoints ?? 0);
    // Greedily raise suggested attributes without exceeding point-buy budget
    const priorityOrder = (Object.entries(targetDeltas) as Array<[keyof TagmarAttributes, number]>)
      .sort((a, b) => b[1] - a[1]);

    for (const [key, desiredDelta] of priorityOrder) {
      for (let i = 0; i < desiredDelta; i++) {
        const candidate: TagmarAttributes = { ...next, [key]: next[key] + 1 };
        const check = computePointBuyCost(race, candidate);
        if (check.valid && check.spent <= budget) {
          next[key] = candidate[key];
        }
      }
    }
    setAttrs(next);
  };

  const applySuggestedKit = (prof = effectiveProf) => {
    const skIds: string[] = [];
    for (const sName of prof.startingSkills ?? []) {
      const found = tagmarSkills.find((s) => normStr(s.name) === normStr(sName));
      if (found && !skIds.includes(found.id)) skIds.push(found.id);
    }
    const ctIds: string[] = [];
    for (const tName of prof.startingCombatTechniques ?? []) {
      const found = tagmarCombatTechniques.find(
        (t) => normStr(t.name) === normStr(tName) || normStr(t.name).includes(normStr(tName).slice(0, 14))
      );
      if (found && !ctIds.includes(found.id)) ctIds.push(found.id);
    }
    const spIds: string[] = [];
    if (prof.isMystic) {
      for (const spName of prof.startingSpells ?? []) {
        const found = getSpellsByProfession(selectedProfession.id).find(
          (sp) => normStr(sp.name) === normStr(spName)
        );
        if (found && !spIds.includes(found.id)) spIds.push(found.id);
      }
    }
    setSelectedSkillIds(skIds);
    setSelectedTechIds(ctIds);
    setSelectedSpellIds(spIds);

    const baseId = prof.baseProfessionId ?? prof.id;
    const defWeapon: Record<string, string> = {
      guerreiro: 'espada-longa',
      ladino: 'espada-curta',
      sacerdote: 'maca-estrela',
      mago: 'bordao',
      rastreador: 'arco-longo',
      bardo: 'florete',
    };
    const defArmor: Record<string, string> = {
      guerreiro: 'couro-rigido',
      ladino: 'couro-leve',
      sacerdote: 'couro-rigido',
      mago: 'vestes-acolchoadas',
      rastreador: 'couro-leve',
      bardo: 'couro-leve',
    };
    setSelectedWeaponId(defWeapon[baseId] ?? 'espada-curta');
    setSelectedArmorId(defArmor[baseId] ?? 'couro-leve');
  };

  const handleSelectRace = (newRaceId: string) => {
    setRaceId(newRaceId);
    const nextRace = tagmarRaces.find((r) => r.id === newRaceId) ?? tagmarRaces[0];
    let nextProfId = professionId;
    if (!nextRace.allowedProfessions.includes(professionId) && nextRace.allowedProfessions.length > 0) {
      nextProfId = nextRace.allowedProfessions[0];
      setProfessionId(nextProfId);
      setSpecializationId('');
    }
    applySuggestedAttributes(nextRace, nextProfId);
    if (!name.trim() && nextRace.suggestedPortrait) {
      setPortraitUrl(nextRace.suggestedPortrait);
    }
  };

  const handleSelectProfession = (newProfId: string) => {
    setProfessionId(newProfId);
    setSpecializationId('');
    const prof = tagmarCoreProfessions.find((p) => p.id === newProfId) ?? tagmarCoreProfessions[0];
    applySuggestedAttributes(selectedRace, prof.id);
    applySuggestedKit(prof);
    if (!name.trim() && prof.suggestedPortrait) {
      setPortraitUrl(prof.suggestedPortrait);
    }
  };

  const handleSelectSpec = (newSpecId: string) => {
    setSpecializationId(newSpecId);
    const spec = tagmarSpecializations.find((s) => s.id === newSpecId);
    applySuggestedKit(spec ?? selectedProfession);
  };

  const adjustAttr = (key: keyof TagmarAttributes, delta: 1 | -1) => {
    const base = selectedRace.attributeAdjustments[key];
    const nextVal = attrs[key] + delta;
    if (nextVal > Math.min(6, base + 4)) return;
    if (nextVal < Math.max(-4, base - 2)) return;
    const candidate: TagmarAttributes = { ...attrs, [key]: nextVal };
    const check = computePointBuyCost(selectedRace, candidate);
    if (delta > 0 && check.remaining < 0) {
      pushToast('Pontos insuficientes no orçamento de atributos.', 'warning');
      return;
    }
    setAttrs(candidate);
  };

  const toggleId = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleUploadPortrait = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadImage(file);
    setUploading(false);
    if (url) {
      setPortraitUrl(url);
      pushToast('Retrato personalizado carregado!', 'success');
    }
  };

  const handleConfirmCreate = async () => {
    const heroName = name.trim() || `${selectedRace.name} ${selectedProfession.name}`;
    setCreating(true);
    try {
      const draft = tagmar3Engine.createCharacterFromWizard({
        name: heroName,
        portraitUrl,
        raceId: selectedRace.id,
        professionId: selectedProfession.id,
        specializationId: specializationId || null,
        attributes: attrs,
        selectedSkillIds: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
        selectedCombatTechniqueIds: selectedTechIds.length > 0 ? selectedTechIds : undefined,
        selectedSpellIds: selectedSpellIds.length > 0 ? selectedSpellIds : undefined,
        selectedWeaponId,
        selectedArmorId,
        biography: biography.trim(),
        ownerUserId: user.id,
      });

      const created = await createCharacter(draft);
      if (created) {
        setActiveCharacterId(created.id);
        pushToast(`Herói Tagmar 3.0 "${created.name}" criado e pronto!`, 'success');
        onCreated?.(created);
        onClose();
      }
    } finally {
      setCreating(false);
    }
  };

  const filteredRaces = useMemo(
    () =>
      tagmarRaces.filter((r) => {
        if (raceFilter === 'core' && r.officialStatus !== 'core') return false;
        if (raceFilter === 'expansion' && r.officialStatus === 'core') return false;
        const q = raceSearch.trim().toLowerCase();
        return (
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.source.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
        );
      }),
    [raceFilter, raceSearch]
  );

  const professionSpells = useMemo(
    () => (effectiveProf.isMystic ? getSpellsByProfession(selectedProfession.id) : []),
    [effectiveProf.isMystic, selectedProfession.id]
  );

  const s5Norm = step5Query.trim().toLowerCase();

  const visibleSkills = useMemo(
    () =>
      tagmarSkills.filter(
        (s) =>
          !s5Norm ||
          s.name.toLowerCase().includes(s5Norm) ||
          s.group.toLowerCase().includes(s5Norm)
      ),
    [s5Norm]
  );

  const visibleTechniques = useMemo(
    () =>
      tagmarCombatTechniques.filter(
        (t) =>
          !s5Norm ||
          t.name.toLowerCase().includes(s5Norm) ||
          t.category.toLowerCase().includes(s5Norm)
      ),
    [s5Norm]
  );

  const visibleSpells = useMemo(
    () =>
      professionSpells.filter(
        (sp) =>
          !s5Norm ||
          sp.name.toLowerCase().includes(s5Norm) ||
          sp.group.toLowerCase().includes(s5Norm)
      ),
    [professionSpells, s5Norm]
  );

  if (!open) return null;

  return (
    <div className="mesa-modal-backdrop" onClick={onClose}>
      <div
        className="mesa-modal"
        style={{ maxWidth: 880, maxHeight: '92dvh', borderColor: 'rgba(74, 222, 128, 0.45)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="mesa-modal__header"
          style={{ background: 'linear-gradient(180deg, rgba(34, 197, 94, 0.12) 0%, transparent 100%)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Crown size={20} style={{ color: 'var(--emerald-400)' }} />
            <div>
              <h3 className="mesa-modal__title" style={{ color: 'var(--emerald-400)' }}>
                Criar Herói · Tagmar 3.0 + Expansões
              </h3>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Passo {step} de 5 — {STEPS[step - 1].label}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="mesa-btn mesa-btn--ghost mesa-btn--icon"
            onClick={onClose}
            aria-label="Fechar criador Tagmar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stepper Bar */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 16px',
            background: 'var(--bg-obsidian)',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
          }}
        >
          {STEPS.map((s) => {
            const active = s.num === step;
            const done = s.num < step;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setStep(s.num)}
                style={{
                  flex: 1,
                  minWidth: 112,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: active
                    ? 'var(--emerald-soft)'
                    : done
                      ? 'var(--gold-soft)'
                      : 'transparent',
                  border: `1px solid ${
                    active
                      ? 'rgba(74, 222, 128, 0.6)'
                      : done
                        ? 'var(--border-gold)'
                        : 'var(--border-subtle)'
                  }`,
                  color: active
                    ? 'var(--emerald-400)'
                    : done
                      ? 'var(--gold-400)'
                      : 'var(--text-muted)',
                }}
              >
                <span>{done ? '✓' : s.num}</span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="mesa-modal__body" style={{ flex: 1 }}>
          {/* STEP 1: Name & Portrait */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <img
                  src={portraitUrl}
                  alt="Retrato do Herói Tagmar"
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 'var(--radius-md)',
                    objectFit: 'cover',
                    border: '2px solid var(--emerald-400)',
                    boxShadow: 'var(--emerald-glow)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="mesa-label">Nome do Herói</label>
                  <input
                    type="text"
                    className="mesa-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Kael de Verrogar, Aelindra, Thorgar, Liriel..."
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="mesa-label" style={{ marginBottom: 0 }}>
                    Retrato do Personagem
                  </label>
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
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload size={12} />
                    {uploading ? 'Enviando...' : 'Upload Próprio'}
                  </button>
                </div>

                <div className="avatar-picker-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))' }}>
                  {portraits.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPortraitUrl(p.url)}
                      className={`avatar-picker-btn ${portraitUrl === p.url ? 'avatar-picker-btn--selected' : ''}`}
                      title={p.name}
                    >
                      <img src={p.url} alt={p.name} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mesa-label">Origem & Conceito no Mundo Conhecido (opcional)</label>
                <textarea
                  className="mesa-textarea"
                  rows={3}
                  value={biography}
                  onChange={(e) => setBiography(e.target.value)}
                  placeholder="De qual reino de Tagmar seu herói vem? (Verrogar, Filanti, Levânia, Calco, Larissa...)"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Choose Race (all 15 official + expansion races) */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  {(
                    [
                      ['all', `Todas (${tagmarRaces.length})`],
                      ['core', 'Livro Básico (6)'],
                      ['expansion', 'Expansões (9)'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRaceFilter(id)}
                      className={`lobby-pill ${raceFilter === id ? 'lobby-pill--active' : ''}`}
                      style={{ padding: '4px 10px', fontSize: 11.5 }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                  <Search
                    size={14}
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    className="mesa-input"
                    value={raceSearch}
                    onChange={(e) => setRaceSearch(e.target.value)}
                    placeholder="Filtrar raças..."
                    style={{ padding: '6px 10px 6px 30px', fontSize: 12 }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: 10 }}>
                {filteredRaces.map((r) => {
                  const selected = r.id === raceId;
                  const adj = r.attributeAdjustments;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleSelectRace(r.id)}
                      style={{
                        textAlign: 'left',
                        padding: 11,
                        borderRadius: 'var(--radius-md)',
                        background: selected ? 'var(--emerald-soft)' : 'var(--bg-elevated)',
                        border: `1px solid ${selected ? 'var(--emerald-400)' : 'var(--border-subtle)'}`,
                        boxShadow: selected ? '0 0 14px rgba(34,197,94,0.22)' : undefined,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: selected ? 'var(--emerald-400)' : 'var(--text-primary)' }}>
                          {r.name}
                        </span>
                        <span className={`mesa-badge ${r.extraAttributePoints > 0 ? 'mesa-badge--gold' : ''}`} style={{ fontSize: 10 }}>
                          {r.extraAttributePoints > 0 ? `+${r.extraAttributePoints} pt` : `EF ${r.baseEF} · VB ${r.baseVB}`}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                        {ATTR_META.map((a) => (
                          <span
                            key={a.key}
                            style={{
                              color:
                                adj[a.key] > 0
                                  ? 'var(--emerald-400)'
                                  : adj[a.key] < 0
                                    ? 'var(--crimson-400)'
                                    : 'var(--text-muted)',
                              fontWeight: adj[a.key] !== 0 ? 700 : 400,
                            }}
                          >
                            {a.abbr} {fmtSigned(adj[a.key])}
                          </span>
                        ))}
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {r.racialAbilities[0] ? (
                          <>
                            <strong style={{ color: 'var(--gold-400)' }}>{r.racialAbilities[0].name}:</strong>{' '}
                            {r.racialAbilities[0].description.slice(0, 88)}…
                          </>
                        ) : (
                          r.description.slice(0, 96) + '…'
                        )}
                      </div>

                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 'auto' }}>
                        {r.source} · EF Base {r.baseEF} · VB {r.baseVB}m
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: Choose Core Profession (6) + Specialization / Order / College (36) */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)', marginBottom: 8 }}>
                  1. Profissão Base (6 Oficiais de Tagmar 3.0)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: 10 }}>
                  {tagmarCoreProfessions.map((prof) => {
                    const selected = prof.id === professionId;
                    const allowedForRace = selectedRace.allowedProfessions.includes(prof.id);
                    return (
                      <button
                        key={prof.id}
                        type="button"
                        onClick={() => handleSelectProfession(prof.id)}
                        style={{
                          textAlign: 'left',
                          padding: 11,
                          borderRadius: 'var(--radius-md)',
                          background: selected ? 'var(--gold-soft)' : 'var(--bg-elevated)',
                          border: `1px solid ${selected ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                          boxShadow: selected ? 'var(--gold-glow)' : undefined,
                          opacity: allowedForRace ? 1 : 0.72,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: selected ? 'var(--gold-400)' : 'var(--text-primary)' }}>
                            {prof.name}
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <span className="mesa-badge mesa-badge--emerald">EH {prof.baseEH}</span>
                            {prof.isMystic && <span className="mesa-badge mesa-badge--sapphire">Místico</span>}
                          </div>
                        </div>

                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {prof.role}
                        </div>

                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {prof.startingPoints.skills} Hab · {prof.startingPoints.combatTechniques} Comb
                          {prof.isMystic ? ` · Magia ${prof.startingPoints.magicFormula}` : ''}
                        </div>

                        {!allowedForRace && (
                          <span className="mesa-badge mesa-badge--crimson" style={{ fontSize: 9.5, alignSelf: 'flex-start' }}>
                            Raro para {selectedRace.name} (Opcional)
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional Specialization / Order / College / Guild (36 official options) */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--emerald-400)' }}>
                    2. Especialização / {selectedProfession.organizationType} ({availableSpecs.length} opções oficiais)
                  </span>
                  <span className="mesa-badge" style={{ fontSize: 10 }}>
                    Opcional no 1º Estágio · Oficial no 5º Estágio
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 7, maxHeight: 220, overflowY: 'auto' }}>
                  <button
                    type="button"
                    onClick={() => handleSelectSpec('')}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: !specializationId ? 'var(--emerald-soft)' : 'var(--bg-elevated)',
                      border: `1px solid ${!specializationId ? 'var(--emerald-400)' : 'var(--border-subtle)'}`,
                      fontSize: 11.5,
                    }}
                  >
                    <strong style={{ color: !specializationId ? 'var(--emerald-400)' : 'var(--text-primary)' }}>
                      Sem Especialização (Padrão)
                    </strong>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      Inicia como {selectedProfession.name} puro; desbloqueia no Estágio 5.
                    </div>
                  </button>

                  {availableSpecs.map((spec) => {
                    const sel = spec.id === specializationId;
                    return (
                      <button
                        key={spec.id}
                        type="button"
                        onClick={() => handleSelectSpec(spec.id)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: sel ? 'var(--emerald-soft)' : 'var(--bg-elevated)',
                          border: `1px solid ${sel ? 'var(--emerald-400)' : 'var(--border-subtle)'}`,
                          fontSize: 11.5,
                        }}
                      >
                        <div style={{ fontWeight: 700, color: sel ? 'var(--emerald-400)' : 'var(--text-primary)' }}>
                          {spec.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          {spec.deity ? `Divindade: ${spec.deity} · ` : ''}
                          {spec.role.slice(0, 62)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Distribute Attribute Points (15 pts / 16 Humanos) + Live Preview */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid rgba(74, 222, 128, 0.4)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--emerald-400)' }}>
                    {name.trim() || 'Novo Herói'} — {selectedProfession.name}
                    {selectedSpec ? ` (${selectedSpec.name})` : ''} · {selectedRace.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Compra progressiva oficial: 0→1 (1pt), 1→2 (2pts), 2→3 (3pts), 3→4 (4pts). Reduzir devolve +0,5pt.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    className={`mesa-badge ${
                      pointBuy.remaining < 0
                        ? 'mesa-badge--crimson'
                        : pointBuy.remaining === 0
                          ? 'mesa-badge--emerald'
                          : 'mesa-badge--gold'
                    }`}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  >
                    Restantes: {pointBuy.remaining} / {pointBuy.budget} pts
                  </span>
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    onClick={() => applySuggestedAttributes()}
                  >
                    <Sparkles size={12} /> Sugerido
                  </button>
                </div>
              </div>

              {/* 6 Attributes Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 9 }}>
                {ATTR_META.map((a) => {
                  const base = selectedRace.attributeAdjustments[a.key];
                  const val = attrs[a.key];
                  const minVal = Math.max(-4, base - 2);
                  const maxVal = Math.min(6, base + 4);
                  const nextCost =
                    val < maxVal
                      ? computeSingleAttributeCost(base, val + 1) - computeSingleAttributeCost(base, val)
                      : null;
                  return (
                    <div
                      key={a.key}
                      style={{
                        padding: 10,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                        {a.abbr} · {a.label}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 28,
                          fontWeight: 800,
                          color: val > 0 ? 'var(--emerald-400)' : val < 0 ? 'var(--crimson-400)' : 'var(--gold-400)',
                          lineHeight: 1,
                        }}
                      >
                        {fmtSigned(val)}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        Base Raça: {fmtSigned(base)}
                      </span>
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--sm"
                          disabled={val <= minVal}
                          onClick={() => adjustAttr(a.key, -1)}
                          style={{ minWidth: 32, padding: '2px 6px' }}
                        >
                          <Minus size={12} />
                        </button>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--gold mesa-btn--sm"
                          disabled={val >= maxVal || (nextCost !== null && pointBuy.remaining < nextCost)}
                          onClick={() => adjustAttr(a.key, 1)}
                          style={{ minWidth: 32, padding: '2px 6px' }}
                          title={nextCost !== null ? `Custo: ${nextCost} pt(s)` : 'Máximo atingido'}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <span style={{ fontSize: 9.5, color: 'var(--text-muted)', textAlign: 'center' }}>
                        {nextCost !== null ? `Próx: ${nextCost}pt` : 'Máx'} · {a.hint}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Live Derived Stats Preview */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-gold)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--gold-400)' }}>
                  Prévia ao Vivo — Estágio 1
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span className="mesa-badge mesa-badge--gold">EH: {preview.eh}</span>
                  <span className="mesa-badge mesa-badge--crimson">EF: {preview.ef}</span>
                  <span className="mesa-badge mesa-badge--sapphire">Karma: {preview.karma}</span>
                  <span className="mesa-badge mesa-badge--emerald">
                    <Shield size={11} /> DA: {preview.da} / DP: {preview.dp}
                  </span>
                  <span className="mesa-badge">Absorção: {preview.absorcao}</span>
                  <span className="mesa-badge">RF: {preview.rf}</span>
                  <span className="mesa-badge">RM: {preview.rm}</span>
                  <span className="mesa-badge">VB: {preview.vb}m</span>
                  <span className="mesa-badge">Iniciativa: 1d10{fmtSigned(preview.iniciativa)}</span>
                </div>
                {effectiveProf.isMystic && attrs.aura < 1 && (
                  <div style={{ fontSize: 11, color: 'var(--amber-400)' }}>
                    Dica: Profissões místicas precisam de <strong>Aura ≥ +1</strong> para possuir pontos de Karma!
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5: Choose Skills, Combat Techniques, Spells & Starting Gear */}
          {step === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid rgba(74, 222, 128, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--emerald-400)' }}>{effectiveProf.name}:</strong>{' '}
                  {selectedSkillIds.length} Hab · {selectedTechIds.length} Téc
                  {effectiveProf.isMystic ? ` · ${selectedSpellIds.length} Magias` : ''}
                </div>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--sm"
                  onClick={() => applySuggestedKit(effectiveProf)}
                >
                  <Sparkles size={12} /> Carregar Sugeridos
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setStep5Tab('skills')}
                  className={`lobby-pill ${step5Tab === 'skills' ? 'lobby-pill--active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                >
                  Habilidades ({selectedSkillIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStep5Tab('techniques')}
                  className={`lobby-pill ${step5Tab === 'techniques' ? 'lobby-pill--active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                >
                  <Swords size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                  Técnicas ({selectedTechIds.length})
                </button>
                {effectiveProf.isMystic && (
                  <button
                    type="button"
                    onClick={() => setStep5Tab('spells')}
                    className={`lobby-pill ${step5Tab === 'spells' ? 'lobby-pill--active' : ''}`}
                    style={{ padding: '4px 10px', fontSize: 11.5 }}
                  >
                    <Wand2 size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                    Magias ({selectedSpellIds.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStep5Tab('gear')}
                  className={`lobby-pill ${step5Tab === 'gear' ? 'lobby-pill--active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                >
                  <Shield size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                  Arma & Armadura
                </button>

                {step5Tab !== 'gear' && (
                  <input
                    type="text"
                    className="mesa-input"
                    value={step5Query}
                    onChange={(e) => setStep5Query(e.target.value)}
                    placeholder="Filtrar..."
                    style={{ flex: 1, minWidth: 140, padding: '5px 9px', fontSize: 12 }}
                  />
                )}
              </div>

              {step5Tab === 'skills' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 7, maxHeight: 300, overflowY: 'auto' }}>
                  {visibleSkills.map((sk) => {
                    const picked = selectedSkillIds.includes(sk.id);
                    return (
                      <button
                        key={sk.id}
                        type="button"
                        onClick={() => toggleId(sk.id, setSelectedSkillIds)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: picked ? 'var(--emerald-soft)' : 'var(--bg-elevated)',
                          border: `1px solid ${picked ? 'var(--emerald-400)' : 'var(--border-subtle)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 5 }}>
                          <strong style={{ fontSize: 12, color: picked ? 'var(--emerald-400)' : 'var(--text-primary)' }}>
                            {picked ? '✓ ' : ''}{sk.name}
                          </strong>
                          <span className="mesa-badge" style={{ fontSize: 9.5 }}>{sk.group}</span>
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {sk.description.slice(0, 74)}…
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {step5Tab === 'techniques' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 7, maxHeight: 300, overflowY: 'auto' }}>
                  {visibleTechniques.map((ct) => {
                    const picked = selectedTechIds.includes(ct.id);
                    return (
                      <button
                        key={ct.id}
                        type="button"
                        onClick={() => toggleId(ct.id, setSelectedTechIds)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: picked ? 'var(--gold-soft)' : 'var(--bg-elevated)',
                          border: `1px solid ${picked ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <strong style={{ fontSize: 12, color: picked ? 'var(--gold-400)' : 'var(--text-primary)' }}>
                          {picked ? '✓ ' : ''}{ct.name}
                        </strong>
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {ct.description.slice(0, 82)}…
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {step5Tab === 'spells' && effectiveProf.isMystic && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))', gap: 7, maxHeight: 300, overflowY: 'auto' }}>
                  {visibleSpells.slice(0, 80).map((sp) => {
                    const picked = selectedSpellIds.includes(sp.id);
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => toggleId(sp.id, setSelectedSpellIds)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: picked ? 'var(--sapphire-soft)' : 'var(--bg-elevated)',
                          border: `1px solid ${picked ? 'var(--sapphire-400)' : 'var(--border-subtle)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 5 }}>
                          <strong style={{ fontSize: 12, color: picked ? '#93c5fd' : 'var(--text-primary)' }}>
                            {picked ? '✓ ' : ''}{sp.name}
                          </strong>
                          <span className="mesa-badge mesa-badge--sapphire" style={{ fontSize: 9.5 }}>
                            {sp.karmaCost} K
                          </span>
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--sapphire-400)' }}>{sp.group}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {sp.description.slice(0, 74)}…
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {step5Tab === 'gear' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="mesa-label" style={{ marginBottom: 0 }}>Arma Inicial</label>
                    <select
                      className="mesa-select"
                      value={selectedWeaponId}
                      onChange={(e) => setSelectedWeaponId(e.target.value)}
                      style={{ fontSize: 12 }}
                    >
                      {tagmarEquipment.weapons.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} (Dano {w.damage.verde}/{w.damage.amarelo}/{w.damage.laranja}/{w.damage.vermelho} · FOR {w.minFor})
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const w = tagmarEquipment.weapons.find((x) => x.id === selectedWeaponId);
                      return w ? (
                        <div style={{ padding: 8, borderRadius: 6, background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <TagmarDamagePills damage={w.damage} />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {w.damageType} · {w.range} · {w.description}
                          </span>
                        </div>
                      ) : null;
                    })()}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="mesa-label" style={{ marginBottom: 0 }}>Armadura Inicial</label>
                    <select
                      className="mesa-select"
                      value={selectedArmorId}
                      onChange={(e) => setSelectedArmorId(e.target.value)}
                      style={{ fontSize: 12 }}
                    >
                      {tagmarEquipment.armor
                        .filter((a) => a.slot === 'armor')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} (Classe {a.armorClass} · Abs {a.absorcao} · DA {fmtSigned(a.defActiveBonus)})
                          </option>
                        ))}
                    </select>
                    {(() => {
                      const a = tagmarEquipment.armor.find((x) => x.id === selectedArmorId);
                      return a ? (
                        <div style={{ padding: 8, borderRadius: 6, background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-secondary)' }}>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
                            <span className="mesa-badge mesa-badge--gold">Classe {a.armorClass}</span>
                            <span className="mesa-badge mesa-badge--emerald">Abs {a.absorcao}</span>
                            <span className="mesa-badge">DA {fmtSigned(a.defActiveBonus)} / DP {fmtSigned(a.defPassiveBonus)}</span>
                          </div>
                          {a.description}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mesa-modal__footer" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="mesa-btn mesa-btn--ghost"
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
          >
            <ChevronLeft size={15} />
            {step > 1 ? 'Voltar' : 'Cancelar'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step < 5 ? (
              <button
                type="button"
                className="mesa-btn mesa-btn--emerald"
                onClick={() => setStep(step + 1)}
              >
                Avançar
                <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                className="mesa-btn mesa-btn--emerald"
                disabled={creating || !pointBuy.valid}
                onClick={() => void handleConfirmCreate()}
              >
                <Check size={15} />
                {creating ? 'Forjando Herói...' : 'Criar Herói Tagmar 3.0'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TagmarWizard;
