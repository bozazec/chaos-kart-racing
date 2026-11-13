import { describe, expect, it } from "vitest";
import {
  buildTrack, DEMO_CONTROL, decodeSnapshot, encodeInput, GameHost, MAX_PLAYERS, NEUTRAL_INPUT, Phase, quantizeInput, TICK_DT,
  type EvtMsg, type HostTransport, type KartInput, type KartState, type Snapshot,
} from "./index";

const track = buildTrack(DEMO_CONTROL, { laps: 1 });

function fakeTransport() {
  const evts = new Map<number, EvtMsg[]>();
  const snaps = new Map<number, Snapshot>();
  const registry: { players: number; state: string }[] = [];
  const tx: HostTransport = {
    sendSnapshot: (p, buf) => void snaps.set(p, decodeSnapshot(buf)!),
    sendEvt: (p, m) => void (evts.get(p) ?? evts.set(p, []).get(p)!).push(m),
    onRegistry: (i) => void registry.push(i),
  };
  return { tx, evts, snaps, registry, last: (p: number, t: EvtMsg["t"]) => [...(evts.get(p) ?? [])].reverse().find((m) => m.t === t) };
}

function pursuit(s: KartState): KartInput {
  const n = track.points.length;
  const t = track.points[(s.segIdx + 8) % n]!;
  let err = Math.atan2(t.x - s.x, t.z - s.z) - s.heading;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  return { steer: Math.max(-1, Math.min(1, -err * 2)), throttle: Math.abs(err) > 0.5 ? 0.3 : 1, brake: 0, useItem: false };
}

/** Run the host for `secs` of simulated time, feeding bot input for each remote peer from its snapshots. */
function run(host: GameHost, fx: ReturnType<typeof fakeTransport>, peers: number[], secs: number, clock: { t: number }, seq: Map<number, number>) {
  const steps = Math.round(secs / TICK_DT);
  for (let i = 0; i < steps; i++) {
    clock.t += TICK_DT * 1000;
    for (const p of peers) {
      const snap = fx.snaps.get(p);
      const slot = host.peerSlot(p);
      const me = snap?.karts.find((k) => k.slot === slot)?.state;
      if (me && snap!.phase === Phase.Race) {
        const n = (seq.get(p) ?? 0) + 1;
        seq.set(p, n);
        host.handleInput(p, encodeInput(n, quantizeInput({ ...pursuit(me), useSpecial: me.spCd === 0 })));
      }
    }
    host.advance(clock.t);
  }
}

