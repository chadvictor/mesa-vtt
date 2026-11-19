import * as THREE from 'three';

export type SupportedDieSides = 4 | 6 | 8 | 10 | 12 | 20;
export type DieVisualKind = 'd4' | 'd6' | 'd8' | 'd10' | 'd10_tens' | 'd10_units' | 'd12' | 'd20';
export type DieTheme = 'default' | 'critical' | 'fumble' | 'dropped';

export interface DieMeshBundle {
  /** Outer transform driven by physics simulation position & quaternion */
  root: THREE.Group;
  /** Inner pivot rotated by exact face-correction quaternion q_fix */
  pivot: THREE.Group;
  /** Primary polyhedron mesh */
  mesh: THREE.Mesh;
  /** Metallic edge highlights */
  edges: THREE.LineSegments;
  /** Maps canonical face value (e.g. 1..N, or 0..9 / 0..90 for d100) to unit normal pointing to +Y at rest */
  faceNormals: Map<number, THREE.Vector3>;
  /** All valid resting unit normals (for finding which face landed up in pre-sim) */
  allNormals: THREE.Vector3[];
  /** Approximate resting height from center to flat table surface */
  restHeight: number;
  /** Bounding radius for die-to-die collision avoidance */
  collisionRadius: number;
  /** Dispose per-instance geometries/materials (cached textures remain shared) */
  dispose: () => void;
}

interface ThemePalette {
  bgInner: string;
  bgOuter: string;
  borderOuter: string;
  borderInner: string;
  textColor: string;
  textShadow: string;
  edgeColor: number;
  emissive: number;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  opacity: number;
}

const THEME_PALETTES: Record<DieTheme, ThemePalette> = {
  default: {
    bgInner: '#1e2536',
    bgOuter: '#0b0e16',
    borderOuter: '#d4a84f',
    borderInner: 'rgba(242, 204, 123, 0.35)',
    textColor: '#f6dc9b',
    textShadow: 'rgba(0, 0, 0, 0.85)',
    edgeColor: 0xd4a84f,
    emissive: 0x16120a,
    emissiveIntensity: 0.14,
    roughness: 0.28,
    metalness: 0.42,
    opacity: 1,
  },
  critical: {
    bgInner: '#473612',
    bgOuter: '#1c1406',
    borderOuter: '#fde68a',
    borderInner: 'rgba(254, 240, 138, 0.75)',
    textColor: '#fffbeb',
    textShadow: 'rgba(212, 168, 79, 0.95)',
    edgeColor: 0xfde68a,
    emissive: 0xd4a84f,
    emissiveIntensity: 0.42,
    roughness: 0.2,
    metalness: 0.62,
    opacity: 1,
  },
  fumble: {
    bgInner: '#451218',
    bgOuter: '#170508',
    borderOuter: '#f87171',
    borderInner: 'rgba(239, 68, 68, 0.7)',
    textColor: '#fee2e2',
    textShadow: 'rgba(220, 38, 38, 0.95)',
    edgeColor: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.4,
    roughness: 0.26,
    metalness: 0.45,
    opacity: 1,
  },
  dropped: {
    bgInner: '#202631',
    bgOuter: '#0f131a',
    borderOuter: '#64748b',
    borderInner: 'rgba(148, 163, 184, 0.28)',
    textColor: '#94a3b8',
    textShadow: 'rgba(0, 0, 0, 0.7)',
    edgeColor: 0x64748b,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.55,
    metalness: 0.2,
    opacity: 0.68,
  },
};

const textureCache = new Map<string, THREE.CanvasTexture>();

