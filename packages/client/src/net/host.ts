import { GameHost, MAX_PLAYERS, type EvtMsg } from "@kart/shared";
import { sampleInput } from "../input";
import type { Hud, RenderKart, RoomView, Session, WorldView } from "../session";
import { CH_EVT, CH_INPUT, CH_SNAP, getIceServers, Signaling, type SignalPayload } from "./signaling";

interface Peer {
  id: number;
  pc: RTCPeerConnection;
  snap: RTCDataChannel;
  input: RTCDataChannel;
  evt: RTCDataChannel;
  open: number;
  remoteSet: boolean;
  ice: RTCIceCandidateInit[];
  relay: boolean;
}

const HEARTBEAT_MS = 3000;

/**
 * Browser host (Option A): all game logic lives in the shared `GameHost`; this class only provides the
 * transport (WebRTC data channels, with a signaling-server relay fallback) and the local player's input.
 * With no `listen()` call it is just single-player.
 */
export class HostSession implements Session {
  mySlot = 0;
  isHost = true;
  roomCode: string | null = null;
  private gh: GameHost;
  private peers = new Map<number, Peer>();
  private sig: Signaling | null = null;
  private worker: Worker | null = null;
  private fallbackTimer: number | null = null;
  private heartbeat: number | null = null;
  /** relay requests that arrived while we were still setting the peer up */
  private earlyRelay = new Set<number>();

  constructor(trackId: number, hostName = "Host", hostCharacter = 0) {
    this.gh = new GameHost(
      trackId,
      {
        sendSnapshot: (id, buf) => {
          const p = this.peers.get(id);
          if (!p) return;
          if (p.relay) this.relaySend(p, CH_SNAP, buf);
          else if (p.snap.readyState === "open" && p.snap.bufferedAmount < 16384) p.snap.send(buf);
        },
        sendEvt: (id, m) => this.sendEvt(id, m),
        onRegistry: (info) => this.sig?.send({ t: "update", ...info }),
      },
      { hostPlayer: { name: hostName, character: hostCharacter, input: sampleInput } },
    );
    try {
      this.worker = new Worker(new URL("./tick.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = () => this.gh.advance(performance.now());
    } catch {
      this.fallbackTimer = window.setInterval(() => this.gh.advance(performance.now()), 8);
    }
  }

  async listen(roomName: string): Promise<string> {
    const sig = await Signaling.connect();
    this.sig = sig;
    void getIceServers(); // warm the cache so peers are set up synchronously
    sig.onMessage((m) => {
      if (m.t === "peer") void this.onPeer(m.peer);
      else if (m.t === "peer-left") this.removePeer(m.peer);
      else if (m.t === "signal") void this.onSignal(m.from, m.data as SignalPayload);
    });
    sig.onBinary((buf) => {
      // [ch][peerHi][peerLo][payload]
      const v = new Uint8Array(buf);
      if (v.length < 3) return;
      const id = (v[1]! << 8) | v[2]!;
      if (!this.peers.get(id)?.relay) return;
      if (v[0] === CH_INPUT) this.gh.handleInput(id, buf.slice(3));
      else if (v[0] === CH_EVT) this.gh.handleEvt(id, new TextDecoder().decode(v.subarray(3)));
    });
    sig.onClose(() => {
      this.roomCode = null;
      if (this.heartbeat !== null) clearInterval(this.heartbeat);
    });
    sig.send({ t: "host", name: roomName });
    const hosted = await sig.waitFor((m): m is Extract<typeof m, { t: "hosted" }> => m.t === "hosted");
    this.roomCode = hosted.room;
    this.heartbeat = window.setInterval(() => sig.send({ t: "update", ...this.gh.registryInfo() }), HEARTBEAT_MS);
    return hosted.room;
  }

  // ---- Session ----
  update(now: number) {
    // sim is driven by the worker; this only covers the (unlikely) case it is stalled
    if (this.gh.msSinceUpdate(now) > 100) this.gh.advance(now);
  }

  render(now: number): RenderKart[] {
    return this.gh.renderKarts(now);
  }

  world(_now: number): WorldView {
    return this.gh.worldRender();
  }

  hud(): Hud {
    let info = "Solo";
    if (this.roomCode) info = `Room ${this.roomCode} · ${this.gh.playerCount()}/${MAX_PLAYERS} players · host perf: ${this.gh.quality()}`;
    return { me: this.gh.localState(), raceTime: this.gh.raceTime(), info };
  }

  room(): RoomView {
    const m = this.gh.roomMsg();
    return { phase: m.phase, countdown: m.countdown, resultsIn: m.resultsIn, players: m.players, waiting: false, trackId: m.track ?? 0 };
  }

  trackId(): number {
    return this.gh.trackId;
  }

  setTrack(id: number) {
    this.gh.setTrack(id);
  }

  startRace() {
    this.gh.startRace();
  }
  toLobby() {
    this.gh.toLobby();
  }
  restart() {
    this.gh.restart();
  }
  setCharacter(id: number) {
    this.gh.setLocalCharacter(id);
  }

  // ---- transport ----
  private sendEvt(id: number, m: EvtMsg) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.relay) this.relaySend(p, CH_EVT, new TextEncoder().encode(JSON.stringify(m)));
    else if (p.evt.readyState === "open") p.evt.send(JSON.stringify(m));
  }

