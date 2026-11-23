import { Matrix, Mesh, MeshBuilder, Quaternion, Vector3, VertexData, type Scene } from '@babylonjs/core';

/**
 * Mesh from rings of points (a loft): ring i at texture u = us[i], point j at v = vs[j] (or j / n). A closed loft
 * repeats each ring's first point so the texture wraps without a seam.
 */
export function loft(scene: Scene, name: string, rings: readonly (readonly Vector3[])[], us: readonly number[], vs: readonly number[] | null, closed: boolean): Mesh {
  const n = rings[0]!.length;
  const cols = closed ? n + 1 : n;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  rings.forEach((ring, i) => {
    for (let j = 0; j < cols; j++) {
      const p = ring[j % n]!;
      positions.push(p.x, p.y, p.z);
      uvs.push(us[i]!, j === n ? 1 : vs ? vs[j]! : j / (cols - 1));
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const c = a + cols;
      indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  return meshFrom(scene, name, positions, indices, uvs);
}

/** A mesh from raw positions, indices and uvs, with computed normals. */
export function meshFrom(scene: Scene, name: string, positions: number[], indices: number[], uvs: number[]): Mesh {
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, true);
  return m;
}

/**
 * Turns a mesh's faces outward: normals should point away from `ref` (by default the centre of all vertices). Lofts
 * and lathes are built without caring about winding, then fixed here.
 */
export function orient(m: Mesh, ref?: (x: number, y: number, z: number) => [number, number, number]): Mesh {
  const p = m.getVerticesData('position');
  const n = m.getVerticesData('normal');
  if (!p || !n) return m;
  const k = p.length / 3;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < k; i++) {
    cx += p[i * 3]!;
    cy += p[i * 3 + 1]!;
    cz += p[i * 3 + 2]!;
  }
  cx /= k;
  cy /= k;
  cz /= k;
  let s = 0;
  for (let i = 0; i < k; i++) {
    const x = p[i * 3]!;
    const y = p[i * 3 + 1]!;
    const z = p[i * 3 + 2]!;
    const [rx, ry, rz] = ref ? ref(x, y, z) : [cx, cy, cz];
    s += n[i * 3]! * (x - rx) + n[i * 3 + 1]! * (y - ry) + n[i * 3 + 2]! * (z - rz);
  }
  if (s < 0) m.flipFaces(true);
  return m;
}

/** NACA 00xx half thickness at chord fraction x. */
const thickness = (x: number) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
const FOIL = 12;

/** One airfoil section: leading edge `le`, chord along −x, thickness ratio `t` along `td`. */
function foil(le: Vector3, chord: number, t: number, td: Vector3): { pts: Vector3[]; vs: number[] } {
  const pts: Vector3[] = [];
  const vs: number[] = [];
  for (let i = 0; i <= FOIL; i++) {
    const x = (1 - Math.cos((1 - i / FOIL) * Math.PI)) / 2;
    pts.push(le.add(new Vector3(-x * chord, 0, 0)).add(td.scale(thickness(x) * chord * t)));
    vs.push(0.5 * (1 - x));
  }
  for (let i = 1; i < FOIL; i++) {
    const x = (1 - Math.cos((i / FOIL) * Math.PI)) / 2;
    pts.push(le.add(new Vector3(-x * chord, 0, 0)).subtract(td.scale(thickness(x) * chord * t)));
    vs.push(0.5 + 0.5 * x);
  }
  return { pts, vs };
}

export interface Station {
  readonly le: Vector3;
  readonly chord: number;
  readonly t?: number;
}

/**
 * A wing, tail or winglet lofted through airfoil sections. Texture u runs from the root (0) to the tip (1) by distance
 * along the leading edge; v runs round the section (0 trailing edge, 0.5 leading edge, 1 trailing edge again).
 */
export function surface(scene: Scene, name: string, st: readonly Station[], t: number, mirror: boolean): { mesh: Mesh; us: number[] } {
  const loops: Vector3[][] = [];
  let vs: number[] = [];
  for (let i = 0; i < st.length; i++) {
    const a = st[Math.max(0, i - 1)]!.le;
    const b = st[Math.min(st.length - 1, i + 1)]!.le;
    const sd = b.subtract(a).normalize();
    let td = Vector3.Cross(new Vector3(-1, 0, 0), sd);
    if (td.lengthSquared() < 1e-6) td = new Vector3(0, 1, 0);
    td.normalize();
    const f = foil(st[i]!.le, st[i]!.chord, st[i]!.t ?? t, td);
    loops.push(f.pts);
    vs = f.vs;
  }
  const us = [0];
  for (let i = 1; i < st.length; i++) us.push(us[i - 1]! + Vector3.Distance(st[i]!.le, st[i - 1]!.le));
  const total = us[us.length - 1] || 1;
  for (let i = 0; i < us.length; i++) us[i] = us[i]! / total;
  const last = loops[loops.length - 1]!;
  const centre = last.reduce((acc, p) => acc.add(p), Vector3.Zero()).scale(1 / last.length);
  loops.push(last.map((p) => Vector3.Lerp(centre, p, 0.02)));
  us.push(1);
  if (mirror) for (const l of loops) for (const p of l) p.z = -p.z;
  return { mesh: orient(loft(scene, name, loops, us, vs, true)), us };
}

/** A cylinder between two points. */
export function rod(scene: Scene, a: Vector3, b: Vector3, diameter: number, tessellation = 8): Mesh {
  const dir = b.subtract(a);
  const m = MeshBuilder.CreateCylinder('rod', { height: dir.length(), diameter, tessellation }, scene);
  m.position = a.add(b).scale(0.5);
  const nd = dir.normalize();
  const axis = Vector3.Cross(new Vector3(0, 1, 0), nd);
  if (axis.length() > 1e-6) m.rotationQuaternion = Quaternion.RotationAxis(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, nd.y))));
  return m;
}

