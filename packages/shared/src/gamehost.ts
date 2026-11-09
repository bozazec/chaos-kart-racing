import { characterById, cleanCharacter, paramsFor } from "./characters";
import { ItemWorld } from "./items";
import {
  cleanName,
  decodeInput,
  encodeSnapshot,
  Phase,
  quantizeInput,
  seqNewer,
  type EvtMsg,
  type PhaseId,
  type PlayerInfo,
} from "./protocol";
import { kartProgress, resolveBumps } from "./race";
import { createKart, stepKart, TICK_DT } from "./sim";
import { buildTrackById, cleanTrackId, TRACKS, type Track } from "./track";
import { Item, MAX_PLAYERS, SPECIAL_START, type KartInput, type KartState } from "./types";
import type { KartParams } from "./sim";

const NEUTRAL: KartInput = { steer: 0, throttle: 0, brake: 0, useItem: false };
const HZ = 1 / TICK_DT;
const SNAPSHOT_EVERY = 3; // 60 Hz sim -> 20 Hz snapshots
const ROOM_MSG_EVERY = 30; // 2 Hz room state
const COUNTDOWN_TICKS = 3 * HZ;
const RESULTS_TICKS = 5 * HZ; // results screen doubles as the "next game in N s" countdown
const FINISH_GRACE_TICKS = 30 * HZ; // after first finisher, others get this long
const MAX_RACE_TICKS = 5 * 60 * HZ;

/** How the host gets bytes to its players. Browser: WebRTC/relay. Dedicated server: WebSocket relay. */
export interface HostTransport {
  sendSnapshot(peer: number, buf: ArrayBuffer): void;
  sendEvt(peer: number, m: EvtMsg): void;
  /** Public room-list info changed (player count / lobby vs racing). */
  onRegistry?(info: { players: number; state: "lobby" | "racing"; track: number }): void;
}

export interface GameHostOptions {
  /** Slot 0 is a local player on the host's machine (browser host / solo). Absent = dedicated server. */
  hostPlayer?: { name: string; character: number; input: () => KartInput };
  /** Dedicated rooms have no host UI: start automatically once enough players are in the lobby. */
  autoStart?: { minPlayers: number; delaySec: number };
  /** Dedicated rooms: move to the next track after every round. */
  rotateTracks?: boolean;
}

interface HostKart {
  slot: number;
  prev: KartState;
  cur: KartState;
  queue: { seq: number; input: KartInput }[];
  lastInput: KartInput;
  ack: number;
  /** from the driver's character */
  params: KartParams;
  toughness: number;
  itemBias: readonly number[];
}

interface PeerInfo {
  slot: number;
  ready: boolean;
  lastSeq: number;
}

export interface KartRender {
  slot: number;
  x: number;
  z: number;
  heading: number;
  shield: boolean;
  boosting: boolean;
  stunned: boolean;
  confused: boolean;
  slowed: boolean;
}

