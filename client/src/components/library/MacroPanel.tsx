import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Edit3,
  Play,
  Plus,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { getSystemEngine } from '@systems/registry';
import { runMacro } from '@systems/sandbox';
import type { Macro, MacroCommand, MacroResult, Visibility } from '@systems/types';
import { useCampaignStore } from '@/lib/store';

export interface MacroPanelProps {
  compact?: boolean;
}

const MACRO_EXAMPLES = [
  {
    name: 'Ataque Poderoso (MB 3e)',
    color: '#ef4444',
    script: `// Gasta 10 PM e realiza ataque com +6 de dano
spendPM(10);
say("Desfere um golpe esmagador!");
roll("2d6 + @forca", "Ataque Poderoso", { difficulty: @target.bloqueio || 10 });`,
  },
  {
    name: 'Bola de Fogo (MB 3e)',
    color: '#f59e0b',
    script: `spendPM(15);
narrate("Uma esfera flamejante irrompe no campo de batalha!");
roll("2d6 + @inteligencia", "Bola de Fogo", { difficulty: 12 });`,
  },
  {
    name: 'Poção de Cura Rápida',
    color: '#22c55e',
    script: `heal(20, "self");
say("Bebe rapidamente uma Poção de Cura (+20 PV)!");`,
  },
  {
    name: 'Teste d20 Genérico',
    color: '#3b82f6',
    script: `let bonus = @fisico || @forca || 2;
roll("1d20 + " + bonus, "Teste de Ação (Genérico)", { difficulty: 12 });`,
  },
];

