import * as THREE from "three";
import { trackPoint, type Track, type TrackScenery } from "@kart/shared";

/**
 * City scenery: landmarks, a river with a bridge, trees and lamps. Purely visual and built only from the
 * track's own points, so every peer sees the same scene without any extra data on the wire.
 * Landmarks are modelled with their base centred on the origin and their front facing +z.
 */

const std = (color: number, glow = 0) => new THREE.MeshStandardMaterial({ color, ...(glow ? { emissive: color, emissiveIntensity: glow } : {}) });
const bx = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color));
  m.position.set(x, y + h / 2, z);
  return m;
};
const cyl = (rt: number, rb: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 16) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), std(color));
  m.position.set(x, y + h / 2, z);
  return m;
};
const cone = (r: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 16) => cyl(0, r, h, color, x, y, z, seg);
const dome = (r: number, color: number, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(color));
  m.position.set(x, y, z);
  return m;
};
const group = (...c: THREE.Object3D[]) => {
  const g = new THREE.Group();
  g.add(...c);
  return g;
};
const cross = (h: number, color: number, y: number) => group(bx(h * 0.1, h, h * 0.1, color, 0, y), bx(h * 0.55, h * 0.1, h * 0.1, color, 0, y + h * 0.62));

// ------------------------------------------------------------------ Belgrade
/** Temple of Saint Sava: white cube body, grey central dome, four small domes, gold crosses. */
function templeOfSaintSava() {
  const g = group(bx(30, 16, 30, 0xeeeae0), bx(34, 10, 12, 0xeeeae0), bx(12, 10, 34, 0xeeeae0));
  g.add(cyl(11, 11, 8, 0xeeeae0, 0, 16, 0, 24), dome(11.5, 0x9fa9a6, 0, 24), cross(10, 0xe6b422, 33));
  for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]] as const) g.add(cyl(3, 3, 5, 0xeeeae0, x, 16, z), dome(3.4, 0x9fa9a6, x, 21), cross(3.4, 0xe6b422, 24));
  return g;
}
/** Kalemegdan fortress: crenellated wall, two round towers, a gate. */
function kalemegdan() {
  const g = group(bx(60, 9, 5, 0xb9a98a), bx(10, 14, 7, 0xa89878, 0, 0, 0));
  for (let i = -28; i <= 28; i += 4) g.add(bx(2, 2, 5, 0xb9a98a, i, 9));
  for (const x of [-32, 32]) g.add(cyl(5, 5.5, 16, 0xa89878, x, 0, 0), cone(6.5, 7, 0x8c4a3c, x, 16));
  g.add(bx(5, 8, 2, 0x2a2018, 0, 0, 3.6));
  return g;
}
/** Belgrade Waterfront tower: a slim glass tower with a stepped crown. */
function waterfrontTower() {
  return group(bx(12, 80, 12, 0x7fb4d0), bx(8, 20, 8, 0x9ccbe0, 0, 80), bx(1, 18, 1, 0xdddddd, 0, 100));
}

// ------------------------------------------------------------------ Budapest
/** Hungarian Parliament: long neo-gothic hall, central dome and a row of spires. */
function parliament() {
  const g = group(bx(80, 12, 18, 0xe6dcc2), bx(70, 6, 14, 0xd8cdb0, 0, 12), bx(14, 14, 24, 0xe6dcc2, -34, 0), bx(14, 14, 24, 0xe6dcc2, 34, 0));
  g.add(cyl(8, 9, 14, 0xe6dcc2, 0, 18, 0, 20), dome(9, 0x7c9a96, 0, 32), cone(1.4, 12, 0xd8b64a, 0, 41, 0, 8));
  for (let i = -32; i <= 32; i += 8) g.add(cone(1.6, 8, 0xc9bf9f, i, 18, -6, 6), cone(1.6, 8, 0xc9bf9f, i, 18, 6, 6));
  for (const x of [-34, 34]) g.add(cone(7, 10, 0x7c9a96, x, 14, 0, 4));
  return g;
}
/** Fisherman's Bastion: white terraced wall with conical towers. */
function fishermansBastion() {
  const g = group(bx(46, 6, 8, 0xf4f1ea), bx(34, 5, 6, 0xf4f1ea, 0, 6, -1));
  for (const x of [-20, -7, 7, 20]) g.add(cyl(3.6, 3.6, 12, 0xf4f1ea, x, 0, 0, 12), cone(4.4, 8, 0x8a9a8e, x, 12, 0, 12));
  g.add(cyl(5, 5, 18, 0xf4f1ea, 0, 0, -4, 12), cone(6, 10, 0x8a9a8e, 0, 18, -4, 12));
  return g;
}
/** Matthias-style church spire for the Buda hill skyline. */
function churchSpire() {
  return group(bx(10, 30, 10, 0xd9cfb6), cone(6.5, 30, 0x4f7a6a, 0, 30, 0, 4), bx(14, 10, 6, 0xd9cfb6, 0, 0, 8));
}

