import {
  cleanCharacter,
  buildTrackById,
  cleanName,
  cleanTrackId,
  decodeSnapshot,
  paramsFor,
  encodeInput,
  Phase,
  quantizeInput,
  stepKart,
  TICK_DT,
  type EvtMsg,
  type KartInput,
  type KartParams,
  type KartState,
  type PhaseId,
  type Snapshot,
  type Track,
} from "@kart/shared";
import { sampleInput } from "../input";
import { lerp, lerpAngle, type Hud, type RenderKart, type RoomView, type Session, type WorldView } from "../session";
import { CH_EVT, CH_INPUT, CH_SNAP, getIceServers, Signaling, type SignalPayload } from "./signaling";

const INTERP_DELAY_MS = 100;
const SNAP_EPS = 6; // position error (m) above which we snap instead of smoothing

interface Remote {
  t: number; // local receive time
  s: KartState;
}

interface ObjSample {
  t: number;
  x: number;
  z: number;
  type: number;
}

export class ClientSession implements Session {
  mySlot = -1;
  isHost = false;
  roomCode: string | null = null;
  private pc!: RTCPeerConnection;
  private sendInput: ((b: ArrayBuffer) => void) | null = null;
  private sendEvt: ((m: EvtMsg) => void) | null = null;
  private roomMsg: Extract<EvtMsg, { t: "room" }> | null = null;
  private roomAt = 0;
  private phase: PhaseId = Phase.Lobby;
  /** round-trip ms measured over the evt channel */
  ping = -1;
  private pingTimer: number | null = null;
  /** physics params of my character (host derives the same ones) */
  private params: KartParams = paramsFor(0);
  mode: "p2p" | "relay" = "p2p";
  private sig!: Signaling;

  private cur: KartState | null = null;
  private prev: KartState | null = null;
  private pending: { seq: number; input: KartInput }[] = [];
  private seq = 0;
  private acc = 0;
  private last = performance.now();
  private lastRender = performance.now();
  private off = { x: 0, z: 0, h: 0 };

  private remotes = new Map<number, Remote[]>();
  private objBuf = new Map<number, ObjSample[]>();
  private boxMask = 0xffffffff;
  private epoch = -1;
  private latestTick = -1;
  closedReason: string | null = null;
  private disposed = false;

  private track: Track = buildTrackById(0);

  private constructor() {}

  trackId(): number {
    return this.track.id;
  }

  /** The host chose a different track: rebuild ours so prediction matches. */
  private useTrack(id: unknown) {
    const next = cleanTrackId(id);
    if (next !== this.track.id) this.track = buildTrackById(next);
  }

  static async join(room: string, opts: { forceRelay?: boolean; name?: string; character?: number } = {}): Promise<ClientSession> {
    const c = new ClientSession();
    c.roomCode = room;
    c.params = paramsFor(cleanCharacter(opts.character));
    await c.connect(room, !!opts.forceRelay, cleanName(opts.name, "Player"), cleanCharacter(opts.character));
    return c;
  }

