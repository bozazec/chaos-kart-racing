import { hitKart } from "./sim";
import { nearestOnTrack, trackLateral, trackPoint, type Track } from "./track";
import { CONF_TICKS, Item, PICKUP_COOLDOWN, SLOW_TICKS, SPECIAL_CD, type KartState } from "./types";

export const BOX_RADIUS = 2.4;
export const BOX_RESPAWN_TICKS = 300;
export const MISSILE_SPEED = 70;
export const MISSILE_TTL = 240;
export const MISSILE_HIT_R = 1.8;
export const DRONE_SPEED = 65;
export const DRONE_RANGE = 180; // metres: it never gets near a full lap
export const DRONE_TTL = Math.ceil((DRONE_RANGE / DRONE_SPEED) * 60);
export const DRONE_HIT_R = 2.2;
export const MISSILE_SPAWN_AHEAD = 2.6;
export const OIL_TTL = 1200;
export const OIL_HIT_R = 2.0;
export const OWNER_GRACE = 45;
export const MAX_OBJECTS = 40;

/** World object type for the Shahed drone (snapshot `type`; 3 = missile, 4 = oil). */
export const OBJ_DRONE = 5;

export interface WorldObj {
  id: number;
  type: typeof Item.Missile | typeof Item.Oil | typeof OBJ_DRONE;
  owner: number;
  x: number;
  z: number;
  /** missile: unit flight direction (straight line). */
  dx: number;
  dz: number;
  /** drone: slot it homes in on, -1 = none (then it flies along the track). */
  target: number;
  /** missile: nearest centerline sample (wall check hint). drone without target: position along the centerline. */
  s: number;
  /** drone without target: lateral offset */
  lat: number;
  age: number;
  ttl: number;
}

/** Weighted item roll. rankFrac: 0 = leading .. 1 = last. Back-markers get stronger items. */
export function rollItem(rankFrac: number, rng: () => number = Math.random, bias: readonly number[] = [1, 1, 1, 1]): number {
  const f = Math.min(1, Math.max(0, rankFrac));
  const lerp = (a: number, b: number) => a + (b - a) * f;
  const weights: [number, number][] = [
    [Item.Boost, lerp(20, 40) * (bias[0] ?? 1)],
    [Item.Shield, lerp(25, 10) * (bias[1] ?? 1)],
    [Item.Missile, lerp(15, 45) * (bias[2] ?? 1)],
    [Item.Oil, lerp(40, 5) * (bias[3] ?? 1)],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [item, w] of weights) {
    if ((r -= w) < 0) return item;
  }
  return Item.Boost;
}

export interface KartHolder {
  slot: number;
  cur: KartState;
  /** 1..5, default 3 */
  toughness?: number;
  /** item roll multipliers [boost, shield, missile, oil] */
  itemBias?: readonly number[];
}

/** Host-owned world: item boxes, missiles, oil slicks. Mutates `cur` of the karts it is given. */
export class ItemWorld {
  objs: WorldObj[] = [];
  boxTimers: number[];
  private nextId = 1;

  constructor(readonly track: Track) {
    this.boxTimers = track.itemBoxes.map(() => 0);
  }

  reset() {
    this.objs = [];
    this.boxTimers.fill(0);
    this.nextId = 1;
  }

  /** Bit i set = box i is available. */
  boxMask(): number {
    let m = 0;
    this.boxTimers.forEach((t, i) => {
      if (t === 0) m |= 1 << i;
    });
    return m >>> 0;
  }

  /** Create the world object for a used missile/oil item. */
  spawnFrom(item: number, owner: number, k: KartState) {
    if (item === Item.Missile) {
      this.spawnMissile(owner, k.x, k.z, k.heading, 0, k.segIdx);
    } else if (item === Item.Oil) {
      this.spawnOil(owner, k.x - Math.sin(k.heading) * 2.8, k.z - Math.cos(k.heading) * 2.8);
    }
  }