export interface WorldRender {
  boxMask: number;
  objects: { id: number; type: number; x: number; z: number }[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * Authoritative sim + round state machine, independent of any transport and of the DOM.
 * Used by the browser host (Option A) and the dedicated server (Option B).
 * Phases: LOBBY -> COUNTDOWN -> RACE -> RESULTS -> COUNTDOWN (LOBBY if a dedicated room is below its minimum players).
 */
export class GameHost {
  private karts = new Map<number, HostKart>();
  private peers = new Map<number, PeerInfo>();
  private names = new Map<number, string>();
  private chars = new Map<number, number>();
  private finishTick = new Map<number, number>(); // slot -> raceTick when finished
  private track: Track;
  private items: ItemWorld;
  private tick = 0;
  private epoch = 0;
  phase: PhaseId = Phase.Lobby;
  private phaseTick = 0;
  private raceTick = 0;
  private lobbyTicks = 0;
  private acc = 0;
  private lastUpdate: number | null = null;
  private gapPeak = 0;

  /** `trackSource`: a TRACKS index, or a ready-made Track (tests). */
  constructor(
    trackSource: Track | number,
    private tx: HostTransport,
    private opts: GameHostOptions = {},
  ) {
    this.track = typeof trackSource === "number" ? buildTrackById(trackSource) : trackSource;
    this.items = new ItemWorld(this.track);
    if (opts.hostPlayer) {
      this.names.set(0, cleanName(opts.hostPlayer.name, "Host"));
      this.chars.set(0, cleanCharacter(opts.hostPlayer.character));
      this.karts.set(0, this.newKart(0));
    }
  }

  // ---------------------------------------------------------------- karts
  private newKart(slot: number): HostKart {
    const s = createKart(this.track, slot);
    const k: HostKart = { slot, prev: s, cur: s, queue: [], lastInput: NEUTRAL, ack: 0, params: paramsFor(0), toughness: 3, itemBias: [1, 1, 1, 1] };
    this.applyChar(k);
    return k;
  }

  private applyChar(k: HostKart) {
    const id = this.chars.get(k.slot) ?? 0;
    const c = characterById(id);
    k.params = paramsFor(id);
    k.toughness = c.stats.toughness;
    k.itemBias = c.itemBias;
  }

  // ---------------------------------------------------------------- time
  /** 0 good .. poor: how late the host timer fires (host stalls lag everyone). */
  quality(): "good" | "fair" | "poor" {
    return this.gapPeak > 150 ? "poor" : this.gapPeak > 50 ? "fair" : "good";
  }

  /** Drive the sim from a wall clock (ms). Runs as many fixed ticks as are due. */
  advance(nowMs: number) {
    if (this.lastUpdate === null) this.lastUpdate = nowMs;
    const gap = nowMs - this.lastUpdate;
    this.gapPeak = Math.max(gap, this.gapPeak * 0.98);
    this.acc += Math.min(0.25, gap / 1000);
    this.lastUpdate = nowMs;
    while (this.acc >= TICK_DT) {
      this.stepAll();
      this.acc -= TICK_DT;
    }
  }

  /** Time since the last advance(), for render interpolation, in ms. */
  msSinceUpdate(nowMs: number) {
    return this.lastUpdate === null ? 0 : nowMs - this.lastUpdate;
  }

  // ---------------------------------------------------------------- sim
  private stepAll() {
    const racing = this.phase === Phase.Race;
    const used: [number, HostKart][] = [];
    const casts: HostKart[] = [];
    for (const k of this.karts.values()) {
      const itemBefore = k.cur.item;
      const spBefore = k.cur.spCd;
      let input: KartInput;
      if (this.opts.hostPlayer && k.slot === 0) {
        input = racing ? quantizeInput(this.opts.hostPlayer.input()) : NEUTRAL;
      } else {
        if (k.queue.length > 8) k.queue.splice(0, k.queue.length - 4);
        const n = k.queue.length > 3 ? 2 : 1; // catch up if client runs ahead
        for (let i = 0; i < n && k.queue.length; i++) {
          const q = k.queue.shift()!;
          k.lastInput = q.input;
          k.ack = q.seq;
        }
        if (!racing) k.lastInput = NEUTRAL;
        input = k.lastInput;
      }
      k.prev = k.cur;
      k.cur = stepKart(k.cur, input, this.track, TICK_DT, k.params);
      // item went away without a pickup: missile/oil are spawned here (boost/shield are handled in the sim)
      if ((itemBefore === Item.Missile || itemBefore === Item.Oil) && k.cur.item === Item.None) used.push([itemBefore, k]);
      // special fired this tick: the host casts the area/world part
      if (spBefore === 0 && k.cur.spCd > 0) casts.push(k);
    }
    if (racing && this.karts.size > 1) {
      const list = [...this.karts.values()];
      const res = resolveBumps(list.map((k) => k.cur));
      list.forEach((k, i) => (k.cur = res[i]!));
    }
    if (racing) {
      for (const [item, k] of used) this.items.spawnFrom(item, k.slot, k.cur);
      const order = this.rankedSlots();
      const all = [...this.karts.values()];
      for (const k of casts) this.items.castSpecial(k.params.charId, k, all, order);
      const denom = Math.max(1, order.length - 1);
      this.items.step(all, (slot) => Math.max(0, order.indexOf(slot)) / denom, TICK_DT);
    }
    this.tick++;
    this.advancePhase();
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
    if (this.tick % ROOM_MSG_EVERY === 0 && (this.phase !== Phase.Lobby || this.opts.autoStart)) this.broadcastRoom();
  }

  // ---------------------------------------------------------------- phases
  private setPhase(p: PhaseId) {
    this.phase = p;
    this.phaseTick = 0;
    this.lobbyTicks = 0;
    this.broadcastRoom();
    this.registry();
  }

  startRace() {
    if (this.phase === Phase.Lobby && this.karts.size > 0) {
      this.items.reset();
      this.setPhase(Phase.Countdown);
    }
  }

  get trackId(): number {
    return this.track.id;
  }

  private swapTrack(id: number) {
    this.track = buildTrackById(id);
    this.items = new ItemWorld(this.track);
  }

  /** Lobby only (host UI): pick the track. Everyone goes back to the new grid and clients rebuild the track. */
  setTrack(id: number) {
    const next = cleanTrackId(id);
    if (this.phase !== Phase.Lobby || next === this.track.id || !this.opts.hostPlayer) return;
    this.swapTrack(next);
    this.newRound(false);
  }

  /** Abort the round / leave results early. */
  toLobby() {
    if (this.phase !== Phase.Lobby) this.newRound();
  }

  /** Host UI: scrap the current round (any phase) and start a fresh one on the same track, same room. */
  restart() {
    if (!this.opts.hostPlayer || this.karts.size === 0) return;
    this.newRound(false);
    this.startRace();
  }

  private advancePhase() {
    this.phaseTick++;
    if (this.phase === Phase.Lobby) {
      const auto = this.opts.autoStart;
      if (auto) {
        if (this.karts.size >= auto.minPlayers) {
          if (++this.lobbyTicks >= auto.delaySec * HZ) this.startRace();
        } else this.lobbyTicks = 0;
      }
    } else if (this.phase === Phase.Countdown) {
      if (this.phaseTick >= COUNTDOWN_TICKS) {
        this.raceTick = 0;
        for (const k of this.karts.values()) k.cur = { ...k.cur, spCd: SPECIAL_START }; // fresh cooldown at the start
        this.setPhase(Phase.Race);
      }
    } else if (this.phase === Phase.Race) {
      this.raceTick++;
      for (const k of this.karts.values()) if (k.cur.finished && !this.finishTick.has(k.slot)) this.finishTick.set(k.slot, this.raceTick);
      const all = [...this.karts.values()];
      const allDone = all.length > 0 && all.every((k) => k.cur.finished);
      const first = this.finishTick.size ? Math.min(...this.finishTick.values()) : null;
      const graceOver = first !== null && this.raceTick - first > FINISH_GRACE_TICKS;
      if (allDone || graceOver || this.raceTick > MAX_RACE_TICKS || all.length === 0) this.setPhase(Phase.Results);
    } else if (this.phase === Phase.Results) {
      if (this.phaseTick >= RESULTS_TICKS) {
        this.newRound();
        // roll straight into the next game; a dedicated room that fell below its minimum waits in the lobby for auto-start
        if (this.karts.size >= (this.opts.autoStart?.minPlayers ?? 1)) this.startRace();
      }
    }
  }

  /** Back to lobby: waiting players get a kart, everyone returns to the grid. New epoch tells clients to resync. */
  private newRound(rotate = true) {
    if (rotate && this.opts.rotateTracks) this.swapTrack((this.track.id + 1) % TRACKS.length);
    for (const [, p] of this.peers) if (p.ready && !this.karts.has(p.slot)) this.karts.set(p.slot, this.newKart(p.slot));
    for (const slot of [...this.karts.keys()]) this.karts.set(slot, this.newKart(slot));
    this.finishTick.clear();
    this.items.reset();
    this.raceTick = 0;
    this.tick = 0;
    this.epoch = (this.epoch + 1) & 0xff;
    this.setPhase(Phase.Lobby);
  }

  private rankedSlots(): number[] {
    return [...this.karts.values()]
      .sort((a, b) => {
        const fa = this.finishTick.get(a.slot);
        const fb = this.finishTick.get(b.slot);
        if (fa !== undefined && fb !== undefined) return fa - fb;
        if (fa !== undefined) return -1;
        if (fb !== undefined) return 1;
        return kartProgress(b.cur, this.track) - kartProgress(a.cur, this.track);
      })
      .map((k) => k.slot);
  }

  // ---------------------------------------------------------------- state out
  private players(): PlayerInfo[] {
    const order = this.rankedSlots();
    const out: PlayerInfo[] = [];
    for (const k of this.karts.values()) {
      const f = this.finishTick.get(k.slot);
      out.push({
        slot: k.slot,
        name: this.names.get(k.slot) ?? `Player ${k.slot}`,
        waiting: false,
        pos: order.indexOf(k.slot) + 1,
        lap: k.cur.lap,
        finishTime: f === undefined ? -1 : f / HZ,
        character: this.chars.get(k.slot) ?? 0,
      });
    }
    for (const [, p] of this.peers) {
      if (p.ready && !this.karts.has(p.slot)) {
        out.push({ slot: p.slot, name: this.names.get(p.slot) ?? `Player ${p.slot}`, waiting: true, pos: 0, lap: 0, finishTime: -1, character: this.chars.get(p.slot) ?? 0 });
      }
    }
    return out.sort((a, b) => a.slot - b.slot);
  }

  roomMsg(): Extract<EvtMsg, { t: "room" }> {
    const auto = this.opts.autoStart;
    return {
      t: "room",
      phase: this.phase,
      countdown: this.phase === Phase.Countdown ? Math.max(0, (COUNTDOWN_TICKS - this.phaseTick) / HZ) : 0,
      resultsIn: this.phase === Phase.Results ? Math.max(0, (RESULTS_TICKS - this.phaseTick) / HZ) : 0,
      raceTime: this.raceTick / HZ,
      players: this.players(),
      track: this.track.id,
      ...(auto && this.phase === Phase.Lobby ? { autoIn: this.karts.size >= auto.minPlayers ? Math.max(0, auto.delaySec - this.lobbyTicks / HZ) : -1 } : {}),
    };
  }

  private broadcastRoom() {
    const m = this.roomMsg();
    for (const [id, p] of this.peers) if (p.ready) this.tx.sendEvt(id, m);
  }

  private broadcastSnapshot() {
    if (this.peers.size === 0) return;
    const buf = encodeSnapshot(
      this.epoch,
      this.tick,
      this.phase,
      [...this.karts.values()].map((k) => ({ slot: k.slot, state: k.cur, ackSeq: k.ack })),
      { boxMask: this.items.boxMask(), objs: this.items.objs.map((o) => ({ id: o.id, type: o.type, x: o.x, z: o.z })) },
    );
    for (const [id, p] of this.peers) if (p.ready) this.tx.sendSnapshot(id, buf);
  }

  /** Players that are connected (ready), including the local host player. */
  playerCount(): number {
    return (this.opts.hostPlayer ? 1 : 0) + [...this.peers.values()].filter((p) => p.ready).length;
  }

  registryInfo(): { players: number; state: "lobby" | "racing"; track: number } {
    return { players: Math.max(1, this.playerCount()), state: this.phase === Phase.Lobby ? "lobby" : "racing", track: this.track.id };
  }

  private registry() {
    this.tx.onRegistry?.(this.registryInfo());
  }

  /** Local host player's kart state (browser host / solo). */
  localState(): KartState | null {
    return this.karts.get(0)?.cur ?? null;
  }

  raceTime(): number {
    return this.raceTick / HZ;
  }

  renderKarts(nowMs: number): KartRender[] {
    const a = Math.min(1, Math.max(0, this.acc / TICK_DT + this.msSinceUpdate(nowMs) / 1000 / TICK_DT));
    return [...this.karts.values()].map((k) => ({
      slot: k.slot,
      x: lerp(k.prev.x, k.cur.x, a),
      z: lerp(k.prev.z, k.cur.z, a),
      heading: lerpAngle(k.prev.heading, k.cur.heading, a),
      shield: k.cur.shield,
      boosting: k.cur.boostT > 0,
      stunned: k.cur.stunT > 0,
      confused: k.cur.confT > 0,
      slowed: k.cur.slowT > 0,
    }));
  }

  worldRender(): WorldRender {
    return { boxMask: this.items.boxMask(), objects: this.items.objs.map((o) => ({ id: o.id, type: o.type, x: o.x, z: o.z })) };
  }

  // ---------------------------------------------------------------- peers
  private freeSlot(): number {
    const used = new Set([...this.peers.values()].map((p) => p.slot));
    for (let s = this.opts.hostPlayer ? 1 : 0; s < MAX_PLAYERS; s++) if (!used.has(s)) return s;
    return -1;
  }

  /** Reserve a slot for a connecting peer. Returns -1 when the room is full. */
  reservePeer(id: number): number {
    const slot = this.freeSlot();
    if (slot >= 0) this.peers.set(id, { slot, ready: false, lastSeq: -1 });
    return slot;
  }

  /** Transport is up. In the lobby the player gets a kart now; mid-round they wait for the next one. */
  peerReady(id: number) {
    const peer = this.peers.get(id);
    if (!peer || peer.ready) return;
    peer.ready = true;
    this.names.set(peer.slot, `Player ${peer.slot}`);
    if (this.phase === Phase.Lobby) this.karts.set(peer.slot, this.newKart(peer.slot));
    this.tx.sendEvt(id, { t: "welcome", slot: peer.slot, slots: [...this.karts.keys()], track: this.track.id });
    this.broadcastRoom();
    this.registry();
  }

  removePeer(id: number) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    this.karts.delete(peer.slot);
    this.names.delete(peer.slot);
    this.chars.delete(peer.slot);
    this.finishTick.delete(peer.slot);
    this.broadcastRoom();
    this.registry();
  }

  peerSlot(id: number): number | undefined {
    return this.peers.get(id)?.slot;
  }

  handleInput(id: number, data: ArrayBuffer) {
    const peer = this.peers.get(id);
    const d = decodeInput(data);
    const k = peer && this.karts.get(peer.slot);
    if (!peer || !d || !k) return;
    if (peer.lastSeq >= 0 && !seqNewer(d.seq, peer.lastSeq)) return; // stale/duplicate
    peer.lastSeq = d.seq;
    k.queue.push({ seq: d.seq, input: d.input });
  }

  handleEvt(id: number, text: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    let m: EvtMsg;
    try {
      m = JSON.parse(text) as EvtMsg;
    } catch {
      return;
    }
    if (m.t === "hello") {
      this.names.set(peer.slot, cleanName(m.name, `Player ${peer.slot}`));
      this.chars.set(peer.slot, cleanCharacter(m.character));
      const pk = this.karts.get(peer.slot);
      if (pk) this.applyChar(pk);
      this.broadcastRoom();
    } else if (m.t === "char") {
      if (this.phase !== Phase.Lobby) return;
      this.chars.set(peer.slot, cleanCharacter(m.character));
      const pk = this.karts.get(peer.slot);
      if (pk) this.applyChar(pk);
      this.broadcastRoom();
    } else if (m.t === "ping") {
      this.tx.sendEvt(id, { t: "pong", ts: Number(m.ts) });
    }
  }

  /** Lobby: change the local host player's driver. */
  setLocalCharacter(id: number) {
    const k = this.karts.get(0);
    if (this.phase !== Phase.Lobby || !k) return;
    this.chars.set(0, cleanCharacter(id));
    this.applyChar(k);
    this.broadcastRoom();
  }
}