describe("GameHost (headless)", () => {
  it("runs a full round with a local player and a remote bot: lobby -> countdown -> race -> results -> countdown", () => {
    const fx = fakeTransport();
    const clock = { t: 1000 };
    // eslint-disable-next-line prefer-const
    let host: GameHost;
    host = new GameHost(track, fx.tx, { hostPlayer: { name: "Hosty", character: 1, input: (): KartInput => ({ ...pursuit(host.localState()!), useSpecial: true }) } });
    expect(host.reservePeer(7)).toBe(1);
    host.peerReady(7);
    expect(fx.last(7, "welcome")).toMatchObject({ slot: 1 });
    host.handleEvt(7, JSON.stringify({ t: "hello", name: "Bot", character: 2 }));
    const seq = new Map<number, number>();
    run(host, fx, [7], 1, clock, seq);
    expect(host.phase).toBe(Phase.Lobby);

    host.startRace();
    expect(host.phase).toBe(Phase.Countdown);
    run(host, fx, [7], 3.2, clock, seq);
    expect(host.phase).toBe(Phase.Race);

    const phases = new Set<number>();
    for (let i = 0; i < 100 && host.phase === Phase.Race; i++) {
      run(host, fx, [7], 1, clock, seq);
      phases.add(host.phase);
    }
    expect(host.phase).toBe(Phase.Results);
    const room = host.roomMsg();
    expect(room.players.filter((p: { finishTime: number }) => p.finishTime > 0).length).toBeGreaterThanOrEqual(1);
    expect(room.players.map((p: { pos: number }) => p.pos).sort()).toEqual([1, 2]);
    expect(room.players.find((p: { slot: number }) => p.slot === 1)?.name).toBe("Bot");

    run(host, fx, [7], 5.5, clock, seq);
    expect(host.phase).toBe(Phase.Countdown); // next game rolls on automatically in the same room
    expect(host.localState()!.lap).toBe(0); // grid reset
    expect(fx.snaps.get(7)!.epoch).toBeGreaterThan(0); // clients are told to resync
  });

  it("host restart scraps a running race and starts a fresh countdown", () => {
    const fx = fakeTransport();
    const clock = { t: 0 };
    const host = new GameHost(track, fx.tx, { hostPlayer: { name: "Hosty", character: 1, input: (): KartInput => ({ steer: 0, throttle: 1, brake: 0, useItem: false }) } });
    host.startRace();
    run(host, fx, [], 4, clock, new Map());
    expect(host.phase).toBe(Phase.Race);
    run(host, fx, [], 3, clock, new Map());
    expect(host.localState()!.speed).toBeGreaterThan(0);
    host.restart();
    expect(host.phase).toBe(Phase.Countdown);
    expect(host.localState()!.speed).toBe(0);
    expect(host.roomMsg().countdown).toBeGreaterThan(2.9);
  });

  it("dedicated rooms roll into the next game after results, or wait in the lobby when short of players", () => {
    const fx = fakeTransport();
    const clock = { t: 0 };
    const host = new GameHost(0, fx.tx, { autoStart: { minPlayers: 1, delaySec: 100 } });
    const toResults = () => {
      for (let i = 0; i < 60 * 400 && host.phase !== Phase.Results; i++) {
        clock.t += TICK_DT * 1000;
        host.advance(clock.t);
      }
      expect(host.phase).toBe(Phase.Results);
    };
    const wait = (sec: number) => {
      for (let i = 0; i < 60 * sec; i++) {
        clock.t += TICK_DT * 1000;
        host.advance(clock.t);
      }
    };
    host.reservePeer(1);
    host.peerReady(1);
    host.startRace();
    toResults();
    wait(6);
    expect(host.phase).toBe(Phase.Countdown);

    host.removePeer(1);
    host.toLobby();
    host.reservePeer(2);
    host.peerReady(2);
    host.startRace();
    toResults();
    host.removePeer(2);
    wait(6);
    expect(host.phase).toBe(Phase.Lobby);
  });

  it("late joiner waits, then is promoted at the next lobby", () => {
    const fx = fakeTransport();
    const clock = { t: 0 };
    const host = new GameHost(track, fx.tx, { hostPlayer: { name: "H", character: 0, input: () => NEUTRAL_INPUT } });
    host.startRace();
    run(host, fx, [], 3.2, clock, new Map());
    expect(host.phase).toBe(Phase.Race);
    host.reservePeer(5);
    host.peerReady(5);
    expect(host.roomMsg().players.find((p) => p.slot === 1)?.waiting).toBe(true);
    host.toLobby();
    expect(host.phase).toBe(Phase.Lobby);
    expect(host.roomMsg().players.find((p) => p.slot === 1)?.waiting).toBe(false);
  });

  it("dedicated mode: no local player, slots from 0, auto-starts once enough players are in, rejects when full", () => {
    const fx = fakeTransport();
    const clock = { t: 0 };
    const host = new GameHost(track, fx.tx, { autoStart: { minPlayers: 2, delaySec: 5 } });
    expect(host.reservePeer(1)).toBe(0);
    host.peerReady(1);
    expect(host.roomMsg().autoIn).toBe(-1); // waiting for a second player
    run(host, fx, [], 6, clock, new Map());
    expect(host.phase).toBe(Phase.Lobby);
    expect(host.reservePeer(2)).toBe(1);
    host.peerReady(2);
    run(host, fx, [], 2, clock, new Map());
    expect(host.phase).toBe(Phase.Lobby);
    expect(host.roomMsg().autoIn).toBeGreaterThan(0);
    run(host, fx, [], 3.5, clock, new Map());
    expect(host.phase).toBe(Phase.Countdown);
    expect(fx.registry.at(-1)).toEqual({ players: 2, state: "racing", track: 0 });

    const full = new GameHost(track, fakeTransport().tx, {});
    for (let i = 0; i < MAX_PLAYERS; i++) expect(full.reservePeer(100 + i)).toBe(i);
    expect(full.reservePeer(999)).toBe(-1);
  });

  it("removePeer frees the slot and the kart; garbage input/events are ignored", () => {
    const fx = fakeTransport();
    const host = new GameHost(track, fx.tx, { hostPlayer: { name: "H", character: 0, input: () => NEUTRAL_INPUT } });
    host.reservePeer(3);
    host.peerReady(3);
    expect(host.roomMsg().players.length).toBe(2);
    host.handleInput(3, new ArrayBuffer(2));
    host.handleEvt(3, "not json");
    host.handleEvt(99, JSON.stringify({ t: "hello", name: "ghost", character: 1 }));
    host.removePeer(3);
    expect(host.roomMsg().players.length).toBe(1);
    expect(host.reservePeer(4)).toBe(1);
  });

  it("only changes character in the lobby", () => {
    const fx = fakeTransport();
    const host = new GameHost(track, fx.tx, { hostPlayer: { name: "H", character: 0, input: () => NEUTRAL_INPUT } });
    host.setLocalCharacter(5);
    expect(host.roomMsg().players[0]!.character).toBe(5);
    host.startRace();
    host.setLocalCharacter(7);
    expect(host.roomMsg().players[0]!.character).toBe(5);
  });
});

