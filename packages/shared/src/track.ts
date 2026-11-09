import type { Vec2 } from "./types";
import { parseLayout } from "./layout";

export interface Track {
  /** Index into TRACKS (0 for ad-hoc tracks). */
  id: number;
  name: string;
  /** Equally spaced closed centerline samples. */
  points: Vec2[];
  halfWidth: number;
  /** Indices into `points`; index 0 is the start/finish line. */
  checkpoints: number[];
  /** Distance between consecutive `points`. */
  spacing: number;
  /** Item box positions. */
  itemBoxes: Vec2[];
  laps: number;
  spawn: { x: number; z: number; heading: number };
}

export interface TrackHit {
  idx: number; // segment start index (segment idx -> idx+1)
  t: number; // 0..1 along segment idx -> idx+1
  px: number; // closest point on centerline
  pz: number;
  dist: number; // distance from centerline
  nx: number; // unit normal pointing from centerline to query point
  nz: number;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export interface TrackOptions {
  halfWidth?: number;
  laps?: number;
  spacing?: number;
  checkpointCount?: number;
  /** Metres between checkpoints (default 30). */
  checkpointSpacing?: number;
  /** Fractions of the lap where rows of item boxes sit. */
  boxRows?: number[];
  boxOffsets?: number[];
  id?: number;
  name?: string;
}

/** Build a closed track from control points via Catmull-Rom, resampled at equal arc length. */
export function buildTrack(control: Vec2[], opts: TrackOptions = {}): Track {
  const { halfWidth = 8, laps = 3, spacing = 4, checkpointCount = 8, checkpointSpacing = 30, boxRows = [0.12, 0.37, 0.62, 0.87], boxOffsets = [-4.5, 0, 4.5] } = opts;
  const n = control.length;
  const dense: Vec2[] = [];
  const perSeg = 100;
  for (let i = 0; i < n; i++) {
    const p0 = control[(i - 1 + n) % n]!;
    const p1 = control[i]!;
    const p2 = control[(i + 1) % n]!;
    const p3 = control[(i + 2) % n]!;
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      dense.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), z: catmull(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  const cum: number[] = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i % dense.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[dense.length]!;
  const count = Math.max(8, Math.round(total / spacing));
  const points: Vec2[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (cum[j + 1]! < target) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dense.length]!;
    const f = (target - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
    points.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }
  const cpCount = Math.min(250, Math.max(checkpointCount, Math.round(total / checkpointSpacing)));
  const checkpoints: number[] = [];
  for (let c = 0; c < cpCount; c++) checkpoints.push(Math.floor((c * count) / cpCount));
  const itemBoxes: Vec2[] = [];
  for (const f of boxRows) {
    const i = Math.floor(f * count);
    const a = points[i]!;
    const b = points[(i + 1) % count]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = (b.z - a.z) / l; // left normal
    const nz = -(b.x - a.x) / l;
    for (const o of boxOffsets) itemBoxes.push({ x: a.x + nx * o, z: a.z + nz * o });
  }
  const p0 = points[0]!;
  const p1 = points[1]!;
  return {
    id: opts.id ?? 0,
    name: opts.name ?? "Track",
    points,
    halfWidth,
    checkpoints,
    spacing: total / count,
    itemBoxes,
    laps,
    spawn: { x: p0.x, z: p0.z, heading: Math.atan2(p1.x - p0.x, p1.z - p0.z) },
  };
}

/** Closest point on the centerline, searching only a window around `hint` (keeps progress continuous). */
export function nearestOnTrack(track: Track, x: number, z: number, hint: number, window = 15): TrackHit {
  const n = track.points.length;
  let best: TrackHit | null = null;
  for (let o = -window; o <= window; o++) {
    const i = (((hint + o) % n) + n) % n;
    const a = track.points[i]!;
    const b = track.points[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.dist) {
      best = { idx: i, t, px, pz, dist: d, nx: d > 1e-6 ? (x - px) / d : 0, nz: d > 1e-6 ? (z - pz) / d : 0 };
    }
  }
  return best!;
}

/** Point at fractional sample position `s`, offset `lat` to the left of travel direction. */
export function trackPoint(track: Track, s: number, lat = 0): Vec2 {
  const n = track.points.length;
  const f = ((s % n) + n) % n;
  const i = Math.floor(f);
  const t = f - i;
  const a = track.points[i]!;
  const b = track.points[(i + 1) % n]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: a.x + dx * t + (dz / l) * lat, z: a.z + dz * t - (dx / l) * lat };
}

/** Signed lateral offset of (x,z) from the centerline at `hit` (positive = left of travel direction). */
export function trackLateral(track: Track, hit: TrackHit, x: number, z: number): number {
  const n = track.points.length;
  const a = track.points[hit.idx]!;
  const b = track.points[(hit.idx + 1) % n]!;
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return (x - hit.px) * ((b.z - a.z) / l) + (z - hit.pz) * (-(b.x - a.x) / l);
}

/** Default demo track. */
export const DEMO_CONTROL: Vec2[] = [
  { x: 0, z: -120 },
  { x: 80, z: -110 },
  { x: 130, z: -50 },
  { x: 110, z: 20 },
  { x: 50, z: 50 },
  { x: 60, z: 110 },
  { x: 0, z: 140 },
  { x: -70, z: 100 },
  { x: -120, z: 30 },
  { x: -100, z: -50 },
  { x: -50, z: -90 },
];

export interface TrackTheme {
  sky: number;
  fog: number;
  ground: number;
  road: number;
  kerb: number;
  /** emissive kerbs (night track) */
  glow?: boolean;
}

/** Which city's landmarks/scenery the client dresses the track with (visual only, never touches the sim). */
export type TrackScenery = "belgrade" | "budapest" | "skopje";

export interface TrackDef {
  id: number;
  name: string;
  blurb: string;
  scenery: TrackScenery;
  /** Kenney road pieces, see layout.ts. The centreline is derived from it. */
  layout: string;
  /** metres per tile; the road is exactly one tile wide */
  tile: number;
  laps: number;
  theme: TrackTheme;
}

const pts = (a: [number, number][]): Vec2[] => a.map(([x, z]) => ({ x, z }));

/**
 * The tracks. Host, clients and dedicated servers all build them from this table, so the control points
 * must never change for a published room (checked by track tests: closed, no overlaps, drivable).
 */
export const TRACKS: readonly TrackDef[] = [
  {
    id: 0,
    name: "Belgrade",
    blurb: "Serbia. Flowing 1.9 km of Kenney road past Kalemegdan and the Temple of Saint Sava. 3 laps.",
    scenery: "belgrade",
    layout: "F3lF4rlF4lF3rF1LF2lF2rF2LF3rF4lF1lF1rF3RlF4lF6LrlF3RF2",
    tile: 18,
    laps: 3,
    theme: { sky: 0x8fc8ef, fog: 0x8fc8ef, ground: 0x4f8f3c, road: 0x3a3a42, kerb: 0xc6363c },
  },
  {
    id: 1,
    name: "Budapest",
    blurb: "Hungary. Long and technical 2.7 km along the Danube, Parliament and the Chain Bridge. 2 laps.",
    scenery: "budapest",
    layout: "F3rF4lF3rF4LF4lF3RF4lF2lF4rF3rF3lF3RlF2lF4rlF3rLF3RlLF1RF3lF6rF3lF2LrF2lF3",
    tile: 18,
    laps: 2,
    theme: { sky: 0xf2c48a, fog: 0xf2c48a, ground: 0x76865a, road: 0x45403f, kerb: 0xe8e0d0 },
  },
  {
    id: 2,
    name: "Skopje",
    blurb: "North Macedonia. Fast 2.9 km night ring by the Vardar with wide sweepers: Stone Bridge, Warrior on a Horse, Millennium Cross. 2 laps.",
    scenery: "skopje",
    layout: "F4rF4LF1rF3LlRF2LF3LF4rF1LF3rF4RF2LF4LF4RF1lF2LRLRF4LF4lF2RF1LF7",
    tile: 20,
    laps: 2,
    theme: { sky: 0x0c1024, fog: 0x0c1024, ground: 0x18261f, road: 0x22222c, kerb: 0xffd23f, glow: true },
  },
];

/** Tile placements for the renderer. */
export const trackTiles = (id: number) => {
  const d = trackDef(id);
  return parseLayout(d.layout, d.tile).tiles;
};

export const cleanTrackId = (id: unknown): number => (Number.isInteger(id) && (id as number) >= 0 && (id as number) < TRACKS.length ? (id as number) : 0);
export const trackDef = (id: number): TrackDef => TRACKS[cleanTrackId(id)]!;

export function buildTrackById(id: number): Track {
  const d = trackDef(id);
  return buildTrack(parseLayout(d.layout, d.tile).control, {
    halfWidth: d.tile / 2,
    laps: d.laps,
    id: d.id,
    name: d.name,
    boxRows: [0.06, 0.18, 0.31, 0.43, 0.56, 0.68, 0.81, 0.93], // 24 boxes: the tracks are long
  });
}

/** Track 0. Kept for older call sites. */
export function buildDemoTrack(): Track {
  return buildTrackById(0);
}
