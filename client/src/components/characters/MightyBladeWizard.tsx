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
  mbAbilities,
  mbClasses,
  mbRaces,
  mbSpells,
  type MBAbility,
  type MBSpell,
} from '@systems/mighty-blade-3e/compendium';
import { mightyBlade3eEngine } from '@systems/mighty-blade-3e/engine';
import type { Character, MightyBladeAttributes } from '@systems/types';
import { FALLBACK_ASSET_MANIFEST, fetchAssetManifest, type AssetEntry } from '@/lib/api';
import { useCampaignStore } from '@/lib/store';

export interface MightyBladeWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (character: Character) => void;
}

const STEPS = [
  { num: 1, label: 'Nome & Retrato' },
  { num: 2, label: 'Raça' },
  { num: 3, label: 'Classe' },
  { num: 4, label: 'Atributos & Kit' },
  { num: 5, label: '3 Habilidades' },
];

const ATTR_META: Array<{ key: keyof MightyBladeAttributes; label: string; abbr: string }> = [
  { key: 'forca', label: 'Força', abbr: 'FOR' },
  { key: 'agilidade', label: 'Agilidade', abbr: 'AGI' },
  { key: 'inteligencia', label: 'Inteligência', abbr: 'INT' },
  { key: 'vontade', label: 'Vontade', abbr: 'VON' },
];

