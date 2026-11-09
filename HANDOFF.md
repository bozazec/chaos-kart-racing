# Browser Kart Racing Game: Handoff

Move this file into the new project folder (e.g. as `HANDOFF.md`) and start the new session there.

## Goal
Multiplayer kart racing game (Crash Team Racing / Mario Kart style) that runs in the browser.
- Players pick a character, drive a kart, collect item boxes on the track, and use them.
- Home page lists open rooms. Players can search and filter rooms, or create a new one.
- The player who creates a room is the host/server. Others join it.
- Players who join are in a waiting list until the next round starts.
- Rooms are self-hosted by players. The home page is only a base point: room list, news, instructions.
- **Up to 8 players per room.**

## Decisions so far
- Feasible. Architecture is host-authoritative, star topology (all clients connect to the host).
- **Option A (start here):** the host's browser runs the authoritative sim. Clients connect through WebRTC DataChannels.
  - Backend is only a small Node WebSocket **signaling server** plus the **room list** (rooms register and send a heartbeat every few seconds; stale rooms expire).
  - STUN is free. TURN (self-hosted coturn) is needed for roughly 10-20% of players behind strict NAT.
- **Option B (later):** downloadable dedicated server (Node/Docker) that registers with the home page. The game logic should be shared between A and B, so keep sim code independent of transport.
- Rendering: Three.js or Babylon.js (Godot web export is the alternative). **Not yet chosen. Ask the user.**
- Do NOT use Mario Kart or CTR characters, tracks, or music. Use original or CC0 assets (e.g. Kenney.nl).

## Netcode design
- Clients send **inputs only** (steer, throttle, brake, use item), and these are tiny.
- Host sims at a fixed 60 Hz tick, separate from the render loop. It broadcasts snapshots at 20-30 Hz.
- Snapshots are packed binary (`ArrayBuffer`, ~20-30 B per kart, ~240 B for 8 karts), not JSON.
- DataChannels:
  - Snapshots: unreliable, unordered (`ordered: false, maxRetransmits: 0`).
  - Events (item pickup, race start, results, lobby changes): reliable.
- Clients predict only their own kart. Remote karts are interpolated about 100 ms behind.
- Host owns item spawns, pickups and effects. Kart-kart collisions are resolved on the host with soft bumps, and clients get small corrections.
- Bandwidth for 8 players: host upload about 50 KB/s, each client about 7 KB/s down and 1-2 KB/s up.

## Room state machine
`LOBBY -> COUNTDOWN -> RACE -> RESULTS -> LOBBY`
- Players who join during `RACE` go to a waiting queue and enter the next round.
- Character select is a lobby message. Each character is a model plus a stats preset.

## Known risks
- Host is the weak point: a weak machine, bad Wi-Fi, or a throttled background tab lags everyone. Warn the host to keep the tab focused, and show a connection quality indicator.
- Host leaves means the room dies. Host migration is out of scope for the MVP.
- Host has a latency advantage and can cheat. Accepted for now.
- Mobile needs touch controls. Test performance early.
- TURN costs bandwidth. Budget for it.

## MVP order
1. Single-player kart on one track (Three.js + simple arcade physics).
2. Host-authoritative sim with 2 players over WebRTC (PeerJS or `simple-peer` plus the signaling server).
3. Lobby, room list, create/join, waiting queue, up to 8 players.
4. Items, then character select.
5. TURN server, polish, then Option B (dedicated server).

## Open questions for the user
- Renderer: plain Three.js + Node signaling, or Godot web export?
- Language: TypeScript or JS? Monorepo layout (client, signaling server, shared sim)?
- Where will the home page and signaling server be deployed?
- Art: original low-poly assets, or a CC0 pack?

## First step for the new session
Confirm the open questions, then scaffold the project: a client app, a signaling/room-list server, and a shared sim package. Then build MVP step 1.