  private async connect(room: string, forceRelay: boolean, name: string, character: number) {
    const sig = (this.sig = await Signaling.connect());
    sig.onClose(() => {
      if (!this.disposed) this.closedReason ??= "disconnected from signaling";
    });
    const iceServers = await getIceServers(); // before join: the host's offer must not arrive before our handlers exist
    sig.send({ t: "join", room });
    const pc = (this.pc = new RTCPeerConnection({ iceServers }));
    let remoteSet = false;
    const seenChannels = new Set<string>();
    const iceQ: RTCIceCandidateInit[] = [];

    const welcomed = new Promise<void>((res, rej) => {
      const timer = setTimeout(() => {
        const ch = [...seenChannels].join(",") || "none";
        rej(
          new Error(
            `connection timed out (ice: ${pc.iceConnectionState}, gathering: ${pc.iceGatheringState}, offer received: ${remoteSet}, channels: ${ch}). ` +
              `Different devices/networks need a TURN server; see console.`,
          ),
        );
      }, 15000);
      let welcome = false;
      const onEvt = (m: EvtMsg) => {
        if (m.t === "welcome") {
          welcome = true;
          this.mySlot = m.slot;
          this.useTrack(m.track);
          clearTimeout(timer);
          clearTimeout(relayTimer);
          this.sendEvt?.({ t: "hello", name, character });
          this.pingTimer = window.setInterval(() => this.sendEvt?.({ t: "ping", ts: performance.now() }), 2000);
          res();
        } else if (m.t === "room") {
          this.useTrack(m.track);
          this.roomMsg = m;
          this.roomAt = performance.now();
        } else if (m.t === "pong") {
          this.ping = Math.round(performance.now() - m.ts);
        }
      };
      /** WebRTC didn't connect: tell host to switch, and talk through the signaling server. */
      const startRelay = () => {
        if (welcome || this.mode === "relay") return;
        console.log("[client] direct connection failed, switching to relay");
        this.mode = "relay";
        pc.onconnectionstatechange = pc.oniceconnectionstatechange = pc.onicecandidate = pc.ondatachannel = null;
        pc.close();
        sig.onBinary((buf) => {
          const v = new Uint8Array(buf);
          if (v[0] === CH_SNAP) this.onSnapshotMsg(buf.slice(1));
          else if (v[0] === CH_EVT) onEvt(JSON.parse(new TextDecoder().decode(v.subarray(1))) as EvtMsg);
        });
        this.sendInput = (b) => {
          const body = new Uint8Array(b);
          const out = new Uint8Array(1 + body.length);
          out[0] = CH_INPUT;
          out.set(body, 1);
          sig.sendBinary(out);
        };
        this.sendEvt = (m) => {
          const body = new TextEncoder().encode(JSON.stringify(m));
          const out = new Uint8Array(1 + body.length);
          out[0] = CH_EVT;
          out.set(body, 1);
          sig.sendBinary(out);
        };
        sig.send({ t: "signal", data: { relay: true } satisfies SignalPayload });
      };
      const relayTimer = setTimeout(startRelay, forceRelay ? 0 : 4000);
      sig.onMessage(async (m) => {
        if (m.t === "joined" && m.relayOnly) startRelay(); // dedicated server: no WebRTC, go straight to the relay
        else if (m.t === "error") rej(new Error(m.msg));
        else if (m.t === "closed") this.closedReason = "host closed the room";
        else if (m.t === "signal") {
          const d = m.data as SignalPayload;
          if (d.full) rej(new Error("room full"));
          if (this.mode === "relay") return;
          if (d.sdp) {
            await pc.setRemoteDescription(d.sdp);
            remoteSet = true;
            await pc.setLocalDescription(await pc.createAnswer());
            sig.send({ t: "signal", data: { sdp: pc.localDescription!.toJSON() } satisfies SignalPayload });
            for (const c of iceQ.splice(0)) await pc.addIceCandidate(c);
          } else if (d.ice) {
            if (remoteSet) await pc.addIceCandidate(d.ice);
            else iceQ.push(d.ice);
          }
        }
      });
      pc.onicecandidate = (e) => {
        if (e.candidate) sig.send({ t: "signal", data: { ice: e.candidate.toJSON() } satisfies SignalPayload });
      };
      pc.oniceconnectionstatechange = () => console.log("[client] ice", pc.iceConnectionState);
      pc.onicecandidateerror = (e) => console.warn("[client] ice candidate error", (e as RTCPeerConnectionIceErrorEvent).errorText);
      pc.onconnectionstatechange = () => {
        console.log("[client] pc", pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "closed") this.closedReason ??= "connection lost";
      };
      pc.ondatachannel = (e) => {
        const ch = e.channel;
        seenChannels.add(ch.label);
        ch.binaryType = "arraybuffer";
        if (ch.label === "snap") ch.onmessage = (ev) => this.onSnapshotMsg(ev.data as ArrayBuffer);
        else if (ch.label === "input")
          this.sendInput = (b) => {
            if (ch.readyState === "open") ch.send(b);
          };
        else if (ch.label === "evt") {
          this.sendEvt = (m) => {
            if (ch.readyState === "open") ch.send(JSON.stringify(m));
          };
          ch.onclose = () => (this.closedReason ??= "host disconnected");
          ch.onmessage = (ev) => onEvt(JSON.parse(String(ev.data)) as EvtMsg);
        }
      };
    });
    await welcomed;
    // keep signaling open: closing it makes the server tell the host this peer left
  }

