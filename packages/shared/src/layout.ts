import type { Vec2 } from "./types";

/**
 * Tile layouts: a track described as a string of Kenney Racing Kit road pieces.
 *   F  straight tile (1 tile long)      l / r  "large" corner, left / right, centreline radius 1.5 tiles
 *   L / R  "larger" corner, radius 2.5 tiles      a number repeats the piece: "F6 l F3"
 * The centreline (used by the sim) and the tile placements (used by the renderer) both come from here, so
 * physics and visuals agree. Everything is deterministic and visual-only data stays out of the network protocol.
 */
export type TileKind = "straight" | "large" | "larger";

export interface TilePlace {
  kind: TileKind;
  /** world centre of the tile footprint */
  x: number;
  z: number;
  /** rotation about the y axis (three.js convention) */
  rot: number;
}

export interface Layout {
  control: Vec2[];
  tiles: TilePlace[];
  /** closing error of the loop in tiles (0 = closed) and heading error in radians */
  gap: number;
  turn: number;
}

const RADIUS = { l: 1.5, r: 1.5, L: 2.5, R: 2.5 } as const;

export function expandLayout(layout: string): string[] {
  const out: string[] = [];
  for (const m of layout.matchAll(/([FlrLR])(\d*)/g)) for (let i = 0; i < Number(m[2] || 1); i++) out.push(m[1]!);
  return out;
}

export function parseLayout(layout: string, tile: number): Layout {
  let x = 0;
  let z = 0;
  let th = 0;
  const control: Vec2[] = [{ x, z }];
  const tiles: TilePlace[] = [];
  const step = 3; // metres between control points on arcs / straights
  const advance = (len: number, dth: number) => {
    // exact for circular arcs: move along the mid-heading by the chord length
    const chord = dth === 0 ? len : 2 * (len / Math.abs(dth)) * Math.sin(Math.abs(dth) / 2);
    x += Math.sin(th + dth / 2) * chord;
    z += Math.cos(th + dth / 2) * chord;
    th += dth;
  };
  for (const tk of expandLayout(layout)) {
    if (tk === "F") {
      const cx = x + Math.sin(th) * tile * 0.5;
      const cz = z + Math.cos(th) * tile * 0.5;
      tiles.push({ kind: "straight", x: cx, z: cz, rot: th });
      const k = Math.max(1, Math.round(tile / step));
      for (let i = 0; i < k; i++) {
        advance(tile / k, 0);
        control.push({ x, z });
      }
      continue;
    }
    const R = RADIUS[tk as keyof typeof RADIUS];
    const right = tk === "r" || tk === "R";
    const N = R + 0.5; // footprint in tiles
    const h = N / 2;
    // model frame: pivot at (+h,+h); entry A = (h-R, h) when turning right (travel A->B), exit side B = (h, h-R) when left
    const [ex, ez] = right ? [h - R, h] : [h, h - R];
    const a = right ? th - Math.PI : th + Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const wx = x - (ex * tile * c + ez * tile * s);
    const wz = z - (-ex * tile * s + ez * tile * c);
    tiles.push({ kind: R === 1.5 ? "large" : "larger", x: wx, z: wz, rot: a });
    const arc = (Math.PI / 2) * R * tile;
    const k = Math.max(3, Math.round(arc / step));
    const dth = ((right ? -1 : 1) * Math.PI) / 2 / k;
    for (let i = 0; i < k; i++) {
      advance(arc / k, dth);
      control.push({ x, z });
    }
  }
  const last = control[control.length - 1]!;
  const gap = Math.hypot(last.x - control[0]!.x, last.z - control[0]!.z) / tile;
  const turn = Math.atan2(Math.sin(th), Math.cos(th));
  control.pop(); // last point duplicates the first on a closed loop
  return { control, tiles, gap, turn };
}
