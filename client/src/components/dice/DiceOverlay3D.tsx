import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EyeOff, Sparkles, Skull, X } from 'lucide-react';
import type { DiceResultEvent } from '@systems/types';
import type { DiceOverlay3DProps } from '@/lib/componentProps';
import {
  createDieMesh,
  expandRolledDice,
  type DieMeshBundle,
  type DieTheme,
  type ExpandedVisualDie,
} from './diceGeometry';
import {
  sampleTrajectory,
  simulateDiceThrow,
  type DieSimulationInput,
  type DieTrajectory,
} from './dicePhysics';

const MAX_3D_DICE = 16;
const HOLD_AFTER_SETTLE_MS = 2300;
const FADE_DURATION_MS = 380;

type RollMood = 'default' | 'critical' | 'fumble';

function detectRollMood(evt: DiceResultEvent): RollMood {
  const kind = evt.roll.outcome?.kind;
  if (kind === 'critical') return 'critical';
  if (kind === 'fumble') return 'fumble';

  // Mighty Blade 3e automatic critical (two 6s on 2d6) / critical failure (two 1s on 2d6)
  const activeD6 = evt.roll.dice.filter((d) => d.sides === 6 && !d.dropped);
  if (activeD6.length >= 2) {
    const sixCount = activeD6.filter((d) => d.value === 6).length;
    const oneCount = activeD6.filter((d) => d.value === 1).length;
    if (sixCount >= 2) return 'critical';
    if (oneCount >= 2 && activeD6.length === 2) return 'fumble';
  }
  return 'default';
}

interface Active3DSession {
  bundles: DieMeshBundle[];
  trajectories: DieTrajectory[];
  sparkPoints: THREE.Points | null;
  sparkVelocities: Float32Array | null;
  mood: RollMood;
  startTimeMs: number;
  settledAtMs: number | null;
  firstImpactTime: number;
}