/** An engine nacelle (or a propeller nacelle) along +x, centred on the origin. */
export function nacelle(scene: Scene, diameter: number, length: number, prop: boolean): Mesh {
  const shape = prop
    ? [[0, 0.5], [0.3, 0.49], [0.44, 0.43], [0.5, 0.28], [0.5, -0.05], [0.4, -0.36], [0.16, -0.5], [0, -0.52]]
    : [[0.43, 0.5], [0.5, 0.43], [0.51, 0.18], [0.47, -0.12], [0.37, -0.34], [0.33, -0.36]];
  const m = MeshBuilder.CreateLathe('nacelle', { shape: shape.map(([r, y]) => new Vector3(r! * diameter, y! * length, 0)), tessellation: 28, updatable: true }, scene);
  m.rotation.z = -Math.PI / 2;
  m.bakeCurrentTransformIntoVertices();
  return orient(m, (x) => [x, 0, 0]);
}

/** A placement for a thin instance: position, scale and turn about the vertical axis. */
export type Place = readonly [x: number, y: number, z: number, sx?: number, sy?: number, sz?: number, yaw?: number];

/** Draws `mesh` once per placement (one draw call for all of them), optionally with a colour each. */
export function thinInstances(mesh: Mesh, places: readonly (Place | Matrix)[], colors?: Float32Array): Mesh {
  const buf = new Float32Array(16 * Math.max(1, places.length));
  places.forEach((p, i) => {
    const m = p instanceof Matrix ? p : Matrix.Compose(new Vector3(p[3] ?? 1, p[4] ?? 1, p[5] ?? 1), Quaternion.RotationYawPitchRoll(p[6] ?? 0, 0, 0), new Vector3(p[0], p[1], p[2]));
    m.copyToArray(buf, 16 * i);
  });
  if (places.length === 0) {
    mesh.setEnabled(false);
    return mesh;
  }
  mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
  if (colors) mesh.thinInstanceSetBuffer('color', colors, 4, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
  return mesh;
}

/** Flat quads on the ground (y), one mesh: each quad is [x0, z0, x1, z1] with texture coordinates in world units / `uvScale`. */
export function groundQuads(scene: Scene, name: string, quads: readonly (readonly [number, number, number, number])[], y: number, uvScale: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  for (const [x0, z0, x1, z1] of quads) {
    const i = positions.length / 3;
    positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    uvs.push(x0 / uvScale, z0 / uvScale, x1 / uvScale, z0 / uvScale, x1 / uvScale, z1 / uvScale, x0 / uvScale, z1 / uvScale);
    indices.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  return orient(meshFrom(scene, name, positions, indices, uvs), (x, _y, z) => [x, y - 1, z]);
}

/** Painted lines on the ground, one mesh: each polyline (x, z points) becomes a strip `width` wide. */
export function groundLines(scene: Scene, name: string, lines: readonly (readonly (readonly [number, number])[])[], width: number, y: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const h = width / 2;
  for (const line of lines) {
    if (line.length < 2) continue;
    const base = positions.length / 3;
    line.forEach(([x, z], i) => {
      const a = line[Math.max(0, i - 1)]!;
      const b = line[Math.min(line.length - 1, i + 1)]!;
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      positions.push(x - dz * h, y, z + dx * h, x + dz * h, y, z - dx * h);
      uvs.push(0, 0, 1, 0);
    });
    for (let i = 0; i < line.length - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  if (positions.length === 0) positions.push(0, -100, 0, 0, -100, 0, 0, -100, 0), indices.push(0, 1, 2), uvs.push(0, 0, 0, 0, 0, 0);
  return orient(meshFrom(scene, name, positions, indices, uvs), (x, _y, z) => [x, y - 1, z]);
}