export function MightyBladeWizard({ open, onClose, onCreated }: MightyBladeWizardProps) {
  const { user, createCharacter, setActiveCharacterId, uploadImage, pushToast } = useCampaignStore();

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [background, setBackground] = useState('');
  const [portraitUrl, setPortraitUrl] = useState('./assets/portraits/human-warrior.svg');
  const [portraits, setPortraits] = useState<AssetEntry[]>(FALLBACK_ASSET_MANIFEST.portraits);

  const [raceId, setRaceId] = useState(mbRaces[0]?.id ?? 'humano');
  const [classId, setClassId] = useState(mbClasses[0]?.id ?? 'guerreiro');
  const [classCategoryFilter, setClassCategoryFilter] = useState<string>('all');
  const [raceSearch, setRaceSearch] = useState('');

  const [freePoints, setFreePoints] = useState<MightyBladeAttributes>({
    forca: 0,
    agilidade: 0,
    inteligencia: 0,
    vontade: 0,
  });

  const [selectedAbilityIds, setSelectedAbilityIds] = useState<string[]>([]);
  const [selectedSpellIds, setSelectedSpellIds] = useState<string[]>([]);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillTab, setSkillTab] = useState<'abilities' | 'spells'>('abilities');

  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchAssetManifest().then((m) => {
      if (m.portraits.length > 0) setPortraits(m.portraits);
    });
  }, [open]);

  const selectedRace = useMemo(
    () => mbRaces.find((r) => r.id === raceId) ?? mbRaces[0],
    [raceId]
  );

  const selectedClass = useMemo(
    () => mbClasses.find((c) => c.id === classId) ?? mbClasses[0],
    [classId]
  );

  const totalExtraAvailable = selectedRace?.extraPoints ?? 0;
  const usedExtraPoints =
    freePoints.forca + freePoints.agilidade + freePoints.inteligencia + freePoints.vontade;
  const remainingExtraPoints = Math.max(0, totalExtraAvailable - usedExtraPoints);

  const finalAttrs: MightyBladeAttributes = useMemo(
    () => ({
      forca:
        (selectedRace?.attributes.forca ?? 3) +
        (selectedClass?.attributeBonuses.forca ?? 0) +
        freePoints.forca,
      agilidade:
        (selectedRace?.attributes.agilidade ?? 3) +
        (selectedClass?.attributeBonuses.agilidade ?? 0) +
        freePoints.agilidade,
      inteligencia:
        (selectedRace?.attributes.inteligencia ?? 3) +
        (selectedClass?.attributeBonuses.inteligencia ?? 0) +
        freePoints.inteligencia,
      vontade:
        (selectedRace?.attributes.vontade ?? 3) +
        (selectedClass?.attributeBonuses.vontade ?? 0) +
        freePoints.vontade,
    }),
    [selectedRace, selectedClass, freePoints]
  );

  // Live derived stats preview
  const previewStats = useMemo(() => {
    const baseDef = selectedRace?.baseDefenseOverride ?? 5;
    const esquiva = baseDef + finalAttrs.agilidade;
    const bloqueio = baseDef + finalAttrs.forca;
    const determinacao = 8 + Math.max(finalAttrs.inteligencia, finalAttrs.vontade);
    const deslocamento = Math.floor(finalAttrs.agilidade / 2) + 5 + (selectedRace?.movementModifier ?? 0);
    const pv = 60 + (selectedRace?.pvBonus ?? 0);
    const pm = 60 + (selectedRace?.pmBonus ?? 0);
    return { pv, pm, esquiva, bloqueio, determinacao, deslocamento, cargaBasica: finalAttrs.forca * 7 };
  }, [selectedRace, finalAttrs]);

  // Available initial abilities & spells for chosen class
  const availableAbilities: MBAbility[] = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return mbAbilities.filter((a) => {
      const classMatch = a.classId === selectedClass.id || a.classId === 'geral' || a.classId === selectedRace.id;
      const queryMatch =
        !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
      return classMatch && queryMatch;
    });
  }, [selectedClass.id, selectedRace.id, skillQuery]);

  const availableSpells: MBSpell[] = useMemo(() => {
    const allowed = selectedClass.allowedPaths.map((p) => p.toLowerCase());
    if (allowed.length === 0) return [];
    const q = skillQuery.trim().toLowerCase();
    return mbSpells.filter((s) => {
      const pathMatch =
        allowed.includes(s.path.toLowerCase()) ||
        (s.classIds ?? []).includes(selectedClass.id);
      const queryMatch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q);
      return pathMatch && queryMatch;
    });
  }, [selectedClass, skillQuery]);

  const totalPickedSkills = selectedAbilityIds.length + selectedSpellIds.length;

  const handleSelectRace = (newRaceId: string) => {
    setRaceId(newRaceId);
    setFreePoints({ forca: 0, agilidade: 0, inteligencia: 0, vontade: 0 });
  };

  const handleSelectClass = (newClassId: string) => {
    setClassId(newClassId);
    setSelectedAbilityIds([]);
    setSelectedSpellIds([]);
    const cls = mbClasses.find((c) => c.id === newClassId);
    if (cls?.suggestedPortrait && !name.trim()) {
      setPortraitUrl(cls.suggestedPortrait);
    }
  };

  const adjustFreePoint = (key: keyof MightyBladeAttributes, delta: 1 | -1) => {
    setFreePoints((prev) => {
      if (delta === 1 && remainingExtraPoints <= 0) return prev;
      if (delta === -1 && prev[key] <= 0) return prev;
      return { ...prev, [key]: prev[key] + delta };
    });
  };

  const toggleAbility = (id: string) => {
    setSelectedAbilityIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length + selectedSpellIds.length >= 3) {
        pushToast('Você já escolheu as 3 habilidades/magias iniciais.', 'info');
        return prev;
      }
      return [...prev, id];
    });
  };

  const toggleSpell = (id: string) => {
    setSelectedSpellIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (selectedAbilityIds.length + prev.length >= 3) {
        pushToast('Você já escolheu as 3 habilidades/magias iniciais.', 'info');
        return prev;
      }
      return [...prev, id];
    });
  };

  const autoPickSuggested = () => {
    const pickedAb: string[] = [];
    const pickedSp: string[] = [];

    for (const suggestedName of selectedClass.suggestedAbilities ?? []) {
      if (pickedAb.length + pickedSp.length >= 3) break;
      const normSug = suggestedName.toLowerCase();
      const ab = availableAbilities.find((a) => a.name.toLowerCase().includes(normSug));
      if (ab && !pickedAb.includes(ab.id)) {
        pickedAb.push(ab.id);
        continue;
      }
      const sp = availableSpells.find((s) => s.name.toLowerCase().includes(normSug));
      if (sp && !pickedSp.includes(sp.id)) {
        pickedSp.push(sp.id);
      }
    }

    // Fill remainder up to 3
    for (const ab of availableAbilities) {
      if (pickedAb.length + pickedSp.length >= 3) break;
      if (!pickedAb.includes(ab.id)) pickedAb.push(ab.id);
    }
    for (const sp of availableSpells) {
      if (pickedAb.length + pickedSp.length >= 3) break;
      if (!pickedSp.includes(sp.id)) pickedSp.push(sp.id);
    }

    setSelectedAbilityIds(pickedAb);
    setSelectedSpellIds(pickedSp);
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
    const heroName = name.trim() || `${selectedRace.name} ${selectedClass.name}`;
    setCreating(true);
    try {
      const draft = mightyBlade3eEngine.createCharacterFromWizard({
        name: heroName,
        portraitUrl,
        raceId: selectedRace.id,
        classId: selectedClass.id,
        freeAttributePoints: freePoints,
        selectedAbilityIds,
        selectedSpellIds,
        background: background.trim(),
        ownerUserId: user.id,
      });

      const created = await createCharacter(draft);
      if (created) {
        setActiveCharacterId(created.id);
        pushToast(`Herói "${created.name}" criado e pronto para aventurar-se!`, 'success');
        onCreated?.(created);
        onClose();
      }
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  const filteredRaces = mbRaces.filter(
    (r) =>
      !raceSearch.trim() ||
      r.name.toLowerCase().includes(raceSearch.toLowerCase()) ||
      r.description.toLowerCase().includes(raceSearch.toLowerCase())
  );

  const filteredClasses = mbClasses.filter(
    (c) => classCategoryFilter === 'all' || c.category === classCategoryFilter
  );

  return (
    <div className="mesa-modal-backdrop" onClick={onClose}>
      <div
        className="mesa-modal"
        style={{ maxWidth: 820, maxHeight: '92dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mesa-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Crown size={20} style={{ color: 'var(--gold-400)' }} />
            <div>
              <h3 className="mesa-modal__title">Criar Herói · Mighty Blade 3ª Edição</h3>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Passo {step} de 5 — {STEPS[step - 1].label}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="mesa-btn mesa-btn--ghost mesa-btn--icon"
            onClick={onClose}
            aria-label="Fechar criador"
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
                  minWidth: 105,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: active
                    ? 'var(--gold-soft)'
                    : done
                      ? 'rgba(34, 197, 94, 0.1)'
                      : 'transparent',
                  border: `1px solid ${
                    active
                      ? 'var(--border-gold)'
                      : done
                        ? 'rgba(34, 197, 94, 0.35)'
                        : 'var(--border-subtle)'
                  }`,
                  color: active
                    ? 'var(--gold-400)'
                    : done
                      ? 'var(--emerald-400)'
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
                  alt="Retrato do Herói"
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 'var(--radius-md)',
                    objectFit: 'cover',
                    border: '2px solid var(--gold-400)',
                    boxShadow: 'var(--gold-glow)',
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
                    placeholder="Ex: Aldric Valen, Lyra Ventoluz, Thorin..."
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="mesa-label" style={{ marginBottom: 0 }}>
                    Escolha um Retrato Oficial ou Envie Imagem
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
                <label className="mesa-label">História / Conceito (opcional)</label>
                <textarea
                  className="mesa-textarea"
                  rows={3}
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  placeholder="De onde seu herói veio em Drakon? Qual seu objetivo?"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Choose Race (all 16 official races) */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Search
                  size={14}
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                />
                <input
                  type="text"
                  className="mesa-input"
                  value={raceSearch}
                  onChange={(e) => setRaceSearch(e.target.value)}
                  placeholder={`Buscar entre as ${mbRaces.length} raças oficiais...`}
                  style={{ paddingLeft: 32 }}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 10,
                }}
              >
                {filteredRaces.map((r) => {
                  const selected = r.id === raceId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleSelectRace(r.id)}
                      style={{
                        textAlign: 'left',
                        padding: 11,
                        borderRadius: 'var(--radius-md)',
                        background: selected ? 'var(--gold-soft)' : 'var(--bg-elevated)',
                        border: `1px solid ${selected ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                        boxShadow: selected ? 'var(--gold-glow)' : undefined,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: selected ? 'var(--gold-400)' : 'var(--text-primary)' }}>
                          {r.name}
                        </span>
                        {r.extraPoints > 0 && (
                          <span className="mesa-badge mesa-badge--gold">+{r.extraPoints} livre</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                        <span>FOR {r.attributes.forca}</span>
                        <span>AGI {r.attributes.agilidade}</span>
                        <span>INT {r.attributes.inteligencia}</span>
                        <span>VON {r.attributes.vontade}</span>
                      </div>

                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        <strong style={{ color: 'var(--gold-400)' }}>{r.racialAbility.name}:</strong>{' '}
                        {r.racialAbility.description.slice(0, 92)}…
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: Choose Class (all 14 official classes) */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['all', 'Combate', 'Especialista', 'Conjurador'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setClassCategoryFilter(cat)}
                    className={`lobby-pill ${classCategoryFilter === cat ? 'lobby-pill--active' : ''}`}
                    style={{ padding: '5px 12px', fontSize: 12 }}
                  >
                    {cat === 'all' ? `Todas (${mbClasses.length})` : cat}
                  </button>
                ))}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))',
                  gap: 10,
                }}
              >
                {filteredClasses.map((cls) => {
                  const selected = cls.id === classId;
                  const bonusStr = Object.entries(cls.attributeBonuses)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `+${v} ${k.slice(0, 3).toUpperCase()}`)
                    .join(' · ');
                  return (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => handleSelectClass(cls.id)}
                      style={{
                        textAlign: 'left',
                        padding: 11,
                        borderRadius: 'var(--radius-md)',
                        background: selected ? 'var(--gold-soft)' : 'var(--bg-elevated)',
                        border: `1px solid ${selected ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                        boxShadow: selected ? 'var(--gold-glow)' : undefined,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: selected ? 'var(--gold-400)' : 'var(--text-primary)' }}>
                          {cls.name}
                        </span>
                        <span className="mesa-badge mesa-badge--gold">{bonusStr}</span>
                      </div>

                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {cls.description.slice(0, 98)}…
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        <strong style={{ color: 'var(--emerald-400)' }}>Auto:</strong> {cls.automaticAbility.name}
                      </div>
                      {cls.allowedPaths.length > 0 && (
                        <div style={{ fontSize: 10.5, color: 'var(--sapphire-400)' }}>
                          Magia: {cls.allowedPaths.join(', ')}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 4: Free Attribute Points & Starting Kit */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid var(--border-gold)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--gold-400)' }}>
                    {name.trim() || 'Novo Herói'} — {selectedClass.name} {selectedRace.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {totalExtraAvailable > 0
                      ? `Sua raça concede +${totalExtraAvailable} ponto(s) livre(s) para distribuir.`
                      : 'Atributos combinados da sua Raça + Classe.'}
                  </div>
                </div>
                {totalExtraAvailable > 0 && (
                  <span className={`mesa-badge ${remainingExtraPoints > 0 ? 'mesa-badge--gold' : 'mesa-badge--emerald'}`}>
                    Restantes: {remainingExtraPoints}
                  </span>
                )}
              </div>

              {/* 4 Attributes Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                {ATTR_META.map((a) => (
                  <div
                    key={a.key}
                    style={{
                      padding: 12,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                      {a.label.toUpperCase()}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 800, color: 'var(--gold-400)' }}>
                      {finalAttrs[a.key]}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Raça {selectedRace.attributes[a.key]} + Classe {selectedClass.attributeBonuses[a.key]}
                      {freePoints[a.key] > 0 ? ` + Livre ${freePoints[a.key]}` : ''}
                    </span>

                    {totalExtraAvailable > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--sm"
                          disabled={freePoints[a.key] <= 0}
                          onClick={() => adjustFreePoint(a.key, -1)}
                        >
                          <Minus size={12} />
                        </button>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--gold mesa-btn--sm"
                          disabled={remainingExtraPoints <= 0}
                          onClick={() => adjustFreePoint(a.key, 1)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Derived Preview Strip */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span className="mesa-badge mesa-badge--emerald">PV: {previewStats.pv}</span>
                <span className="mesa-badge mesa-badge--sapphire">PM: {previewStats.pm}</span>
                <span className="mesa-badge mesa-badge--gold">
                  <Shield size={11} /> Bloqueio Base: {previewStats.bloqueio}
                </span>
                <span className="mesa-badge">Esquiva: {previewStats.esquiva}</span>
                <span className="mesa-badge">Determinação: {previewStats.determinacao}</span>
                <span className="mesa-badge">Desloc.: {previewStats.deslocamento}m</span>
                <span className="mesa-badge">Carga Básica: {previewStats.cargaBasica} kg</span>
              </div>

              {/* Starting Equipment Preview */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--gold-400)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Swords size={14} /> Equipamento Inicial ({selectedClass.name})
                  </span>
                  <span className="mesa-badge mesa-badge--gold">{selectedClass.startingGold ?? 400} TO</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {(selectedClass.startingEquipment ?? []).map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* STEP 5: Choose 3 Initial Abilities / Spells */}
          {step === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-obsidian)',
                  border: '1px solid var(--border-gold)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12 }}>
                  <strong style={{ color: 'var(--gold-400)' }}>Já incluídas automaticamente:</strong>{' '}
                  {selectedRace.racialAbility.name} (Racial) + {selectedClass.automaticAbility.name} (Classe)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`mesa-badge ${totalPickedSkills === 3 ? 'mesa-badge--emerald' : 'mesa-badge--gold'}`}>
                    {totalPickedSkills} / 3 selecionadas
                  </span>
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--sm"
                    onClick={autoPickSuggested}
                  >
                    <Sparkles size={12} />
                    Escolher Sugeridas
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setSkillTab('abilities')}
                  className={`lobby-pill ${skillTab === 'abilities' ? 'lobby-pill--active' : ''}`}
                  style={{ padding: '5px 12px', fontSize: 12 }}
                >
                  <Sparkles size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                  Habilidades ({availableAbilities.length})
                </button>
                {availableSpells.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSkillTab('spells')}
                    className={`lobby-pill ${skillTab === 'spells' ? 'lobby-pill--active' : ''}`}
                    style={{ padding: '5px 12px', fontSize: 12 }}
                  >
                    <Wand2 size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                    Magias ({availableSpells.length})
                  </button>
                )}
                <input
                  type="text"
                  className="mesa-input"
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  placeholder="Filtrar habilidades ou magias..."
                  style={{ flex: 1, minWidth: 160, padding: '6px 10px', fontSize: 12 }}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                  gap: 8,
                  maxHeight: 330,
                  overflowY: 'auto',
                  paddingRight: 2,
                }}
              >
                {skillTab === 'abilities' &&
                  availableAbilities.map((ab) => {
                    const checked = selectedAbilityIds.includes(ab.id);
                    return (
                      <button
                        key={ab.id}
                        type="button"
                        onClick={() => toggleAbility(ab.id)}
                        style={{
                          textAlign: 'left',
                          padding: 10,
                          borderRadius: 'var(--radius-sm)',
                          background: checked ? 'rgba(34, 197, 94, 0.14)' : 'var(--bg-elevated)',
                          border: `1px solid ${checked ? 'var(--emerald-500)' : 'var(--border-subtle)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 12.5, color: checked ? 'var(--emerald-400)' : 'var(--text-primary)' }}>
                            {checked && <Check size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}
                            {ab.name}
                          </span>
                          {ab.manaCost ? (
                            <span className="mesa-badge mesa-badge--sapphire">{ab.manaCost} PM</span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {ab.description.slice(0, 125)}
                          {ab.description.length > 125 ? '…' : ''}
                        </div>
                      </button>
                    );
                  })}

                {skillTab === 'spells' &&
                  availableSpells.map((sp) => {
                    const checked = selectedSpellIds.includes(sp.id);
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => toggleSpell(sp.id)}
                        style={{
                          textAlign: 'left',
                          padding: 10,
                          borderRadius: 'var(--radius-sm)',
                          background: checked ? 'rgba(59, 130, 246, 0.16)' : 'var(--bg-elevated)',
                          border: `1px solid ${checked ? 'var(--sapphire-400)' : 'var(--border-subtle)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 12.5, color: checked ? 'var(--sapphire-400)' : 'var(--text-primary)' }}>
                            {checked && <Check size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}
                            {sp.name}
                          </span>
                          <span className="mesa-badge mesa-badge--sapphire">{sp.manaCost} PM</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gold-400)' }}>
                          Caminho {sp.path} · Dif {sp.difficulty}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {sp.description.slice(0, 115)}
                          {sp.description.length > 115 ? '…' : ''}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="mesa-modal__footer" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="mesa-btn"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            <ChevronLeft size={15} />
            Voltar
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step < 5 ? (
              <button
                type="button"
                className="mesa-btn mesa-btn--gold"
                onClick={() => setStep((s) => Math.min(5, s + 1))}
              >
                Avançar
                <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                className="mesa-btn mesa-btn--gold"
                disabled={creating}
                onClick={() => void handleConfirmCreate()}
              >
                <Check size={15} />
                {creating ? 'Forjando Herói...' : 'Confirmar e Criar Herói'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MightyBladeWizard;
