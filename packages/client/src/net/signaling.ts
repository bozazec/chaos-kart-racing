import type { ClientToServer, ServerToClient } from "@kart/shared";

const env = (import.meta as unknown as { env: Record<string, string | boolean | undefined> }).env;
/** Dev: the signaling server runs next to Vite on :8787. Production build: same origin as the page (wss behind https). */
export const SIGNALING_URL: string =
  (env.VITE_SIGNALING_URL as string | undefined) ??
  (env.PROD ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}` : `ws://${location.hostname}:8787`);

export const ROOMS_URL: string = (env.VITE_ROOMS_URL as string | undefined) ?? SIGNALING_URL.replace(/^ws/, "http") + "/rooms";

const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
let iceCache: { at: number; p: Promise<RTCIceServer[]> } | null = null;

/** ICE servers from the signaling server (STUN + time-limited TURN credentials when configured). Cached ~30 min. */
export function getIceServers(): Promise<RTCIceServer[]> {
  if (iceCache && Date.now() - iceCache.at < 30 * 60_000) return iceCache.p;
  const p = fetch(ROOMS_URL.replace(/\/rooms$/, "/ice"), { cache: "no-store" })
    .then((r) => r.json() as Promise<{ iceServers: RTCIceServer[] }>)
    .then((j) => (Array.isArray(j.iceServers) && j.iceServers.length ? j.iceServers : FALLBACK_ICE))
    .catch(() => FALLBACK_ICE);
  iceCache = { at: Date.now(), p };
  return p;
}

export class Signaling {
  private handlers: ((m: ServerToClient) => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private binHandlers: ((b: ArrayBuffer) => void)[] = [];
  private constructor(private ws: WebSocket) {
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        for (const h of this.binHandlers) h(e.data);
        return;
      }
      let m: ServerToClient;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      for (const h of this.handlers) h(m);
    };
    ws.onclose = () => this.closeHandlers.forEach((h) => h());
  }
  static connect(url = SIGNALING_URL): Promise<Signaling> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.onopen = () => res(new Signaling(ws));
      ws.onerror = () => rej(new Error(`cannot reach signaling server ${url}`));
    });
  }
  send(m: ClientToServer) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  /** Relay-mode binary frame. */
  sendBinary(b: ArrayBuffer | Uint8Array) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(b);
  }
  onBinary(h: (b: ArrayBuffer) => void) {
    this.binHandlers.push(h);
  }
  onMessage(h: (m: ServerToClient) => void) {
    this.handlers.push(h);
  }
  onClose(h: () => void) {
    this.closeHandlers.push(h);
  }
  /** Resolve with the first message matching `pred`; reject on error msg or close. */
  waitFor<T extends ServerToClient>(pred: (m: ServerToClient) => m is T): Promise<T> {
    return new Promise((res, rej) => {
      this.onMessage((m) => {
        if (pred(m)) res(m);
        else if (m.t === "error") rej(new Error(m.msg));
      });
      this.onClose(() => rej(new Error("signaling closed")));
    });
  }
  close() {
    this.ws.close();
  }
}

export interface SignalPayload {
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
  full?: boolean;
  /** Client gave up on WebRTC: switch to the signaling-server relay. */
  relay?: boolean;
}

/** Relay channel ids. */
export const CH_SNAP = 0;
export const CH_INPUT = 1;
export const CH_EVT = 2;
