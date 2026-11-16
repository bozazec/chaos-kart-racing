import { Phase, type PhaseId } from "@kart/shared";
import { addXp } from "./progress";

/** XP table. Modelled on what other kart/racing games pay: small drip for skill moments, big payout for placing. */
export const XP = {
  overtake: 5,
  lap: 10,
  hitMissile: 10,
  hitDrone: 15,
  hitOil: 8,
  /** finish payout by place (1st, 2nd, 3rd), everyone else gets `finishRest` */
  finish: [100, 60, 40] as readonly number[],
  finishRest: 20,
} as const;

export interface RewardFrame {
  now: number;
  phase: PhaseId;
  waiting: boolean;
  /** racers in this round (not counting spectators waiting for the next one) */
  racers: number;
  mySlot: number;
  pos: number;
  lap: number;
  finished: boolean;
  /** every rendered kart: position and whether it is spun out */
  karts: Map<number, { x: number; z: number; stunned: boolean }>;
  objects: { id: number; type: number; owner: number; x: number; z: number }[];
}

const stunOf = (f: RewardFrame) => new Map([...f.karts].map(([slot, k]) => [slot, k.stunned]));
const OVERTAKE_COOLDOWN_MS = 1500;
const START_GRACE_MS = 4000; // the grid shuffles right after the lights
const HIT_WINDOW_MS = 1500;

/**
 * Turns the frame-by-frame view of the race into XP gains. Purely client side and only for your own kart.
 * Nothing pays out in a solo round, so you can't farm XP by driving laps alone.
 */
export class RewardTracker {
  private inRace = false;
  private raceStart = 0;
  private prevPos = 0;
  private prevLap = 0;
  private lastOvertake = -1e9;
  private paidFinish = false;
  private prevStun = new Map<number, boolean>();
  private prevObjs = new Map<number, { type: number; owner: number; x: number; z: number }>();
  private shots: { type: number; x: number; z: number; at: number }[] = [];

  constructor(private readonly award: (xp: number, why: string) => void = (xp) => void addXp(xp)) {}

  frame(f: RewardFrame) {
    const racing = f.phase === Phase.Race && !f.waiting;
    if (racing && !this.inRace) {
      this.inRace = true;
      this.raceStart = f.now;
      this.prevPos = f.pos;
      this.prevLap = f.lap;
      this.paidFinish = false;
      this.shots = [];
    }
    if (!racing) {
      // the round can flip to Results in the same frame you cross the line
      if (this.inRace && f.phase === Phase.Results && f.finished && !this.paidFinish && f.racers >= 2) {
        this.paidFinish = true;
        this.award(f.pos >= 1 && f.pos <= XP.finish.length ? XP.finish[f.pos - 1]! : XP.finishRest, f.pos === 1 ? "Race win" : "Race finished");
      }
      this.inRace = false;
      this.prevStun = stunOf(f);
      this.prevObjs.clear();
      return;
    }
    const live = f.racers >= 2;

    // my missiles/drones/oil that vanished this frame, remembered so a spin-out right after can be credited to them
    const nowObjs = new Map(f.objects.map((o) => [o.id, o]));
    for (const [id, o] of this.prevObjs) if (!nowObjs.has(id) && o.owner === f.mySlot) this.shots.push({ type: o.type, x: o.x, z: o.z, at: f.now });
    this.prevObjs = nowObjs;
    this.shots = this.shots.filter((s) => f.now - s.at < HIT_WINDOW_MS);
    for (const [slot, k] of f.karts) {
      if (slot === f.mySlot || !k.stunned || this.prevStun.get(slot)) continue;
      const i = this.shots.findIndex((s) => Math.hypot(s.x - k.x, s.z - k.z) < 25);
      if (i < 0) continue;
      const s = this.shots.splice(i, 1)[0]!;
      if (live) this.award(s.type === 5 ? XP.hitDrone : s.type === 3 ? XP.hitMissile : XP.hitOil, s.type === 5 ? "Drone hit" : s.type === 3 ? "Missile hit" : "Oil trap");
    }
    this.prevStun = stunOf(f);

    if (f.lap > this.prevLap && !f.finished && live) this.award(XP.lap, "Lap");
    this.prevLap = f.lap;

    if (f.pos > 0 && f.pos < this.prevPos && !f.finished && live && f.now - this.raceStart > START_GRACE_MS && f.now - this.lastOvertake > OVERTAKE_COOLDOWN_MS) {
      this.award(XP.overtake * (this.prevPos - f.pos), "Overtake");
      this.lastOvertake = f.now;
    }
    if (f.pos > 0) this.prevPos = f.pos;

    if (f.finished && !this.paidFinish) {
      this.paidFinish = true;
      if (live) this.award(f.pos >= 1 && f.pos <= XP.finish.length ? XP.finish[f.pos - 1]! : XP.finishRest, f.pos === 1 ? "Race win" : "Race finished");
    }
  }
}