describe("GameHost tracks", () => {
  const hp = () => ({ hostPlayer: { name: "H", character: 0, input: () => NEUTRAL_INPUT } });

  it("host picks the track in the lobby: grid reset, epoch bump, welcome/room carry the id", () => {
    const fx = fakeTransport();
    const host = new GameHost(0, fx.tx, hp());
    expect(host.trackId).toBe(0);
    host.reservePeer(5);
    host.peerReady(5);
    expect(fx.last(5, "welcome")).toMatchObject({ track: 0 });
    host.setTrack(2);
    expect(host.trackId).toBe(2);
    expect(host.roomMsg().track).toBe(2);
    expect(fx.last(5, "room")).toMatchObject({ track: 2 });
    expect(host.registryInfo().track).toBe(2);
    expect(host.localState()!.lap).toBe(0);
    // junk ids and no-op changes are ignored
    host.setTrack(99);
    host.setTrack(2);
    expect(host.trackId).toBe(2);
  });

  it("cannot change track mid-round, and a dedicated room has no host to ask", () => {
    const fx = fakeTransport();
    const host = new GameHost(0, fx.tx, hp());
    host.startRace();
    host.setTrack(1);
    expect(host.trackId).toBe(0);
    const ded = new GameHost(0, fakeTransport().tx, { autoStart: { minPlayers: 2, delaySec: 5 } });
    ded.setTrack(1);
    expect(ded.trackId).toBe(0);
  });

  it("dedicated rooms can rotate through the tracks every round", () => {
    const fx = fakeTransport();
    const clock = { t: 0 };
    const host = new GameHost(0, fx.tx, { autoStart: { minPlayers: 1, delaySec: 1 }, rotateTracks: true });
    host.reservePeer(1);
    host.peerReady(1);
    const seen = [host.trackId];
    for (let round = 0; round < 3; round++) {
      host.toLobby(); // not in lobby yet on round 0 -> no-op; later rounds abort the race
      for (let i = 0; i < 60 * 8 && host.phase !== Phase.Race; i++) {
        clock.t += TICK_DT * 1000;
        host.advance(clock.t);
      }
      host.toLobby();
      seen.push(host.trackId);
    }
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