function createFaceTexture(
  label: string,
  theme: DieTheme,
  shape: 'square' | 'triangle' | 'kite' | 'pentagon' | 'd4_corners',
  cornerLabels?: [string, string, string]
): THREE.CanvasTexture {
  const key = `${theme}:${shape}:${label}:${cornerLabels ? cornerLabels.join(',') : ''}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const pal = THEME_PALETTES[theme];
    const cx = size / 2;
    const cy = size / 2;

    // Rich radial dark-fantasy obsidian background
    const grad = ctx.createRadialGradient(cx, cy - 18, 12, cx, cy, size * 0.62);
    grad.addColorStop(0, pal.bgInner);
    grad.addColorStop(1, pal.bgOuter);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle forged metallic grain rings
    ctx.strokeStyle = pal.borderInner;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (shape === 'square') {
      // Ornate beveled square frame for d6
      ctx.strokeStyle = pal.borderOuter;
      ctx.lineWidth = 10;
      ctx.strokeRect(14, 14, size - 28, size - 28);

      ctx.strokeStyle = pal.borderInner;
      ctx.lineWidth = 3;
      ctx.strokeRect(28, 28, size - 56, size - 56);

      // Corner filigree dots
      const corners = [
        [34, 34],
        [size - 34, 34],
        [34, size - 34],
        [size - 34, size - 34],
      ];
      ctx.fillStyle = pal.borderOuter;
      for (const [x, y] of corners) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (shape === 'd4_corners' && cornerLabels) {
      // Triangle border + 3 vertex numbers oriented toward their respective corners
      const verts: Array<[number, number]> = [
        [cx, 24],
        [24, size - 28],
        [size - 24, size - 28],
      ];
      ctx.strokeStyle = pal.borderOuter;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(verts[0][0], verts[0][1]);
      ctx.lineTo(verts[1][0], verts[1][1]);
      ctx.lineTo(verts[2][0], verts[2][1]);
      ctx.closePath();
      ctx.stroke();

      // Draw each vertex's number near that vertex pointing outward toward the peak
      ctx.font = '800 54px "Cinzel", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = pal.textColor;
      ctx.shadowColor = pal.textShadow;
      ctx.shadowBlur = 10;

      for (let i = 0; i < 3; i++) {
        const [vx, vy] = verts[i];
        const px = vx + (cx - vx) * 0.34;
        const py = vy + (cy + 14 - vy) * 0.34;
        const angle = Math.atan2(vy - (cy + 14), vx - cx) + Math.PI / 2;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.fillText(cornerLabels[i], 0, 0);
        ctx.restore();
      }
      ctx.shadowBlur = 0;
    } else if (shape === 'triangle') {
      // Decorative inner circle accent for d8 / d20
      ctx.strokeStyle = pal.borderInner;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy + 8, size * 0.28, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === 'pentagon') {
      ctx.strokeStyle = pal.borderInner;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const rx = cx + Math.cos(a) * size * 0.38;
        const ry = cy + Math.sin(a) * size * 0.38;
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (shape === 'kite') {
      ctx.strokeStyle = pal.borderInner;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, 26);
      ctx.lineTo(size - 40, cy + 12);
      ctx.lineTo(cx, size - 24);
      ctx.lineTo(40, cy + 12);
      ctx.closePath();
      ctx.stroke();
    }

    if (shape !== 'd4_corners') {
      const len = label.length;
      const fontSize =
        shape === 'square'
          ? len > 1
            ? 102
            : 128
          : shape === 'triangle'
            ? len > 1
              ? 68
              : 84
            : len > 1
              ? 78
              : 98;
      const textY = shape === 'triangle' ? cy + 10 : cy + 4;

      ctx.font = `800 ${fontSize}px "Cinzel", "Palatino Linotype", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Crisp dark outline + glow shadow for legibility at every angle
      ctx.shadowColor = pal.textShadow;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.strokeText(label, cx, textY);

      ctx.fillStyle = pal.textColor;
      ctx.fillText(label, cx, textY);
      ctx.shadowBlur = 0;

      // Disambiguate 6 and 9 with a crisp gold underline bar
      if (label === '6' || label === '9') {
        const barW = fontSize * 0.42;
        const barY = textY + fontSize * 0.44;
        ctx.fillStyle = pal.borderOuter;
        ctx.fillRect(cx - barW / 2, barY, barW, 6);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}

function makeMaterial(tex: THREE.CanvasTexture, theme: DieTheme): THREE.MeshStandardMaterial {
  const pal = THEME_PALETTES[theme];
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: pal.roughness,
    metalness: pal.metalness,
    emissive: new THREE.Color(pal.emissive),
    emissiveIntensity: pal.emissiveIntensity,
    transparent: pal.opacity < 1,
    opacity: pal.opacity,
  });
}

