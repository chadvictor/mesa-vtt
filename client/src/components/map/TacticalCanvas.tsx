import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { Character, Scene, Token } from '@systems/types';
import type { TacticalCanvasProps } from '@/lib/componentProps';
import { useCampaignStore } from '@/lib/store';
import conditionsData from '@data/mighty-blade/conditions.json';
import { TokenPopover } from './TokenPopover';
import type { MapCameraCommandDetail } from './MapToolbar';

interface ConditionMeta {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

const CONDITION_MAP = new Map<string, ConditionMeta>(
  (conditionsData as ConditionMeta[]).map((c) => [c.id, c])
);

interface CameraState {
  x: number;
  y: number;
  scale: number;
}

interface RulerState {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
  startWorldX: number;
  startWorldY: number;
  endWorldX: number;
  endWorldY: number;
}

interface DragTokenState {
  tokenId: string;
  offsetWorldX: number;
  offsetWorldY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
  lastSentMs: number;
}

const MIN_SCALE = 0.22;
const MAX_SCALE = 4.2;
const PING_DURATION_MS = 3000;

function formatMetersPtBr(meters: number): string {
  return meters.toLocaleString('pt-BR', {
    minimumFractionDigits: meters % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export const TacticalCanvas: React.FC<TacticalCanvasProps> = ({
  scene,
  activeTool,
  activeLayer,
  selectedTokenId,
  onSelectToken,
  onOpenCharacterSheet,
  isGm,
  pings,
  compact = false,
}) => {
  const {
    user,
    characters,
    combat,
    moveToken,
    updateFog,
    sendMapPing,
    deleteToken,
  } = useCampaignStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport camera stored in ref for 60fps interaction without React re-render overhead
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef<{ width: number; height: number }>({ width: 800, height: 600 });
  const fittedSceneIdRef = useRef<string | null>(null);

  // Image cache shared across redraws
  const imageCacheRef = useRef<Map<string, HTMLImageElement | 'loading' | 'error'>>(new Map());

  // Interaction refs
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    lastDist: number;
    lastMidX: number;
    lastMidY: number;
  } | null>(null);
  const panStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    camStartX: number;
    camStartY: number;
    moved: boolean;
  } | null>(null);
  const dragTokenRef = useRef<DragTokenState | null>(null);
  const rulerRef = useRef<RulerState | null>(null);
  const fogBrushRef = useRef<{
    pointerId: number;
    mode: 'reveal' | 'hide';
    pendingCells: Set<number>;
    paintedCells: Set<number>;
    lastFlushMs: number;
  } | null>(null);
  const hoverCellRef = useRef<{ col: number; row: number } | null>(null);
  const lastTapRef = useRef<{ tokenId: string; timeMs: number } | null>(null);
  const spacePressedRef = useRef(false);

  // Optimistic local fog preview overrides while dragging the GM brush
  const optimisticFogRef = useRef<{ sceneId: string; cells: Map<number, '0' | '1'> }>({
    sceneId: '',
    cells: new Map(),
  });

  // Lightweight React state for HUD zoom indicator, local player grid override & popover anchor sync
  const [zoomPercent, setZoomPercent] = useState(100);
  const [localGridOverride, setLocalGridOverride] = useState<boolean | null>(null);
  const [popoverTick, setPopoverTick] = useState(0);

  // Quick lookup map for characters by id
  const characterById = useMemo(() => {
    const map = new Map<string, Character>();
    for (const ch of characters) {
      map.set(ch.id, ch);
    }
    return map;
  }, [characters]);

  // Clear optimistic fog overrides whenever authoritative scene fog changes
  useEffect(() => {
    if (scene) {
      optimisticFogRef.current = { sceneId: scene.id, cells: new Map() };
    }
  }, [scene?.id, scene?.fog.revealedCells, scene?.fog.enabled]);

  // Helper to check if current user can drag/control a given token
  const canControlToken = useCallback(
    (token: Token): boolean => {
      if (isGm) return true;
      if (token.layer === 'gm') return false;
      if (token.controlledByUserIds?.includes(user.id)) return true;
      if (token.characterId) {
        const ch = characterById.get(token.characterId);
        if (ch) {
          if (ch.ownerUserId === user.id || ch.controlledByUserIds?.includes(user.id)) {
            return true;
          }
          // Allow controlling unclaimed PCs in demo/open campaigns when no specific controller is locked
          if (
            ch.kind === 'pc' &&
            !ch.ownerUserId &&
            (ch.controlledByUserIds?.length ?? 0) === 0 &&
            (token.controlledByUserIds?.length ?? 0) === 0
          ) {
            return true;
          }
        }
      }
      return false;
    },
    [isGm, user.id, characterById]
  );

  // Active combatant lookup for animated turn highlight ring
  const activeCombatant = useMemo(() => {
    if (!combat.active || combat.combatants.length === 0) return null;
    return combat.combatants[combat.turnIndex] ?? null;
  }, [combat]);

  const getSceneDims = useCallback((s: Scene) => {
    const mapW = s.width > 0 ? s.width : 1600;
    const mapH = s.height > 0 ? s.height : 1200;
    const cols = Math.max(1, s.grid.cols || 24);
    const rows = Math.max(1, s.grid.rows || 18);
    return {
      mapW,
      mapH,
      cols,
      rows,
      cellW: mapW / cols,
      cellH: mapH / rows,
    };
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current;
    return {
      x: (sx - cam.x) / cam.scale,
      y: (sy - cam.y) / cam.scale,
    };
  }, []);

  const worldToScreen = useCallback((wx: number, wy: number) => {
    const cam = cameraRef.current;
    return {
      x: wx * cam.scale + cam.x,
      y: wy * cam.scale + cam.y,
    };
  }, []);

  // Request redraw via RAF coalescing
  const needsDrawRef = useRef(true);
  const drawFrameRef = useRef<() => void>(() => {});

  const requestDraw = useCallback(() => {
    needsDrawRef.current = true;
  }, []);

  const fitToView = useCallback(() => {
    if (!scene) return;
    const { width, height } = viewportRef.current;
    if (width <= 0 || height <= 0) return;
    const { mapW, mapH } = getSceneDims(scene);
    const padding = compact ? 16 : 36;
    const availW = Math.max(60, width - padding * 2);
    const availH = Math.max(60, height - padding * 2);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(availW / mapW, availH / mapH)));
    cameraRef.current = {
      scale,
      x: (width - mapW * scale) / 2,
      y: (height - mapH * scale) / 2,
    };
    setZoomPercent(Math.round(scale * 100));
    setPopoverTick((t) => t + 1);
    requestDraw();
  }, [scene, compact, getSceneDims, requestDraw]);