// ------------------------------------------------------------------ Skopje
/** Millennium Cross on Vodno: a huge white cross on a wooded hill. */
function millenniumCross() {
  const hill = cone(70, 55, 0x24402d, 0, 0, 0, 14);
  return group(hill, cross(40, 0xf4f4f0, 55));
}
/** Warrior on a Horse: gilded rider on a tall column in a lit fountain pool. */
function warriorOnHorse() {
  const gold = 0xe0b84a;
  const g = group(cyl(16, 16, 1.2, 0x2a6ea8, 0, 0, 0, 28), cyl(4, 5, 22, 0xd8d2c4, 0, 1.2, 0, 14), bx(11, 3, 11, 0xd8d2c4, 0, 22.8));
  const horse = group(bx(3.4, 4, 9, gold, 0, 0), bx(2.4, 5, 2.4, gold, 0, 3, -4.6), bx(1.4, 3, 1.4, gold, -1, -2.8, -3), bx(1.4, 3, 1.4, gold, 1, -2.8, -3), bx(1.4, 3, 1.4, gold, -1, -2.8, 3), bx(1.4, 3, 1.4, gold, 1, -2.8, 3));
  horse.position.set(0, 29, 0);
  const rider = group(cyl(1.1, 1.3, 5, gold, 0, 0, 0, 8), bx(0.6, 4, 0.6, gold, 1.4, 4, -0.5));
  rider.position.set(0, 33, 0.6);
  g.add(horse, rider);
  return g;
}
/** Porta Macedonia: triumphal arch. */
function portaMacedonia() {
  const g = group(bx(8, 34, 10, 0xf0ece0, -14, 0), bx(8, 34, 10, 0xf0ece0, 14, 0), bx(36, 9, 10, 0xf0ece0, 0, 28));
  g.add(bx(30, 2, 3, 0xcfc8b4, 0, 37, 5.5));
  return g;
}

// ------------------------------------------------------------------ placement
interface Landmark {
  build: () => THREE.Object3D;
  /** Fraction of the lap where it stands. */
  at: number;
  /** Footprint radius, used for clearance. */
  r: number;
  /** +1 inside the loop (left of travel), -1 outside. */
  side?: 1 | -1;
  scale?: number;
}