function makeEdges(geo: THREE.BufferGeometry, theme: DieTheme): THREE.LineSegments {
  const pal = THEME_PALETTES[theme];
  const edgesGeo = new THREE.EdgesGeometry(geo, 14);
  const edgesMat = new THREE.LineBasicMaterial({
    color: pal.edgeColor,
    transparent: true,
    opacity: theme === 'dropped' ? 0.35 : 0.78,
  });
  return new THREE.LineSegments(edgesGeo, edgesMat);
}

/**
 * Helper that takes a non-indexed Platonic BufferGeometry (d8, d12, d20),
 * clusters coplanar triangles by outward normal into distinct polygon faces,
 * builds clean planar centered UVs, and assigns opposite faces symmetrically.
 */
function buildPlatonicDie(
  sourceGeo: THREE.BufferGeometry,
  faceValues: number[],
  shape: 'triangle' | 'pentagon',
  theme: DieTheme,
  restHeight: number,
  collisionRadius: number
): DieMeshBundle {
  const nonIndexed = sourceGeo.index ? sourceGeo.toNonIndexed() : sourceGeo;
  const posAttr = nonIndexed.getAttribute('position');
  const triCount = posAttr.count / 3;

  interface FaceGroup {
    normal: THREE.Vector3;
    triangles: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]>;
  }

  const groups: FaceGroup[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const triNormal = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(posAttr, t * 3);
    b.fromBufferAttribute(posAttr, t * 3 + 1);
    c.fromBufferAttribute(posAttr, t * 3 + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    triNormal.crossVectors(ab, ac).normalize();

    // Ensure outward winding relative to origin
    const centroid = a.clone().add(b).add(c).divideScalar(3);
    let tri: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [a.clone(), b.clone(), c.clone()];
    if (triNormal.dot(centroid) < 0) {
      triNormal.negate();
      tri = [a.clone(), c.clone(), b.clone()];
    }

    let target = groups.find((g) => g.normal.dot(triNormal) > 0.99);
    if (!target) {
      target = { normal: triNormal.clone(), triangles: [] };
      groups.push(target);
    }
    target.triangles.push(tri);
  }

  // Pair opposite faces so opposite faces get opposite values (e.g. 1 <-> 20)
  const used = new Set<number>();
  const orderedGroups: FaceGroup[] = [];
  const totalFaces = groups.length;
  const half = Math.floor(totalFaces / 2);
  const frontHalf: FaceGroup[] = [];
  const backHalf: FaceGroup[] = [];

  for (let i = 0; i < totalFaces; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let oppIdx = -1;
    let bestDot = 1;
    for (let j = i + 1; j < totalFaces; j++) {
      if (used.has(j)) continue;
      const d = groups[i].normal.dot(groups[j].normal);
      if (d < bestDot) {
        bestDot = d;
        oppIdx = j;
      }
    }
    frontHalf.push(groups[i]);
    if (oppIdx !== -1) {
      used.add(oppIdx);
      backHalf.push(groups[oppIdx]);
    }
  }
  for (let i = 0; i < half; i++) {
    if (frontHalf[i]) orderedGroups.push(frontHalf[i]);
  }
  for (let i = half - 1; i >= 0; i--) {
    if (backHalf[i]) orderedGroups.push(backHalf[i]);
  }
  // Fallback if odd count ever happened
  const finalGroups = orderedGroups.length === groups.length ? orderedGroups : groups;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const geo = new THREE.BufferGeometry();
  const materials: THREE.MeshStandardMaterial[] = [];
  const faceNormals = new Map<number, THREE.Vector3>();
  const allNormals: THREE.Vector3[] = [];

  let vertexCursor = 0;

  finalGroups.forEach((group, idx) => {
    const faceValue = faceValues[idx] ?? idx + 1;
    const n = group.normal.clone().normalize();
    faceNormals.set(faceValue, n);
    allNormals.push(n);

    // Collect unique vertices on this face to compute exact centroid and radius
    const faceCentroid = new THREE.Vector3();
    let vCount = 0;
    for (const [v0, v1, v2] of group.triangles) {
      faceCentroid.add(v0).add(v1).add(v2);
      vCount += 3;
    }
    faceCentroid.divideScalar(vCount);

    // Choose tangent axes (uAxis, vAxis) aligned nicely to a vertex so text sits upright
    const firstVert = group.triangles[0][0];
    const vAxis = firstVert.clone().sub(faceCentroid);
    vAxis.addScaledVector(n, -vAxis.dot(n)).normalize();
    const uAxis = new THREE.Vector3().crossVectors(vAxis, n).normalize();

    let maxRadius = 0.001;
    for (const tri of group.triangles) {
      for (const v of tri) {
        const rel = v.clone().sub(faceCentroid);
        const dist = Math.hypot(rel.dot(uAxis), rel.dot(vAxis));
        if (dist > maxRadius) maxRadius = dist;
      }
    }

    const uvScale = shape === 'triangle' ? 0.44 / maxRadius : 0.46 / maxRadius;
    const groupStart = vertexCursor;

    for (const tri of group.triangles) {
      for (const v of tri) {
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        const rel = v.clone().sub(faceCentroid);
        const u = 0.5 + rel.dot(uAxis) * uvScale;
        const vv = 0.5 + rel.dot(vAxis) * uvScale;
        uvs.push(u, vv);
        vertexCursor++;
      }
    }

    geo.addGroup(groupStart, vertexCursor - groupStart, idx);
    const tex = createFaceTexture(String(faceValue), theme, shape);
    materials.push(makeMaterial(tex, theme));
  });

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  sourceGeo.dispose();
  if (nonIndexed !== sourceGeo) nonIndexed.dispose();

  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = makeEdges(geo, theme);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.add(edges);

  const root = new THREE.Group();
  root.add(pivot);

  return {
    root,
    pivot,
    mesh,
    edges,
    faceNormals,
    allNormals,
    restHeight,
    collisionRadius,
    dispose: () => {
      geo.dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      for (const m of materials) m.dispose();
    },
  };
}

