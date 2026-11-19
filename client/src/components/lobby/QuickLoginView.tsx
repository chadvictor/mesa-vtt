import React, { useEffect, useState } from 'react';
import { Loader2, Shield, Sparkles } from 'lucide-react';
import {
  FALLBACK_ASSET_MANIFEST,
  authLocal,
  fetchAssetManifest,
  type AssetEntry,
} from '@/lib/api';
import type { UserIdentity } from '@systems/types';

interface QuickLoginViewProps {
  onAuthenticated: (token: string, user: UserIdentity) => void;
  ssoLoading?: boolean;
  ssoError?: string | null;
  localAuthEnabled: boolean;
}

export function QuickLoginView({
  onAuthenticated,
  ssoLoading = false,
  ssoError = null,
  localAuthEnabled,
}: QuickLoginViewProps) {
  const [displayName, setDisplayName] = useState(() => {
    try {
      return localStorage.getItem('mesa_vtt_last_name') || '';
    } catch {
      return '';
    }
  });
  const [portraits, setPortraits] = useState<AssetEntry[]>(FALLBACK_ASSET_MANIFEST.portraits);
  const [selectedAvatar, setSelectedAvatar] = useState<string>(
    FALLBACK_ASSET_MANIFEST.portraits[0].url
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(ssoError);

  useEffect(() => {
    setError(ssoError);
  }, [ssoError]);

  useEffect(() => {
    void fetchAssetManifest().then((m) => {
      if (m.portraits.length > 0) {
        setPortraits(m.portraits);
        setSelectedAvatar((prev) => prev || m.portraits[0].url);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError('Digite seu nome de aventureiro ou mestre.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await authLocal({
        displayName: trimmed,
        avatarUrl: selectedAvatar,
      });
      try {
        localStorage.setItem('mesa_vtt_last_name', trimmed);
      } catch {
        // Ignore
      }
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível iniciar sessão local. Verifique se o servidor está ativo.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (ssoLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-card__body" style={{ alignItems: 'center', padding: '42px 24px' }}>
            <Loader2 size={32} className="mesa-spin" color="#f2cc7b" />
            <h2 className="font-display" style={{ color: 'var(--gold-400)', fontSize: 20 }}>
              Conectando ao Mesa VTT...
            </h2>
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: 13 }}>
              Validando sua sessão e preparando a mesa virtual.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__banner">
          <img src="./assets/banner-mesa-rpg.svg" alt="Mesa VTT" />
          <div className="login-card__banner-overlay">
            <h1 className="login-card__title">Mesa VTT</h1>
            <p className="login-card__subtitle">
              RPG de mesa online open source · Mapa tático · Dados 3D · Voz integrada
            </p>
          </div>
        </div>

        <form className="login-card__body" onSubmit={handleSubmit}>
          {error && (
            <div className="voice-error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}

          {!localAuthEnabled && (
            <div className="voice-error-banner">
              <span>
                Esta instância utiliza autenticação SSO externa (AUTH_MODE=sso). Acesse o Mesa VTT
                a partir do seu provedor de identidade.
              </span>
            </div>
          )}

          <div>
            <label className="mesa-label" htmlFor="mesa-login-name">
              Seu Nome na Mesa
            </label>
            <input
              id="mesa-login-name"
              className="mesa-input"
              type="text"
              placeholder="Ex: Mestre Aldric, Lyra, Thorin..."
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
              autoFocus
              disabled={!localAuthEnabled || submitting}
            />
          </div>

          <div>
            <span className="mesa-label">Escolha seu Retrato</span>
            <div className="avatar-picker-grid">
              {portraits.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`avatar-picker-btn ${
                    selectedAvatar === p.url ? 'avatar-picker-btn--selected' : ''
                  }`}
                  onClick={() => setSelectedAvatar(p.url)}
                  title={p.name}
                >
                  <img src={p.url} alt={p.name} />
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="mesa-btn mesa-btn--gold"
            style={{ width: '100%', minHeight: 44, fontSize: 14 }}
            disabled={!localAuthEnabled || submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="mesa-spin" />
                Entrando na Taverna...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Entrar no Salão de Campanhas
              </>
            )}
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <Shield size={13} />
            <span>Mighty Blade 3ª Edição + RPG Genérico · Pronto para desktop e celular</span>
          </div>
        </form>
      </div>
    </div>
  );
}
