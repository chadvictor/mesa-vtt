import React, { useEffect, useState } from 'react';
import { Globe, Loader2, Lock, Plus, Shield, Sparkles, X } from 'lucide-react';
import {
  FALLBACK_ASSET_MANIFEST,
  createCampaign,
  fetchAssetManifest,
  type AssetEntry,
} from '@/lib/api';
import type { Campaign } from '@systems/types';

interface CreateCampaignModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (campaign: Campaign) => void;
}

const SYSTEM_OPTIONS = [
  {
    id: 'mighty-blade-3e',
    name: 'Mighty Blade 3ª Edição',
    badge: 'Automação Completa',
    desc: 'Assistente de criação, PV/PM/Defesas automáticas, 2d6 com Crítico (6+6) e Falha Crítica (1+1), compêndio oficial completo.',
  },
  {
    id: 'generic-rpg',
    name: 'RPG Genérico',
    badge: 'Multisistema Livre',
    desc: 'Atributos, barras e fórmulas customizáveis (d20, 3d6, d100) + macros seguras para qualquer sistema.',
  },
];

export function CreateCampaignModal({ open, onClose, onCreated }: CreateCampaignModalProps) {
  const [name, setName] = useState('');
  const [systemId, setSystemId] = useState('mighty-blade-3e');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'invite_only'>('public');
  const [inviteCode, setInviteCode] = useState('');
  const [covers, setCovers] = useState<AssetEntry[]>([
    FALLBACK_ASSET_MANIFEST.banner,
    ...FALLBACK_ASSET_MANIFEST.maps,
  ]);
  const [coverUrl, setCoverUrl] = useState(FALLBACK_ASSET_MANIFEST.banner.url);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchAssetManifest().then((m) => {
      setCovers([m.banner, ...m.maps]);
    });
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Informe o nome da campanha.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const cleanCode = inviteCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const res = await createCampaign({
        name: trimmedName,
        systemId,
        description:
          description.trim() ||
          (systemId === 'mighty-blade-3e'
            ? 'Uma nova aventura épica nas terras de Drakon.'
            : 'Campanha personalizada no Mesa VTT.'),
        coverUrl,
        privacy,
        inviteCode: cleanCode.length >= 4 ? cleanCode : undefined,
      });
      onCreated(res.campaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar campanha.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mesa-modal-backdrop" onClick={onClose}>
      <div className="mesa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mesa-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="#f2cc7b" />
            <h2 className="mesa-modal__title">Criar Nova Campanha</h2>
          </div>
          <button
            type="button"
            className="mesa-btn mesa-btn--ghost mesa-btn--icon"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div className="mesa-modal__body">
            {error && <div className="voice-error-banner">{error}</div>}

            <div>
              <label className="mesa-label" htmlFor="camp-name">
                Nome da Campanha
              </label>
              <input
                id="camp-name"
                className="mesa-input"
                type="text"
                placeholder="Ex: A Lâmina de Aethelgard"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
              />
            </div>

            <div>
              <span className="mesa-label">Sistema de RPG</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SYSTEM_OPTIONS.map((sys) => {
                  const selected = systemId === sys.id;
                  return (
                    <button
                      key={sys.id}
                      type="button"
                      onClick={() => setSystemId(sys.id)}
                      style={{
                        textAlign: 'left',
                        padding: '11px 13px',
                        borderRadius: 'var(--radius-sm)',
                        border: selected
                          ? '1px solid var(--gold-400)'
                          : '1px solid var(--border-default)',
                        background: selected ? 'var(--gold-soft)' : 'var(--bg-obsidian)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: selected ? 'var(--gold-400)' : 'var(--text-primary)' }}>
                          {sys.name}
                        </span>
                        <span className={`mesa-badge ${selected ? 'mesa-badge--gold' : ''}`}>
                          <Shield size={11} />
                          {sys.badge}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sys.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mesa-label" htmlFor="camp-desc">
                Sinopse / Descrição
              </label>
              <textarea
                id="camp-desc"
                className="mesa-textarea"
                placeholder="Descreva a premissa, tom e regras da sua mesa..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={400}
              />
            </div>

            <div>
              <span className="mesa-label">Capa da Campanha</span>
              <div className="cover-picker-grid">
                {covers.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`cover-picker-btn ${
                      coverUrl === item.url ? 'cover-picker-btn--selected' : ''
                    }`}
                    onClick={() => setCoverUrl(item.url)}
                  >
                    <img src={item.url} alt={item.name} />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <span className="mesa-label">Visibilidade</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`mesa-btn mesa-btn--sm ${privacy === 'public' ? 'mesa-btn--gold' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setPrivacy('public')}
                  >
                    <Globe size={13} />
                    Pública
                  </button>
                  <button
                    type="button"
                    className={`mesa-btn mesa-btn--sm ${privacy === 'invite_only' ? 'mesa-btn--gold' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setPrivacy('invite_only')}
                  >
                    <Lock size={13} />
                    Convite
                  </button>
                </div>
              </div>

              <div>
                <label className="mesa-label" htmlFor="camp-code">
                  Código (opcional)
                </label>
                <input
                  id="camp-code"
                  className="mesa-input"
                  type="text"
                  placeholder="AUTO (ex: DRAKON)"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  maxLength={12}
                  style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}
                />
              </div>
            </div>
          </div>

          <div className="mesa-modal__footer">
            <button type="button" className="mesa-btn mesa-btn--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="mesa-btn mesa-btn--gold" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={15} className="mesa-spin" />
                  Forjando Mesa...
                </>
              ) : (
                <>
                  <Plus size={15} />
                  Criar e Mestrar
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
