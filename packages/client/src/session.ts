import type { KartState, PhaseId, PlayerInfo } from "@kart/shared";

export interface RenderKart {
  slot: number;
  x: number;
  z: number;
  heading: number;
  shield?: boolean;
  boosting?: boolean;
  stunned?: boolean;
  confused?: boolean;
  slowed?: boolean;
}

/** Item boxes and world objects (missiles, oil) to draw. */
export interface WorldView {
  /** Bit i set = item box i available. */
  boxMask: number;
  objects: { id: number; type: number; x: number; z: number }[];
}

export interface Hud {
  me: KartState | null;
  raceTime: number;
  info: string;
}

export interface RoomView {
  phase: PhaseId;
  /** seconds until race start (countdown phase) */
  countdown: number;
  /** seconds until back to lobby (results phase) */
  resultsIn: number;
  players: PlayerInfo[];
  /** joined mid-round; spectating until next round */
  waiting: boolean;
  /** which track the room is on (index into TRACKS) */
  trackId: number;
  /** dedicated rooms: seconds until auto-start, -1 = waiting for more players, undefined = host starts manually */
  autoIn?: number;
}

/** What the renderer/main loop needs from a game session (solo/host/client). */
export interface Session {
  mySlot: number;
  /** Called every render frame. Client runs prediction ticks here; host ticks via worker. */
  update(now: number): void;
  render(now: number): RenderKart[];
  hud(): Hud;
  room(): RoomView;
  trackId(): number;
  world(now: number): WorldView;
  isHost: boolean;
  roomCode: string | null;
  /** Set when the connection died (host left, network lost). */
  closedReason?: string | null;
  /** Lobby only: switch driver. */
  setCharacter?(id: number): void;
  /** Host only, lobby only: pick the track. */
  setTrack?(id: number): void;
  /** Host only. */
  startRace?(): void;
  /** Host only: abort round / leave results early. */
  toLobby?(): void;
  /** Host only: restart the game right away in the same room. */
  restart?(): void;
  dispose(): void;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
