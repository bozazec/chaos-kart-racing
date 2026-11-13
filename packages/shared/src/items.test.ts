import { describe, expect, it } from "vitest";
import {
  buildTrack, createKart, DEMO_CONTROL, hitKart, Item, ItemWorld, nearestOnTrack, rollItem, stepKart, TICK_DT,
  BOOST_TICKS, STUN_TICKS, MISSILE_TTL, type KartHolder, type KartState,
} from "./index";

const track = buildTrack(DEMO_CONTROL, { laps: 3 });
const idle = { steer: 0, throttle: 0, brake: 0, useItem: false };
const go = { ...idle, throttle: 1 };

function kartAt(slot: number, x: number, z: number, over: Partial<KartState> = {}): KartHolder {
  const base = createKart(track, 0);
  const hit = nearestOnTrack(track, x, z, base.segIdx);
  return { slot, cur: { ...base, x, z, segIdx: hit.idx, ...over } };
}
/** Put a kart on the centerline at sample i, heading along track. */
function onTrack(slot: number, i: number, over: Partial<KartState> = {}): KartHolder {
  const n = track.points.length;
  const a = track.points[i % n]!;
  const b = track.points[(i + 1) % n]!;
  const k = createKart(track, 0);
  return { slot, cur: { ...k, x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z), segIdx: i % n, lap: 1, nextCp: 3, ...over } };
}

describe("track item boxes", () => {
  it("12 boxes, all on the road", () => {
    expect(track.itemBoxes.length).toBe(12);
    for (const b of track.itemBoxes) expect(nearestOnTrack(track, b.x, b.z, 0, track.points.length).dist).toBeLessThan(track.halfWidth);
  });
});

describe("rollItem", () => {
  const dist = (frac: number) => {
    const c: Record<number, number> = {};
    let seed = 12345;
    const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 20000; i++) {
      const it = rollItem(frac, rng);
      c[it] = (c[it] ?? 0) + 1;
    }
    return c;
  };
  it("leaders get more oil, back-markers more missiles", () => {
    const first = dist(0);
    const last = dist(1);
    expect(first[Item.Oil]!).toBeGreaterThan(last[Item.Oil]! * 3);
    expect(last[Item.Missile]!).toBeGreaterThan(first[Item.Missile]! * 2);
    for (const it of [Item.Boost, Item.Shield, Item.Missile, Item.Oil, Item.Drone]) expect(first[it]).toBeGreaterThan(0);
  });
});

describe("pickups", () => {
  it("driving through a box grants an item, box respawns later", () => {
    const w = new ItemWorld(track);
    const b = track.itemBoxes[0]!;
    const k = kartAt(1, b.x, b.z);
    w.step([k], () => 0.5, TICK_DT, () => 0.1);
    expect(k.cur.item).not.toBe(Item.None);
    expect(k.cur.itemCd).toBeGreaterThan(0);
    expect(w.boxMask() & 1).toBe(0);
    // second kart cannot grab the same box
    const k2 = kartAt(2, b.x, b.z);
    w.step([k2], () => 0.5, TICK_DT);
    expect(k2.cur.item).toBe(Item.None);
    for (let i = 0; i < 300; i++) w.step([], () => 0, TICK_DT);
    expect(w.boxMask() & 1).toBe(1);
  });
  it("kart already holding an item gets nothing", () => {
    const w = new ItemWorld(track);
    const b = track.itemBoxes[0]!;
    const k = kartAt(1, b.x, b.z, { item: Item.Oil });
    w.step([k], () => 0, TICK_DT);
    expect(k.cur.item).toBe(Item.Oil);
    expect(w.boxMask() & 1).toBe(1);
  });
});

describe("item use in sim", () => {
  it("boost lifts speed above max for a while", () => {
    let s: KartState = { ...createKart(track), speed: 40, item: Item.Boost };
    s = stepKart(s, { ...go, useItem: true }, track);
    expect(s.item).toBe(Item.None);
    expect(s.boostT).toBeGreaterThan(BOOST_TICKS - 3);
    for (let i = 0; i < 60; i++) s = stepKart(s, go, track);
    expect(s.speed).toBeGreaterThan(45);
  });
  it("item cooldown stops chaining and early use", () => {
    let s: KartState = { ...createKart(track), item: Item.Shield, itemCd: 10 };
    s = stepKart(s, { ...idle, useItem: true }, track);
    expect(s.item).toBe(Item.Shield);
    for (let i = 0; i < 12; i++) s = stepKart(s, { ...idle, useItem: true }, track);
    expect(s.item).toBe(Item.None);
    expect(s.shield).toBe(true);
  });
  it("shield absorbs one hit, then next hit stuns", () => {
    const shielded = { ...createKart(track), shield: true, speed: 30 };
    const a = hitKart(shielded);
    expect(a.shield).toBe(false);
    expect(a.stunT).toBe(0);
    const b = hitKart(a);
    expect(b.stunT).toBe(STUN_TICKS);
    expect(b.speed).toBeCloseTo(12);
  });
  it("stunned kart ignores input, spins, then recovers", () => {
    let s: KartState = hitKart({ ...createKart(track), speed: 30 });
    const h0 = s.heading;
    for (let i = 0; i < 20; i++) s = stepKart(s, go, track);
    expect(Math.abs(s.heading - h0)).toBeGreaterThan(1);
    expect(s.speed).toBeLessThan(12);
    for (let i = 0; i < STUN_TICKS; i++) s = stepKart(s, go, track);
    expect(s.stunT).toBe(0);
    const v = s.speed;
    for (let i = 0; i < 30; i++) s = stepKart(s, go, track);
    expect(s.speed).toBeGreaterThan(v);
  });
});

