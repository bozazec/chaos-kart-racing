export interface Vec2 {
  x: number;
  z: number;
}

/** Per-tick kart input. steer: -1 (left) .. +1 (right). */
export interface KartInput {
  steer: number;
  throttle: number; // 0..1
  brake: number; // 0..1
  useItem: boolean;
  /** character special power (own button + cooldown) */
  useSpecial?: boolean;
  /** Put the kart back on the last checkpoint it passed (stuck / lost). */
  reset?: boolean;
}

export const NEUTRAL_INPUT: KartInput = { steer: 0, throttle: 0, brake: 0, useItem: false };

/** Forward vector = (sin heading, cos heading). Heading 0 faces +z; increasing heading turns left. */
export interface KartState {
  x: number;
  z: number;
  heading: number;
  speed: number; // signed, along heading
  segIdx: number; // nearest centerline sample, progress tracking
  lap: number; // completed laps
  nextCp: number; // index into track.checkpoints
  finished: boolean;
  offTrack: boolean;
  /** Held item (see `Item`), 0 = none. */
  item: number;
  /** Ticks of boost remaining. */
  boostT: number;
  /** Ticks of spin-out remaining (input ignored). */
  stunT: number;
  /** Ticks until the held item can be used (stops a held button chaining items). */
  itemCd: number;
  /** Absorbs the next hit, for at most SHIELD_TICKS. */
  shield: boolean;
  /** Ticks of shield remaining. */
  shieldT: number;
  /** Ticks of reversed steering remaining (Chaos Wave). */
  confT: number;
  /** Ticks of slowdown remaining (Lag Spike). */
  slowT: number;
  /** Ticks until the character special is ready. */
  spCd: number;
}

export const MAX_PLAYERS = 8;

export const Item = { None: 0, Boost: 1, Shield: 2, Missile: 3, Oil: 4, Drone: 5 } as const;
export const ITEM_COUNT = 6;
export const BOOST_TICKS = 120;
export const STUN_TICKS = 70;
export const ITEM_COOLDOWN = 20;
export const PICKUP_COOLDOWN = 30;
export const SHIELD_TICKS = 600; // 10 s
export const SPECIAL_CD = 1500; // 25 s
export const SPECIAL_START = 600; // 10 s into the race
export const CONF_TICKS = 180;
export const SLOW_TICKS = 150;