const SETS: Record<TrackScenery, { landmarks: Landmark[]; tree: "chestnut" | "autumn" | "cypress"; lamps: boolean; bridge: { color: number; kind: "chain" | "stone" } | null; waterColor: number }> = {
  belgrade: {
    landmarks: [
      { build: templeOfSaintSava, at: 0.12, r: 24, side: -1 },
      { build: kalemegdan, at: 0.45, r: 34, side: -1 },
      { build: waterfrontTower, at: 0.72, r: 12, side: -1 },
      { build: waterfrontTower, at: 0.3, r: 12, side: 1, scale: 0.6 },
    ],
    tree: "chestnut",
    lamps: false,
    waterColor: 0x3d86b8,
    bridge: null,
  },
  budapest: {
    landmarks: [
      { build: parliament, at: 0.08, r: 44, side: -1 },
      { build: fishermansBastion, at: 0.4, r: 28, side: -1 },
      { build: churchSpire, at: 0.46, r: 12, side: -1 },
      { build: churchSpire, at: 0.7, r: 12, side: 1, scale: 0.7 },
    ],
    tree: "autumn",
    lamps: true,
    waterColor: 0x4a7fa0,
    bridge: { color: 0xc9b98a, kind: "chain" },
  },
  skopje: {
    landmarks: [
      { build: warriorOnHorse, at: 0.1, r: 20, side: -1 },
      { build: portaMacedonia, at: 0.5, r: 24, side: -1 },
      { build: millenniumCross, at: 0.8, r: 70, side: -1 },
    ],
    tree: "cypress",
    lamps: true,
    waterColor: 0x1f3f66,
    bridge: { color: 0xc9b99a, kind: "stone" },
  },
};

const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function buildScenery(track: Track, scenery: TrackScenery, night: boolean): THREE.Group {
  const set = SETS[scenery];
  const g = new THREE.Group();
  const n = track.points.length;
  const hw = track.halfWidth;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity;
  for (const p of track.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
  }
  // river south of the loop
  const riverNear = minZ - hw - 40;
  const riverWidth = 70;
  const riverFar = riverNear - riverWidth;
  const river = new THREE.Mesh(new THREE.PlaneGeometry(1600, riverWidth), std(set.waterColor, night ? 0.25 : 0));
  river.rotation.x = -Math.PI / 2;
  river.position.set((minX + maxX) / 2, 0.03, (riverNear + riverFar) / 2);
  g.add(river);
  if (set.bridge) g.add(buildBridge(set.bridge.kind, set.bridge.color, (minX + maxX) / 2 + 40, riverNear, riverFar, night));

  const clear = (x: number, z: number, r: number) => {
    if (z - r < riverNear + 6) return false;
    const lim = hw + r + 4;
    for (const p of track.points) if ((p.x - x) ** 2 + (p.z - z) ** 2 < lim * lim) return false;
    return true;
  };

  const spots: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => clear(x, z, r) && spots.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 > (s.r + r) ** 2);

  for (const lm of set.landmarks) {
    const side = lm.side ?? -1;
    const sc = lm.scale ?? 1;
    const r = lm.r * sc;
    for (let k = 0; k < 40; k++) {
      // walk outward from the road, then along the lap, until the footprint fits
      const s = lm.at * n + Math.floor(k / 8) * 3 * (k % 2 ? 1 : -1);
      const d = hw + r + 10 + (k % 8) * 10;
      const p = trackPoint(track, s, side * d);
      if (!free(p.x, p.z, r)) continue;
      const c = trackPoint(track, s, 0);
      const obj = lm.build();
      obj.position.set(p.x, 0, p.z);
      obj.rotation.y = Math.atan2(c.x - p.x, c.z - p.z);
      obj.scale.setScalar(sc);
      g.add(obj);
      spots.push({ x: p.x, z: p.z, r });
      break;
    }
  }

  g.add(trees(track, set.tree, free, spots, night));
  if (set.lamps) g.add(lamps(track, free, night));
  return g;
}

