import * as THREE from 'three';

export interface DieSimulationInput {
  restHeight: number;
  collisionRadius: number;
  targetNormal: THREE.Vector3;
  allNormals: THREE.Vector3[];
}

export interface DieTrajectory {
  /** Recorded world-space center positions at 60Hz */
  positions: THREE.Vector3[];
  /** Recorded world-space quaternions at 60Hz */
  quaternions: THREE.Quaternion[];
  /** Constant local correction quaternion baked into inner pivot so target face lands strictly on +Y */
  fixQuaternion: THREE.Quaternion;
  /** First impact timestamp in seconds (used for camera micro-shake on fumbles / sparks on crits) */
  firstImpactTime: number;
  /** Total throw duration in seconds */
  duration: number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Deterministic Mulberry32 PRNG matching ARCHITECTURE.md Section 7.
 * Produces identical trajectories on every client given the server's uint32 roll seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes a quaternion mapping unit vector `from` onto unit vector `to`,
 * safely handling the 180° antiparallel edge case.
 */
function safeFromUnitVectors(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  const f = from.clone().normalize();
  const t = to.clone().normalize();
  const dot = f.dot(t);

  if (dot > 0.99999) {
    return new THREE.Quaternion();
  }
  if (dot < -0.99999) {
    // Pick an orthogonal axis for 180-degree rotation
    const ortho = Math.abs(f.x) < 0.85 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const axis = new THREE.Vector3().crossVectors(f, ortho).normalize();
    return new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
  }
  return new THREE.Quaternion().setFromUnitVectors(f, t);
}

/**
 * Pre-simulates a synchronized multi-die throw on the virtual tabletop.
 *
 * Guarantees:
 * 1. Identical physics across all clients given the same `seed`.
 * 2. Zero overlap between settled dice via soft horizontal separation impulses.
 * 3. 100% authentic bounce + spin with zero snapping: each die's `fixQuaternion`
 *    pre-rotates the inner geometry so the exact server-rolled face lands pointing +Y.
 */
export function simulateDiceThrow(
  dice: DieSimulationInput[],
  seed: number,
  arenaHalfWidth = 4.6,
  arenaHalfDepth = 2.6
): DieTrajectory[] {
  const count = dice.length;
  if (count === 0) return [];

  const dt = 1 / 60;
  const gravity = -34;
  const maxFrames = 96; // 1.6s upper bound
  const settleFrames = 16; // Smooth flat-landing slerp window

  interface SimBody {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    quat: THREE.Quaternion;
    angVel: THREE.Vector3;
    restHeight: number;
    radius: number;
    firstImpactTime: number;
    bounces: number;
    positions: THREE.Vector3[];
    quaternions: THREE.Quaternion[];
  }

  const bodies: SimBody[] = dice.map((die, idx) => {
    const rng = mulberry32((seed ^ ((idx + 1) * 2654435761)) >>> 0);

    // Fan starting positions along the left/bottom-left rim of the tabletop
    const spread = count > 1 ? (idx / (count - 1) - 0.5) * Math.min(3.6, count * 0.95) : 0;
    const startX = -arenaHalfWidth * 0.85 - rng() * 1.4;
    const startY = 3.2 + rng() * 1.6 + idx * 0.14;
    const startZ = spread + (rng() - 0.5) * 0.7;

    // Energetic throw velocity aimed toward center of tabletop
    const targetX = (rng() - 0.5) * Math.min(3.8, 1.4 + count * 0.45);
    const targetZ = spread * 0.65 + (rng() - 0.5) * 1.2;
    const vx = (targetX - startX) * (1.25 + rng() * 0.35);
    const vy = 1.8 + rng() * 2.6;
    const vz = (targetZ - startZ) * (1.1 + rng() * 0.4);

    // Random initial orientation & brisk tumble spin
    const initEuler = new THREE.Euler(
      rng() * Math.PI * 2,
      rng() * Math.PI * 2,
      rng() * Math.PI * 2
    );
    const quat = new THREE.Quaternion().setFromEuler(initEuler);

    const angSpeed = 9 + rng() * 8;
    const angAxis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    const angVel = angAxis.multiplyScalar(angSpeed);

    return {
      pos: new THREE.Vector3(startX, startY, startZ),
      vel: new THREE.Vector3(vx, vy, vz),
      quat,
      angVel,
      restHeight: die.restHeight,
      radius: die.collisionRadius,
      firstImpactTime: -1,
      bounces: 0,
      positions: [],
      quaternions: [],
    };
  });

  const deltaQuat = new THREE.Quaternion();
  const spinAxis = new THREE.Vector3();
  const sepVec = new THREE.Vector3();

  // Step 1: Pure rigid-body ballistic + floor/wall + die-to-die repulsion simulation
  for (let frame = 0; frame < maxFrames; frame++) {
    const t = frame * dt;

    for (let i = 0; i < count; i++) {
      const b = bodies[i];

      // Gravity & linear integration
      b.vel.y += gravity * dt;
      b.pos.addScaledVector(b.vel, dt);

      // Floor collision
      if (b.pos.y <= b.restHeight) {
        b.pos.y = b.restHeight;
        if (b.firstImpactTime < 0) {
          b.firstImpactTime = t;
        }
        if (Math.abs(b.vel.y) > 0.9) {
          b.vel.y = -b.vel.y * 0.44;
          b.vel.x *= 0.74;
          b.vel.z *= 0.74;
          b.angVel.multiplyScalar(0.76);
          b.bounces++;
        } else {
          b.vel.y = 0;
          // Rolling friction on tabletop
          b.vel.x *= 0.89;
          b.vel.z *= 0.89;
          b.angVel.multiplyScalar(0.87);
        }
      }

      // Soft invisible arena walls so dice stay framed inside center stage
      const maxX = arenaHalfWidth - b.radius;
      const maxZ = arenaHalfDepth - b.radius;
      if (b.pos.x > maxX) {
        b.pos.x = maxX;
        b.vel.x = -Math.abs(b.vel.x) * 0.52;
      } else if (b.pos.x < -maxX - 1.2 && frame > 14) {
        b.pos.x = -maxX - 1.2;
        b.vel.x = Math.abs(b.vel.x) * 0.52;
      }
      if (b.pos.z > maxZ) {
        b.pos.z = maxZ;
        b.vel.z = -Math.abs(b.vel.z) * 0.52;
      } else if (b.pos.z < -maxZ) {
        b.pos.z = -maxZ;
        b.vel.z = Math.abs(b.vel.z) * 0.52;
      }

      // Progressive damping near the end of the throw so all dice settle gracefully
      if (frame > maxFrames - settleFrames - 18) {
        b.vel.x *= 0.9;
        b.vel.z *= 0.9;
        b.angVel.multiplyScalar(0.84);
      }

      // Integrate angular velocity into quaternion
      const speed = b.angVel.length();
      if (speed > 0.001) {
        spinAxis.copy(b.angVel).divideScalar(speed);
        deltaQuat.setFromAxisAngle(spinAxis, speed * dt);
        b.quat.premultiply(deltaQuat).normalize();
      }
    }

    // Die-to-die horizontal collision separation so dice never settle overlapping
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const minDist = (a.radius + b.radius) * 1.12;
        sepVec.set(b.pos.x - a.pos.x, 0, b.pos.z - a.pos.z);
        const dist = sepVec.length();
        if (dist < minDist) {
          if (dist < 0.0001) {
            sepVec.set(1, 0, 0);
          } else {
            sepVec.divideScalar(dist);
          }
          const push = (minDist - dist) * 0.5;
          a.pos.addScaledVector(sepVec, -push);
          b.pos.addScaledVector(sepVec, push);
          // Exchange gentle elastic impulse
          const relVel = (b.vel.x - a.vel.x) * sepVec.x + (b.vel.z - a.vel.z) * sepVec.z;
          if (relVel < 0) {
            const imp = -relVel * 0.45;
            a.vel.addScaledVector(sepVec, -imp);
            b.vel.addScaledVector(sepVec, imp);
          }
        }
      }
    }

