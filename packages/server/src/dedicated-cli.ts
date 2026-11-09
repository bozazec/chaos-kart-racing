import { startDedicated } from "./dedicated";

const url = process.env.SIGNALING_URL ?? "ws://localhost:8787";
const rooms = Math.max(1, Number(process.env.ROOMS ?? 1));
const base = process.env.ROOM_NAME ?? "Dedicated";

for (let i = 0; i < rooms; i++) {
  const name = rooms > 1 ? `${base} ${i + 1}` : base;
  startDedicated({
    url,
    name,
    // TRACK=0|1|2 fixes the track; unset = rotate through all of them each round
    trackId: process.env.TRACK === undefined ? undefined : Number(process.env.TRACK),
    rotateTracks: process.env.TRACK === undefined,
    minPlayers: Number(process.env.MIN_PLAYERS ?? 2),
    delaySec: Number(process.env.AUTO_START_SEC ?? 15),
    log: (m) => console.log(`[${name}] ${m}`),
  });
}
console.log(`${rooms} dedicated room(s) -> ${url}`);
