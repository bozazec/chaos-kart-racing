import { describe, expect, it } from "vitest";
import { buildTrackById, cleanTrackId, createKart, nearestOnTrack, stepKart, TICK_DT, TRACKS } from "./index";

const seg = (a: { x: number; z: number }, b: typeof a, c: typeof a, d: typeof a) => {
  const o = (p: typeof a, q: typeof a, r: typeof a) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

describe.each(TRACKS.map((d) => [d.name, d.id] as const))("track %s", (_name, id) => {
  const t = buildTrackById(id);
  const P = t.points;
  const n = P.length;

  it("has an id, name, 24 item boxes on the road and a spawn on the road", () => {
    expect(t.id).toBe(id);
    expect(t.name).toBe(TRACKS[id]!.name);
    expect(t.itemBoxes.length).toBe(24);
    for (const b of t.itemBoxes) expect(nearestOnTrack(t, b.x, b.z, 0, n).dist).toBeLessThan(t.halfWidth);
    const k = createKart(t, 0);
    expect(nearestOnTrack(t, k.x, k.z, k.segIdx).dist).toBeLessThan(t.halfWidth);
  });

  it("never turns tighter than the road is wide (ribbon stays valid)", () => {
    let minR = Infinity;
    for (let i = 0; i < n; i++) {
      const a = P[(i - 2 + n) % n]!, b = P[i]!, d = P[(i + 2) % n]!;
      const ab = Math.hypot(b.x - a.x, b.z - a.z), bd = Math.hypot(d.x - b.x, d.z - b.z), ad = Math.hypot(d.x - a.x, d.z - a.z);
      const area2 = Math.abs((b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x));
      if (area2 > 1e-9) minR = Math.min(minR, (ab * bd * ad) / (2 * area2));
    }
    expect(minR).toBeGreaterThan(t.halfWidth * 1.2);
  });

  it("does not cross or touch itself", () => {
    let cross = 0;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1) && seg(P[i]!, P[(i + 1) % n]!, P[j]!, P[(j + 1) % n]!)) cross++;
    expect(cross).toBe(0);
    let minSep = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.min(j - i, n - (j - i)) < 30) continue;
      minSep = Math.min(minSep, Math.hypot(P[i]!.x - P[j]!.x, P[i]!.z - P[j]!.z));
    }
    expect(minSep).toBeGreaterThan(t.halfWidth * 2 + 4);
  });

  it("is drivable: a centerline bot finishes every lap", () => {
    let s = createKart(t);
    let tick = 0;
    while (!s.finished && tick < 700 * 60) {
      const tp = P[(s.segIdx + 8) % n]!;
      let err = Math.atan2(tp.x - s.x, tp.z - s.z) - s.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      s = stepKart(s, { steer: Math.max(-1, Math.min(1, -err * 2)), throttle: Math.abs(err) > 0.5 ? 0.3 : 1, brake: 0, useItem: false }, t, TICK_DT);
      tick++;
    }
    expect(s.finished).toBe(true);
    expect(s.lap).toBe(t.laps);
  });
});

describe("tracks table", () => {
  it("ids are indices and cleanTrackId rejects junk", () => {
    TRACKS.forEach((d, i) => expect(d.id).toBe(i));
    expect(cleanTrackId(99)).toBe(0);
    expect(cleanTrackId("1")).toBe(0);
    expect(cleanTrackId(2)).toBe(2);
    expect(TRACKS.length).toBe(4);
  });
});
