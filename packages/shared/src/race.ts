import type { Track } from "./track";
import type { KartState } from "./types";

export const KART_RADIUS = 1.3;
const MAX_SPEED = 40;
const MAX_REVERSE = 10;

/** Monotonic race progress (in centerline samples). Continuous across the start line. */
export function kartProgress(s: KartState, track: Track): number {
  const n = track.points.length;
  let raw = s.segIdx;
  if (s.lap === 0 && s.nextCp === 1 && raw > n / 2) raw -= n; // still behind the line on the grid
  return s.lap * n + raw;
}

/** Soft kart-kart collisions: separate overlapping karts and trade some speed. Returns new states. */
export function resolveBumps(karts: KartState[]): KartState[] {
  const out = karts.map((k) => ({ ...k }));
  const min = KART_RADIUS * 2;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!;
      const b = out[j]!;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
      }
      const nx = d < 1e-6 ? 1 : dx / d;
      const nz = d < 1e-6 ? 0 : dz / d;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      const fax = Math.sin(a.heading);
      const faz = Math.cos(a.heading);
      const fbx = Math.sin(b.heading);
      const fbz = Math.cos(b.heading);
      const closing = (fax * a.speed - fbx * b.speed) * nx + (faz * a.speed - fbz * b.speed) * nz;
      if (closing > 0) {
        const imp = closing * 0.5;
        a.speed = Math.min(MAX_SPEED, Math.max(-MAX_REVERSE, a.speed - imp * (fax * nx + faz * nz)));
        b.speed = Math.min(MAX_SPEED, Math.max(-MAX_REVERSE, b.speed + imp * (fbx * nx + fbz * nz)));
      }
    }
  }
  return out;
}
