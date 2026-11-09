import { describe, expect, it } from "vitest";
import {
  buildTrack, CHARACTERS, createKart, DEMO_CONTROL, ItemWorld, Item, nearestOnTrack, paramsFor, stepKart, TICK_DT,
  CONF_TICKS, SLOW_TICKS, SPECIAL_CD, SPECIAL_START, type KartHolder, type KartState,
} from "./index";

const track = buildTrack(DEMO_CONTROL, { laps: 3 });
const press = { steer: 0, throttle: 0, brake: 0, useItem: false, useSpecial: true };
const idle = { steer: 0, throttle: 0, brake: 0, useItem: false };

function onTrack(slot: number, i: number, over: Partial<KartState> = {}): KartHolder {
  const n = track.points.length;
  const a = track.points[i % n]!;
  const b = track.points[(i + 1) % n]!;
  const k = createKart(track, 0);
  return { slot, cur: { ...k, x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z), segIdx: i % n, lap: 1, nextCp: 3, spCd: 0, ...over } };
}
const world = () => new ItemWorld(track);
const fixedRng = () => 0.5;

describe("special cooldown", () => {
  it("starts on cooldown, becomes ready, fires once, then recharges", () => {
    let s: KartState = createKart(track);
    expect(s.spCd).toBe(SPECIAL_START);
    s = stepKart(s, press, track, TICK_DT, paramsFor(1));
    expect(s.spCd).toBeLessThan(SPECIAL_START); // too early: nothing fired
    expect(s.boostT).toBe(0);
    s = { ...s, spCd: 0 };
    s = stepKart(s, press, track, TICK_DT, paramsFor(1));
    expect(s.spCd).toBe(SPECIAL_CD);
    expect(s.boostT).toBeGreaterThan(200);
    const again = stepKart(s, press, track, TICK_DT, paramsFor(1));
    expect(again.spCd).toBe(SPECIAL_CD - 1);
  });
  it("cannot fire while spun out", () => {
    const s = stepKart({ ...createKart(track), spCd: 0, stunT: 20 }, press, track, TICK_DT, paramsFor(1));
    expect(s.spCd).toBe(0);
    expect(s.boostT).toBe(0);
  });
});

describe("self-part of specials (predicted in the sim)", () => {
  const fire = (id: number, over: Partial<KartState> = {}) => stepKart({ ...createKart(track), spCd: 0, ...over }, press, track, TICK_DT, paramsFor(id));
  it("Overclock boosts", () => expect(fire(1).boostT).toBeGreaterThan(200));
  it("Gold Rush boosts + shields", () => {
    const s = fire(7);
    expect(s.shield).toBe(true);
    expect(s.boostT).toBeGreaterThan(100);
  });
  it("Green Shield shields and clears debuffs", () => {
    const s = fire(4, { confT: 100, slowT: 100 });
    expect(s.shield).toBe(true);
    expect(s.confT).toBe(0);
    expect(s.slowT).toBe(0);
  });
  it("Aid Package shields", () => expect(fire(9).shield).toBe(true));
  it("host-only specials have no self effect", () => {
    for (const id of [0, 2, 3, 5, 6, 8, 10, 11]) {
      const s = fire(id);
      expect(s.spCd).toBe(SPECIAL_CD);
      expect(s.shield || s.boostT > 0).toBe(false);
    }
  });
});

describe("debuff states in the sim", () => {
  it("confusion reverses steering and expires", () => {
    const k = { ...createKart(track), speed: 20 };
    const normal = stepKart(k, { ...idle, steer: 1 }, track).heading - k.heading;
    const conf = stepKart({ ...k, confT: 5 }, { ...idle, steer: 1 }, track).heading - k.heading;
    expect(Math.sign(conf)).toBe(-Math.sign(normal));
    let s: KartState = { ...k, confT: 2 };
    for (let i = 0; i < 3; i++) s = stepKart(s, idle, track);
    expect(s.confT).toBe(0);
  });
  it("slow lowers top speed and acceleration", () => {
    const run = (slowT: number) => {
      let s: KartState = { ...createKart(track), slowT };
      for (let i = 0; i < 40; i++) s = stepKart(s, { ...idle, throttle: 1 }, track);
      return s.speed;
    };
    expect(run(200)).toBeLessThan(run(0) * 0.8);
  });
});

