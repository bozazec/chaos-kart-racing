import type { KartInput, KartState } from "./types";

export const Phase = { Lobby: 0, Countdown: 1, Race: 2, Results: 3 } as const;
export type PhaseId = (typeof Phase)[keyof typeof Phase];

export const MSG_SNAPSHOT = 1;
export const MSG_INPUT = 2;

const SNAP_HEADER = 8; // type u8, epoch u8, tick u32, phase u8, count u8
const SNAP_KART = 32;
const SNAP_OBJ = 10;

export interface KartSnap {
  slot: number;
  state: KartState;
  /** Last client input seq (low 16 bits) the host applied to this kart. */
  ackSeq: number;
}

export interface ObjSnap {
  id: number;
  type: number;
  x: number;
  z: number;
}

export interface WorldSnap {
  /** Bit i set = item box i available. */
  boxMask: number;
  objs: ObjSnap[];
}

export interface Snapshot {
  epoch: number;
  tick: number;
  phase: PhaseId;
  karts: KartSnap[];
  world: WorldSnap;
}

export function encodeSnapshot(epoch: number, tick: number, phase: PhaseId, karts: KartSnap[], world: WorldSnap = { boxMask: 0, objs: [] }): ArrayBuffer {
  const buf = new ArrayBuffer(SNAP_HEADER + karts.length * SNAP_KART + 5 + world.objs.length * SNAP_OBJ);
  const v = new DataView(buf);
  v.setUint8(0, MSG_SNAPSHOT);
  v.setUint8(1, epoch & 0xff);
  v.setUint32(2, tick >>> 0);
  v.setUint8(6, phase);
  v.setUint8(7, karts.length);
  let o = SNAP_HEADER;
  for (const k of karts) {
    const s = k.state;
    v.setUint8(o, k.slot);
    v.setFloat32(o + 1, s.x);
    v.setFloat32(o + 5, s.z);
    v.setFloat32(o + 9, s.heading);
    v.setInt16(o + 13, Math.round(s.speed * 100));
    v.setUint8(o + 15, s.lap);
    v.setUint8(o + 16, s.nextCp);
    v.setUint8(o + 17, (s.finished ? 1 : 0) | (s.offTrack ? 2 : 0) | (s.shield ? 4 : 0));
    v.setUint16(o + 18, s.segIdx);
    v.setUint16(o + 20, k.ackSeq & 0xffff);
    v.setUint8(o + 22, s.item);
    v.setUint8(o + 23, Math.min(255, s.boostT));
    v.setUint8(o + 24, Math.min(255, s.stunT));
    v.setUint8(o + 25, Math.min(255, s.itemCd));
    v.setUint8(o + 26, Math.min(255, s.confT));
    v.setUint8(o + 27, Math.min(255, s.slowT));
    v.setUint16(o + 28, Math.min(0xffff, s.spCd));
    v.setUint16(o + 30, Math.min(0xffff, s.shieldT));
    o += SNAP_KART;
  }
  v.setUint32(o, world.boxMask >>> 0);
  v.setUint8(o + 4, world.objs.length);
  o += 5;
  for (const ob of world.objs) {
    v.setUint8(o, ob.id);
    v.setUint8(o + 1, ob.type);
    v.setFloat32(o + 2, ob.x);
    v.setFloat32(o + 6, ob.z);
    o += SNAP_OBJ;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  if (buf.byteLength < SNAP_HEADER) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_SNAPSHOT) return null;
  const count = v.getUint8(7);
  if (buf.byteLength < SNAP_HEADER + count * SNAP_KART + 5) return null;
  const karts: KartSnap[] = [];
  let o = SNAP_HEADER;
  for (let i = 0; i < count; i++) {
    const flags = v.getUint8(o + 17);
    karts.push({
      slot: v.getUint8(o),
      ackSeq: v.getUint16(o + 20),
      state: {
        x: v.getFloat32(o + 1),
        z: v.getFloat32(o + 5),
        heading: v.getFloat32(o + 9),
        speed: v.getInt16(o + 13) / 100,
        lap: v.getUint8(o + 15),
        nextCp: v.getUint8(o + 16),
        finished: (flags & 1) !== 0,
        offTrack: (flags & 2) !== 0,
        segIdx: v.getUint16(o + 18),
        item: v.getUint8(o + 22),
        boostT: v.getUint8(o + 23),
        stunT: v.getUint8(o + 24),
        itemCd: v.getUint8(o + 25),
        confT: v.getUint8(o + 26),
        slowT: v.getUint8(o + 27),
        spCd: v.getUint16(o + 28),
        shieldT: v.getUint16(o + 30),
        shield: (flags & 4) !== 0,
      },
    });
    o += SNAP_KART;
  }
  const boxMask = v.getUint32(o);
  const nObj = v.getUint8(o + 4);
  o += 5;
  if (buf.byteLength < o + nObj * SNAP_OBJ) return null;
  const objs: ObjSnap[] = [];
  for (let i = 0; i < nObj; i++) {
    objs.push({ id: v.getUint8(o), type: v.getUint8(o + 1), x: v.getFloat32(o + 2), z: v.getFloat32(o + 6) });
    o += SNAP_OBJ;
  }
  return { epoch: v.getUint8(1), tick: v.getUint32(2), phase: v.getUint8(6) as PhaseId, karts, world: { boxMask, objs } };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Round input to wire precision. Clients must simulate with quantized input so host/client agree. */
export function quantizeInput(i: KartInput): KartInput {
  return {
    steer: Math.round(clamp(i.steer, -1, 1) * 127) / 127,
    throttle: Math.round(clamp(i.throttle, 0, 1) * 255) / 255,
    brake: Math.round(clamp(i.brake, 0, 1) * 255) / 255,
    useItem: !!i.useItem,
    useSpecial: !!i.useSpecial,
    reset: !!i.reset,
  };
}

export function encodeInput(seq: number, i: KartInput): ArrayBuffer {
  const buf = new ArrayBuffer(7);
  const v = new DataView(buf);
  v.setUint8(0, MSG_INPUT);
  v.setUint16(1, seq & 0xffff);
  v.setInt8(3, Math.round(clamp(i.steer, -1, 1) * 127));
  v.setUint8(4, Math.round(clamp(i.throttle, 0, 1) * 255));
  v.setUint8(5, Math.round(clamp(i.brake, 0, 1) * 255));
  v.setUint8(6, (i.useItem ? 1 : 0) | (i.useSpecial ? 2 : 0) | (i.reset ? 4 : 0));
  return buf;
}

export function decodeInput(buf: ArrayBuffer): { seq: number; input: KartInput } | null {
  if (buf.byteLength < 7) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_INPUT) return null;
  return {
    seq: v.getUint16(1),
    input: {
      steer: v.getInt8(3) / 127,
      throttle: v.getUint8(4) / 255,
      brake: v.getUint8(5) / 255,
      useItem: (v.getUint8(6) & 1) !== 0,
      useSpecial: (v.getUint8(6) & 2) !== 0,
      reset: (v.getUint8(6) & 4) !== 0,
    },
  };
}

