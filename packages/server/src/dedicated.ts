import WebSocket from "ws";
import { GameHost, type EvtMsg, type ServerToClient, type Track } from "@kart/shared";

/** Relay channel ids (same as the client's). */
const CH_SNAP = 0;
const CH_INPUT = 1;
const CH_EVT = 2;

export interface DedicatedOptions {
  /** Signaling server, e.g. ws://localhost:8787 */
  url: string;
  name: string;
  /** Race starts automatically once this many players are in the lobby. */
  minPlayers?: number;
  /** ...after this many seconds. */
  delaySec?: number;
  /** Fixed TRACKS index, or omit and set `rotateTracks`. */
  trackId?: number;
  rotateTracks?: boolean;
  track?: Track;
  /** Delay before reconnecting to the signaling server. */
  reconnectMs?: number;
  log?: (msg: string) => void;
}

export interface DedicatedRoom {
  /** Resolves with the room code once registered. */
  ready: Promise<string>;
  stop(): void;
}

/**
 * Option B: a headless host. Runs the same shared `GameHost` as a browser host, but has no local player and
 * talks to everyone through the signaling server's WebSocket relay (no WebRTC, so no native dependencies).
 * Registers as a "dedicated" room and reconnects (with a fresh room) if the signaling server restarts.
 */
export function startDedicated(opts: DedicatedOptions): DedicatedRoom {
  const { url, name, minPlayers = 2, delaySec = 15, reconnectMs = 3000, log = () => {} } = opts;
  let stopped = false;
  let cleanup: (() => void) | null = null;
  let firstReady: ((code: string) => void) | null = null;
  const ready = new Promise<string>((res) => (firstReady = res));

  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const timers: ReturnType<typeof setInterval>[] = [];

    const frame = (ch: number, peer: number, body: Uint8Array) => {
      const out = new Uint8Array(3 + body.length);
      out[0] = ch;
      out[1] = peer >> 8;
      out[2] = peer & 0xff;
      out.set(body, 3);
      if (ws.readyState === WebSocket.OPEN) ws.send(out);
    };
    const gh = new GameHost(
      opts.track ?? opts.trackId ?? 0,
      {
        sendSnapshot: (id, buf) => frame(CH_SNAP, id, new Uint8Array(buf)),
        sendEvt: (id, m: EvtMsg) => frame(CH_EVT, id, new TextEncoder().encode(JSON.stringify(m))),
        onRegistry: (info) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "update", ...info })),
      },
      { autoStart: { minPlayers, delaySec }, rotateTracks: opts.rotateTracks },
    );

    ws.on("open", () => ws.send(JSON.stringify({ t: "host", name, relayOnly: true })));
    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        const buf = raw as ArrayBuffer;
        const v = new Uint8Array(buf);
        if (v.length < 3) return;
        const id = (v[1]! << 8) | v[2]!;
        if (v[0] === CH_INPUT) gh.handleInput(id, buf.slice(3));
        else if (v[0] === CH_EVT) gh.handleEvt(id, new TextDecoder().decode(v.subarray(3)));
        return;
      }
      let m: ServerToClient;
      try {
        m = JSON.parse(String(raw)) as ServerToClient;
      } catch {
        return;
      }
      if (m.t === "hosted") {
        log(`room ${m.room} registered as "${name}"`);
        firstReady?.(m.room);
        firstReady = null;
        timers.push(setInterval(() => gh.advance(performance.now()), 8));
        timers.push(setInterval(() => ws.send(JSON.stringify({ t: "update", ...gh.registryInfo() })), 3000));
      } else if (m.t === "peer") {
        if (gh.reservePeer(m.peer) < 0) ws.send(JSON.stringify({ t: "signal", to: m.peer, data: { full: true } }));
      } else if (m.t === "peer-left") {
        gh.removePeer(m.peer);
      } else if (m.t === "signal") {
        // the client has switched to the relay and is listening: now it can be welcomed
        if ((m.data as { relay?: boolean })?.relay) gh.peerReady(m.from);
      }
    });
    ws.on("error", (e) => log(`signaling error: ${e.message}`));
    ws.on("close", () => {
      timers.forEach(clearInterval);
      cleanup = null;
      if (stopped) return;
      log(`signaling closed, reconnecting in ${reconnectMs} ms`);
      setTimeout(connect, reconnectMs);
    });
    cleanup = () => {
      timers.forEach(clearInterval);
      ws.close();
    };
  };
  connect();

  return {
    ready,
    stop() {
      stopped = true;
      cleanup?.();
    },
  };
}