  /** Relay frame to server: [ch][peerHi][peerLo][payload]. */
  private relaySend(p: Peer, ch: number, payload: ArrayBuffer | Uint8Array) {
    const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const out = new Uint8Array(3 + body.length);
    out[0] = ch;
    out[1] = p.id >> 8;
    out[2] = p.id & 0xff;
    out.set(body, 3);
    this.sig?.sendBinary(out);
  }

  private useRelay(peer: Peer) {
    if (peer.relay) return;
    peer.relay = true;
    console.log(`[host] peer ${peer.id} switching to relay`);
    // detach handlers first so closing the pc doesn't look like the peer leaving
    peer.pc.onconnectionstatechange = peer.pc.oniceconnectionstatechange = peer.pc.onicecandidate = null;
    for (const c of [peer.snap, peer.input, peer.evt]) c.onopen = c.onclose = c.onmessage = null;
    peer.pc.close();
    this.gh.peerReady(peer.id);
  }

  private async onPeer(id: number) {
    const sig = this.sig!;
    if (this.gh.reservePeer(id) < 0) {
      sig.send({ t: "signal", to: id, data: { full: true } satisfies SignalPayload });
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: await getIceServers() });
    const snap = pc.createDataChannel("snap", { ordered: false, maxRetransmits: 0 });
    const input = pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 });
    const evt = pc.createDataChannel("evt");
    for (const c of [snap, input, evt]) c.binaryType = "arraybuffer";
    const peer: Peer = { id, pc, snap, input, evt, open: 0, remoteSet: false, ice: [], relay: false };
    this.peers.set(id, peer);
    if (this.earlyRelay.delete(id)) this.useRelay(peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) sig.send({ t: "signal", to: id, data: { ice: e.candidate.toJSON() } satisfies SignalPayload });
    };
    pc.oniceconnectionstatechange = () => console.log(`[host] peer ${id} ice`, pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      console.log(`[host] peer ${id} pc`, pc.connectionState);
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.removePeer(id);
    };
    const opened = () => {
      if (++peer.open === 3) this.gh.peerReady(id);
    };
    snap.onopen = input.onopen = evt.onopen = opened;
    evt.onclose = () => this.removePeer(id);
    input.onmessage = (e) => this.gh.handleInput(id, e.data as ArrayBuffer);
    evt.onmessage = (e) => this.gh.handleEvt(id, String(e.data));

    await pc.setLocalDescription(await pc.createOffer());
    sig.send({ t: "signal", to: id, data: { sdp: pc.localDescription!.toJSON() } satisfies SignalPayload });
  }

  private async onSignal(from: number, data: SignalPayload) {
    const peer = this.peers.get(from);
    if (!peer) {
      if (data.relay) this.earlyRelay.add(from);
      return;
    }
    if (data.relay) return this.useRelay(peer);
    if (peer.relay) return;
    if (data.sdp) {
      await peer.pc.setRemoteDescription(data.sdp);
      peer.remoteSet = true;
      for (const c of peer.ice.splice(0)) await peer.pc.addIceCandidate(c);
    } else if (data.ice) {
      if (peer.remoteSet) await peer.pc.addIceCandidate(data.ice);
      else peer.ice.push(data.ice);
    }
  }

  private removePeer(id: number) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.close();
    this.gh.removePeer(id);
  }

  dispose() {
    this.worker?.terminate();
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    for (const p of [...this.peers.keys()]) this.removePeer(p);
    this.sig?.close();
  }
}