/** True if 16-bit seq `a` is newer than `b` (modular). */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) & 0xffff;
  return d !== 0 && d < 0x8000;
}

export interface PlayerInfo {
  slot: number;
  name: string;
  waiting: boolean; // joined mid-round, enters next round
  pos: number; // 1-based race position, 0 if none
  lap: number;
  finishTime: number; // seconds, -1 if not finished
  character: number; // index into CHARACTERS
}

/** Reliable-channel events (JSON). */
export type EvtMsg =
  | { t: "welcome"; slot: number; slots: number[]; track?: number }
  | { t: "hello"; name: string; character: number } // client -> host
  | { t: "char"; character: number } // client -> host, lobby only
  | { t: "ping"; ts: number } // client -> host
  | { t: "pong"; ts: number } // host -> client
  | { t: "room"; phase: PhaseId; countdown: number; resultsIn: number; raceTime: number; players: PlayerInfo[]; /** dedicated rooms: seconds to auto-start, -1 = waiting for players */ autoIn?: number; track?: number };

export const MAX_NAME = 16;
export const cleanName = (n: unknown, fallback: string) => {
  const s = typeof n === "string" ? n.replace(/[\u0000-\u001f<>&"']/g, "").trim().slice(0, MAX_NAME) : "";
  return s || fallback;
};

export interface RoomInfo {
  code: string;
  name: string;
  players: number;
  max: number;
  state: "lobby" | "racing";
  createdAt: number;
  /** Run by a dedicated server: everyone connects through the relay and the round auto-starts. */
  dedicated?: boolean;
  /** Index into TRACKS. */
  track?: number;
}

/** Signaling server protocol (JSON over WebSocket). */
export type ClientToServer =
  | { t: "host"; name?: string; relayOnly?: boolean }
  | { t: "update"; players: number; state: "lobby" | "racing"; track?: number }
  | { t: "join"; room: string }
  | { t: "signal"; to?: number; data: unknown };
export type ServerToClient =
  | { t: "hosted"; room: string }
  | { t: "joined"; peer: number; relayOnly?: boolean }
  | { t: "peer"; peer: number }
  | { t: "peer-left"; peer: number }
  | { t: "signal"; from: number; data: unknown }
  | { t: "closed" }
  | { t: "error"; msg: string };
