import React, { useState } from 'react';
import { Crown, KeyRound, Loader2, Sword, X } from 'lucide-react';
import { joinCampaign } from '@/lib/api';
import type { Campaign, MemberRole } from '@systems/types';

interface JoinByCodeModalProps {
  open: boolean;
  localAuthEnabled: boolean;
  onClose: () => void;
  onJoined: (campaign: Campaign, role: MemberRole) => void;
}

export function JoinByCodeModal({ open, localAuthEnabled, onClose, onJoined }: JoinByCodeModalProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [desiredRole, setDesiredRole] = useState<MemberRole>('player');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (code.length < 3) {
      setError('Digite o código de convite da campanha (ex: DRAKON).');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await joinCampaign({
        inviteCode: code,
        desiredRole: localAuthEnabled ? desiredRole : 'player',
      });
      onJoined(res.campaign, res.member?.role ?? desiredRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Campanha não encontrada com este código.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mesa-modal-backdrop" onClick={onClose}>
      <div
        className="mesa-modal"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mesa-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={18} color="#f2cc7b" />
            <h2 className="mesa-modal__title">Entrar por Código</h2>
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

        <form onSubmit={handleSubmit}>
          <div className="mesa-modal__body">
            {error && <div className="voice-error-banner">{error}</div>}

            <div>
              <label className="mesa-label" htmlFor="join-invite-code">
                Código da Campanha
              </label>
              <input
                id="join-invite-code"
                className="mesa-input"
                type="text"
                placeholder="Ex: DRAKON"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                maxLength={12}
                autoFocus
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 18,
                  letterSpacing: '0.14em',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                }}
              />
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Mesa demo:</span>
                <button
                  type="button"
                  className="invite-code-btn"
                  onClick={() => setInviteCode('DRAKON')}
                >
                  DRAKON
                </button>
              </div>
            </div>

            {localAuthEnabled && (
              <div>
                <span className="mesa-label">Papel na Mesa</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    className={`mesa-btn ${desiredRole === 'player' ? 'mesa-btn--gold' : ''}`}
                    onClick={() => setDesiredRole('player')}
                  >
                    <Sword size={15} />
                    Jogador
                  </button>
                  <button
                    type="button"
                    className={`mesa-btn ${desiredRole === 'gm' ? 'mesa-btn--gold' : ''}`}
                    onClick={() => setDesiredRole('gm')}
                  >
                    <Crown size={15} />
                    Mestre (GM)
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mesa-modal__footer">
            <button type="button" className="mesa-btn mesa-btn--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="mesa-btn mesa-btn--gold" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={15} className="mesa-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar na Mesa'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