    // Snapshot frame
    for (let i = 0; i < count; i++) {
      const b = bodies[i];
      b.positions.push(b.pos.clone());
      b.quaternions.push(b.quat.clone());
    }
  }

  // Step 2: Determine winning flat resting orientation & compute exact face-alignment q_fix
  return bodies.map((b, idx) => {
    const die = dice[idx];
    const lastQuat = b.quaternions[b.quaternions.length - 1];

    // Find which candidate normal of the polyhedron ended up pointing closest to world +Y
    let winnerNormal = die.allNormals[0].clone();
    let bestDot = -Infinity;
    const worldNormal = new THREE.Vector3();

    for (const n of die.allNormals) {
      worldNormal.copy(n).applyQuaternion(lastQuat);
      const d = worldNormal.dot(WORLD_UP);
      if (d > bestDot) {
        bestDot = d;
        winnerNormal = n.clone();
      }
    }

    // Compute exact flat resting quaternion where `winnerNormal` points straight to +Y
    // while preserving the natural horizontal yaw from `lastQuat`.
    const currentWinnerWorld = winnerNormal.clone().applyQuaternion(lastQuat).normalize();
    const tiltAlign = safeFromUnitVectors(currentWinnerWorld, WORLD_UP);
    const flatRestQuat = tiltAlign.clone().multiply(lastQuat).normalize();

    // Smoothly blend the last `settleFrames` into `flatRestQuat` and `y = restHeight`
    // so the die settles cleanly flat on the tabletop with zero snap
    const total = b.quaternions.length;
    const startBlend = Math.max(0, total - settleFrames);
    for (let f = startBlend; f < total; f++) {
      const u = (f - startBlend) / Math.max(1, total - 1 - startBlend);
      // Smoothstep easing
      const ease = u * u * (3 - 2 * u);
      b.quaternions[f].slerp(flatRestQuat, ease);
      b.positions[f].y = THREE.MathUtils.lerp(b.positions[f].y, b.restHeight, ease);
    }

    // Compute exact constant inner-pivot correction quaternion:
    // Maps the server-rolled `targetNormal` -> `winnerNormal` in local space.
    // Because `flatRestQuat` maps `winnerNormal` -> `+Y`, the target face ends strictly at `+Y`!
    const fixQuaternion = safeFromUnitVectors(die.targetNormal, winnerNormal);

    return {
      positions: b.positions,
      quaternions: b.quaternions,
      fixQuaternion,
      firstImpactTime: b.firstImpactTime >= 0 ? b.firstImpactTime : 0.25,
      duration: (total - 1) * dt,
    };
  });
}

/**
 * Samples a pre-simulated trajectory smoothly at arbitrary elapsed seconds (supports 60Hz/120Hz/144Hz monitors).
 */
export function sampleTrajectory(
  traj: DieTrajectory,
  elapsedSeconds: number,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion
): boolean {
  const maxIdx = traj.positions.length - 1;
  if (maxIdx <= 0) {
    return true;
  }
  const exactFrame = elapsedSeconds * 60;
  if (exactFrame >= maxIdx) {
    outPos.copy(traj.positions[maxIdx]);
    outQuat.copy(traj.quaternions[maxIdx]);
    return true;
  }
  const i0 = Math.max(0, Math.floor(exactFrame));
  const i1 = Math.min(maxIdx, i0 + 1);
  const alpha = exactFrame - i0;
  outPos.lerpVectors(traj.positions[i0], traj.positions[i1], alpha);
  outQuat.slerpQuaternions(traj.quaternions[i0], traj.quaternions[i1], alpha);
  return false;
}