describe("missiles and oil", () => {
  it("missile flies straight and hits a kart in front of the shooter", () => {
    const w = new ItemWorld(track);
    const shooter = onTrack(1, 40, { item: Item.Missile });
    const used = stepKart(shooter.cur, { ...idle, useItem: true }, track);
    expect(used.item).toBe(Item.None);
    const h = shooter.cur.heading;
    const victim = kartAt(2, shooter.cur.x + Math.sin(h) * 25, shooter.cur.z + Math.cos(h) * 25);
    w.spawnFrom(Item.Missile, 1, shooter.cur);
    expect(w.objs.length).toBe(1);
    for (let i = 0; i < 120 && victim.cur.stunT === 0; i++) w.step([shooter, victim], () => 0, TICK_DT);
    expect(victim.cur.stunT).toBeGreaterThan(0);
    expect(shooter.cur.stunT).toBe(0);
    expect(w.objs.length).toBe(0);
  });
  it("missile explodes on the track wall instead of following the bend", () => {
    const w = new ItemWorld(track);
    // aim straight across the track edge
    const k = onTrack(1, 40);
    k.cur = { ...k.cur, heading: k.cur.heading + Math.PI / 2 };
    w.spawnFrom(Item.Missile, 1, k.cur);
    const m = w.objs[0]!;
    const dirx = m.dx;
    const dirz = m.dz;
    let steps = 0;
    while (w.objs.length && steps++ < 200) {
      w.step([], () => 0, TICK_DT);
      if (w.objs[0]) {
        expect(w.objs[0].dx).toBe(dirx); // never steers
        expect(w.objs[0].dz).toBe(dirz);
      }
    }
    expect(w.objs.length).toBe(0);
    expect(steps).toBeLessThan(40); // gone long before the ttl
  });
  it("missile expires if nothing is hit", () => {
    const w = new ItemWorld(track);
    w.spawnFrom(Item.Missile, 1, onTrack(1, 10).cur);
    for (let i = 0; i < MISSILE_TTL + 2; i++) w.step([], () => 0, TICK_DT);
    expect(w.objs.length).toBe(0);
  });
  it("drone item homes in on the kart ahead of the user and hits it", () => {
    const w = new ItemWorld(track);
    const shooter = onTrack(1, 40, { item: Item.Drone });
    const victim = onTrack(2, 60);
    const target = w.targetAhead(1, [shooter, victim], [2, 1]);
    expect(target).toBe(2);
    expect(w.targetAhead(2, [shooter, victim], [2, 1])).toBe(-1); // leader has nobody ahead
    w.spawnFrom(Item.Drone, 1, shooter.cur, target);
    for (let i = 0; i < 300 && victim.cur.stunT === 0; i++) w.step([shooter, victim], () => 0, TICK_DT);
    expect(victim.cur.stunT).toBeGreaterThan(0);
    expect(shooter.cur.stunT).toBe(0);
  });
  it("oil spins out a kart that drives over it, not the owner at first", () => {
    const w = new ItemWorld(track);
    const owner = onTrack(1, 100, { speed: 10 });
    w.spawnFrom(Item.Oil, 1, owner.cur);
    const o = w.objs[0]!;
    w.step([owner], () => 0, TICK_DT);
    expect(owner.cur.stunT).toBe(0); // grace
    const other = kartAt(2, o.x, o.z);
    w.step([other], () => 0, TICK_DT);
    expect(other.cur.stunT).toBeGreaterThan(0);
    expect(w.objs.length).toBe(0);
  });
  it("shield eats a missile", () => {
    const w = new ItemWorld(track);
    const shooter = onTrack(1, 40);
    const h = shooter.cur.heading;
    const victim = kartAt(2, shooter.cur.x + Math.sin(h) * 25, shooter.cur.z + Math.cos(h) * 25, { shield: true });
    w.spawnFrom(Item.Missile, 1, shooter.cur);
    for (let i = 0; i < 120 && w.objs.length; i++) w.step([victim], () => 0, TICK_DT);
    expect(victim.cur.shield).toBe(false);
    expect(victim.cur.stunT).toBe(0);
  });
});

describe("shield duration", () => {
  it("shield item lasts 10 s then expires on its own", async () => {
    const { SHIELD_TICKS } = await import("./index");
    let s: KartState = { ...createKart(track), item: Item.Shield };
    s = stepKart(s, { ...idle, useItem: true }, track);
    expect(s.shield).toBe(true);
    expect(s.shieldT).toBe(SHIELD_TICKS - 1);
    expect(SHIELD_TICKS).toBe(600);
    for (let i = 0; i < SHIELD_TICKS - 5; i++) s = stepKart(s, idle, track);
    expect(s.shield).toBe(true);
    for (let i = 0; i < 10; i++) s = stepKart(s, idle, track);
    expect(s.shield).toBe(false);
    expect(s.shieldT).toBe(0);
  });
  it("a hit consumes the shield immediately", () => {
    const s = hitKart({ ...createKart(track), shield: true, shieldT: 300 });
    expect(s.shield).toBe(false);
    expect(s.shieldT).toBe(0);
    expect(s.stunT).toBe(0);
  });
});
