import { nearestOnTrack, type Track } from "./track";
import { BOOST_TICKS, Item, ITEM_COOLDOWN, SHIELD_TICKS, SPECIAL_CD, SPECIAL_START, STUN_TICKS, type KartInput, type KartState } from "./types";

export const TICK_DT = 1 / 60;

export interface KartParams {
  maxSpeed: number;
  maxReverse: number;
  accel: number;
  brakeDecel: number;
  coastDecel: number;
  steerRate: number; // rad/s at full steer
  offroadSpeedFactor: number;
  wallMargin: number; // allowed distance beyond halfWidth before wall
  /** character id, selects the self-part of the special power (-1 = none) */
  charId: number;
}

export const DEFAULT_PARAMS: KartParams = {
  maxSpeed: 40,
  maxReverse: 10,
  accel: 25,
  brakeDecel: 50,
  coastDecel: 8,
  steerRate: 2.2,
  offroadSpeedFactor: 0.45,
  wallMargin: 3,
  charId: -1,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createKart(track: Track, slot = 0): KartState {
  const { x, z, heading } = track.spawn;
  // staggered grid behind the line, 2 columns
  const back = 6 + Math.floor(slot / 2) * 6;
  const side = slot % 2 === 0 ? -2.5 : 2.5;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = -fz; // right of forward (facing +z => right is -x)
  const rz = fx;
  const sx = x - fx * back + rx * -side;
  const sz = z - fz * back + rz * -side;
  const n = track.points.length;
  return {
    x: sx,
    z: sz,
    heading,
    speed: 0,
    segIdx: (n - 1 - Math.floor(back / 4) + n) % n,
    lap: 0,
    nextCp: 1,
    finished: false,
    offTrack: false,
    item: 0,
    boostT: 0,
    stunT: 0,
    itemCd: 0,
    shield: false,
    shieldT: 0,
    confT: 0,
    slowT: 0,
    spCd: SPECIAL_START,
  };
}

/** A hazard hit: shield absorbs it, otherwise spin out. Tougher karts (1..5) recover faster and keep more speed. */
export function hitKart(s: KartState, toughness = 3): KartState {
  if (s.stunT > 0) return s;
  if (s.shield) return { ...s, shield: false, shieldT: 0 };
  const stun = Math.round(STUN_TICKS * (1 - 0.15 * (toughness - 3)));
  return { ...s, stunT: stun, boostT: 0, speed: s.speed * (0.4 + 0.05 * (toughness - 3)) };
}

/** Back to the centre of the last checkpoint passed, facing forward, standing still. Items and cooldowns are kept. */
export function resetToCheckpoint(s: KartState, track: Track): KartState {
  const n = track.points.length;
  const cps = track.checkpoints;
  const idx = cps[(s.nextCp - 1 + cps.length) % cps.length]!;
  const a = track.points[idx]!;
  const b = track.points[(idx + 1) % n]!;
  return { ...s, x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z), speed: 0, segIdx: idx, boostT: 0, stunT: 0, offTrack: false };
}

const BOOST_CAP = 1.45;