  /** Straight-line missile fired from (x, z) along `heading`, `side` metres to the right of the shooter. */
  spawnMissile(owner: number, x: number, z: number, heading: number, side = 0, segHint = 0) {
    if (this.objs.length >= MAX_OBJECTS) return;
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    const px = x + dx * MISSILE_SPAWN_AHEAD - Math.cos(heading) * side;
    const pz = z + dz * MISSILE_SPAWN_AHEAD + Math.sin(heading) * side;
    this.objs.push({ id: this.id(), type: Item.Missile, owner, x: px, z: pz, dx, dz, target: -1, s: segHint, lat: 0, age: 0, ttl: MISSILE_TTL });
  }

  /** Shahed drone: homes in on `target` (the kart ahead of the sender), or follows the track if nobody is ahead. */
  spawnDrone(owner: number, k: KartState, target: number) {
    if (this.objs.length >= MAX_OBJECTS) return;
    const hit = nearestOnTrack(this.track, k.x, k.z, k.segIdx);
    this.objs.push({ id: this.id(), type: OBJ_DRONE, owner, x: k.x, z: k.z, dx: Math.sin(k.heading), dz: Math.cos(k.heading), target, s: hit.idx + hit.t, lat: trackLateral(this.track, hit, k.x, k.z), age: 0, ttl: DRONE_TTL });
  }

  spawnOil(owner: number, x: number, z: number) {
    if (this.objs.length >= MAX_OBJECTS) return;
    this.objs.push({ id: this.id(), type: Item.Oil, owner, x, z, dx: 0, dz: 0, target: -1, s: 0, lat: 0, age: 0, ttl: OIL_TTL });
  }

  /**
   * World/area part of a character special (the self part lives in stepKart).
   * `order` = slots ranked first..last. Mutates karts' `cur`.
   */
  castSpecial(charId: number, caster: KartHolder, karts: KartHolder[], order: number[], rng: () => number = Math.random) {
    const others = karts.filter((k) => k.slot !== caster.slot && !k.cur.finished);
    const c = caster.cur;
    const hit = nearestOnTrack(this.track, c.x, c.z, c.segIdx);
    const s0 = hit.idx + hit.t;
    const frac = (slot: number) => (order.length > 1 ? Math.max(0, order.indexOf(slot)) / (order.length - 1) : 0);
    switch (charId) {
      case 0: // Chaos Wave: rivals' steering reversed
        for (const k of others) k.cur = { ...k.cur, confT: CONF_TICKS };
        break;
      case 2: // Rocket Salvo: three parallel straight missiles
        for (const side of [-3.5, 0, 3.5]) this.spawnMissile(caster.slot, c.x, c.z, c.heading, side, c.segIdx);
        break;
      case 3: // Shahed Drone (Putin)
      case 9: {
        // Shahed Drone (Zelensky): homes in on the kart just ahead of the caster
        const i = order.indexOf(caster.slot);
        const target = i > 0 ? karts.find((k) => k.slot === order[i - 1] && !k.cur.finished) : undefined;
        this.spawnDrone(caster.slot, c, target ? target.slot : -1);
        break;
      }
      case 5: // Bass Drop: shockwave
        for (const k of others) if (Math.hypot(k.cur.x - c.x, k.cur.z - c.z) < 18) k.cur = hitKart(k.cur, k.toughness);
        break;
      case 6: // Giveaway: free item for everyone without one
        for (const k of karts) {
          if (k.cur.item === Item.None && !k.cur.finished) k.cur = { ...k.cur, item: rollItem(frac(k.slot), rng, k.itemBias), itemCd: PICKUP_COOLDOWN };
        }
        break;
      case 8: // Blitz: slicks scattered ahead
        for (let i = 0; i < 4; i++) {
          const p = trackPoint(this.track, s0 + 6 + rng() * 10, (rng() * 2 - 1) * 6);
          this.spawnOil(caster.slot, p.x, p.z);
        }
        break;
      case 10: // Lag Spike
        for (const k of others) if (Math.hypot(k.cur.x - c.x, k.cur.z - c.z) < 35) k.cur = { ...k.cur, slowT: SLOW_TICKS };
        break;
      case 11: {
        // Lockdown: freeze the kart just ahead; leader gets half the cooldown back
        const i = order.indexOf(caster.slot);
        const target = i > 0 ? karts.find((k) => k.slot === order[i - 1] && !k.cur.finished) : undefined;
        if (target) target.cur = hitKart(target.cur, target.toughness);
        else caster.cur = { ...caster.cur, spCd: SPECIAL_CD / 2 };
        break;
      }
    }
  }

