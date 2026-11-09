import { describe, expect, it } from "vitest";
import { buildTrack, CHARACTERS, createKart, DEMO_CONTROL, hitKart, Item, paramsFor, rollItem, stepKart, TICK_DT, cleanCharacter } from "./index";

const track = buildTrack(DEMO_CONTROL, { laps: 3 });

describe("characters", () => {
  it("ids are their index, stats in 1..5, 12 points each", () => {
    CHARACTERS.forEach((c, i) => {
      expect(c.id).toBe(i);
      const v = Object.values(c.stats);
      expect(v.every((x) => x >= 1 && x <= 5)).toBe(true);
      expect(v.reduce((a, b) => a + b, 0)).toBe(12);
    });
  });
  it("cleanCharacter rejects junk", () => {
    expect(cleanCharacter(99)).toBe(0);
    expect(cleanCharacter(-1)).toBe(0);
    expect(cleanCharacter("3")).toBe(0);
    expect(cleanCharacter(5)).toBe(5);
  });
  it("stats change real physics: top speed, acceleration, steering", () => {
    const fast = paramsFor(7); // speed 5, handling 1
    const slow = paramsFor(4); // speed 2, handling 5
    expect(fast.maxSpeed).toBeGreaterThan(slow.maxSpeed);
    expect(slow.steerRate).toBeGreaterThan(fast.steerRate);
    expect(paramsFor(5).accel).toBeGreaterThan(paramsFor(11).accel);
    const run = (id: number, secs: number) => {
      let s = createKart(track);
      for (let i = 0; i < secs * 60; i++) s = stepKart(s, { steer: 0, throttle: 1, brake: 0, useItem: false }, track, TICK_DT, paramsFor(id));
      return s;
    };
    expect(run(5, 1).speed).toBeGreaterThan(run(11, 1).speed); // accel 5 vs 2
    expect(run(7, 1).speed).toBeGreaterThan(0);
    const turn = (id: number) => {
      const k = { ...createKart(track), speed: 20 };
      return Math.abs(stepKart(k, { steer: 1, throttle: 0, brake: 0, useItem: false }, track, TICK_DT, paramsFor(id)).heading - k.heading);
    };
    expect(turn(4)).toBeGreaterThan(turn(7));
  });
  it("toughness shortens spin-out and keeps speed", () => {
    const k = { ...createKart(track), speed: 30 };
    const tough = hitKart(k, 5);
    const soft = hitKart(k, 1);
    expect(tough.stunT).toBeLessThan(soft.stunT);
    expect(tough.speed).toBeGreaterThan(soft.speed);
  });
  it("item bias shifts rolls toward the theme", () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const count = (bias: readonly number[], item: number) => {
      let n = 0;
      for (let i = 0; i < 10000; i++) if (rollItem(0.5, rng, bias) === item) n++;
      return n;
    };
    expect(count([1, 1, 1.6, 1], Item.Missile)).toBeGreaterThan(count([1, 1, 1, 1], Item.Missile) * 1.2);
    expect(count([1, 1.6, 1, 1], Item.Shield)).toBeGreaterThan(count([1, 1, 1, 1], Item.Shield) * 1.2);
  });
  it("every character has a distinct kart look", () => {
    const looks = new Set(CHARACTERS.map((c) => `${c.kart.body}|${c.kart.accent}|${c.kart.shape}|${c.kart.parts.join()}`));
    expect(looks.size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) expect(c.kart.parts.length).toBeGreaterThan(0);
  });
});