  // ---- prediction ----
  update(now: number) {
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= TICK_DT) {
      if (this.cur && this.phase === Phase.Race) {
        const input = quantizeInput(sampleInput());
        this.seq++;
        this.pending.push({ seq: this.seq, input });
        if (this.pending.length > 180) this.pending.shift();
        this.prev = this.cur;
        this.cur = stepKart(this.cur, input, this.track, TICK_DT, this.params);
        this.sendInput?.(encodeInput(this.seq, input));
      }
      this.acc -= TICK_DT;
    }
  }

  private onSnapshotMsg(buf: ArrayBuffer) {
    const snap = decodeSnapshot(buf);
    if (!snap) return;
    if (!this.acceptOrder(snap)) return;
    this.phase = snap.phase;
    const now = performance.now();
    for (const k of snap.karts) {
      if (k.slot === this.mySlot) this.reconcile(k.state, k.ackSeq);
      else {
        const b = this.remotes.get(k.slot) ?? [];
        b.push({ t: now, s: k.state });
        if (b.length > 30) b.shift();
        this.remotes.set(k.slot, b);
      }
    }
    this.boxMask = snap.world.boxMask;
    for (const o of snap.world.objs) {
      const b = this.objBuf.get(o.id) ?? [];
      b.push({ t: now, x: o.x, z: o.z, type: o.type });
      if (b.length > 20) b.shift();
      this.objBuf.set(o.id, b);
    }
    const liveObjs = new Set(snap.world.objs.map((o) => o.id));
    for (const id of this.objBuf.keys()) if (!liveObjs.has(id)) this.objBuf.delete(id);
    // drop karts that left
    const present = new Set(snap.karts.map((k) => k.slot));
    for (const s of this.remotes.keys()) if (!present.has(s)) this.remotes.delete(s);
  }

  /** Snapshots are unordered: drop old ones; a new epoch (race reset) restarts local state. */
  private acceptOrder(snap: Snapshot): boolean {
    if (snap.epoch !== this.epoch) {
      const newer = this.epoch < 0 || ((snap.epoch - this.epoch) & 0xff) < 128;
      if (!newer) return false;
      this.epoch = snap.epoch;
      this.latestTick = -1;
      this.cur = this.prev = null;
      this.pending = [];
      this.remotes.clear();
      this.objBuf.clear();
      this.off = { x: 0, z: 0, h: 0 };
    }
    if (snap.tick <= this.latestTick) return false;
    this.latestTick = snap.tick;
    return true;
  }

  private reconcile(server: KartState, ack: number) {
    // frozen (lobby/countdown/results): the server is the only truth, nothing to predict
    if (!this.cur || !this.prev || this.phase !== Phase.Race) {
      this.cur = this.prev = server;
      this.pending = [];
      this.off = { x: 0, z: 0, h: 0 };
      return;
    }
    const idx = this.pending.findIndex((p) => (p.seq & 0xffff) === ack);
    if (idx < 0) return;
    this.pending.splice(0, idx + 1);
    let s = server;
    for (const p of this.pending) s = stepKart(s, p.input, this.track, TICK_DT, this.params);

    const old = this.cur;
    const dx = old.x - s.x;
    const dz = old.z - s.z;
    const dh = Math.atan2(Math.sin(old.heading - s.heading), Math.cos(old.heading - s.heading));
    const stepDx = old.x - this.prev.x;
    const stepDz = old.z - this.prev.z;
    const stepDh = Math.atan2(Math.sin(old.heading - this.prev.heading), Math.cos(old.heading - this.prev.heading));
    this.cur = s;
    this.prev = { ...s, x: s.x - stepDx, z: s.z - stepDz, heading: s.heading - stepDh };
    if (Math.hypot(dx, dz) > SNAP_EPS) {
      this.prev = s;
      this.off = { x: 0, z: 0, h: 0 };
    } else {
      // hide the correction: render offset decays toward zero
      this.off.x += dx;
      this.off.z += dz;
      this.off.h += dh;
    }
  }

  render(now: number): RenderKart[] {
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    const decay = Math.exp(-10 * dt);
    this.off.x *= decay;
    this.off.z *= decay;
    this.off.h *= decay;

    const out: RenderKart[] = [];
    if (this.cur && this.prev) {
      const a = Math.min(1, this.acc / TICK_DT);
      out.push({
        slot: this.mySlot,
        x: lerp(this.prev.x, this.cur.x, a) + this.off.x,
        z: lerp(this.prev.z, this.cur.z, a) + this.off.z,
        heading: lerpAngle(this.prev.heading, this.cur.heading, a) + this.off.h,
        shield: this.cur.shield,
        boosting: this.cur.boostT > 0,
        stunned: this.cur.stunT > 0,
        confused: this.cur.confT > 0,
        slowed: this.cur.slowT > 0,
      });
    }
    const rt = now - INTERP_DELAY_MS;
    for (const [slot, buf] of this.remotes) {
      if (buf.length === 0) continue;
      let i = buf.length - 1;
      while (i > 0 && buf[i]!.t > rt) i--;
      const a0 = buf[i]!;
      const a1 = buf[i + 1];
      const fx = { shield: a0.s.shield, boosting: a0.s.boostT > 0, stunned: a0.s.stunT > 0, confused: a0.s.confT > 0, slowed: a0.s.slowT > 0 };
      if (!a1 || rt <= a0.t) {
        out.push({ slot, x: a0.s.x, z: a0.s.z, heading: a0.s.heading, ...fx });
      } else {
        const t = Math.min(1, (rt - a0.t) / (a1.t - a0.t));
        out.push({
          slot,
          x: lerp(a0.s.x, a1.s.x, t),
          z: lerp(a0.s.z, a1.s.z, t),
          heading: lerpAngle(a0.s.heading, a1.s.heading, t),
          ...fx,
        });
      }
    }
    return out;
  }

  world(now: number): WorldView {
    const rt = now - INTERP_DELAY_MS;
    const objects: WorldView["objects"] = [];
    for (const [id, buf] of this.objBuf) {
      let i = buf.length - 1;
      while (i > 0 && buf[i]!.t > rt) i--;
      const a0 = buf[i]!;
      const a1 = buf[i + 1];
      if (!a1 || rt <= a0.t) objects.push({ id, type: a0.type, x: a0.x, z: a0.z });
      else {
        const t = Math.min(1, (rt - a0.t) / (a1.t - a0.t));
        objects.push({ id, type: a0.type, x: lerp(a0.x, a1.x, t), z: lerp(a0.z, a1.z, t) });
      }
    }
    return { boxMask: this.boxMask, objects };
  }

  hud(): Hud {
    const link = this.mode === "relay" ? "relay" : "direct";
    const q = this.ping < 0 ? "" : ` · ping ${this.ping} ms (${this.ping < 80 ? "good" : this.ping < 160 ? "fair" : "poor"})`;
    const status = this.closedReason ? `⚠ ${this.closedReason}` : `Room ${this.roomCode} · ${link}${q}`;
    const r = this.roomMsg;
    const raceTime = r ? r.raceTime + (r.phase === Phase.Race ? (performance.now() - this.roomAt) / 1000 : 0) : 0;
    return { me: this.cur, raceTime, info: status };
  }

  room(): RoomView {
    const r = this.roomMsg;
    const el = (performance.now() - this.roomAt) / 1000;
    const me = r?.players.find((p) => p.slot === this.mySlot);
    return {
      phase: r?.phase ?? Phase.Lobby,
      countdown: r ? Math.max(0, r.countdown - el) : 0,
      resultsIn: r ? Math.max(0, r.resultsIn - el) : 0,
      players: r?.players ?? [],
      waiting: me?.waiting ?? false,
      trackId: this.track.id,
      autoIn: r?.autoIn === undefined ? undefined : r.autoIn < 0 ? -1 : Math.max(0, r.autoIn - el),
    };
  }

  /** Lobby: change my driver (host validates; physics params must match, so switch both now). */
  setCharacter(id: number) {
    const c = cleanCharacter(id);
    this.params = paramsFor(c);
    this.sendEvt?.({ t: "char", character: c });
  }

  dispose() {
    this.disposed = true;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pc.close();
    this.sig.close();
  }
}
