import React, { useEffect, useRef, useState } from 'react';
import {
  Cloud,
  CloudOff,
  Eye,
  EyeOff,
  Grid3x3,
  Hand,
  Layers,
  Map as MapIcon,
  Maximize2,
  MousePointer2,
  Plus,
  Radio,
  Ruler,
  Upload,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
  MoreHorizontal,
} from 'lucide-react';
import type { MapToolbarProps as BaseMapToolbarProps, MapTool } from '@/lib/componentProps';
import { useCampaignStore } from '@/lib/store';
import {
  FALLBACK_ASSET_MANIFEST,
  fetchAssetManifest,
  type AssetEntry,
  type AssetManifest,
} from '@/lib/api';

export interface MapCameraCommandDetail {
  action: 'zoom_in' | 'zoom_out' | 'fit' | 'toggle_local_grid';
}

export function dispatchMapCameraCommand(action: MapCameraCommandDetail['action']): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MapCameraCommandDetail>('mesa:map-camera', { detail: { action } }));
}

export interface MapToolbarProps extends BaseMapToolbarProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
}

const TOKEN_COLORS = ['#d4a84f', '#22c55e', '#3b82f6', '#ef4444', '#a855f7', '#f97316'];

export const MapToolbar: React.FC<MapToolbarProps> = ({
  activeTool,
  onSelectTool,
  activeLayer,
  onSelectLayer,
  scene,
  isGm,
  compact = false,
  onZoomIn,
  onZoomOut,
  onFitView,
}) => {
  const {
    scenes,
    characters,
    activateScene,
    createScene,
    updateScene,
    createToken,
    updateFog,
    uploadImage,
    pushToast,
  } = useCampaignStore();

  const [manifest, setManifest] = useState<AssetManifest>(FALLBACK_ASSET_MANIFEST);
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [fogMenuOpen, setFogMenuOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [newSceneOpen, setNewSceneOpen] = useState(false);
  const [spawnTokenOpen, setSpawnTokenOpen] = useState(false);

  // New Scene Modal state
  const [sceneName, setSceneName] = useState('');
  const [sceneImageUrl, setSceneImageUrl] = useState(FALLBACK_ASSET_MANIFEST.maps[0].url);
  const [sceneCols, setSceneCols] = useState(24);
  const [sceneRows, setSceneRows] = useState(18);
  const [sceneCellMeters, setSceneCellMeters] = useState(1.5);
  const [sceneStartFog, setSceneStartFog] = useState(false);
  const [uploadingMap, setUploadingMap] = useState(false);
  const [creatingScene, setCreatingScene] = useState(false);
  const mapFileInputRef = useRef<HTMLInputElement | null>(null);

  // Spawn Token Modal state
  const [spawnTab, setSpawnTab] = useState<'characters' | 'custom'>('characters');
  const [customTokenName, setCustomTokenName] = useState('Guarda');
  const [customTokenImg, setCustomTokenImg] = useState(FALLBACK_ASSET_MANIFEST.monsters[0].url);
  const [customTokenHp, setCustomTokenHp] = useState(40);
  const [customTokenSize, setCustomTokenSize] = useState(1);
  const [customTokenColor, setCustomTokenColor] = useState('#ef4444');
  const [customTokenLayer, setCustomTokenLayer] = useState<'tokens' | 'gm'>('tokens');
  const [uploadingTokenImg, setUploadingTokenImg] = useState(false);
  const tokenFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAssetManifest().then((m) => {
      if (active) setManifest(m);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleZoomIn = () => {
    if (onZoomIn) onZoomIn();
    else dispatchMapCameraCommand('zoom_in');
  };

  const handleZoomOut = () => {
    if (onZoomOut) onZoomOut();
    else dispatchMapCameraCommand('zoom_out');
  };

  const handleFitView = () => {
    if (onFitView) onFitView();
    else dispatchMapCameraCommand('fit');
  };

  const handleToggleGrid = () => {
    if (!scene) return;
    if (isGm) {
      void updateScene(scene.id, {
        grid: { ...scene.grid, enabled: !scene.grid.enabled },
      });
    } else {
      dispatchMapCameraCommand('toggle_local_grid');
    }
  };

  const handleToggleFogEnabled = () => {
    if (!scene || !isGm) return;
    const cols = scene.grid.cols || 24;
    const rows = scene.grid.rows || 18;
    const revealed =
      scene.fog.revealedCells && scene.fog.revealedCells.length === cols * rows
        ? scene.fog.revealedCells
        : '1'.repeat(cols * rows);
    void updateScene(scene.id, {
      fog: { enabled: !scene.fog.enabled, revealedCells: revealed },
    });
  };

  const handleSelectPresetMap = (entry: AssetEntry) => {
    setSceneImageUrl(entry.url);
    if (!sceneName.trim()) {
      setSceneName(entry.name);
    }
    if (entry.cols) setSceneCols(entry.cols);
    if (entry.rows) setSceneRows(entry.rows);
  };

  const handleMapFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMap(true);
    try {
      const url = await uploadImage(file);
      if (url) {
        setSceneImageUrl(url);
        if (!sceneName.trim()) {
          setSceneName(file.name.replace(/\.[^.]+$/, ''));
        }
        pushToast('Imagem do mapa enviada com sucesso!', 'success');
      }
    } finally {
      setUploadingMap(false);
      e.target.value = '';
    }
  };

  const handleCreateScene = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = sceneName.trim() || 'Nova Cena';
    setCreatingScene(true);
    try {
      const cols = Math.max(6, Math.min(80, Math.round(sceneCols)));
      const rows = Math.max(6, Math.min(80, Math.round(sceneRows)));
      const created = await createScene({
        name: title,
        imageUrl: sceneImageUrl || FALLBACK_ASSET_MANIFEST.maps[0].url,
        width: 1600,
        height: Math.round((1600 * rows) / cols),
        grid: {
          enabled: true,
          cols,
          rows,
          cellMeters: Math.max(0.5, sceneCellMeters || 1.5),
          color: 'rgba(255,255,255,0.16)',
          snap: true,
        },
        fog: {
          enabled: sceneStartFog,
          revealedCells: (sceneStartFog ? '0' : '1').repeat(cols * rows),
        },
        tokens: [],
        visibility: 'all_players',
      });
      if (created) {
        activateScene(created.id);
        pushToast(`Cena "${created.name}" criada e ativada!`, 'success');
        setNewSceneOpen(false);
        setSceneName('');
      }
    } finally {
      setCreatingScene(false);
    }
  };

  const handleSpawnFromCharacter = (charId: string) => {
    if (!scene) return;
    const ch = characters.find((c) => c.id === charId);
    if (!ch) return;
    const cols = scene.grid.cols || 24;
    const rows = scene.grid.rows || 18;
    const offset = scene.tokens.length % 5;
    const pv = ch.resources?.pv;
    const pm = ch.resources?.pm;
    const color =
      ch.kind === 'pc' ? '#d4a84f' : ch.kind === 'monster' ? '#ef4444' : '#3b82f6';

    createToken(scene.id, {
      characterId: ch.id,
      name: ch.name,
      imageUrl: ch.portraitUrl,
      x: Math.max(0, Math.min(cols - 1, Math.floor(cols / 2) - 2 + offset)),
      y: Math.max(0, Math.min(rows - 1, Math.floor(rows / 2))),
      size: 1,
      rotation: 0,
      color,
      layer: activeLayer,
      showBars: true,
      hp: pv?.current ?? 40,
      hpMax: pv?.max ?? 40,
      mp: pm?.current,
      mpMax: pm?.max,
      conditions: (ch.conditions ?? []).map((c) => c.id),
      controlledByUserIds: ch.controlledByUserIds ?? (ch.ownerUserId ? [ch.ownerUserId] : []),
    });
    pushToast(`Token "${ch.name}" adicionado ao mapa.`, 'success');
    setSpawnTokenOpen(false);
  };

  const handleSpawnCustomToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scene) return;
    const cols = scene.grid.cols || 24;
    const rows = scene.grid.rows || 18;
    const name = customTokenName.trim() || 'Criatura';
    const hpVal = Math.max(1, Math.round(customTokenHp || 30));

    createToken(scene.id, {
      characterId: null,
      name,
      imageUrl: customTokenImg,
      x: Math.max(0, Math.min(cols - customTokenSize, Math.floor(cols / 2))),
      y: Math.max(0, Math.min(rows - customTokenSize, Math.floor(rows / 2))),
      size: customTokenSize,
      rotation: 0,
      color: customTokenColor,
      layer: customTokenLayer,
      showBars: true,
      hp: hpVal,
      hpMax: hpVal,
      conditions: [],
      controlledByUserIds: [],
    });
    pushToast(`Token "${name}" posicionado na cena.`, 'success');
    setSpawnTokenOpen(false);
  };

  const handleTokenFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTokenImg(true);
    try {
      const url = await uploadImage(file);
      if (url) {
        setCustomTokenImg(url);
        pushToast('Imagem do token carregada!', 'success');
      }
    } finally {
      setUploadingTokenImg(false);
      e.target.value = '';
    }
  };

  const tools: Array<{ id: MapTool; label: string; icon: React.ReactNode; gmOnly?: boolean }> = [
    { id: 'select', label: 'Selecionar / Mover', icon: <MousePointer2 size={15} /> },
    { id: 'pan', label: 'Mover Câmera', icon: <Hand size={15} /> },
    { id: 'ruler', label: 'Régua (m)', icon: <Ruler size={15} /> },
    { id: 'ping', label: 'Ping no Mapa', icon: <Radio size={15} /> },
    { id: 'fog_reveal', label: 'Revelar Névoa', icon: <Eye size={15} />, gmOnly: true },
    { id: 'fog_hide', label: 'Ocultar Névoa', icon: <EyeOff size={15} />, gmOnly: true },
  ];

  const visibleTools = tools.filter((t) => !t.gmOnly || isGm);

  const toolBtnStyle = (active: boolean, tint?: 'gold' | 'amethyst' | 'emerald' | 'crimson'): React.CSSProperties => {
    const activeBg =
      tint === 'amethyst'
        ? 'var(--amethyst-soft)'
        : tint === 'emerald'
          ? 'var(--emerald-soft)'
          : tint === 'crimson'
            ? 'var(--crimson-soft)'
            : 'var(--gold-soft)';
    const activeBorder =
      tint === 'amethyst'
        ? 'rgba(192, 132, 252, 0.65)'
        : tint === 'emerald'
          ? 'rgba(74, 222, 128, 0.6)'
          : tint === 'crimson'
            ? 'rgba(248, 113, 113, 0.6)'
            : 'var(--border-gold-strong)';
    const activeColor =
      tint === 'amethyst'
        ? 'var(--amethyst-400)'
        : tint === 'emerald'
          ? 'var(--emerald-400)'
          : tint === 'crimson'
            ? 'var(--crimson-400)'
            : 'var(--gold-400)';

    return {
      minWidth: compact ? 36 : 32,
      height: compact ? 36 : 30,
      padding: '0 7px',
      borderRadius: 'var(--radius-xs)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      fontSize: 12,
      fontWeight: 600,
      background: active ? activeBg : 'transparent',
      border: `1px solid ${active ? activeBorder : 'transparent'}`,
      color: active ? activeColor : 'var(--text-secondary)',
      transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
    };
  };

  const pillContainerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 4,
    borderRadius: 'var(--radius-md)',
    background: 'rgba(12, 16, 24, 0.88)',
    backdropFilter: 'blur(10px)',
    border: '1px solid var(--border-default)',
    boxShadow: 'var(--shadow-md)',
    pointerEvents: 'auto',
  };

  const allArtAssets: AssetEntry[] = [...manifest.monsters, ...manifest.portraits];

  return (
    <>
      {/* Floating Toolbar Overlay */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: compact ? 8 : 10,
          left: compact ? 8 : 10,
          right: compact ? 8 : 10,
          zIndex: 'var(--z-canvas-ui, 15)' as unknown as number,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          pointerEvents: 'none',
        }}
      >
        {/* Left Pill: Drawing/Interaction Tools + GM Layer */}
        <div style={pillContainerStyle}>
          {visibleTools.map((tool) => {
            const tint =
              tool.id === 'fog_reveal'
                ? 'emerald'
                : tool.id === 'fog_hide'
                  ? 'crimson'
                  : 'gold';
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelectTool(tool.id)}
                title={tool.label}
                aria-label={tool.label}
                aria-pressed={activeTool === tool.id}
                style={toolBtnStyle(activeTool === tool.id, tint)}
              >
                {tool.icon}
              </button>
            );
          })}

          {isGm && (
            <>
              <div style={{ width: 1, height: 18, background: 'var(--border-subtle)', margin: '0 2px' }} />

              {/* GM / Player Layer Toggle */}
              <button
                type="button"
                onClick={() => onSelectLayer(activeLayer === 'gm' ? 'tokens' : 'gm')}
                title={
                  activeLayer === 'gm'
                    ? 'Camada do Mestre ativa (tokens ocultos)'
                    : 'Camada de Jogadores ativa'
                }
                style={toolBtnStyle(activeLayer === 'gm', 'amethyst')}
              >
                <Layers size={14} />
                {!compact && <span>{activeLayer === 'gm' ? 'GM' : 'Tokens'}</span>}
              </button>

              {/* Fog of War Quick Controls */}
              {!compact && scene && (
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setFogMenuOpen((v) => !v);
                      setSceneMenuOpen(false);
                    }}
                    title="Configurações da Névoa de Guerra"
                    style={toolBtnStyle(scene.fog.enabled, 'amethyst')}
                  >
                    {scene.fog.enabled ? <Cloud size={14} /> : <CloudOff size={14} />}
                    <span>Névoa</span>
                  </button>
                  {fogMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        minWidth: 190,
                        padding: 6,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-gold)',
                        boxShadow: 'var(--shadow-lg)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        zIndex: 30,
                      }}
                    >
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--sm"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => {
                          handleToggleFogEnabled();
                          setFogMenuOpen(false);
                        }}
                      >
                        {scene.fog.enabled ? <CloudOff size={13} /> : <Cloud size={13} />}
                        <span>{scene.fog.enabled ? 'Desativar Névoa' : 'Ativar Névoa'}</span>
                      </button>
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--sm"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => {
                          updateFog(scene.id, 'reveal_all');
                          setFogMenuOpen(false);
                        }}
                      >
                        <Eye size={13} />
                        <span>Revelar Tudo</span>
                      </button>
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--danger mesa-btn--sm"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => {
                          updateFog(scene.id, 'reset');
                          setFogMenuOpen(false);
                        }}
                      >
                        <EyeOff size={13} />
                        <span>Cobrir Tudo (Reset)</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Pill: Scene Switcher, +Token, Grid & Zoom */}
        <div style={pillContainerStyle}>
          {/* Scene Switcher Dropdown (Desktop) */}
          {!compact && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => {
                  setSceneMenuOpen((v) => !v);
                  setFogMenuOpen(false);
                }}
                title="Trocar ou criar cena tática"
                style={{
                  ...toolBtnStyle(sceneMenuOpen, 'gold'),
                  maxWidth: 175,
                  padding: '0 9px',
                }}
              >
                <MapIcon size={14} style={{ flexShrink: 0, color: 'var(--gold-400)' }} />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--text-primary)',
                  }}
                >
                  {scene?.name ?? 'Cenas'}
                </span>
              </button>

              {sceneMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    minWidth: 230,
                    padding: 6,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-gold)',
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    zIndex: 30,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      padding: '4px 8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Cenas Táticas ({scenes.length})
                  </div>
                  {scenes.map((s) => {
                    const isActive = s.id === scene?.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!isGm && !isActive}
                        onClick={() => {
                          if (isGm) activateScene(s.id);
                          setSceneMenuOpen(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '7px 9px',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: 12,
                          fontWeight: isActive ? 700 : 500,
                          textAlign: 'left',
                          background: isActive ? 'var(--gold-soft)' : 'transparent',
                          color: isActive ? 'var(--gold-400)' : 'var(--text-primary)',
                          border: isActive ? '1px solid var(--border-gold)' : '1px solid transparent',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.name}
                        </span>
                        {isActive && <span className="mesa-badge mesa-badge--gold">Ativa</span>}
                      </button>
                    );
                  })}
                  {isGm && (
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      style={{ marginTop: 4 }}
                      onClick={() => {
                        setSceneMenuOpen(false);
                        setNewSceneOpen(true);
                      }}
                    >
                      <Plus size={13} />
                      <span>Nova Cena</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* + Token Quick Spawner (GM, desktop) */}
          {isGm && !compact && scene && (
            <button
              type="button"
              onClick={() => setSpawnTokenOpen(true)}
              title="Adicionar token ao mapa"
              style={{
                ...toolBtnStyle(false, 'gold'),
                color: 'var(--gold-400)',
              }}
            >
              <UserPlus size={14} />
              <span>Token</span>
            </button>
          )}

          {!compact && (
            <div style={{ width: 1, height: 18, background: 'var(--border-subtle)', margin: '0 2px' }} />
          )}

          {/* Grid toggle */}
          <button
            type="button"
            onClick={handleToggleGrid}
            title="Alternar grade tática"
            aria-label="Alternar grade tática"
            style={toolBtnStyle(Boolean(scene?.grid.enabled), 'gold')}
          >
            <Grid3x3 size={14} />
          </button>

          {/* Zoom Controls */}
          <button
            type="button"
            onClick={handleZoomOut}
            title="Afastar zoom (-)"
            aria-label="Afastar zoom"
            style={toolBtnStyle(false)}
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={handleFitView}
            title="Ajustar mapa à tela (0)"
            aria-label="Ajustar mapa à tela"
            style={toolBtnStyle(false)}
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            title="Aproximar zoom (+)"
            aria-label="Aproximar zoom"
            style={toolBtnStyle(false)}
          >
            <ZoomIn size={14} />
          </button>

          {/* Compact Mobile Overflow Drawer Trigger */}
          {compact && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setMobileMoreOpen((v) => !v)}
                aria-label="Mais opções do mapa"
                style={toolBtnStyle(mobileMoreOpen, 'gold')}
              >
                <MoreHorizontal size={16} />
              </button>

              {mobileMoreOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    width: 224,
                    padding: 8,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-gold)',
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    zIndex: 35,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 4px' }}>
                    CENA ATIVA
                  </div>
                  {scenes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!isGm && s.id !== scene?.id}
                      onClick={() => {
                        if (isGm) activateScene(s.id);
                        setMobileMoreOpen(false);
                      }}
                      className={`mesa-btn mesa-btn--sm ${s.id === scene?.id ? 'mesa-btn--gold' : ''}`}
                      style={{ justifyContent: 'flex-start' }}
                    >
                      <MapIcon size={13} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                    </button>
                  ))}

                  {isGm && (
                    <>
                      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0' }} />
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--gold mesa-btn--sm"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => {
                          setMobileMoreOpen(false);
                          setSpawnTokenOpen(true);
                        }}
                      >
                        <UserPlus size={13} />
                        <span>+ Adicionar Token</span>
                      </button>
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--sm"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => {
                          setMobileMoreOpen(false);
                          setNewSceneOpen(true);
                        }}
                      >
                        <Plus size={13} />
                        <span>+ Nova Cena</span>
                      </button>
                      {scene && (
                        <>
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            style={{ justifyContent: 'flex-start' }}
                            onClick={() => {
                              handleToggleFogEnabled();
                              setMobileMoreOpen(false);
                            }}
                          >
                            {scene.fog.enabled ? <CloudOff size={13} /> : <Cloud size={13} />}
                            <span>{scene.fog.enabled ? 'Desativar Névoa' : 'Ativar Névoa'}</span>
                          </button>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              className="mesa-btn mesa-btn--sm"
                              style={{ flex: 1 }}
                              onClick={() => {
                                updateFog(scene.id, 'reveal_all');
                                setMobileMoreOpen(false);
                              }}
                            >
                              Revelar
                            </button>
                            <button
                              type="button"
                              className="mesa-btn mesa-btn--danger mesa-btn--sm"
                              style={{ flex: 1 }}
                              onClick={() => {
                                updateFog(scene.id, 'reset');
                                setMobileMoreOpen(false);
                              }}
                            >
                              Cobrir
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* "+ Nova Cena" Modal (GM) */}
      {newSceneOpen && (
        <div
          className="mesa-modal-backdrop"
          onClick={() => setNewSceneOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mesa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mesa-modal__header">
              <h3 className="mesa-modal__title font-display">Nova Cena Tática</h3>
              <button
                type="button"
                className="mesa-btn mesa-btn--ghost mesa-btn--icon"
                onClick={() => setNewSceneOpen(false)}
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateScene} style={{ display: 'contents' }}>
              <div className="mesa-modal__body">
                <div>
                  <label className="mesa-label" htmlFor="mesa-new-scene-name">
                    Nome da Cena
                  </label>
                  <input
                    id="mesa-new-scene-name"
                    type="text"
                    className="mesa-input"
                    value={sceneName}
                    onChange={(e) => setSceneName(e.target.value)}
                    placeholder="Ex: Emboscada na Ponte de Pedra"
                    required
                  />
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <label className="mesa-label" style={{ marginBottom: 0 }}>
                      Escolher Mapa Pronto
                    </label>
                    <input
                      ref={mapFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      style={{ display: 'none' }}
                      onChange={handleMapFileUpload}
                    />
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      disabled={uploadingMap}
                      onClick={() => mapFileInputRef.current?.click()}
                    >
                      <Upload size={13} />
                      <span>{uploadingMap ? 'Enviando...' : 'Upload Imagem'}</span>
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 8,
                    }}
                  >
                    {manifest.maps.map((m) => {
                      const selected = sceneImageUrl === m.url;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectPresetMap(m)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            borderRadius: 'var(--radius-sm)',
                            border: `2px solid ${selected ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                            background: 'var(--bg-obsidian)',
                            textAlign: 'left',
                          }}
                        >
                          <img
                            src={m.url}
                            alt={m.name}
                            style={{ width: '100%', height: 78, objectFit: 'cover', display: 'block' }}
                          />
                          <div
                            style={{
                              padding: '6px 8px',
                              fontSize: 12,
                              fontWeight: 600,
                              color: selected ? 'var(--gold-400)' : 'var(--text-primary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {m.name}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                  <div>
                    <label className="mesa-label" htmlFor="mesa-scene-cols">
                      Colunas
                    </label>
                    <input
                      id="mesa-scene-cols"
                      type="number"
                      min={6}
                      max={80}
                      className="mesa-input"
                      value={sceneCols}
                      onChange={(e) => setSceneCols(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="mesa-label" htmlFor="mesa-scene-rows">
                      Linhas
                    </label>
                    <input
                      id="mesa-scene-rows"
                      type="number"
                      min={6}
                      max={80}
                      className="mesa-input"
                      value={sceneRows}
                      onChange={(e) => setSceneRows(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="mesa-label" htmlFor="mesa-scene-meters">
                      Metros/Quad.
                    </label>
                    <input
                      id="mesa-scene-meters"
                      type="number"
                      step={0.5}
                      min={0.5}
                      max={10}
                      className="mesa-input"
                      value={sceneCellMeters}
                      onChange={(e) => setSceneCellMeters(Number(e.target.value))}
                    />
                  </div>
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-obsidian)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sceneStartFog}
                    onChange={(e) => setSceneStartFog(e.target.checked)}
                  />
                  <span style={{ fontSize: 13 }}>
                    Iniciar com <strong>Névoa de Guerra</strong> fechada (Mestre revela conforme exploram)
                  </span>
                </label>
              </div>

              <div className="mesa-modal__footer">
                <button type="button" className="mesa-btn mesa-btn--ghost" onClick={() => setNewSceneOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="mesa-btn mesa-btn--gold" disabled={creatingScene}>
                  <Plus size={15} />
                  <span>{creatingScene ? 'Criando...' : 'Criar e Ativar Cena'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* "+ Token" Quick Spawner Modal (GM) */}
      {spawnTokenOpen && scene && (
        <div
          className="mesa-modal-backdrop"
          onClick={() => setSpawnTokenOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mesa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mesa-modal__header">
              <h3 className="mesa-modal__title font-display">Adicionar Token à Cena</h3>
              <button
                type="button"
                className="mesa-btn mesa-btn--ghost mesa-btn--icon"
                onClick={() => setSpawnTokenOpen(false)}
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mesa-modal__body">
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className={`mesa-btn mesa-btn--sm ${spawnTab === 'characters' ? 'mesa-btn--gold' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setSpawnTab('characters')}
                >
                  Personagens ({characters.length})
                </button>
                <button
                  type="button"
                  className={`mesa-btn mesa-btn--sm ${spawnTab === 'custom' ? 'mesa-btn--gold' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setSpawnTab('custom')}
                >
                  Token Rápido / Monstro
                </button>
              </div>

              {spawnTab === 'characters' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                  {characters.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 18 }}>
                      Nenhum personagem criado ainda. Use a aba &ldquo;Token Rápido&rdquo; para posicionar criaturas.
                    </p>
                  ) : (
                    characters.map((ch) => (
                      <div
                        key={ch.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-obsidian)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <img
                          src={ch.portraitUrl}
                          alt={ch.name}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 'var(--radius-full)',
                            objectFit: 'cover',
                            border: '2px solid var(--border-gold)',
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{ch.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {ch.subtitle || ch.kind.toUpperCase()}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="mesa-btn mesa-btn--gold mesa-btn--sm"
                          onClick={() => handleSpawnFromCharacter(ch.id)}
                        >
                          <Plus size={13} />
                          <span>Colocar</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <form id="mesa-spawn-custom-form" onSubmit={handleSpawnCustomToken} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <label className="mesa-label" htmlFor="mesa-tok-name">Nome</label>
                      <input
                        id="mesa-tok-name"
                        type="text"
                        className="mesa-input"
                        value={customTokenName}
                        onChange={(e) => setCustomTokenName(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="mesa-label" htmlFor="mesa-tok-hp">PV</label>
                      <input
                        id="mesa-tok-hp"
                        type="number"
                        min={1}
                        className="mesa-input"
                        value={customTokenHp}
                        onChange={(e) => setCustomTokenHp(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="mesa-label" htmlFor="mesa-tok-size">Tamanho</label>
                      <select
                        id="mesa-tok-size"
                        className="mesa-select"
                        value={customTokenSize}
                        onChange={(e) => setCustomTokenSize(Number(e.target.value))}
                      >
                        <option value={1}>1×1 (Médio)</option>
                        <option value={2}>2×2 (Grande)</option>
                        <option value={3}>3×3 (Enorme)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label className="mesa-label" style={{ marginBottom: 0 }}>Arte do Token</label>
                      <input
                        ref={tokenFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        style={{ display: 'none' }}
                        onChange={handleTokenFileUpload}
                      />
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--sm"
                        disabled={uploadingTokenImg}
                        onClick={() => tokenFileInputRef.current?.click()}
                      >
                        <Upload size={12} />
                        <span>{uploadingTokenImg ? 'Enviando...' : 'Upload'}</span>
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
                      {allArtAssets.map((art) => {
                        const selected = customTokenImg === art.url;
                        return (
                          <button
                            key={art.id}
                            type="button"
                            onClick={() => {
                              setCustomTokenImg(art.url);
                              setCustomTokenName(art.name);
                            }}
                            style={{
                              padding: 4,
                              borderRadius: 'var(--radius-sm)',
                              border: `2px solid ${selected ? 'var(--gold-400)' : 'var(--border-subtle)'}`,
                              background: 'var(--bg-obsidian)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <img
                              src={art.url}
                              alt={art.name}
                              style={{ width: 42, height: 42, borderRadius: 'var(--radius-full)', objectFit: 'cover' }}
                            />
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                              {art.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mesa-label" style={{ marginBottom: 0 }}>Borda:</span>
                      {TOKEN_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setCustomTokenColor(hex)}
                          aria-label={`Cor ${hex}`}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 'var(--radius-full)',
                            background: hex,
                            border: customTokenColor === hex ? '2px solid #fff' : '2px solid transparent',
                          }}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      className="mesa-btn mesa-btn--sm"
                      onClick={() => setCustomTokenLayer((l) => (l === 'gm' ? 'tokens' : 'gm'))}
                      style={{
                        borderColor: customTokenLayer === 'gm' ? 'rgba(192,132,252,0.6)' : undefined,
                        color: customTokenLayer === 'gm' ? 'var(--amethyst-400)' : undefined,
                      }}
                    >
                      {customTokenLayer === 'gm' ? <EyeOff size={13} /> : <Eye size={13} />}
                      <span>{customTokenLayer === 'gm' ? 'Oculto (GM)' : 'Visível'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            {spawnTab === 'custom' && (
              <div className="mesa-modal__footer">
                <button type="button" className="mesa-btn mesa-btn--ghost" onClick={() => setSpawnTokenOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" form="mesa-spawn-custom-form" className="mesa-btn mesa-btn--gold">
                  <UserPlus size={14} />
                  <span>Adicionar ao Mapa</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default MapToolbar;