export const DiceOverlay3D: React.FC<DiceOverlay3DProps> = ({
  enabled,
  activeRoll,
  onAnimationComplete,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const accentLightRef = useRef<THREE.PointLight | null>(null);
  const rafRef = useRef<number | null>(null);
  const sessionRef = useRef<Active3DSession | null>(null);
  const completeTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onAnimationComplete);
  onCompleteRef.current = onAnimationComplete;

  const [webglFailed, setWebglFailed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [fading, setFading] = useState(false);

  const mood = useMemo<RollMood>(
    () => (activeRoll ? detectRollMood(activeRoll) : 'default'),
    [activeRoll]
  );

  const visualDice = useMemo<ExpandedVisualDie[]>(() => {
    if (!activeRoll) return [];
    return expandRolledDice(activeRoll.roll.dice).slice(0, MAX_3D_DICE);
  }, [activeRoll]);

  const clearTimers = useCallback(() => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (completeTimerRef.current !== null) {
      window.clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
  }, []);

  const disposeSession = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const session = sessionRef.current;
    const scene = sceneRef.current;
    if (session && scene) {
      for (const bundle of session.bundles) {
        scene.remove(bundle.root);
        bundle.dispose();
      }
      if (session.sparkPoints) {
        scene.remove(session.sparkPoints);
        session.sparkPoints.geometry.dispose();
        (session.sparkPoints.material as THREE.Material).dispose();
      }
    }
    sessionRef.current = null;
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.clear();
    }
  }, []);

  const handleDismiss = useCallback(() => {
    if (!activeRoll) return;
    clearTimers();
    setFading(true);
    const idToComplete = activeRoll.roll.rollId;
    completeTimerRef.current = window.setTimeout(() => {
      disposeSession();
      onCompleteRef.current(idToComplete);
    }, 180);
  }, [activeRoll, clearTimers, disposeSession]);

  // If 3D dice are disabled, immediately drain queued roll events so the queue stays clean
  useEffect(() => {
    if (!enabled && activeRoll) {
      onCompleteRef.current(activeRoll.roll.rollId);
    }
  }, [enabled, activeRoll]);

  // Initialize transparent WebGL renderer & lighting once when enabled
  useEffect(() => {
    if (!enabled || webglFailed) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    const scene = new THREE.Scene();

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 240);
    renderer.setSize(width, height, false);

    // Overhead angled tabletop camera: crisp top faces + dramatic 3D perspective
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.5, 60);
    camera.position.set(0, 13.5, 4.6);
    camera.lookAt(0, 0, 0);

    // Rich dark-fantasy tavern lighting rig
    const hemi = new THREE.HemisphereLight(0xfef3c7, 0x1e293b, 0.95);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffeed4, 1.85);
    keyLight.position.set(5, 16, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 32;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -6;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
    rimLight.position.set(-7, 9, -6);
    scene.add(rimLight);

    const accentLight = new THREE.PointLight(0xd4a84f, 0, 18);
    accentLight.position.set(0, 4.5, 0);
    scene.add(accentLight);

    // Transparent shadow-catching tabletop plane
    const shadowPlaneGeo = new THREE.PlaneGeometry(36, 24);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.36 });
    const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    accentLightRef.current = accentLight;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !rendererRef.current || !cameraRef.current) return;
      const w = Math.max(Math.round(entry.contentRect.width), 1);
      const h = Math.max(Math.round(entry.contentRect.height), 1);
      rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      rendererRef.current.setSize(w, h, false);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      if (sessionRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    });
    resizeObserver.observe(container);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglFailed(true);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      resizeObserver.disconnect();
      clearTimers();
      disposeSession();
      shadowPlaneGeo.dispose();
      shadowPlaneMat.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      accentLightRef.current = null;
    };
  }, [enabled, webglFailed, clearTimers, disposeSession]);

  // Run 3D throw OR CSS fallback whenever a new activeRoll arrives
  useEffect(() => {
    clearTimers();
    disposeSession();
    setSettled(false);
    setFading(false);

    if (!enabled || !activeRoll) return;

    const rollId = activeRoll.roll.rollId;
    const rollMood = detectRollMood(activeRoll);
    const expanded = expandRolledDice(activeRoll.roll.dice).slice(0, MAX_3D_DICE);

    // Fallback mode (CSS 3D card flip) when WebGL is unavailable
    if (webglFailed || !rendererRef.current || !sceneRef.current || !cameraRef.current) {
      const settleTimer = window.setTimeout(() => {
        setSettled(true);
        fadeTimerRef.current = window.setTimeout(() => {
          setFading(true);
          completeTimerRef.current = window.setTimeout(() => {
            onCompleteRef.current(rollId);
          }, FADE_DURATION_MS);
        }, HOLD_AFTER_SETTLE_MS);
      }, 950);

      return () => {
        window.clearTimeout(settleTimer);
        clearTimers();
      };
    }

    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const accentLight = accentLightRef.current;

    if (expanded.length === 0) {
      // Pure constant formula without dice (e.g. "5+2") — briefly show banner
      setSettled(true);
      fadeTimerRef.current = window.setTimeout(() => {
        setFading(true);
        completeTimerRef.current = window.setTimeout(() => {
          onCompleteRef.current(rollId);
        }, FADE_DURATION_MS);
      }, 1800);
      return () => clearTimers();
    }

    // Build 3D meshes & deterministic pre-simulated trajectories
    const bundles: DieMeshBundle[] = [];
    const simInputs: DieSimulationInput[] = [];

    for (const d of expanded) {
      const dieTheme: DieTheme = d.dropped
        ? 'dropped'
        : rollMood === 'critical'
          ? 'critical'
          : rollMood === 'fumble'
            ? 'fumble'
            : 'default';

      const bundle = createDieMesh(d.kind, dieTheme);
      const targetNormal =
        bundle.faceNormals.get(d.targetValue) ??
        bundle.allNormals[0] ??
        new THREE.Vector3(0, 1, 0);

      bundles.push(bundle);
      simInputs.push({
        restHeight: bundle.restHeight,
        collisionRadius: bundle.collisionRadius,
        targetNormal,
        allNormals: bundle.allNormals,
      });
    }

    // Compute aspect-aware arena bounds so dice stay well framed on portrait mobile & wide desktop
    const aspect = camera.aspect || 1.5;
    const arenaHalfDepth = 2.6;
    const arenaHalfWidth = Math.max(2.3, Math.min(5.2, arenaHalfDepth * aspect * 0.88));

    const trajectories = simulateDiceThrow(
      simInputs,
      activeRoll.roll.seed || Date.now(),
      arenaHalfWidth,
      arenaHalfDepth
    );

    let earliestImpact = Infinity;
    bundles.forEach((bundle, i) => {
      const traj = trajectories[i];
      // Bake exact server-face correction into the inner geometry pivot once!
      bundle.pivot.quaternion.copy(traj.fixQuaternion);
      if (traj.positions[0]) bundle.root.position.copy(traj.positions[0]);
      if (traj.quaternions[0]) bundle.root.quaternion.copy(traj.quaternions[0]);
      scene.add(bundle.root);
      if (traj.firstImpactTime < earliestImpact) {
        earliestImpact = traj.firstImpactTime;
      }
    });

    // Optional golden/crimson spark burst particles for Crits and Fumbles
    let sparkPoints: THREE.Points | null = null;
    let sparkVelocities: Float32Array | null = null;
    if (rollMood === 'critical' || rollMood === 'fumble') {
      const count = rollMood === 'critical' ? 54 : 36;
      const positions = new Float32Array(count * 3);
      sparkVelocities = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (i % 5) * 0.3;
        const radius = 0.4 + (i % 7) * 0.22;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = 0.25 + (i % 4) * 0.15;
        positions[i * 3 + 2] = Math.sin(angle) * radius;

        const speed = 1.4 + (i % 6) * 0.45;
        sparkVelocities[i * 3] = Math.cos(angle) * speed;
        sparkVelocities[i * 3 + 1] = 1.8 + (i % 5) * 0.55;
        sparkVelocities[i * 3 + 2] = Math.sin(angle) * speed;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pMat = new THREE.PointsMaterial({
        color: rollMood === 'critical' ? 0xfde68a : 0xf87171,
        size: rollMood === 'critical' ? 0.19 : 0.16,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      sparkPoints = new THREE.Points(pGeo, pMat);
      scene.add(sparkPoints);
    }

    if (accentLight) {
      if (rollMood === 'critical') {
        accentLight.color.setHex(0xf5c85c);
        accentLight.intensity = 2.6;
      } else if (rollMood === 'fumble') {
        accentLight.color.setHex(0xef4444);
        accentLight.intensity = 2.4;
      } else {
        accentLight.color.setHex(0xd4a84f);
        accentLight.intensity = 0.6;
      }
    }

    const session: Active3DSession = {
      bundles,
      trajectories,
      sparkPoints,
      sparkVelocities,
      mood: rollMood,
      startTimeMs: performance.now(),
      settledAtMs: null,
      firstImpactTime: Number.isFinite(earliestImpact) ? earliestImpact : 0.25,
    };
    sessionRef.current = session;

    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const baseCamPos = new THREE.Vector3(0, 13.5, 4.6);
    let lastFrameMs = session.startTimeMs;

    const animate = (nowMs: number) => {
      const cur = sessionRef.current;
      if (!cur) return;

      const dt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
      lastFrameMs = nowMs;
      const elapsedSec = (nowMs - cur.startTimeMs) / 1000;

      let allDone = true;
      for (let i = 0; i < cur.bundles.length; i++) {
        const done = sampleTrajectory(cur.trajectories[i], elapsedSec, tmpPos, tmpQuat);
        cur.bundles[i].root.position.copy(tmpPos);
        cur.bundles[i].root.quaternion.copy(tmpQuat);
        if (!done) allDone = false;
      }

      // Subtle camera micro-shake on Fumble impact
      if (cur.mood === 'fumble') {
        const sinceImpact = elapsedSec - cur.firstImpactTime;
        if (sinceImpact >= 0 && sinceImpact < 0.45) {
          const decay = 1 - sinceImpact / 0.45;
          const mag = 0.22 * decay * decay;
          camera.position.set(
            baseCamPos.x + Math.sin(sinceImpact * 58) * mag,
            baseCamPos.y,
            baseCamPos.z + Math.cos(sinceImpact * 47) * mag
          );
          camera.lookAt(0, 0, 0);
        } else {
          camera.position.copy(baseCamPos);
          camera.lookAt(0, 0, 0);
        }
      } else {
        camera.position.copy(baseCamPos);
        camera.lookAt(0, 0, 0);
      }

      // Animate radiant gold / crimson spark aura after dice begin landing
      if (cur.sparkPoints && cur.sparkVelocities) {
        const sparkTime = elapsedSec - cur.firstImpactTime;
        const mat = cur.sparkPoints.material as THREE.PointsMaterial;
        if (sparkTime > 0 && sparkTime < 2.2) {
          const posAttr = cur.sparkPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          for (let i = 0; i < arr.length; i += 3) {
            arr[i] += cur.sparkVelocities[i] * dt * 0.65;
            arr[i + 1] += cur.sparkVelocities[i + 1] * dt * 0.55;
            arr[i + 2] += cur.sparkVelocities[i + 2] * dt * 0.65;
            cur.sparkVelocities[i + 1] -= 2.2 * dt;
            if (arr[i + 1] < 0.05) arr[i + 1] = 0.05;
          }
          posAttr.needsUpdate = true;
          const fade = sparkTime < 0.25 ? sparkTime / 0.25 : Math.max(0, 1 - (sparkTime - 0.25) / 1.95);
          mat.opacity = fade * 0.92;
        } else {
          mat.opacity = 0;
        }
      }

      // Pulse glow slightly on settled critical/fumble dice
      if (allDone && cur.settledAtMs === null) {
        cur.settledAtMs = nowMs;
        setSettled(true);

        fadeTimerRef.current = window.setTimeout(() => {
          setFading(true);
          completeTimerRef.current = window.setTimeout(() => {
            disposeSession();
            onCompleteRef.current(rollId);
          }, FADE_DURATION_MS);
        }, HOLD_AFTER_SETTLE_MS);
      }

      if (accentLight && cur.settledAtMs !== null && cur.mood !== 'default') {
        const pulse = 0.5 + 0.5 * Math.sin((nowMs - cur.settledAtMs) * 0.008);
        accentLight.intensity = 1.8 + pulse * 1.4;
      }

      renderer.render(scene, camera);

      // Keep RAF alive only while tumbling or pulsing crit/fumble aura; stop when static default roll settles
      const keepAnimating =
        !allDone ||
        (cur.mood !== 'default' &&
          cur.settledAtMs !== null &&
          nowMs - cur.settledAtMs < HOLD_AFTER_SETTLE_MS + FADE_DURATION_MS);

      if (keepAnimating) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      clearTimers();
      disposeSession();
    };
  }, [enabled, activeRoll, webglFailed, clearTimers, disposeSession]);

  if (!enabled) return null;

  const isVisible = Boolean(activeRoll);
  const badgeText =
    activeRoll?.roll.outcome?.badgeText ??
    (mood === 'critical'
      ? 'CRÍTICO!'
      : mood === 'fumble'
        ? 'FALHA CRÍTICA!'
        : undefined);

  const accentBorder =
    mood === 'critical'
      ? 'rgba(253, 230, 138, 0.85)'
      : mood === 'fumble'
        ? 'rgba(248, 113, 113, 0.85)'
        : 'var(--border-gold)';

  const accentGlow =
    mood === 'critical'
      ? '0 0 28px rgba(212, 168, 79, 0.45), var(--shadow-lg)'
      : mood === 'fumble'
        ? '0 0 28px rgba(239, 68, 68, 0.42), var(--shadow-lg)'
        : 'var(--shadow-lg)';

  return (
    <div
      ref={containerRef}
      aria-live="polite"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 'var(--z-dice-3d, 40)' as unknown as number,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: isVisible ? (fading ? 0 : 1) : 0,
        transition: `opacity ${FADE_DURATION_MS}ms ease`,
      }}
    >
      {/* Transparent Three.js WebGL Canvas */}
      {!webglFailed && (
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Graceful CSS 3D Flip Fallback when WebGL is unavailable */}
      {webglFailed && activeRoll && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            flexWrap: 'wrap',
            padding: 24,
            perspective: 900,
          }}
        >
          <style>{`
            @keyframes mesaDiceCssFlip {
              0% { transform: translateY(-60px) rotateX(360deg) rotateY(220deg) scale(0.7); opacity: 0; }
              55% { transform: translateY(8px) rotateX(24deg) rotateY(-18deg) scale(1.06); opacity: 1; }
              78% { transform: translateY(-5px) rotateX(-8deg) rotateY(6deg) scale(0.98); }
              100% { transform: translateY(0) rotateX(0deg) rotateY(0deg) scale(1); opacity: 1; }
            }
          `}</style>
          {visualDice.map((die, idx) => {
            const isCrit = mood === 'critical' && !die.dropped;
            const isFum = mood === 'fumble' && !die.dropped;
            return (
              <div
                key={`${activeRoll.roll.rollId}-${idx}`}
                style={{
                  width: 66,
                  height: 66,
                  borderRadius: die.kind === 'd6' ? 12 : 18,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isCrit
                    ? 'radial-gradient(circle at 30% 25%, #553f14, #1b1305)'
                    : isFum
                      ? 'radial-gradient(circle at 30% 25%, #52141b, #190609)'
                      : 'radial-gradient(circle at 30% 25%, #222b3e, #0c1018)',
                  border: `2px solid ${
                    die.dropped
                      ? '#64748b'
                      : isCrit
                        ? '#fde68a'
                        : isFum
                          ? '#f87171'
                          : '#d4a84f'
                  }`,
                  boxShadow: isCrit
                    ? '0 0 24px rgba(242, 204, 123, 0.55)'
                    : isFum
                      ? '0 0 24px rgba(239, 68, 68, 0.5)'
                      : '0 10px 24px rgba(0, 0, 0, 0.55)',
                  opacity: die.dropped ? 0.55 : 1,
                  animation: `mesaDiceCssFlip 860ms cubic-bezier(0.22, 1, 0.36, 1) ${idx * 65}ms both`,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: 26,
                    lineHeight: 1,
                    color: isCrit ? '#fffbeb' : isFum ? '#fee2e2' : '#f6dc9b',
                  }}
                >
                  {die.displayLabel}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    textTransform: 'uppercase',
                  }}
                >
                  d{die.sides}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Subtle Bottom-Center Settled Result & Dismiss Tap Chip */}
      {activeRoll && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 18,
            transform: `translate(-50%, ${settled ? '0px' : '12px'})`,
            opacity: settled ? 1 : 0,
            transition: 'opacity 220ms ease, transform 220ms ease',
            pointerEvents: settled ? 'auto' : 'none',
            maxWidth: 'min(92%, 440px)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px 8px 16px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(11, 15, 22, 0.92)',
              backdropFilter: 'blur(10px)',
              border: `1px solid ${accentBorder}`,
              boxShadow: accentGlow,
            }}
          >
            {mood === 'critical' && (
              <Sparkles size={18} style={{ color: '#fde68a', flexShrink: 0 }} />
            )}
            {mood === 'fumble' && (
              <Skull size={18} style={{ color: '#f87171', flexShrink: 0 }} />
            )}

            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {activeRoll.characterName || activeRoll.senderName}
                </span>
                <span>·</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeRoll.roll.label || activeRoll.roll.formula}
                </span>
                {activeRoll.visibility === 'gm_only' && (
                  <EyeOff size={12} style={{ color: 'var(--amethyst-400)', flexShrink: 0 }} />
                )}
              </div>
              {badgeText && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.03em',
                    color:
                      mood === 'critical'
                        ? '#fde68a'
                        : mood === 'fumble'
                          ? '#f87171'
                          : 'var(--gold-400)',
                  }}
                >
                  {badgeText}
                </div>
              )}
            </div>

            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 800,
                lineHeight: 1,
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                background:
                  mood === 'critical'
                    ? 'rgba(212, 168, 79, 0.24)'
                    : mood === 'fumble'
                      ? 'rgba(239, 68, 68, 0.22)'
                      : 'rgba(255, 255, 255, 0.08)',
                color:
                  mood === 'critical'
                    ? '#fffbeb'
                    : mood === 'fumble'
                      ? '#fecaca'
                      : 'var(--gold-400)',
                flexShrink: 0,
              }}
            >
              {activeRoll.roll.total}
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dispensar rolagem 3D"
              title="Dispensar"
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-full)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text-secondary)',
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiceOverlay3D;
