import { createSignalingServer } from "./signaling";

const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const port = Number(process.env.PORT ?? 8787);
createSignalingServer(port, {
  staticDir: process.env.STATIC_DIR, // e.g. packages/client/dist: one process serves game + signaling
  ice: {
    stunUrls: list(process.env.STUN_URLS),
    turnUrls: list(process.env.TURN_URLS), // e.g. turn:turn.example.com:3478,turns:turn.example.com:5349
    turnSecret: process.env.TURN_SECRET, // coturn static-auth-secret (time-limited REST credentials)
    turnUser: process.env.TURN_USER,
    turnPass: process.env.TURN_PASS,
  },
});
console.log(`signaling server on ws://localhost:${port}  (rooms: GET /rooms, ice: GET /ice)`);