  const zoomAt = useCallback(
    (factor: number, screenX?: number, screenY?: number) => {
      const { width, height } = viewportRef.current;
      const cx = screenX ?? width / 2;
      const cy = screenY ?? height / 2;
      const cam = cameraRef.current;
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * factor));
      if (Math.abs(nextScale - cam.scale) < 0.0001) return;
      const wx = (cx - cam.x) / cam.scale;
      const wy = (cy - cam.y) / cam.scale;
      cameraRef.current = {
        scale: nextScale,
        x: cx - wx * nextScale,
        y: cy - wy * nextScale,
      };
      setZoomPercent(Math.round(nextScale * 100));
      setPopoverTick((t) => t + 1);
      requestDraw();
    },
    [requestDraw]
  );

  // Fit view automatically whenever active scene changes
  useEffect(() => {
    if (scene && fittedSceneIdRef.current !== scene.id) {
      fittedSceneIdRef.current = scene.id;
      setLocalGridOverride(null);
      fitToView();
    }
  }, [scene, fitToView]);

  // Listen to camera commands from MapToolbar (zoom_in / zoom_out / fit / toggle_local_grid)
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<MapCameraCommandDetail>).detail;
      if (!detail) return;
      if (detail.action === 'zoom_in') zoomAt(1.22);
      else if (detail.action === 'zoom_out') zoomAt(1 / 1.22);
      else if (detail.action === 'fit') fitToView();
      else if (detail.action === 'toggle_local_grid') {
        setLocalGridOverride((prev) => {
          const base = scene?.grid.enabled ?? true;
          return prev === null ? !base : !prev;
        });
      }
    };
    window.addEventListener('mesa:map-camera', handler);
    return () => window.removeEventListener('mesa:map-camera', handler);
  }, [zoomAt, fitToView, scene?.grid.enabled]);

  // Keyboard shortcuts (Space pan, +/-/0 zoom, Escape deselect, Delete/Backspace GM delete token)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        spacePressedRef.current = true;
      } else if (e.key === '=' || e.key === '+') {
        zoomAt(1.18);
      } else if (e.key === '-') {
        zoomAt(1 / 1.18);
      } else if (e.key === '0') {
        fitToView();
      } else if (e.key === 'Escape') {
        onSelectToken(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && isGm && scene && selectedTokenId) {
        deleteToken(scene.id, selectedTokenId);
        onSelectToken(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressedRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [zoomAt, fitToView, isGm, scene, selectedTokenId, deleteToken, onSelectToken]);

  // Helper to fetch/cache an HTMLImageElement cleanly
  const getCachedImage = useCallback(
    (url: string | undefined): HTMLImageElement | null => {
      if (!url) return null;
      const cache = imageCacheRef.current;
      const entry = cache.get(url);
      if (entry instanceof HTMLImageElement) return entry;
      if (entry === 'loading' || entry === 'error') return null;

      cache.set(url, 'loading');
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        cache.set(url, img);
        requestDraw();
      };
      img.onerror = () => {
        cache.set(url, 'error');
        requestDraw();
      };
      img.src = url;
      return null;
    },
    [requestDraw]
  );

  const isCellRevealed = useCallback(
    (s: Scene, col: number, row: number): boolean => {
      if (!s.fog.enabled) return true;
      const cols = Math.max(1, s.grid.cols || 24);
      const rows = Math.max(1, s.grid.rows || 18);
      if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
      const idx = row * cols + col;
      if (optimisticFogRef.current.sceneId === s.id) {
        const override = optimisticFogRef.current.cells.get(idx);
        if (override !== undefined) return override === '1';
      }
      const bits = s.fog.revealedCells;
      if (!bits || idx >= bits.length) return false;
      return bits[idx] === '1';
    },
    []
  );

  // Main High-DPI 2D Canvas renderer
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = viewportRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Deep obsidian tabletop backdrop
    ctx.fillStyle = '#080b10';
    ctx.fillRect(0, 0, width, height);

    if (!scene) {
      ctx.restore();
      return;
    }

    const now = performance.now();
    const { mapW, mapH, cols, rows, cellW, cellH } = getSceneDims(scene);
    const cam = cameraRef.current;
    const showGrid = localGridOverride !== null ? localGridOverride : scene.grid.enabled;

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.scale, cam.scale);

    // 2. Map outer drop shadow & parchment frame
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 32 / cam.scale;
    ctx.fillStyle = '#12161f';
    ctx.fillRect(0, 0, mapW, mapH);
    ctx.restore();

    // 3. Battlemap Image
    const mapImg = getCachedImage(scene.imageUrl);
    if (mapImg) {
      ctx.drawImage(mapImg, 0, 0, mapW, mapH);
    } else {
      // Subtle textured fallback while loading
      const bgGrad = ctx.createLinearGradient(0, 0, mapW, mapH);
      bgGrad.addColorStop(0, '#161b26');
      bgGrad.addColorStop(1, '#0f131b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, mapW, mapH);
    }

    // 4. Tactical Square Grid
    if (showGrid) {
      ctx.save();
      ctx.strokeStyle = scene.grid.color || 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = Math.max(0.75, 1 / cam.scale);
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const x = c * cellW;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mapH);
      }
      for (let r = 0; r <= rows; r++) {
        const y = r * cellH;
        ctx.moveTo(0, y);
        ctx.lineTo(mapW, y);
      }
      ctx.stroke();

      // Subtle coordinate labels along edges when zoomed closely enough
      if (cellW * cam.scale >= 34) {
        ctx.fillStyle = 'rgba(242, 204, 123, 0.34)';
        ctx.font = `600 ${Math.max(10, 11 / cam.scale)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let c = 0; c < cols; c++) {
          const label = c < 26 ? String.fromCharCode(65 + c) : String(c + 1);
          ctx.fillText(label, (c + 0.5) * cellW, 4 / cam.scale);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let r = 0; r < rows; r++) {
          ctx.fillText(String(r + 1), 4 / cam.scale, (r + 0.5) * cellH);
        }
      }
      ctx.restore();
    }

    // 5. Tokens (ordered: regular tokens first, then GM tokens if GM, then selected/dragging on top)
    const drag = dragTokenRef.current;
    const sortedTokens = [...scene.tokens].sort((a, b) => {
      if (drag?.tokenId === a.id) return 1;
      if (drag?.tokenId === b.id) return -1;
      if (a.id === selectedTokenId) return 1;
      if (b.id === selectedTokenId) return -1;
      if (a.layer !== b.layer) return a.layer === 'gm' ? 1 : -1;
      return 0;
    });

    for (const token of sortedTokens) {
      // GM-only tokens never render for players
      if (token.layer === 'gm' && !isGm) continue;

      const drawX = drag?.tokenId === token.id ? drag.currentX : token.x;
      const drawY = drag?.tokenId === token.id ? drag.currentY : token.y;
      const tokenSize = Math.max(1, token.size || 1);

      // Hide tokens standing inside unrevealed fog cells for players
      if (!isGm && scene.fog.enabled) {
        const centerCol = Math.floor(drawX + tokenSize / 2);
        const centerRow = Math.floor(drawY + tokenSize / 2);
        if (!isCellRevealed(scene, centerCol, centerRow)) continue;
      }

      const cx = (drawX + tokenSize / 2) * cellW;
      const cy = (drawY + tokenSize / 2) * cellH;
      const diameter = Math.min(cellW, cellH) * tokenSize * 0.88;
      const radius = diameter / 2;

      const linkedChar = token.characterId ? characterById.get(token.characterId) ?? null : null;
      const isSelected = token.id === selectedTokenId;
      const isGmOnlyToken = token.layer === 'gm';
      const isTurnActive = Boolean(
        activeCombatant &&
          (activeCombatant.tokenId === token.id ||
            (token.characterId && activeCombatant.characterId === token.characterId))
      );

      // Faction / role border color
      const ringColor =
        token.color ||
        (linkedChar?.kind === 'pc'
          ? '#d4a84f'
          : linkedChar?.kind === 'monster'
            ? '#ef4444'
            : linkedChar?.kind === 'npc'
              ? '#3b82f6'
              : '#d4a84f');

      ctx.save();
      if (isGmOnlyToken) {
        ctx.globalAlpha = 0.58;
      }

      // Active Combat Turn Animated Pulse Ring
      if (isTurnActive) {
        const phase = (now % 1600) / 1600;
        const pulseRadius = radius + 4 + phase * (radius * 0.45);
        ctx.save();
        ctx.strokeStyle = `rgba(242, 204, 123, ${(1 - phase) * 0.85})`;
        ctx.lineWidth = Math.max(2, 3.2 / cam.scale);
        ctx.beginPath();
        ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Rotating antique gold compass ticks
        const rot = (now * 0.0012) % (Math.PI * 2);
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = Math.max(2, 2.8 / cam.scale);
        for (let k = 0; k < 4; k++) {
          const a = rot + (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, radius + 5, a - 0.25, a + 0.25);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Token ground shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + radius * 0.14, radius * 1.02, radius * 0.98, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Circular portrait clip
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = '#121722';
      ctx.fill();
      ctx.clip();

      const portrait = getCachedImage(token.imageUrl || linkedChar?.portraitUrl);
      if (portrait) {
        // Cover-fit image into circle
        const iw = portrait.naturalWidth || portrait.width || 1;
        const ih = portrait.naturalHeight || portrait.height || 1;
        const scaleImg = Math.max(diameter / iw, diameter / ih);
        const dw = iw * scaleImg;
        const dh = ih * scaleImg;
        ctx.drawImage(portrait, cx - dw / 2, cy - dh / 2, dw, dh);
      } else {
        // Monogram fallback
        ctx.fillStyle = ringColor;
        ctx.font = `700 ${Math.round(radius * 0.72)}px "Cinzel", Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(token.name.slice(0, 2).toUpperCase(), cx, cy + 1);
      }
      ctx.restore();

      // Outer faction / selection ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = isSelected ? Math.max(3, 4 / cam.scale) : Math.max(2.2, 3 / cam.scale);
      ctx.strokeStyle = isSelected ? '#fde68a' : ringColor;
      if (isGmOnlyToken) {
        ctx.setLineDash([6 / cam.scale, 4 / cam.scale]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Extra soft selection halo
      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(242, 204, 123, 0.48)';
        ctx.lineWidth = Math.max(2, 6 / cam.scale);
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 3.5 / cam.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // GM-only eye-off / "GM" badge on top-left of hidden tokens
      if (isGmOnlyToken) {
        const badgeW = Math.max(24, radius * 0.78);
        const badgeH = Math.max(14, radius * 0.44);
        const bx = cx - radius * 0.95;
        const by = cy - radius * 0.98;
        drawRoundedRect(ctx, bx, by, badgeW, badgeH, badgeH / 2);
        ctx.fillStyle = 'rgba(88, 28, 135, 0.92)';
        ctx.fill();
        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 1.2 / cam.scale;
        ctx.stroke();
        ctx.fillStyle = '#f3e8ff';
        ctx.font = `700 ${Math.max(9, badgeH * 0.65)}px "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GM', bx + badgeW / 2, by + badgeH / 2 + 0.5);
      }

      // Condition pips around top-right arc
      const condIds = new Set<string>(token.conditions ?? []);
      if (linkedChar?.conditions) {
        for (const c of linkedChar.conditions) condIds.add(c.id);
      }
      const condList = Array.from(condIds).slice(0, 5);
      if (condList.length > 0) {
        const pipR = Math.max(5.5, radius * 0.22);
        condList.forEach((cid, idx) => {
          const meta = CONDITION_MAP.get(cid);
          const angle = -Math.PI * 0.25 + idx * 0.42;
          const px = cx + Math.cos(angle) * (radius * 0.92);
          const py = cy + Math.sin(angle) * (radius * 0.92);
          ctx.beginPath();
          ctx.arc(px, py, pipR, 0, Math.PI * 2);
          ctx.fillStyle = '#0c0f14';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = meta?.color ?? '#f59e0b';
          ctx.stroke();
          if (meta?.emoji && pipR * cam.scale >= 6) {
            ctx.font = `${Math.round(pipR * 1.25)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(meta.emoji, px, py + 0.5);
          } else {
            ctx.beginPath();
            ctx.arc(px, py, pipR * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = meta?.color ?? '#f59e0b';
            ctx.fill();
          }
        });
      }

      // Compact HP & MP bars beneath token
      const pv = linkedChar?.resources?.pv;
      const pm = linkedChar?.resources?.pm;
      const hp = pv ? pv.current : token.hp;
      const hpMax = pv ? pv.max : token.hpMax;
      const mp = pm ? pm.current : token.mp;
      const mpMax = pm ? pm.max : token.mpMax;

      let bottomCursor = cy + radius + 4;
      const barW = Math.max(diameter * 0.92, 42);
      const barX = cx - barW / 2;

      if (token.showBars && hp !== undefined && hpMax !== undefined && hpMax > 0) {
        const barH = Math.max(4.5, radius * 0.16);
        const pct = Math.max(0, Math.min(1, hp / hpMax));
        drawRoundedRect(ctx, barX, bottomCursor, barW, barH, barH / 2);
        ctx.fillStyle = 'rgba(7, 9, 13, 0.88)';
        ctx.fill();
        if (pct > 0) {
          drawRoundedRect(ctx, barX, bottomCursor, barW * pct, barH, barH / 2);
          ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444';
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 0.8 / cam.scale;
        drawRoundedRect(ctx, barX, bottomCursor, barW, barH, barH / 2);
        ctx.stroke();
        bottomCursor += barH + 2;

        if (mp !== undefined && mpMax !== undefined && mpMax > 0) {
          const mpH = Math.max(3.5, radius * 0.12);
          const mpPct = Math.max(0, Math.min(1, mp / mpMax));
          drawRoundedRect(ctx, barX, bottomCursor, barW, mpH, mpH / 2);
          ctx.fillStyle = 'rgba(7, 9, 13, 0.88)';
          ctx.fill();
          if (mpPct > 0) {
            drawRoundedRect(ctx, barX, bottomCursor, barW * mpPct, mpH, mpH / 2);
            ctx.fillStyle = '#3b82f6';
            ctx.fill();
          }
          bottomCursor += mpH + 2;
        }
      }

      // Nameplate pill
      if (radius * cam.scale >= 12) {
        const fontSize = Math.max(10, Math.min(13, 11.5 / Math.sqrt(cam.scale)));
        ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
        const label = token.name.length > 18 ? `${token.name.slice(0, 17)}…` : token.name;
        const textW = ctx.measureText(label).width;
        const pillPadX = 6;
        const pillW = textW + pillPadX * 2;
        const pillH = fontSize + 6;
        const pillX = cx - pillW / 2;
        const pillY = bottomCursor + 1;

        drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 5);
        ctx.fillStyle = isSelected ? 'rgba(26, 22, 14, 0.94)' : 'rgba(10, 13, 19, 0.86)';
        ctx.fill();
        ctx.strokeStyle = isSelected ? 'rgba(242, 204, 123, 0.75)' : 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1 / cam.scale;
        ctx.stroke();

        ctx.fillStyle = isSelected ? '#fde68a' : '#eef2f8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, pillY + pillH / 2 + 0.5);
      }

      ctx.restore();
    }

    // 6. Fog of War Layer
    if (scene.fog.enabled) {
      ctx.save();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (isCellRevealed(scene, c, r)) continue;
          const x = c * cellW;
          const y = r * cellH;
          if (isGm) {
            // Semi-transparent dark veil for GM so GM sees underlying map & tokens clearly
            ctx.fillStyle = 'rgba(7, 9, 16, 0.56)';
            ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.18)';
            ctx.lineWidth = 0.8 / cam.scale;
            ctx.beginPath();
            ctx.moveTo(x + 4, y + cellH - 4);
            ctx.lineTo(x + cellW - 4, y + 4);
            ctx.stroke();
          } else {
            // Solid opaque dark mist for players
            ctx.fillStyle = '#07090e';
            ctx.fillRect(x - 0.5, y - 0.5, cellW + 1, cellH + 1);
          }
        }
      }
      ctx.restore();
    }

    // 7. GM Fog Brush Hover Highlight
    if (isGm && (activeTool === 'fog_reveal' || activeTool === 'fog_hide') && hoverCellRef.current) {
      const { col, row } = hoverCellRef.current;
      if (col >= 0 && col < cols && row >= 0 && row < rows) {
        ctx.save();
        const isReveal = activeTool === 'fog_reveal';
        ctx.fillStyle = isReveal ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)';
        ctx.strokeStyle = isReveal ? '#4ade80' : '#f87171';
        ctx.lineWidth = 2 / cam.scale;
        ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
        ctx.strokeRect(col * cellW, row * cellH, cellW, cellH);
        ctx.restore();
      }
    }

    // 8. Distance Ruler Overlay
    const ruler = rulerRef.current;
    if (ruler) {
      ctx.save();
      const dxCells = Math.abs(ruler.endCol - ruler.startCol);
      const dyCells = Math.abs(ruler.endRow - ruler.startRow);
      const squares = scene.grid.snap
        ? Math.max(dxCells, dyCells)
        : Math.hypot((ruler.endWorldX - ruler.startWorldX) / cellW, (ruler.endWorldY - ruler.startWorldY) / cellH);
      const cellMeters = scene.grid.cellMeters || 1.5;
      const meters = squares * cellMeters;

      // Dashed glowing gold line
      ctx.strokeStyle = '#f2cc7b';
      ctx.lineWidth = Math.max(2.5, 3.2 / cam.scale);
      ctx.setLineDash([10 / cam.scale, 6 / cam.scale]);
      ctx.beginPath();
      ctx.moveTo(ruler.startWorldX, ruler.startWorldY);
      ctx.lineTo(ruler.endWorldX, ruler.endWorldY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Endpoints
      for (const [px, py] of [
        [ruler.startWorldX, ruler.startWorldY],
        [ruler.endWorldX, ruler.endWorldY],
      ]) {
        ctx.beginPath();
        ctx.arc(px, py, 6 / cam.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#0c0f14';
        ctx.fill();
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 2.5 / cam.scale;
        ctx.stroke();
      }

      // Distance badge at midpoint
      const midX = (ruler.startWorldX + ruler.endWorldX) / 2;
      const midY = (ruler.startWorldY + ruler.endWorldY) / 2 - 18 / cam.scale;
      const roundedSquares = scene.grid.snap ? squares : Number(squares.toFixed(1));
      const labelText = `${formatMetersPtBr(meters)}m (${roundedSquares} quad.)`;

      const fontSize = Math.max(12, 13 / cam.scale);
      ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
      const tw = ctx.measureText(labelText).width;
      const padX = 10 / cam.scale;
      const pillW = tw + padX * 2;
      const pillH = fontSize + 10 / cam.scale;

      drawRoundedRect(ctx, midX - pillW / 2, midY - pillH / 2, pillW, pillH, pillH / 2);
      ctx.fillStyle = 'rgba(10, 14, 22, 0.94)';
      ctx.fill();
      ctx.strokeStyle = '#f2cc7b';
      ctx.lineWidth = 1.6 / cam.scale;
      ctx.stroke();

      ctx.fillStyle = '#fde68a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, midX, midY + 0.5);
      ctx.restore();
    }

    // 9. Synchronized Map Ping Ripples
    const nowEpoch = Date.now();
    const scenePings = pings.filter((p) => p.sceneId === scene.id);
    for (const ping of scenePings) {
      const age = nowEpoch - ping.createdAt;
      if (age < 0 || age > PING_DURATION_MS) continue;
      const progress = age / PING_DURATION_MS;
      // Support both grid coords (0..cols) and pixel coords gracefully
      const px = ping.x <= cols + 1 && ping.y <= rows + 1 ? ping.x * cellW : ping.x;
      const py = ping.x <= cols + 1 && ping.y <= rows + 1 ? ping.y * cellH : ping.y;
      const color = ping.color || '#f2cc7b';

      ctx.save();
      for (let ring = 0; ring < 3; ring++) {
        const localP = (progress * 2.2 - ring * 0.32) % 1;
        if (localP < 0 || progress > 0.96) continue;
        const alpha = Math.max(0, (1 - localP) * (1 - progress * 0.65));
        const r = (10 + localP * Math.min(cellW, cellH) * 1.45) / Math.sqrt(Math.max(0.5, cam.scale));
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = Math.max(2, 3.2 / cam.scale);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Central beacon dot + sender tag
      ctx.globalAlpha = Math.max(0, 1 - progress * 0.85);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 5.5 / cam.scale, 0, Math.PI * 2);
      ctx.fill();

      if (ping.displayName) {
        const fs = Math.max(10, 11 / cam.scale);
        ctx.font = `700 ${fs}px "Inter", sans-serif`;
        const tw = ctx.measureText(ping.displayName).width;
        const pw = tw + 12 / cam.scale;
        const ph = fs + 7 / cam.scale;
        const bx = px - pw / 2;
        const by = py - 24 / cam.scale - ph / 2;
        drawRoundedRect(ctx, bx, by, pw, ph, ph / 2);
        ctx.fillStyle = 'rgba(10, 14, 22, 0.9)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2 / cam.scale;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ping.displayName, px, by + ph / 2 + 0.5);
      }
      ctx.restore();
    }

    // 10. Crisp antique gold frame around the battlemap border
    ctx.strokeStyle = 'rgba(212, 168, 79, 0.32)';
    ctx.lineWidth = Math.max(1, 1.5 / cam.scale);
    ctx.strokeRect(0, 0, mapW, mapH);

    ctx.restore();
    ctx.restore();
  }, [
    scene,
    getSceneDims,
    localGridOverride,
    getCachedImage,
    selectedTokenId,
    isGm,
    isCellRevealed,
    characterById,
    activeCombatant,
    activeTool,
    pings,
  ]);

  drawFrameRef.current = drawFrame;

  // Trigger redraw whenever React props/state change
  useEffect(() => {
    requestDraw();
  }, [scene, selectedTokenId, activeTool, activeLayer, isGm, pings, combat, characters, localGridOverride, requestDraw]);

  // Continuous RAF loop ONLY when needed (active animations: pings, active combat pulse, or dirty draw flag)
  useEffect(() => {
    let rafId = 0;
    const loop = () => {
      const hasActivePings = Boolean(scene && pings.some((p) => p.sceneId === scene.id));
      const hasActiveCombatPulse = Boolean(scene && combat.active && combat.combatants.length > 0);
      if (needsDrawRef.current || hasActivePings || hasActiveCombatPulse) {
        needsDrawRef.current = false;
        drawFrameRef.current();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [scene, pings, combat.active, combat.combatants.length]);

  // Observe container resize cleanly
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(1, Math.round(entry.contentRect.width));
      const h = Math.max(1, Math.round(entry.contentRect.height));
      const wasZero = viewportRef.current.width <= 1 || viewportRef.current.height <= 1;
      viewportRef.current = { width: w, height: h };
      if (wasZero && scene) {
        fitToView();
      } else {
        setPopoverTick((t) => t + 1);
        requestDraw();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [scene, fitToView, requestDraw]);

  // Hit-test topmost visible token at world coordinates
  const hitTestToken = useCallback(
    (wx: number, wy: number): Token | null => {
      if (!scene) return null;
      const { cellW, cellH } = getSceneDims(scene);
      // Reverse draw order: prioritize GM-layer tokens when GM is on GM layer, otherwise top token
      const candidates = [...scene.tokens].sort((a, b) => {
        if (a.id === selectedTokenId) return -1;
        if (b.id === selectedTokenId) return 1;
        if (isGm && a.layer !== b.layer) {
          return a.layer === activeLayer ? -1 : 1;
        }
        return 0;
      });

      for (const token of candidates) {
        if (token.layer === 'gm' && !isGm) continue;
        const size = Math.max(1, token.size || 1);
        if (!isGm && scene.fog.enabled) {
          const cc = Math.floor(token.x + size / 2);
          const cr = Math.floor(token.y + size / 2);
          if (!isCellRevealed(scene, cc, cr)) continue;
        }
        const cx = (token.x + size / 2) * cellW;
        const cy = (token.y + size / 2) * cellH;
        const radius = (Math.min(cellW, cellH) * size * 0.92) / 2;
        if (Math.hypot(wx - cx, wy - cy) <= radius) {
          return token;
        }
      }
      return null;
    },
    [scene, getSceneDims, selectedTokenId, isGm, activeLayer, isCellRevealed]
  );

  const paintFogCell = useCallback(
    (wx: number, wy: number, mode: 'reveal' | 'hide') => {
      if (!scene || !isGm) return;
      const { cols, rows, cellW, cellH } = getSceneDims(scene);
      const col = Math.floor(wx / cellW);
      const row = Math.floor(wy / cellH);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return;
      const idx = row * cols + col;
      const brush = fogBrushRef.current;
      if (!brush || brush.paintedCells.has(idx)) return;

      brush.paintedCells.add(idx);
      brush.pendingCells.add(idx);

      if (optimisticFogRef.current.sceneId !== scene.id) {
        optimisticFogRef.current = { sceneId: scene.id, cells: new Map() };
      }
      optimisticFogRef.current.cells.set(idx, mode === 'reveal' ? '1' : '0');
      requestDraw();

      const now = performance.now();
      if (now - brush.lastFlushMs > 120 && brush.pendingCells.size > 0) {
        updateFog(scene.id, mode, Array.from(brush.pendingCells));
        brush.pendingCells.clear();
        brush.lastFlushMs = now;
      }
    },
    [scene, isGm, getSceneDims, updateFog, requestDraw]
  );

  // Pointer Events (Unified Mouse + Mobile Touch + 2-Finger Pinch-to-Zoom)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!scene) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    canvas.setPointerCapture?.(e.pointerId);
    activePointersRef.current.set(e.pointerId, { x: sx, y: sy });

    // 2-finger pinch-to-zoom / 2-finger pan takes priority over any single-pointer tool
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStateRef.current = {
        lastDist: Math.max(10, dist),
        lastMidX: (pts[0].x + pts[1].x) / 2,
        lastMidY: (pts[0].y + pts[1].y) / 2,
      };
      // Cancel in-progress single-finger drags cleanly
      dragTokenRef.current = null;
      panStartRef.current = null;
      rulerRef.current = null;
      fogBrushRef.current = null;
      return;
    }
    if (activePointersRef.current.size > 2) return;

    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const { cols, rows, cellW, cellH } = getSceneDims(scene);

    // Middle-click or Spacebar always pans
    const isPanGesture =
      e.button === 1 ||
      spacePressedRef.current ||
      activeTool === 'pan';

    if (isPanGesture) {
      panStartRef.current = {
        pointerId: e.pointerId,
        startX: sx,
        startY: sy,
        camStartX: cameraRef.current.x,
        camStartY: cameraRef.current.y,
        moved: false,
      };
      return;
    }

    // Ping tool (or Shift+Click in select mode)
    if (activeTool === 'ping' || (activeTool === 'select' && e.shiftKey)) {
      const gridX = Math.max(0, Math.min(cols, wx / cellW));
      const gridY = Math.max(0, Math.min(rows, wy / cellH));
      sendMapPing(scene.id, gridX, gridY, isGm ? '#f2cc7b' : '#4ade80');
      return;
    }

    // Distance Ruler tool
    if (activeTool === 'ruler') {
      const col = Math.max(0, Math.min(cols - 1, Math.floor(wx / cellW)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor(wy / cellH)));
      const startWX = scene.grid.snap ? (col + 0.5) * cellW : wx;
      const startWY = scene.grid.snap ? (row + 0.5) * cellH : wy;
      rulerRef.current = {
        startCol: col,
        startRow: row,
        endCol: col,
        endRow: row,
        startWorldX: startWX,
        startWorldY: startWY,
        endWorldX: startWX,
        endWorldY: startWY,
      };
      requestDraw();
      return;
    }

    // GM Fog of War Brush tool
    if (isGm && (activeTool === 'fog_reveal' || activeTool === 'fog_hide')) {
      const mode = activeTool === 'fog_reveal' ? 'reveal' : 'hide';
      fogBrushRef.current = {
        pointerId: e.pointerId,
        mode,
        pendingCells: new Set(),
        paintedCells: new Set(),
        lastFlushMs: performance.now(),
      };
      paintFogCell(wx, wy, mode);
      return;
    }

    // Default: Select / Drag Token (and fallback pan when dragging empty map space)
    const hit = hitTestToken(wx, wy);
    if (hit) {
      const now = performance.now();
      const prevTap = lastTapRef.current;
      if (prevTap && prevTap.tokenId === hit.id && now - prevTap.timeMs < 340 && hit.characterId) {
        lastTapRef.current = null;
        onSelectToken(hit.id);
        onOpenCharacterSheet(hit.characterId);
        return;
      }
      lastTapRef.current = { tokenId: hit.id, timeMs: now };

      onSelectToken(hit.id);
      setPopoverTick((t) => t + 1);

      if (canControlToken(hit)) {
        const size = Math.max(1, hit.size || 1);
        const cx = (hit.x + size / 2) * cellW;
        const cy = (hit.y + size / 2) * cellH;
        dragTokenRef.current = {
          tokenId: hit.id,
          offsetWorldX: wx - cx,
          offsetWorldY: wy - cy,
          currentX: hit.x,
          currentY: hit.y,
          moved: false,
          lastSentMs: 0,
        };
      }
      requestDraw();
    } else {
      // Begin map pan; if released without movement, deselect token
      panStartRef.current = {
        pointerId: e.pointerId,
        startX: sx,
        startY: sy,
        camStartX: cameraRef.current.x,
        camStartY: cameraRef.current.y,
        moved: false,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!scene) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: sx, y: sy });
    }

    // 2-finger pinch zoom & pan
    if (activePointersRef.current.size === 2 && pinchStateRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;

      const cam = cameraRef.current;
      const ratio = dist / pinchStateRef.current.lastDist;
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * ratio));

      const dx = midX - pinchStateRef.current.lastMidX;
      const dy = midY - pinchStateRef.current.lastMidY;

      const worldMidX = (midX - cam.x) / cam.scale;
      const worldMidY = (midY - cam.y) / cam.scale;

      cameraRef.current = {
        scale: nextScale,
        x: midX - worldMidX * nextScale + dx,
        y: midY - worldMidY * nextScale + dy,
      };

      pinchStateRef.current = { lastDist: dist, lastMidX: midX, lastMidY: midY };
      setZoomPercent(Math.round(nextScale * 100));
      setPopoverTick((t) => t + 1);
      requestDraw();
      return;
    }

    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const { cols, rows, cellW, cellH } = getSceneDims(scene);

    // Update fog hover preview cell
    if (isGm && (activeTool === 'fog_reveal' || activeTool === 'fog_hide')) {
      const col = Math.floor(wx / cellW);
      const row = Math.floor(wy / cellH);
      if (hoverCellRef.current?.col !== col || hoverCellRef.current?.row !== row) {
        hoverCellRef.current = { col, row };
        requestDraw();
      }
    }

    // Active fog brush painting
    if (fogBrushRef.current && fogBrushRef.current.pointerId === e.pointerId) {
      paintFogCell(wx, wy, fogBrushRef.current.mode);
      return;
    }

    // Active distance ruler drag
    if (rulerRef.current) {
      const col = Math.max(0, Math.min(cols - 1, Math.floor(wx / cellW)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor(wy / cellH)));
      rulerRef.current.endCol = col;
      rulerRef.current.endRow = row;
      rulerRef.current.endWorldX = scene.grid.snap ? (col + 0.5) * cellW : wx;
      rulerRef.current.endWorldY = scene.grid.snap ? (row + 0.5) * cellH : wy;
      requestDraw();
      return;
    }

    // Active token drag
    const drag = dragTokenRef.current;
    if (drag) {
      const token = scene.tokens.find((t) => t.id === drag.tokenId);
      if (token) {
        const size = Math.max(1, token.size || 1);
        const centerWX = wx - drag.offsetWorldX;
        const centerWY = wy - drag.offsetWorldY;
        const nextX = Math.max(0, Math.min(cols - size, centerWX / cellW - size / 2));
        const nextY = Math.max(0, Math.min(rows - size, centerWY / cellH - size / 2));

        if (Math.hypot(nextX - token.x, nextY - token.y) > 0.08) {
          drag.moved = true;
        }
        drag.currentX = nextX;
        drag.currentY = nextY;
        requestDraw();

        // Throttled live sync (~12Hz) so peers see smooth token movement
        const now = performance.now();
        if (drag.moved && now - drag.lastSentMs > 85) {
          drag.lastSentMs = now;
          moveToken(scene.id, token.id, Number(nextX.toFixed(2)), Number(nextY.toFixed(2)));
        }
      }
      return;
    }

    // Active map pan
    const pan = panStartRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      const dx = sx - pan.startX;
      const dy = sy - pan.startY;
      if (Math.hypot(dx, dy) > 4) {
        pan.moved = true;
      }
      cameraRef.current = {
        ...cameraRef.current,
        x: pan.camStartX + dx,
        y: pan.camStartY + dy,
      };
      setPopoverTick((t) => t + 1);
      requestDraw();
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    // Finish fog brush
    if (fogBrushRef.current && fogBrushRef.current.pointerId === e.pointerId) {
      const brush = fogBrushRef.current;
      if (scene && brush.pendingCells.size > 0) {
        updateFog(scene.id, brush.mode, Array.from(brush.pendingCells));
      }
      fogBrushRef.current = null;
      return;
    }

    // Finish ruler
    if (rulerRef.current) {
      rulerRef.current = null;
      requestDraw();
      return;
    }

    // Commit dragged token with grid snap
    if (dragTokenRef.current && scene) {
      const drag = dragTokenRef.current;
      dragTokenRef.current = null;
      if (drag.moved) {
        const token = scene.tokens.find((t) => t.id === drag.tokenId);
        const size = Math.max(1, token?.size || 1);
        const { cols, rows } = getSceneDims(scene);
        const finalX = scene.grid.snap
          ? Math.max(0, Math.min(cols - size, Math.round(drag.currentX)))
          : Number(drag.currentX.toFixed(2));
        const finalY = scene.grid.snap
          ? Math.max(0, Math.min(rows - size, Math.round(drag.currentY)))
          : Number(drag.currentY.toFixed(2));
        moveToken(scene.id, drag.tokenId, finalX, finalY);
        setPopoverTick((t) => t + 1);
      }
      requestDraw();
      return;
    }

    // Finish pan (tap on empty space deselects selected token)
    if (panStartRef.current && panStartRef.current.pointerId === e.pointerId) {
      const wasClick = !panStartRef.current.moved;
      panStartRef.current = null;
      if (wasClick && activeTool === 'select') {
        onSelectToken(null);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(factor, sx, sy);
  };

  // Selected token + popover anchor calculation
  const selectedToken = useMemo(() => {
    if (!scene || !selectedTokenId) return null;
    const tok = scene.tokens.find((t) => t.id === selectedTokenId) ?? null;
    if (!tok) return null;
    if (tok.layer === 'gm' && !isGm) return null;
    return tok;
  }, [scene, selectedTokenId, isGm]);

  const selectedCharacter = useMemo(() => {
    if (!selectedToken?.characterId) return null;
    return characterById.get(selectedToken.characterId) ?? null;
  }, [selectedToken, characterById]);

  const popoverAnchor = useMemo(() => {
    void popoverTick;
    if (!scene || !selectedToken) return null;
    const { cellW, cellH } = getSceneDims(scene);
    const size = Math.max(1, selectedToken.size || 1);
    const worldCenterX = (selectedToken.x + size / 2) * cellW;
    const worldCenterY = (selectedToken.y + size / 2) * cellH;
    const screenPos = worldToScreen(worldCenterX, worldCenterY);
    return {
      x: screenPos.x,
      y: screenPos.y,
      containerWidth: viewportRef.current.width,
      containerHeight: viewportRef.current.height,
    };
  }, [scene, selectedToken, getSceneDims, worldToScreen, popoverTick]);

  const cursorStyle =
    activeTool === 'pan'
      ? 'grab'
      : activeTool === 'ruler' || activeTool === 'ping'
        ? 'crosshair'
        : activeTool === 'fog_reveal' || activeTool === 'fog_hide'
          ? 'cell'
          : 'default';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#080b10',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {scene ? (
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          onPointerLeave={() => {
            hoverCellRef.current = null;
            requestDraw();
          }}
          onWheel={handleWheel}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            touchAction: 'none',
            cursor: cursorStyle,
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            color: 'var(--text-muted)',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <MapIcon size={36} style={{ color: 'var(--gold-500)', opacity: 0.7 }} />
          <div className="font-display" style={{ fontSize: 16, color: 'var(--text-secondary)' }}>
            Nenhuma cena ativa
          </div>
          <p style={{ fontSize: 13, maxWidth: 320 }}>
            {isGm
              ? 'Crie ou selecione uma cena na barra superior do mapa para posicionar tokens.'
              : 'Aguardando o Mestre ativar o mapa tático da sessão.'}
          </p>
        </div>
      )}

      {/* Subtle Bottom-Left Map Telemetry Pill */}
      {scene && !selectedToken && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            zIndex: 12,
            pointerEvents: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(10, 14, 20, 0.78)',
            border: '1px solid var(--border-subtle)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
          }}
        >
          <span>{zoomPercent}%</span>
          <span>·</span>
          <span>{formatMetersPtBr(scene.grid.cellMeters || 1.5)}m/quad</span>
          {scene.fog.enabled && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--amethyst-400)' }}>Névoa ON</span>
            </>
          )}
        </div>
      )}

      {/* Contextual Token Popover / Mobile Sheet */}
      {scene && selectedToken && (
        <TokenPopover
          sceneId={scene.id}
          token={selectedToken}
          character={selectedCharacter}
          isGm={isGm}
          canControl={canControlToken(selectedToken)}
          anchor={popoverAnchor}
          compact={compact}
          onClose={() => onSelectToken(null)}
          onOpenCharacterSheet={onOpenCharacterSheet}
        />
      )}
    </div>
  );
};

export default TacticalCanvas;