  private id() {
    const id = this.nextId;
    this.nextId = (this.nextId % 250) + 1;
    return id;
  }

  /** Homing flight: straight at the target kart; with no target, along the centerline until it reaches a kart. */
  private stepDrone(o: WorldObj, karts: KartHolder[], dt: number) {
    const t = o.target >= 0 ? karts.find((k) => k.slot === o.target && !k.cur.finished) : undefined;
    const step = DRONE_SPEED * dt;
    if (t) {
      const ex = t.cur.x - o.x;
      const ez = t.cur.z - o.z;
      const d = Math.hypot(ex, ez) || 1;
      o.dx = ex / d;
      o.dz = ez / d;
      o.x += o.dx * Math.min(step, d);
      o.z += o.dz * Math.min(step, d);
      return;
    }
    if (o.target >= 0) {
      // target finished/left: carry on along the track from where we are
      o.target = -1;
      const hit = nearestOnTrack(this.track, o.x, o.z, Math.floor(o.s));
      o.s = hit.idx + hit.t;
      o.lat = trackLateral(this.track, hit, o.x, o.z);
    }
    o.s += step / this.track.spacing;
    const p = trackPoint(this.track, o.s, o.lat);
    o.dx = p.x - o.x;
    o.dz = p.z - o.z;
    o.x = p.x;
    o.z = p.z;
  }

  step(karts: KartHolder[], rankFrac: (slot: number) => number, dt: number, rng: () => number = Math.random) {
    // boxes: respawn timers + pickups
    for (let i = 0; i < this.boxTimers.length; i++) if (this.boxTimers[i]! > 0) this.boxTimers[i]!--;
    for (const k of karts) {
      if (k.cur.item !== Item.None || k.cur.finished) continue;
      for (let i = 0; i < this.boxTimers.length; i++) {
        if (this.boxTimers[i]! > 0) continue;
        const b = this.track.itemBoxes[i]!;
        if (Math.hypot(k.cur.x - b.x, k.cur.z - b.z) < BOX_RADIUS) {
          this.boxTimers[i] = BOX_RESPAWN_TICKS;
          k.cur = { ...k.cur, item: rollItem(rankFrac(k.slot), rng, k.itemBias), itemCd: PICKUP_COOLDOWN };
          break;
        }
      }
    }

    // objects
    const alive: WorldObj[] = [];
    for (const o of this.objs) {
      o.age++;
      o.ttl--;
      let consumed = o.ttl <= 0;
      if (o.type === Item.Missile) {
        // straight line; explodes on the first wall it reaches (or a kart, below)
        o.x += o.dx * MISSILE_SPEED * dt;
        o.z += o.dz * MISSILE_SPEED * dt;
        const nh = nearestOnTrack(this.track, o.x, o.z, o.s, 30);
        o.s = nh.idx;
        if (nh.dist > this.track.halfWidth) consumed = true;
      } else if (o.type === OBJ_DRONE) {
        this.stepDrone(o, karts, dt);
      }
      const r = o.type === Item.Missile ? MISSILE_HIT_R : o.type === OBJ_DRONE ? DRONE_HIT_R : OIL_HIT_R;
      if (!consumed) {
        for (const k of karts) {
          if (k.cur.finished || (k.slot === o.owner && o.age < OWNER_GRACE)) continue;
          if (Math.hypot(k.cur.x - o.x, k.cur.z - o.z) < r) {
            k.cur = hitKart(k.cur, k.toughness);
            consumed = true;
            break;
          }
        }
      }
      if (!consumed) alive.push(o);
    }
    this.objs = alive;
  }
}