function buildBridge(kind: "chain" | "stone", color: number, x: number, zNear: number, zFar: number, night: boolean) {
  const len = zNear - zFar + 30;
  const zc = (zNear + zFar) / 2;
  const g = new THREE.Group();
  g.add(bx(16, 2, len, 0x55524e, x, 8, zc), bx(1.4, 3, len, color, x - 7.5, 10, zc), bx(1.4, 3, len, color, x + 7.5, 10, zc));
  if (kind === "chain") {
    // Chain Bridge: two stone gates and swept chains
    for (const z of [zNear - 12, zFar + 12]) {
      g.add(bx(4, 34, 5, color, x - 9, 0, z), bx(4, 34, 5, color, x + 9, 0, z), bx(22, 5, 5, color, x, 34, z));
      for (const sx of [-9, 9]) g.add(cone(2.6, 5, 0x6f8f86, x + sx, 39, z, 4));
    }
    const span = Math.abs(zNear - zFar) - 24;
    for (const sx of [-8.5, 8.5]) {
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const y = 36 - Math.sin(t * Math.PI) * 22;
        const z = zNear - 12 - t * span;
        g.add(bx(0.5, 0.5, span / 12 + 0.6, 0x40382e, x + sx, y, z - span / 24));
        if (i % 2 === 0) g.add(bx(0.3, Math.max(0.5, y - 10), 0.3, 0x40382e, x + sx, 10, z));
      }
    }
  } else {
    // Stone Bridge: low arches on pillars
    const count = 7;
    for (let i = 0; i < count; i++) {
      const z = zNear + 10 - (i / (count - 1)) * (len - 6);
      g.add(bx(14, 8, 3.2, color, x, 0, z));
    }
    g.add(bx(18, 1.2, len, color, x, 6.8, zc));
  }
  if (night && kind === "stone") for (let i = 0; i < 6; i++) g.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), std(0xffe9a0, 1.5)).translateX(x + (i % 2 ? 7.5 : -7.5)).translateY(13).translateZ(zNear + 8 - i * (len / 6)));
  return g;
}

function trees(track: Track, kind: "chestnut" | "autumn" | "cypress", free: (x: number, z: number, r: number) => boolean, spots: { x: number; z: number; r: number }[], night: boolean) {
  const g = new THREE.Group();
  const n = track.points.length;
  const trunk = std(0x5a3f2a);
  const crowns =
    kind === "cypress"
      ? [std(night ? 0x15351f : 0x2e6a3a)]
      : kind === "autumn"
        ? [std(0xd08a3a), std(0xb8602e), std(0x8a9a3c)]
        : [std(0x3f8a3a), std(0x4f9a44), std(0x2f7a38)];
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 6);
  const ballGeo = new THREE.SphereGeometry(3, 10, 8);
  const coneGeo = new THREE.ConeGeometry(2, 11, 8);
  for (let i = 0; i < n; i += 4) {
    for (const side of [1, -1]) {
      const h = hash(i * 2 + (side > 0 ? 0 : 1));
      if (h < 0.35) continue;
      const lat = side * (track.halfWidth + 8 + h * 14);
      const p = trackPoint(track, i, lat);
      if (!free(p.x, p.z, 3)) continue;
      const t = new THREE.Group();
      const sc = 0.8 + hash(i + 17) * 0.7;
      if (kind === "cypress") {
        const c = new THREE.Mesh(coneGeo, crowns[0]);
        c.position.y = 5.5;
        t.add(c);
      } else {
        const tr = new THREE.Mesh(trunkGeo, trunk);
        tr.position.y = 1.5;
        const c = new THREE.Mesh(ballGeo, crowns[Math.floor(hash(i + 5) * crowns.length) % crowns.length]);
        c.position.y = 5.5;
        t.add(tr, c);
      }
      t.position.set(p.x, 0, p.z);
      t.scale.setScalar(sc);
      g.add(t);
      spots.push({ x: p.x, z: p.z, r: 2.5 * sc });
    }
  }
  return g;
}

function lamps(track: Track, free: (x: number, z: number, r: number) => boolean, night: boolean) {
  const g = new THREE.Group();
  const n = track.points.length;
  const post = std(0x2b2b30);
  const bulb = std(0xffe9a0, night ? 1.8 : 0.2);
  const postGeo = new THREE.CylinderGeometry(0.25, 0.3, 9, 6);
  const bulbGeo = new THREE.SphereGeometry(0.9, 8, 6);
  for (let i = 0; i < n; i += 10) {
    const p = trackPoint(track, i, -(track.halfWidth + 3.5));
    if (!free(p.x, p.z, 1)) continue;
    const a = new THREE.Mesh(postGeo, post);
    a.position.set(p.x, 4.5, p.z);
    const b = new THREE.Mesh(bulbGeo, bulb);
    b.position.set(p.x, 9.4, p.z);
    g.add(a, b);
  }
  return g;
}
