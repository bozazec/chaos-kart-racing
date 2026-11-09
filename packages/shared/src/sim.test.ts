import { describe, expect, it } from "vitest";
import { buildTrack, createKart, DEMO_CONTROL, stepKart, TICK_DT, nearestOnTrack } from "./index";
import type { KartInput, KartState } from "./index";

const track = buildTrack(DEMO_CONTROL, { laps: 3 });
const idle: KartInput = { steer: 0, throttle: 0, brake: 0, useItem: false };

function run(s: KartState, input: KartInput, secs: number): KartState {
  for (let i = 0; i < secs * 60; i++) s = stepKart(s, input, track, TICK_DT);
  return s;
}

/** Pure-pursuit bot following the centerline. */
function bot(s: KartState): KartInput {
  const n = track.points.length;
  const t = track.points[(s.segIdx + 8) % n]!;
  const desired = Math.atan2(t.x - s.x, t.z - s.z);
  let err = desired - s.heading;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const steer = Math.max(-1, Math.min(1, -err * 2));
  return { steer, throttle: Math.abs(err) > 0.5 ? 0.3 : 1, brake: 0, useItem: false };
}

describe("track", () => {
  it("is closed with roughly equal spacing", () => {
    const n = track.points.length;
    const d = track.points.map((p, i) => Math.hypot(track.points[(i + 1) % n]!.x - p.x, track.points[(i + 1) % n]!.z - p.z));
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(1.5);
  });
  it("spawn kart starts on track", () => {
    const k = createKart(track, 0);
    expect(nearestOnTrack(track, k.x, k.z, k.segIdx).dist).toBeLessThan(track.halfWidth);
  });
});

describe("kart physics", () => {
  it("accelerates to a capped speed", () => {
    const s = run(createKart(track), { ...idle, throttle: 1 }, 1);
    expect(s.speed).toBeGreaterThan(20);
    expect(run(s, { ...idle, throttle: 1 }, 3).speed).toBeLessThanOrEqual(40.001);
  });
  it("coasts to a stop and brakes faster", () => {
    const fast = run(createKart(track), { ...idle, throttle: 1 }, 2);
    expect(run(fast, idle, 1).speed).toBeLessThan(fast.speed);
    expect(run(fast, { ...idle, brake: 1 }, 1).speed).toBeLessThan(run(fast, idle, 1).speed);
  });
  it("does not turn when stationary", () => {
    const k = createKart(track);
    expect(run(k, { ...idle, steer: 1 }, 1).heading).toBe(k.heading);
  });
  it("steer right decreases heading (turns right)", () => {
    const k = { ...createKart(track), speed: 15 };
    expect(stepKart(k, { ...idle, steer: 1, throttle: 1 }, track).heading).toBeLessThan(k.heading);
  });
  it("is slowed offroad and walled in", () => {
    let k = createKart(track);
    // aim straight off the track
    k = { ...k, heading: k.heading + Math.PI / 2 };
    k = run(k, { ...idle, throttle: 1 }, 6);
    expect(k.offTrack).toBe(true);
    expect(nearestOnTrack(track, k.x, k.z, k.segIdx).dist).toBeLessThanOrEqual(track.halfWidth + 3 + 0.01);
    expect(k.speed).toBeLessThan(30);
  });
});

describe("laps", () => {
  it("bot completes 3 laps and finishes", () => {
    let s = createKart(track);
    let t = 0;
    while (!s.finished && t < 400 * 60) {
      s = stepKart(s, bot(s), track, TICK_DT);
      t++;
    }
    expect(s.finished).toBe(true);
    expect(s.lap).toBe(3);
  });
  it("driving backwards does not count laps", () => {
    let s = createKart(track);
    s = { ...s, heading: s.heading + Math.PI };
    s = run(s, { ...idle, throttle: 1 }, 20);
    expect(s.lap).toBe(0);
  });
  it("standing still on start does not count a lap", () => {
    expect(run(createKart(track), idle, 5).lap).toBe(0);
  });
});

describe("checkpoints and reset", () => {
  it("places a checkpoint about every 30 m", () => {
    const n = track.points.length;
    const gap = (track.checkpoints[1]! - track.checkpoints[0]!) * track.spacing;
    expect(gap).toBeGreaterThan(25);
    expect(gap).toBeLessThan(35);
    expect(track.checkpoints.length).toBeGreaterThan(20);
    expect(track.checkpoints.length).toBeLessThan(250);
    expect(track.checkpoints.every((c, i) => c < n && (i === 0 || c > track.checkpoints[i - 1]!))).toBe(true);
  });

  it("reset puts the kart on the last passed checkpoint, still, facing forward", () => {
    let s = createKart(track);
    s = run(s, { ...idle, throttle: 1 }, 6);
    expect(s.nextCp).toBeGreaterThan(2);
    // drive into the grass, then reset
    s = { ...s, x: s.x + 200, z: s.z + 200, speed: 20 };
    const r = stepKart(s, { ...idle, reset: true }, track);
    const cp = track.points[track.checkpoints[s.nextCp - 1]!]!;
    expect(r.x).toBeCloseTo(cp.x);
    expect(r.z).toBeCloseTo(cp.z);
    expect(r.speed).toBe(0);
    expect(r.nextCp).toBe(s.nextCp);
    expect(r.offTrack).toBe(false);
  });
});
