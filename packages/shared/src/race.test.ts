import { describe, expect, it } from "vitest";
import { buildTrack, createKart, DEMO_CONTROL, kartProgress, resolveBumps, stepKart, TICK_DT } from "./index";
import type { KartState } from "./index";

const track = buildTrack(DEMO_CONTROL, { laps: 3 });
const base = createKart(track, 0);
const at = (x: number, z: number, heading: number, speed: number): KartState => ({ ...base, x, z, heading, speed });

describe("kartProgress", () => {
  it("grid is behind the line, ordered front to back", () => {
    const p = [0, 1, 2, 3].map((s) => kartProgress(createKart(track, s), track));
    expect(p[0]!).toBeLessThan(0);
    expect(p[0]!).toBeGreaterThanOrEqual(p[2]!);
    expect(p[2]!).toBeGreaterThanOrEqual(p[3]!);
  });
  it("increases monotonically while driving a lap", () => {
    let s = createKart(track);
    let last = kartProgress(s, track);
    for (let i = 0; i < 60 * 60; i++) {
      const n = track.points.length;
      const t = track.points[(s.segIdx + 8) % n]!;
      let err = Math.atan2(t.x - s.x, t.z - s.z) - s.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      s = stepKart(s, { steer: Math.max(-1, Math.min(1, -err * 2)), throttle: Math.abs(err) > 0.5 ? 0.3 : 1, brake: 0, useItem: false }, track, TICK_DT);
      const p = kartProgress(s, track);
      expect(p).toBeGreaterThanOrEqual(last - 1);
      last = p;
    }
    expect(last).toBeGreaterThan(track.points.length * 0.5);
  });
});

describe("resolveBumps", () => {
  it("separates overlapping karts", () => {
    const [a, b] = resolveBumps([at(0, 0, 0, 20), at(0, 1, 0, 20)]);
    expect(Math.hypot(b!.x - a!.x, b!.z - a!.z)).toBeGreaterThanOrEqual(2.59);
  });
  it("rear-end hit slows the faster rear kart and speeds the front one", () => {
    const [rear, front] = resolveBumps([at(0, 0, 0, 40), at(0, 2, 0, 20)]);
    expect(rear!.speed).toBeLessThan(40);
    expect(front!.speed).toBeGreaterThan(20);
  });
  it("does nothing when apart", () => {
    const [a, b] = resolveBumps([at(0, 0, 0, 20), at(10, 0, 0, 20)]);
    expect(a).toMatchObject({ x: 0, speed: 20 });
    expect(b).toMatchObject({ x: 10, speed: 20 });
  });
  it("handles exact overlap", () => {
    const [a, b] = resolveBumps([at(5, 5, 0, 0), at(5, 5, 0, 0)]);
    expect(Math.hypot(b!.x - a!.x, b!.z - a!.z)).toBeGreaterThan(2);
  });
});