describe("castSpecial (host)", () => {
  const rivals = () => [onTrack(1, 100), onTrack(2, 104), onTrack(3, 140)];
  it("Chaos Wave confuses all rivals, not the caster", () => {
    const [c, a, b] = rivals();
    world().castSpecial(0, c!, [c!, a!, b!], [3, 2, 1], fixedRng);
    expect(a!.cur.confT).toBe(CONF_TICKS);
    expect(b!.cur.confT).toBe(CONF_TICKS);
    expect(c!.cur.confT).toBe(0);
  });
  it("Rocket Salvo fires 3 missiles in 3 lanes and they hit", () => {
    const w = world();
    const c = onTrack(1, 100);
    const victims = [onTrack(2, 112), onTrack(3, 112, {})];
    w.castSpecial(2, c, [c, ...victims], [2, 3, 1], fixedRng);
    expect(w.objs.filter((o) => o.type === Item.Missile).length).toBe(3);
    expect(new Set(w.objs.map((o) => Math.round(o.lat))).size).toBe(3);
  });
  it("Ice Wall drops 3 slicks behind", () => {
    const w = world();
    const c = onTrack(1, 100);
    w.castSpecial(3, c, [c], [1], fixedRng);
    expect(w.objs.length).toBe(3);
    for (const o of w.objs) {
      expect(o.type).toBe(Item.Oil);
      const hit = nearestOnTrack(track, o.x, o.z, 100, 20);
      expect(hit.idx).toBeLessThanOrEqual(100);
    }
  });
  it("Bass Drop only spins out rivals within 18 m", () => {
    const c = onTrack(1, 100);
    const near = onTrack(2, 102);
    const far = onTrack(3, 140);
    world().castSpecial(5, c, [c, near, far], [1, 2, 3], fixedRng);
    expect(near.cur.stunT).toBeGreaterThan(0);
    expect(far.cur.stunT).toBe(0);
    expect(c.cur.stunT).toBe(0);
  });
  it("Giveaway gives items to everyone without one", () => {
    const c = onTrack(1, 100);
    const a = onTrack(2, 110, { item: Item.Oil });
    const b = onTrack(3, 120);
    world().castSpecial(6, c, [c, a, b], [3, 2, 1], fixedRng);
    expect(c.cur.item).not.toBe(Item.None);
    expect(b.cur.item).not.toBe(Item.None);
    expect(a.cur.item).toBe(Item.Oil);
  });
  it("Blitz scatters 4 slicks ahead of the caster", () => {
    const w = world();
    const c = onTrack(1, 100);
    w.castSpecial(8, c, [c], [1], fixedRng);
    expect(w.objs.length).toBe(4);
    for (const o of w.objs) expect(nearestOnTrack(track, o.x, o.z, 100, 30).idx).toBeGreaterThan(100);
  });
  it("Aid Package gives the caster an item", () => {
    const c = onTrack(1, 100);
    world().castSpecial(9, c, [c], [1], fixedRng);
    expect(c.cur.item).not.toBe(Item.None);
  });
  it("Lag Spike slows rivals in 35 m", () => {
    const c = onTrack(1, 100);
    const near = onTrack(2, 108);
    const far = onTrack(3, 160);
    world().castSpecial(10, c, [c, near, far], [1, 2, 3], fixedRng);
    expect(near.cur.slowT).toBe(SLOW_TICKS);
    expect(far.cur.slowT).toBe(0);
  });
  it("Lockdown freezes the kart ahead; leader gets a refund", () => {
    const lead = onTrack(1, 120);
    const me = onTrack(2, 100);
    world().castSpecial(11, me, [lead, me], [1, 2], fixedRng);
    expect(lead.cur.stunT).toBeGreaterThan(0);
    const solo = onTrack(1, 100);
    world().castSpecial(11, solo, [solo], [1], fixedRng);
    expect(solo.cur.spCd).toBe(SPECIAL_CD / 2);
  });
  it("every character has a special def", () => {
    for (const c of CHARACTERS) {
      expect(c.special.name.length).toBeGreaterThan(2);
      expect(c.special.icon.length).toBeGreaterThan(0);
    }
  });
});