function buildD6(theme: DieTheme): DieMeshBundle {
  const size = 1.12;
  const geo = new THREE.BoxGeometry(size, size, size);
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (opposite faces sum to 7)
  const faceSpec: Array<{ value: number; normal: THREE.Vector3 }> = [
    { value: 3, normal: new THREE.Vector3(1, 0, 0) },
    { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
    { value: 6, normal: new THREE.Vector3(0, 1, 0) },
    { value: 1, normal: new THREE.Vector3(0, -1, 0) },
    { value: 2, normal: new THREE.Vector3(0, 0, 1) },
    { value: 5, normal: new THREE.Vector3(0, 0, -1) },
  ];

  const materials: THREE.MeshStandardMaterial[] = [];
  const faceNormals = new Map<number, THREE.Vector3>();
  const allNormals: THREE.Vector3[] = [];

  for (const spec of faceSpec) {
    faceNormals.set(spec.value, spec.normal);
    allNormals.push(spec.normal);
    const tex = createFaceTexture(String(spec.value), theme, 'square');
    materials.push(makeMaterial(tex, theme));
  }

  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = makeEdges(geo, theme);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.add(edges);

  const root = new THREE.Group();
  root.add(pivot);

  return {
    root,
    pivot,
    mesh,
    edges,
    faceNormals,
    allNormals,
    restHeight: size * 0.5,
    collisionRadius: size * 0.78,
    dispose: () => {
      geo.dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/**
 * Regular Tetrahedron (d4):
 * Each vertex represents values 1..4. When vertex k points straight up (+Y),
 * the opposite face sits dead flat on the table and all 3 visible faces show k at the top peak!
 */
function buildD4(theme: DieTheme): DieMeshBundle {
  const radius = 0.96;
  const rawVerts: Array<{ value: number; pos: THREE.Vector3 }> = [
    { value: 1, pos: new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(radius) },
    { value: 2, pos: new THREE.Vector3(1, -1, -1).normalize().multiplyScalar(radius) },
    { value: 3, pos: new THREE.Vector3(-1, 1, -1).normalize().multiplyScalar(radius) },
    { value: 4, pos: new THREE.Vector3(-1, -1, 1).normalize().multiplyScalar(radius) },
  ];

  // 4 triangular faces, each omitting one vertex
  const faceIndices: Array<[number, number, number]> = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const geo = new THREE.BufferGeometry();
  const materials: THREE.MeshStandardMaterial[] = [];

  // Triangle UVs matching createFaceTexture('d4_corners') vertex layout:
  // verts[0] = top (0.5, 0.906), verts[1] = bottom-left (0.094, 0.109), verts[2] = bottom-right (0.906, 0.109)
  const triUVs: Array<[number, number]> = [
    [0.5, 1 - 24 / 256],
    [24 / 256, 28 / 256],
    [1 - 24 / 256, 28 / 256],
  ];

  faceIndices.forEach((indices, fIdx) => {
    const [i0, i1, i2] = indices;
    const v0 = rawVerts[i0].pos;
    const v1 = rawVerts[i1].pos;
    const v2 = rawVerts[i2].pos;

    const ab = v1.clone().sub(v0);
    const ac = v2.clone().sub(v0);
    const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
    const centroid = v0.clone().add(v1).add(v2).divideScalar(3);

    let ordered: Array<{ value: number; pos: THREE.Vector3 }> = [
      rawVerts[i0],
      rawVerts[i1],
      rawVerts[i2],
    ];
    if (n.dot(centroid) < 0) {
      n.negate();
      ordered = [rawVerts[i0], rawVerts[i2], rawVerts[i1]];
    }

    const start = fIdx * 3;
    for (let k = 0; k < 3; k++) {
      const p = ordered[k].pos;
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(triUVs[k][0], triUVs[k][1]);
    }

    geo.addGroup(start, 3, fIdx);
    const cornerLabels: [string, string, string] = [
      String(ordered[0].value),
      String(ordered[1].value),
      String(ordered[2].value),
    ];
    const tex = createFaceTexture(`d4-${fIdx}`, theme, 'd4_corners', cornerLabels);
    materials.push(makeMaterial(tex, theme));
  });

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const faceNormals = new Map<number, THREE.Vector3>();
  const allNormals: THREE.Vector3[] = [];
  for (const v of rawVerts) {
    const dir = v.pos.clone().normalize();
    faceNormals.set(v.value, dir);
    allNormals.push(dir);
  }

  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = makeEdges(geo, theme);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.add(edges);

  const root = new THREE.Group();
  root.add(pivot);

  // Distance from origin to opposite face of regular tetrahedron is radius / 3
  return {
    root,
    pivot,
    mesh,
    edges,
    faceNormals,
    allNormals,
    restHeight: radius / 3,
    collisionRadius: radius * 0.78,
    dispose: () => {
      geo.dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/**
 * Mathematically planar Pentagonal Trapezohedron (d10, d10_tens, d10_units).
 * Central symmetry (D_5d) guarantees every kite face has an exact opposite flat kite face!
 */
function buildD10(mode: 'd10' | 'd10_tens' | 'd10_units', theme: DieTheme): DieMeshBundle {
  const R = 0.86;
  const H = 0.84;
  // Exact planarity condition: h = H * (1 - cos(36°)) / (1 + cos(36°))
  const cos36 = Math.cos(Math.PI / 5);
  const h = (H * (1 - cos36)) / (1 + cos36);

  const pTop = new THREE.Vector3(0, H, 0);
  const pBot = new THREE.Vector3(0, -H, 0);
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];

  for (let k = 0; k < 5; k++) {
    const aU = (k * 2 * Math.PI) / 5;
    const aL = ((k + 0.5) * 2 * Math.PI) / 5;
    upper.push(new THREE.Vector3(Math.cos(aU) * R, h, Math.sin(aU) * R));
    lower.push(new THREE.Vector3(Math.cos(aL) * R, -h, Math.sin(aL) * R));
  }

  // Values & labels for the 10 kites (5 top odd/even alternating, 5 bottom)
  const faceDefs: Array<{ value: number; label: string }> =
    mode === 'd10_tens'
      ? [
          { value: 0, label: '00' },
          { value: 20, label: '20' },
          { value: 40, label: '40' },
          { value: 60, label: '60' },
          { value: 80, label: '80' },
          { value: 10, label: '10' },
          { value: 30, label: '30' },
          { value: 50, label: '50' },
          { value: 70, label: '70' },
          { value: 90, label: '90' },
        ]
      : mode === 'd10_units'
        ? [
            { value: 0, label: '0' },
            { value: 2, label: '2' },
            { value: 4, label: '4' },
            { value: 6, label: '6' },
            { value: 8, label: '8' },
            { value: 1, label: '1' },
            { value: 3, label: '3' },
            { value: 5, label: '5' },
            { value: 7, label: '7' },
            { value: 9, label: '9' },
          ]
        : [
            { value: 1, label: '1' },
            { value: 3, label: '3' },
            { value: 5, label: '5' },
            { value: 7, label: '7' },
            { value: 9, label: '9' },
            { value: 2, label: '2' },
            { value: 4, label: '4' },
            { value: 6, label: '6' },
            { value: 8, label: '8' },
            { value: 10, label: '10' },
          ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const geo = new THREE.BufferGeometry();
  const materials: THREE.MeshStandardMaterial[] = [];
  const faceNormals = new Map<number, THREE.Vector3>();
  const allNormals: THREE.Vector3[] = [];

  // Kite corners in order: [pole, right, far, left]
  const kites: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
  for (let k = 0; k < 5; k++) {
    const kNext = (k + 1) % 5;
    kites.push([pTop, upper[k], lower[k], upper[kNext]]);
  }
  for (let k = 0; k < 5; k++) {
    const kNext = (k + 1) % 5;
    kites.push([pBot, lower[kNext], upper[kNext], lower[k]]);
  }

  let cursor = 0;
  let restHeight = 0.62;

  kites.forEach((kite, idx) => {
    const [pole, right, far, left] = kite;
    const centroid = pole.clone().add(right).add(far).add(left).divideScalar(4);

    // Compute exact outward face normal
    const e1 = right.clone().sub(pole);
    const e2 = far.clone().sub(pole);
    const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
    let pA = pole;
    let pB = right;
    let pC = far;
    let pD = left;
    if (n.dot(centroid) < 0) {
      n.negate();
      pB = left;
      pD = right;
    }

    // Distance from origin to kite plane
    restHeight = Math.abs(centroid.dot(n));

    const def = faceDefs[idx];
    faceNormals.set(def.value, n);
    allNormals.push(n);

    // Kite UV coordinates matching createFaceTexture('kite')
    const uvPole: [number, number] = [0.5, 0.92];
    const uvRight: [number, number] = [0.85, 0.45];
    const uvFar: [number, number] = [0.5, 0.08];
    const uvLeft: [number, number] = [0.15, 0.45];

    const tris: Array<[THREE.Vector3, [number, number]]> = [
      [pA, uvPole],
      [pB, uvRight],
      [pC, uvFar],
      [pA, uvPole],
      [pC, uvFar],
      [pD, uvLeft],
    ];

    const start = cursor;
    for (const [v, uv] of tris) {
      positions.push(v.x, v.y, v.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(uv[0], uv[1]);
      cursor++;
    }

    geo.addGroup(start, 6, idx);
    const tex = createFaceTexture(def.label, theme, 'kite');
    materials.push(makeMaterial(tex, theme));
  });

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = makeEdges(geo, theme);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.add(edges);

  const root = new THREE.Group();
  root.add(pivot);

  return {
    root,
    pivot,
    mesh,
    edges,
    faceNormals,
    allNormals,
    restHeight,
    collisionRadius: R * 0.95,
    dispose: () => {
      geo.dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      for (const m of materials) m.dispose();
    },
  };
}

export function createDieMesh(kind: DieVisualKind, theme: DieTheme = 'default'): DieMeshBundle {
  switch (kind) {
    case 'd4':
      return buildD4(theme);
    case 'd6':
      return buildD6(theme);
    case 'd8':
      return buildPlatonicDie(
        new THREE.OctahedronGeometry(0.92, 0),
        [1, 2, 3, 4, 5, 6, 7, 8],
        'triangle',
        theme,
        0.92 / Math.sqrt(3),
        0.84
      );
    case 'd10':
      return buildD10('d10', theme);
    case 'd10_tens':
      return buildD10('d10_tens', theme);
    case 'd10_units':
      return buildD10('d10_units', theme);
    case 'd12':
      return buildPlatonicDie(
        new THREE.DodecahedronGeometry(0.86, 0),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        'pentagon',
        theme,
        0.68,
        0.86
      );
    case 'd20':
      return buildPlatonicDie(
        new THREE.IcosahedronGeometry(0.9, 0),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        'triangle',
        theme,
        0.71,
        0.88
      );
  }
}

export interface ExpandedVisualDie {
  kind: DieVisualKind;
  targetValue: number;
  displayLabel: string;
  sides: number;
  dropped: boolean;
}

/**
 * Expands server RolledDie entries into visual 3D dice (turning d100 into a tens + units d10 pair).
 */
export function expandRolledDice(
  dice: Array<{ sides: number; value: number; dropped?: boolean }>
): ExpandedVisualDie[] {
  const result: ExpandedVisualDie[] = [];
  for (const d of dice) {
    if (d.sides === 100) {
      const clamped = Math.max(1, Math.min(100, Math.round(d.value)));
      const tensVal = clamped === 100 ? 0 : Math.floor(clamped / 10) * 10;
      const unitsVal = clamped === 100 ? 0 : clamped % 10;
      result.push({
        kind: 'd10_tens',
        targetValue: tensVal,
        displayLabel: tensVal === 0 ? '00' : String(tensVal),
        sides: 100,
        dropped: Boolean(d.dropped),
      });
      result.push({
        kind: 'd10_units',
        targetValue: unitsVal,
        displayLabel: String(unitsVal),
        sides: 100,
        dropped: Boolean(d.dropped),
      });
    } else if (d.sides === 4) {
      result.push({
        kind: 'd4',
        targetValue: Math.max(1, Math.min(4, Math.round(d.value))),
        displayLabel: String(d.value),
        sides: 4,
        dropped: Boolean(d.dropped),
      });
    } else if (d.sides === 6) {
      result.push({
        kind: 'd6',
        targetValue: Math.max(1, Math.min(6, Math.round(d.value))),
        displayLabel: String(d.value),
        sides: 6,
        dropped: Boolean(d.dropped),
      });
    } else if (d.sides === 8) {
      result.push({
        kind: 'd8',
        targetValue: Math.max(1, Math.min(8, Math.round(d.value))),
        displayLabel: String(d.value),
        sides: 8,
        dropped: Boolean(d.dropped),
      });
    } else if (d.sides === 10) {
      result.push({
        kind: 'd10',
        targetValue: Math.max(1, Math.min(10, Math.round(d.value))),
        displayLabel: String(d.value),
        sides: 10,
        dropped: Boolean(d.dropped),
      });
    } else if (d.sides === 12) {
      result.push({
        kind: 'd12',
        targetValue: Math.max(1, Math.min(12, Math.round(d.value))),
        displayLabel: String(d.value),
        sides: 12,
        dropped: Boolean(d.dropped),
      });
    } else {
      // Default to d20 for 20 or exotic custom die sizes
      const clamped = Math.max(1, Math.min(20, Math.round(d.value)));
      result.push({
        kind: 'd20',
        targetValue: clamped,
        displayLabel: String(d.value),
        sides: d.sides,
        dropped: Boolean(d.dropped),
      });
    }
  }
  return result;
}
