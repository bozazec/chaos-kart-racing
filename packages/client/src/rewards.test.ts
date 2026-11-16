import { describe, expect, it } from "vitest";
import { Phase } from "@kart/shared";
import { RewardTracker, XP, type RewardFrame } from "./rewards";

const base = (o: Partial<RewardFrame> = {}): RewardFrame => ({
  now: 0,
  phase: Phase.Race,
  waiting: false,
  racers: 4,
  mySlot: 0,
  pos: 4,
  lap: 0,
  finished: false,
  karts: new Map([
    [0, { x: 0, z: 0, stunned: false }],
    [1, { x: 10, z: 0, stunned: false }],
  ]),
  objects: [],
  ...o,
});
const mk = () => {
  const got: [number, string][] = [];
  return { got, t: new RewardTracker((xp, why) => got.push([xp, why])) };
};

describe("RewardTracker", () => {
  it("pays per place gained, but not during the start shuffle", () => {
    const { got, t } = mk();
    t.frame(base({ now: 0, pos: 4 }));
    t.frame(base({ now: 1000, pos: 3 })); // grid shuffle
    expect(got).toEqual([]);
    t.frame(base({ now: 6000, pos: 2 }));
    expect(got).toEqual([[XP.overtake, "Overtake"]]);
    t.frame(base({ now: 6100, pos: 1 })); // cooldown
    expect(got).toHaveLength(1);
  });

  it("pays laps and a finish by place, once", () => {
    const { got, t } = mk();
    t.frame(base({ now: 0, pos: 1 }));
    t.frame(base({ now: 9000, pos: 1, lap: 1 }));
    t.frame(base({ now: 18000, pos: 1, lap: 3, finished: true }));
    t.frame(base({ now: 18100, pos: 1, lap: 3, finished: true }));
    expect(got).toEqual([
      [XP.lap, "Lap"],
      [XP.finish[0], "Race win"],
    ]);
  });

  it("pays the finish when the round flips to Results in the same frame", () => {
    const { got, t } = mk();
    t.frame(base({ now: 0, pos: 2 }));
    t.frame(base({ now: 9000, pos: 2, phase: Phase.Results, lap: 3, finished: true }));
    expect(got).toEqual([[XP.finish[1], "Race finished"]]);
  });

  it("credits a spin-out right after my missile vanished near the victim", () => {
    const { got, t } = mk();
    const m = { id: 5, type: 3, owner: 0, x: 9, z: 0 };
    t.frame(base({ now: 0, objects: [m] }));
    t.frame(base({ now: 100, karts: new Map([[0, { x: 0, z: 0, stunned: false }], [1, { x: 10, z: 0, stunned: true }]]) }));
    expect(got).toEqual([[XP.hitMissile, "Missile hit"]]);
  });

  it("ignores other people's missiles and far-away spin-outs", () => {
    const { got, t } = mk();
    t.frame(base({ now: 0, objects: [{ id: 5, type: 3, owner: 2, x: 9, z: 0 }] }));
    t.frame(base({ now: 100, karts: new Map([[1, { x: 10, z: 0, stunned: true }]]) }));
    const t2 = mk();
    t2.t.frame(base({ now: 0, objects: [{ id: 5, type: 5, owner: 0, x: 90, z: 0 }] }));
    t2.t.frame(base({ now: 100, karts: new Map([[1, { x: 10, z: 0, stunned: true }]]) }));
    expect(got).toEqual([]);
    expect(t2.got).toEqual([]);
  });

  it("pays nothing in a solo round", () => {
    const { got, t } = mk();
    t.frame(base({ racers: 1, pos: 1 }));
    t.frame(base({ racers: 1, now: 9000, pos: 1, lap: 3, finished: true }));
    expect(got).toEqual([]);
  });
});