/** Advance one kart by dt. Pure: returns a new state. */
export function stepKart(
  s: KartState,
  input: KartInput,
  track: Track,
  dt = TICK_DT,
  p: KartParams = DEFAULT_PARAMS,
): KartState {
  let { x, z, heading, speed, lap, nextCp, finished, item, boostT, stunT, itemCd, shield, shieldT, confT, slowT, spCd } = s;
  // finished karts coast to a stop, ignoring input (keeps prediction identical on host/client)
  if (finished) input = { steer: 0, throttle: 0, brake: 0.5, useItem: false };
  const stunned = stunT > 0;
  if (input.reset && !finished && !stunned) return resetToCheckpoint(s, track);
  if (stunned) input = { steer: 0, throttle: 0, brake: 0, useItem: false };

  // held item. Boost/shield are self-contained so clients predict them; missile/oil are spawned by the host
  // (it sees item go non-zero -> 0 without a pickup).
  if (itemCd > 0) itemCd--;
  if (input.useItem && item !== Item.None && itemCd === 0) {
    if (item === Item.Boost) boostT = BOOST_TICKS;
    else if (item === Item.Shield) {
      shield = true;
      shieldT = SHIELD_TICKS;
    }
    item = Item.None;
    itemCd = ITEM_COOLDOWN;
  }

  // character special: the self-part runs here (predicted); area/world parts are cast by the host when it sees spCd jump
  if (spCd > 0) spCd--;
  if (input.useSpecial && spCd === 0 && !stunned && !finished) {
    spCd = SPECIAL_CD;
    switch (p.charId) {
      case 1: // Overclock
        boostT = Math.round(BOOST_TICKS * 1.75);
        break;
      case 4: // Green Shield
        shield = true;
        shieldT = SHIELD_TICKS;
        confT = 0;
        slowT = 0;
        break;
      case 7: // Gold Rush
        boostT = Math.max(boostT, BOOST_TICKS);
        shield = true;
        shieldT = SHIELD_TICKS;
        break;
    }
  }
  // the shield runs out after 10 s even if nothing hit it
  if (shield && --shieldT <= 0) {
    shield = false;
    shieldT = 0;
  }
  const boosting = boostT > 0;
  if (boosting) boostT--;
  if (stunned) stunT--;
  const slowed = slowT > 0;
  if (slowed) slowT--;
  const confused = confT > 0;
  if (confused) confT--;
  const steer = clamp(input.steer, -1, 1) * (confused ? -1 : 1);
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);

  const hit0 = nearestOnTrack(track, x, z, s.segIdx);
  const offTrack = hit0.dist > track.halfWidth;
  const cap = p.maxSpeed * (offTrack ? p.offroadSpeedFactor : 1) * (boosting ? BOOST_CAP : 1) * (slowed ? 0.55 : 1);

  // longitudinal
  if (boosting) speed += p.accel * 2 * dt;
  else if (throttle > 0) speed += p.accel * (slowed ? 0.6 : 1) * throttle * dt;
  if (brake > 0) speed -= (speed > 0 ? p.brakeDecel : p.accel) * brake * dt;
  if (throttle === 0 && brake === 0 && !boosting) {
    const d = p.coastDecel * dt;
    speed = Math.abs(speed) <= d ? 0 : speed - Math.sign(speed) * d;
  }
  if (speed > cap) speed = Math.max(cap, speed - p.brakeDecel * 0.5 * dt); // bleed excess (e.g. entering grass)
  speed = Math.max(speed, -p.maxReverse);

  // steering: needs speed, tapers a little at top speed; reverse flips
  const speedFactor = clamp(Math.abs(speed) / 8, 0, 1) * (1 - 0.35 * clamp(Math.abs(speed) / p.maxSpeed, 0, 1));
  heading += -steer * p.steerRate * speedFactor * Math.sign(speed || 1) * dt;
  if (stunned) {
    heading += 9 * dt; // spin out
    speed *= Math.max(0, 1 - 2.5 * dt);
  }

  x += Math.sin(heading) * speed * dt;
  z += Math.cos(heading) * speed * dt;

  // wall
  let hit = nearestOnTrack(track, x, z, hit0.idx);
  const limit = track.halfWidth + p.wallMargin;
  if (hit.dist > limit) {
    x = hit.px + hit.nx * limit;
    z = hit.pz + hit.nz * limit;
    speed *= Math.max(0, 1 - 4 * dt);
    hit = nearestOnTrack(track, x, z, hit.idx);
  }

  // checkpoints / laps
  const n = track.points.length;
  const prev = s.segIdx;
  const cur = hit.idx;
  const fwd = (cur - prev + n) % n;
  if (fwd > 0 && fwd < n / 2 && !finished) {
    const cp = track.checkpoints[nextCp]!;
    const toCp = (cp - prev + n) % n;
    if (toCp >= 1 && toCp <= fwd) {
      nextCp++;
      if (nextCp >= track.checkpoints.length) nextCp = 0;
      if (nextCp === 1 && cp === track.checkpoints[0]) {
        // crossed start line after full circuit
        lap++;
        if (lap >= track.laps) finished = true;
      }
    }
  }

  return {
    x,
    z,
    heading,
    speed,
    segIdx: hit.idx,
    lap,
    nextCp,
    finished,
    offTrack: hit.dist > track.halfWidth,
    item,
    boostT,
    stunT,
    itemCd,
    shield,
    shieldT,
    confT,
    slowT,
    spCd,
  };
}