const COLOR_SWATCHES = ['#d4a84f', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#f59e0b'];

export function MacroPanel({ compact = false }: MacroPanelProps) {
  const {
    campaign,
    macros,
    activeCharacter,
    targetCharacter,
    user,
    isGm,
    rollDice,
    sendChat,
    patchCharacter,
    upsertMacro,
    deleteMacro,
    pushToast,
  } = useCampaignStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#d4a84f');
  const [visibility, setVisibility] = useState<Visibility>('all_players');
  const [script, setScript] = useState(MACRO_EXAMPLES[0].script);
  const [testResult, setTestResult] = useState<MacroResult | null>(null);

  const engine = useMemo(
    () => getSystemEngine(campaign?.systemId ?? 'mighty-blade-3e'),
    [campaign?.systemId]
  );

  const executeCommands = (commands: MacroCommand[]) => {
    for (const cmd of commands) {
      if (cmd.type === 'roll') {
        rollDice({
          formula: cmd.formula,
          label: cmd.label,
          characterId: activeCharacter?.id,
          visibility: cmd.visibility ?? 'all_players',
          difficulty: cmd.difficulty,
          targetCharacterId: targetCharacter?.id,
          systemMeta: cmd.meta,
        });
      } else if (cmd.type === 'roll_attack' && activeCharacter) {
        const plan = engine.planAttack(activeCharacter, cmd.weaponId ?? '', targetCharacter ?? undefined);
        rollDice({
          formula: cmd.bonus ? `${plan.formula} + ${cmd.bonus}` : plan.formula,
          label: plan.label,
          characterId: activeCharacter.id,
          targetCharacterId: plan.targetCharacterId,
          targetDefense: plan.targetDefense,
          systemMeta: plan.systemMeta,
        });
      } else if (cmd.type === 'roll_ability' && activeCharacter) {
        const plan = engine.planAbility(activeCharacter, cmd.abilityId, targetCharacter ?? undefined);
        if (plan.manaCost && plan.manaCost > 0) {
          const spendRes = engine.spendMana(activeCharacter, plan.manaCost);
          if (spendRes.error) {
            pushToast(spendRes.error, 'error');
            continue;
          }
          if (spendRes.patch) patchCharacter(activeCharacter.id, spendRes.patch);
        }
        rollDice({
          formula: plan.formula,
          label: plan.label,
          characterId: activeCharacter.id,
          difficulty: plan.difficulty,
          targetCharacterId: plan.targetCharacterId,
          targetDefense: plan.targetDefense,
          systemMeta: { ...plan.systemMeta, manaAlreadySpent: Boolean(plan.manaCost) },
        });
      } else if (cmd.type === 'roll_spell' && activeCharacter) {
        const plan = engine.planSpell(activeCharacter, cmd.spellId, targetCharacter ?? undefined);
        if (plan.manaCost && plan.manaCost > 0) {
          const spendRes = engine.spendMana(activeCharacter, plan.manaCost);
          if (spendRes.error) {
            pushToast(spendRes.error, 'error');
            continue;
          }
          if (spendRes.patch) patchCharacter(activeCharacter.id, spendRes.patch);
        }
        rollDice({
          formula: plan.formula,
          label: plan.label,
          characterId: activeCharacter.id,
          difficulty: plan.difficulty,
          targetCharacterId: plan.targetCharacterId,
          targetDefense: plan.targetDefense,
          systemMeta: { ...plan.systemMeta, manaAlreadySpent: Boolean(plan.manaCost) },
        });
      } else if (cmd.type === 'spend' && activeCharacter) {
        if (cmd.resource === 'pm' || cmd.resource === 'mp') {
          const res = engine.spendMana(activeCharacter, cmd.amount);
          if (res.error) {
            pushToast(res.error, 'error');
          } else if (res.patch) {
            patchCharacter(activeCharacter.id, res.patch);
          }
        } else {
          const bar = activeCharacter.resources?.[cmd.resource];
          if (bar) {
            patchCharacter(activeCharacter.id, {
              resources: {
                ...activeCharacter.resources,
                [cmd.resource]: { ...bar, current: Math.max(0, bar.current - cmd.amount) },
              },
            });
          }
        }
      } else if (cmd.type === 'heal') {
        const dest = cmd.target === 'target' ? targetCharacter : activeCharacter;
        if (dest) {
          patchCharacter(dest.id, engine.applyHealing(dest, cmd.amount));
          pushToast(`${dest.name} recuperou ${cmd.amount} PV.`, 'success');
        }
      } else if (cmd.type === 'damage') {
        const dest = cmd.target === 'self' ? activeCharacter : targetCharacter ?? activeCharacter;
        if (dest) {
          patchCharacter(dest.id, engine.applyDamage(dest, cmd.amount, cmd.damageType));
          pushToast(`${dest.name} sofreu ${cmd.amount} de dano.`, 'info');
        }
      } else if (cmd.type === 'condition') {
        const dest = cmd.target === 'self' ? activeCharacter : targetCharacter ?? activeCharacter;
        if (dest) {
          patchCharacter(dest.id, engine.applyCondition(dest, cmd.conditionId, cmd.rounds));
          pushToast(`Condição ${cmd.conditionId} aplicada em ${dest.name}.`, 'info');
        }
      } else if (cmd.type === 'chat') {
        sendChat({
          kind: cmd.kind,
          content: cmd.content,
          characterId: cmd.kind === 'ic' ? activeCharacter?.id : undefined,
        });
      }
    }
  };

  const handleRunMacro = (macro: Macro) => {
    const res = runMacro(macro.script, {
      character: activeCharacter ?? undefined,
      target: targetCharacter ?? undefined,
      user,
    });
    if (!res.ok) {
      pushToast(`Erro na macro "${macro.name}": ${res.error}`, 'error');
      return;
    }
    if (res.commands.length === 0) {
      pushToast(
        `Macro "${macro.name}" executada (resultado: ${String(res.value ?? 'ok')}).`,
        'info'
      );
      return;
    }
    executeCommands(res.commands);
  };

  const openNewEditor = () => {
    setEditingId(undefined);
    setName('');
    setColor('#d4a84f');
    setVisibility('all_players');
    setScript(MACRO_EXAMPLES[0].script);
    setTestResult(null);
    setEditorOpen(true);
  };

  const openEditEditor = (macro: Macro) => {
    setEditingId(macro.id);
    setName(macro.name);
    setColor(macro.color || '#d4a84f');
    setVisibility(macro.visibility);
    setScript(macro.script);
    setTestResult(null);
    setEditorOpen(true);
  };

  const handleTestSandbox = () => {
    const res = runMacro(script, {
      character: activeCharacter ?? undefined,
      target: targetCharacter ?? undefined,
      user,
    });
    setTestResult(res);
  };

  const handleSaveMacro = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast('Digite um nome para a macro.', 'warning');
      return;
    }
    const dryRun = runMacro(script, {
      character: activeCharacter ?? undefined,
      target: targetCharacter ?? undefined,
      user,
    });
    if (!dryRun.ok) {
      setTestResult(dryRun);
      pushToast(`Corrija o script antes de salvar: ${dryRun.error}`, 'error');
      return;
    }
    await upsertMacro({
      id: editingId,
      name: trimmed,
      color,
      icon: 'zap',
      scope: 'campaign',
      visibility: isGm ? visibility : 'all_players',
      script,
    });
    pushToast(editingId ? 'Macro atualizada!' : `Macro "${trimmed}" criada!`, 'success');
    setEditorOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Sandbox seguro (zero <code style={{ color: 'var(--gold-400)' }}>eval</code>)
        </div>
        <button
          type="button"
          className="mesa-btn mesa-btn--gold mesa-btn--sm"
          onClick={openNewEditor}
        >
          <Plus size={13} />
          Nova Macro
        </button>
      </div>

      {/* Macro Grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        {macros.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 12px',
              color: 'var(--text-muted)',
              fontSize: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Code2 size={24} style={{ color: 'var(--gold-500)', opacity: 0.55 }} />
            <span>Nenhuma macro criada ainda.</span>
            <button
              type="button"
              className="mesa-btn mesa-btn--sm"
              onClick={openNewEditor}
            >
              <Sparkles size={13} /> Criar Macro com Exemplos
            </button>
          </div>
        )}

        {macros.map((macro) => {
          const canManage = isGm || macro.createdBy === user.id;
          return (
            <div
              key={macro.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderLeft: `4px solid ${macro.color || '#d4a84f'}`,
                borderRadius: 'var(--radius-sm)',
                padding: compact ? '6px 8px' : '5px 8px',
              }}
            >
              <button
                type="button"
                onClick={() => handleRunMacro(macro)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left',
                  padding: '4px 2px',
                  minHeight: compact ? 38 : 30,
                }}
              >
                <Zap size={14} style={{ color: macro.color || 'var(--gold-400)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {macro.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {macro.script.split('\n').find((l) => l.trim() && !l.trim().startsWith('//')) ??
                      macro.script}
                  </div>
                </div>
                <Play size={13} style={{ color: 'var(--emerald-400)', flexShrink: 0 }} />
              </button>

              {canManage && (
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    title="Editar macro"
                    onClick={() => openEditEditor(macro)}
                    style={{ padding: 5, color: 'var(--text-muted)' }}
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    type="button"
                    title="Excluir macro"
                    onClick={() => void deleteMacro(macro.id)}
                    style={{ padding: 5, color: 'var(--crimson-400)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Macro Script Editor Modal */}
      {editorOpen && (
        <div className="mesa-modal-backdrop" onClick={() => setEditorOpen(false)}>
          <div
            className="mesa-modal"
            style={{ maxWidth: 640 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mesa-modal__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Code2 size={18} style={{ color: 'var(--gold-400)' }} />
                <h3 className="mesa-modal__title">
                  {editingId ? 'Editar Macro & Script' : 'Novo Script / Macro (Sandbox)'}
                </h3>
              </div>
              <button
                type="button"
                className="mesa-btn mesa-btn--ghost mesa-btn--icon"
                onClick={() => setEditorOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mesa-modal__body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                <div>
                  <label className="mesa-label">Nome da Macro</label>
                  <input
                    type="text"
                    className="mesa-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Golpe Sagrado, Bola de Fogo..."
                  />
                </div>
                <div>
                  <label className="mesa-label">Cor</label>
                  <div style={{ display: 'flex', gap: 5, paddingTop: 4 }}>
                    {COLOR_SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        onClick={() => setColor(swatch)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: swatch,
                          border: color === swatch ? '2px solid #fff' : '2px solid transparent',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {isGm && (
                <div>
                  <label className="mesa-label">Visibilidade</label>
                  <select
                    className="mesa-select"
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as Visibility)}
                  >
                    <option value="all_players">🌐 Todos os Jogadores</option>
                    <option value="gm_only">🔒 Só Mestre</option>
                  </select>
                </div>
              )}

              <div>
                <label className="mesa-label">Modelos Prontos (clique para carregar)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {MACRO_EXAMPLES.map((ex) => (
                    <button
                      key={ex.name}
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      onClick={() => {
                        setScript(ex.script);
                        if (!name.trim()) setName(ex.name);
                        setColor(ex.color);
                        setTestResult(null);
                      }}
                    >
                      {ex.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mesa-label">Script (AST Sandbox)</label>
                <textarea
                  className="mesa-textarea"
                  rows={7}
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5 }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                  Variáveis: <code>@forca</code>, <code>@agilidade</code>, <code>@inteligencia</code>,{' '}
                  <code>@vontade</code>, <code>@target.bloqueio</code> · Funções:{' '}
                  <code>roll()</code>, <code>spendPM()</code>, <code>heal()</code>,{' '}
                  <code>damage()</code>, <code>condition()</code>, <code>say()</code>,{' '}
                  <code>narrate()</code>
                </div>
              </div>

              {/* Live Sandbox Test Runner Output */}
              {testResult && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    background: testResult.ok
                      ? 'rgba(34, 197, 94, 0.1)'
                      : 'rgba(239, 68, 68, 0.12)',
                    border: `1px solid ${
                      testResult.ok ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.45)'
                    }`,
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                    {testResult.ok ? (
                      <>
                        <CheckCircle2 size={14} style={{ color: 'var(--emerald-400)' }} />
                        <span style={{ color: 'var(--emerald-400)' }}>
                          Sandbox OK · {testResult.commands.length} comando(s) · {testResult.stepsUsed} passos
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={14} style={{ color: 'var(--crimson-400)' }} />
                        <span style={{ color: 'var(--crimson-400)' }}>{testResult.error}</span>
                      </>
                    )}
                  </div>
                  {testResult.ok && testResult.commands.length > 0 && (
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {JSON.stringify(testResult.commands, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>

            <div className="mesa-modal__footer" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="mesa-btn"
                onClick={handleTestSandbox}
              >
                <Play size={14} />
                Testar no Sandbox
              </button>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--ghost"
                  onClick={() => setEditorOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold"
                  onClick={() => void handleSaveMacro()}
                >
                  <Save size={14} />
                  Salvar Macro
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MacroPanel;
