# Global Chaos Kart

Browser kart racing, up to 8 players per room. Three.js client, host-authoritative netcode.
Rooms are hosted by players (WebRTC) or by a dedicated server (WebSocket relay). The server in this repo only
does signaling, the room list and (optionally) serves the game.

```
packages/
  shared/   sim, items, characters, binary protocol, GameHost (round state machine). No DOM, no transport.
  client/   Vite + Three.js: renderer, input (keyboard/gamepad/touch), UI, WebRTC + relay transports
  server/   signaling + room list + /ice (TURN credentials) + static hosting; dedicated rooms
```

## Develop
```
pnpm install
pnpm dev          # client http://localhost:5173 + signaling ws://localhost:8787
pnpm test         # sim, protocol, items, specials, GameHost (headless), signaling, dedicated rooms
pnpm typecheck
```
Open the client on two tabs: create a room in one, join from the list in the other.
Phone on the same Wi-Fi: `http://<laptop-ip>:5173` (touch controls appear automatically).

## Architecture in one minute
- The host runs the authoritative 60 Hz sim (`GameHost`) and sends 20 Hz binary snapshots; clients send inputs
  only, predict their own kart and interpolate the others ~100 ms behind.
- Browser host: WebRTC data channels (unreliable `snap`/`input`, reliable `evt`). If a direct link does not come
  up in 4 s the client falls back to relaying through the signaling server.
- Dedicated server: the same `GameHost` with no local player, reached only through the relay (no native
  dependencies). The round starts automatically when `MIN_PLAYERS` are in the lobby.
- Host leaves = room closes (no host migration). A browser host should keep its tab visible.

## Tracks
Four tracks live in `shared/src/track.ts` (`TRACKS`): Belgrade (1.9 km), Budapest (2.7 km), Skopje (2.9 km, night), Niš (1.8 km, with the fortress, Bubanj fists and Skull Tower). Each is
a string of Kenney road pieces (`layout`, see `shared/src/layout.ts`: `F` straight, `l`/`r` radius-1.5 corner, `L`/`R` radius-2.5
corner) and a tile size in metres; the physics centreline and the rendered tiles both come from that string. Each has its own
road width, lap count and theme (sky, ground, road, kerbs). The host picks the track in the lobby and everyone's
client rebuilds it. Tests check every track is a closed loop that never crosses itself, never turns tighter than the
road is wide, and can be driven through all laps. Do not edit published control points: all peers must build the
same track. A mini map (bottom right) shows the track and every driver.

Karts use the character roster art: each driver's front and back view is cut out of the roster sheet
(`scripts/extract-kart-art.sh "<sheet.png>"` writes `client/public/art/karts/k{id}{f|b}.png`) and stood up on the
kart as two double-sided "cardboard" standees. The chase camera sees the back view (head, torso and the emblem on the
kart's rear); other angles fade to a simple 3D kart in the character's colors (`kart` in `shared/src/characters.ts`).
Preview all 12 at `http://localhost:5173/gallery.html` (dev server only).

## Dedicated rooms
```
pnpm --filter @kart/server dedicated
# env: SIGNALING_URL=ws://localhost:8787 ROOM_NAME=Official ROOMS=2 MIN_PLAYERS=2 AUTO_START_SEC=15
#      TRACK=0|1|2 fixes the track; unset = rotate to the next track after every round
```
They show up in the room list with a "dedicated" badge and reconnect if the signaling server restarts.

## Deploy (not done yet: nothing here has been deployed anywhere)
Everything below is prepared but untested against a real host.

Single box with Docker:
```
cp .env.example .env     # set PUBLIC_IP, TURN_REALM, TURN_SECRET, TURN_URLS
docker compose up -d --build
```
- `app` serves the built client and the signaling server on :8787. Put a TLS reverse proxy in front (https/wss).
  In a production build the client talks to its own origin; override with `VITE_SIGNALING_URL` at build time.
- `dedicated` runs `DEDICATED_ROOMS` always-on rooms.
- `coturn` relays media for players behind strict NAT (roughly 10 to 20 percent). The server hands out
  time-limited credentials at `GET /ice` using `TURN_SECRET`. Open UDP/TCP 3478 and UDP 49160-49200.
  TURN traffic costs bandwidth: budget for it.

Without Docker: `pnpm --filter @kart/client build`, then
`STATIC_DIR=packages/client/dist pnpm --filter @kart/server start`.

Server env: `PORT`, `STATIC_DIR`, `STUN_URLS`, `TURN_URLS`, `TURN_SECRET` (or `TURN_USER`/`TURN_PASS`).

## Controls
WASD / arrows drive, Space item, E special, R back to lobby (host), Esc leave.
Shield items and powers last 10 s (or until they absorb one hit).
Gamepad: right trigger/A gas, left trigger/B brake, X item, Y special. Touch: left joystick, ITEM and ★ buttons.

## Assets and rights
Character art and the logo are cropped from the supplied poster (`client/public/art`). The characters are real,
named public figures: check likeness/publicity rights before any public or commercial release. Characters are
data (`shared/src/characters.ts`), so names, art, stats and powers can be swapped in one place.

## 3D models

The kart body and the track props (barriers, start gantry, grandstands, garages, billboards, banner towers, light posts) come from
Kenney's **Racing Kit** (CC0, https://kenney.nl/assets/racing-kit). The files live in `packages/client/public/models/`
(`kart.glb`, `kit/*.glb`, licence in `KENNEY-LICENSE.txt`). Each kart is recoloured per character and gets a 3D chibi driver
(`build3DKart` in `scene.ts`); the kit props are placed by `props.ts`. If a model fails to load the game falls back to the old sprite kart / plain scenery.
