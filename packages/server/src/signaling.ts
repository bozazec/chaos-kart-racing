import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { cleanName, cleanTrackId, MAX_PLAYERS, type ClientToServer, type RoomInfo, type ServerToClient } from "@kart/shared";

interface Room {
  code: string;
  host: WebSocket;
  peers: Map<number, WebSocket>;
  nextPeer: number;
  name: string;
  players: number;
  state: "lobby" | "racing";
  createdAt: number;
  lastSeen: number;
  relayOnly: boolean;
  track: number;
}

export interface ServerOptions {
  /** Rooms with no host message for this long are dropped (hung host tab). */
  ttlMs?: number;
  sweepMs?: number;
  maxRooms?: number;
  /** Serve this directory (the built client) at / for single-origin deployments. */
  staticDir?: string;
  /** TURN/STUN config for GET /ice */
  ice?: IceConfig;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PEERS = 7;

export interface IceConfig {
  stunUrls?: string[];
  /** coturn `use-auth-secret` REST credentials */
  turnUrls?: string[];
  turnSecret?: string;
  /** or static credentials */
  turnUser?: string;
  turnPass?: string;
  ttlSec?: number;
}

/** ICE servers for clients. TURN credentials are time-limited (coturn REST API scheme). */
export function iceServers(cfg: IceConfig, now = Date.now()): { urls: string | string[]; username?: string; credential?: string }[] {
  const out: { urls: string | string[]; username?: string; credential?: string }[] = [{ urls: cfg.stunUrls?.length ? cfg.stunUrls : ["stun:stun.l.google.com:19302"] }];
  if (cfg.turnUrls?.length) {
    if (cfg.turnSecret) {
      const username = `${Math.floor(now / 1000) + (cfg.ttlSec ?? 3600)}:kart`;
      out.push({ urls: cfg.turnUrls, username, credential: createHmac("sha1", cfg.turnSecret).update(username).digest("base64") });
    } else if (cfg.turnUser && cfg.turnPass) {
      out.push({ urls: cfg.turnUrls, username: cfg.turnUser, credential: cfg.turnPass });
    }
  }
  return out;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Serve a file from `dir`. Returns false if nothing was served. Path traversal is rejected. */
export function serveStatic(dir: string, rawUrl: string, res: http.ServerResponse): boolean {
  const root = path.resolve(dir);
  let rel: string;
  try {
    rel = decodeURIComponent(rawUrl.split("?")[0] ?? "/");
  } catch {
    return false;
  }
  if (rel.includes("\0")) return false;
  let file = path.join(root, rel.endsWith("/") ? rel + "index.html" : rel);
  if (!file.startsWith(root + path.sep) && file !== root) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) return false; // missing asset: real 404
    file = path.join(root, "index.html"); // client-side routes fall back to the app
  }
  if (!fs.existsSync(file)) return false;
  const ext = path.extname(file).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  fs.createReadStream(file).pipe(res);
  return true;
}

function send(ws: WebSocket, m: ServerToClient) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

export function createSignalingServer(port: number, opts: ServerOptions = {}) {
  const { ttlMs = 12000, sweepMs = 2000, maxRooms = 500, ice = {}, staticDir } = opts;
  const rooms = new Map<string, Room>();

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "GET" && req.url?.split("?")[0] === "/rooms") {
      const list: RoomInfo[] = [...rooms.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((r) => ({ code: r.code, name: r.name, players: r.players, max: MAX_PLAYERS, state: r.state, createdAt: r.createdAt, dedicated: r.relayOnly || undefined, track: r.track }));
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(list));
    } else if (req.method === "GET" && req.url?.split("?")[0] === "/ice") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ iceServers: iceServers(ice) }));
    } else if (staticDir && req.method === "GET" && serveStatic(staticDir, req.url ?? "/", res)) {
      // served the client
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
  const ready = new Promise<void>((res) => server.listen(port, () => res()));

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) if (now - r.lastSeen > ttlMs) r.host.terminate();
  }, sweepMs);

  const newCode = () => {
    for (;;) {
      let c = "";
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  };

  wss.on("connection", (ws) => {
    let hosted: Room | null = null;
    let joined: { room: Room; peer: number } | null = null;

    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        // Relay frames. client->server: [ch][payload]; server->host: [ch][peerHi][peerLo][payload]
        // host->server: [ch][peerHi][peerLo][payload]; server->client: [ch][payload]
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]);
        if (joined && buf.length >= 1) {
          const head = Buffer.from([buf[0]!, joined.peer >> 8, joined.peer & 0xff]);
          if (joined.room.host.readyState === WebSocket.OPEN) joined.room.host.send(Buffer.concat([head, buf.subarray(1)]));
        } else if (hosted && buf.length >= 3) {
          hosted.lastSeen = Date.now();
          const target = hosted.peers.get((buf[1]! << 8) | buf[2]!);
          if (target?.readyState === WebSocket.OPEN) target.send(Buffer.concat([buf.subarray(0, 1), buf.subarray(3)]));
        }
        return;
      }
      let m: ClientToServer;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.t === "host" && !hosted && !joined) {
        if (rooms.size >= maxRooms) return send(ws, { t: "error", msg: "server full" });
        const now = Date.now();
        hosted = {
          code: newCode(),
          host: ws,
          peers: new Map(),
          nextPeer: 1,
          name: cleanName(m.name, "Kart room"),
          players: 1,
          state: "lobby",
          createdAt: now,
          lastSeen: now,
          relayOnly: m.relayOnly === true,
          track: 0,
        };
        rooms.set(hosted.code, hosted);
        send(ws, { t: "hosted", room: hosted.code });
      } else if (m.t === "update" && hosted) {
        hosted.lastSeen = Date.now();
        hosted.players = Math.max(1, Math.min(MAX_PLAYERS, Number(m.players) | 0));
        hosted.state = m.state === "racing" ? "racing" : "lobby";
        hosted.track = cleanTrackId(m.track);
      } else if (m.t === "join" && !hosted && !joined) {
        const room = rooms.get(String(m.room).toUpperCase());
        if (!room) return send(ws, { t: "error", msg: "room not found" });
        if (room.peers.size >= MAX_PEERS) return send(ws, { t: "error", msg: "room full" });
        const peer = room.nextPeer++;
        room.peers.set(peer, ws);
        joined = { room, peer };
        send(ws, { t: "joined", peer, relayOnly: room.relayOnly || undefined });
        send(room.host, { t: "peer", peer });
      } else if (m.t === "signal") {
        if (hosted) hosted.lastSeen = Date.now();
        if (hosted && typeof m.to === "number") {
          const target = hosted.peers.get(m.to);
          if (target) send(target, { t: "signal", from: 0, data: m.data });
        } else if (joined) {
          send(joined.room.host, { t: "signal", from: joined.peer, data: m.data });
        }
      }
    });

    ws.on("close", () => {
      if (hosted) {
        rooms.delete(hosted.code);
        for (const p of hosted.peers.values()) {
          send(p, { t: "closed" });
          p.close();
        }
      } else if (joined) {
        joined.room.peers.delete(joined.peer);
        send(joined.room.host, { t: "peer-left", peer: joined.peer });
      }
    });
  });

  return {
    wss,
    rooms,
    ready,
    close: () =>
      new Promise<void>((res) => {
        clearInterval(sweep);
        for (const c of wss.clients) c.terminate();
        wss.close(() => server.close(() => res()));
        server.closeAllConnections?.();
      }),
  };
}
