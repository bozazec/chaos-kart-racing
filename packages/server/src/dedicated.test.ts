import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { decodeSnapshot, encodeInput, Phase, type EvtMsg, type RoomInfo, type ServerToClient, type Snapshot } from "@kart/shared";
import { startDedicated, type DedicatedRoom } from "./dedicated";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSignalingServer, iceServers } from "./signaling";

const PORT = 18788;
let srv: ReturnType<typeof createSignalingServer>;
let room: DedicatedRoom;
let code = "";
beforeAll(async () => {
  srv = createSignalingServer(PORT, { ice: { turnUrls: ["turn:t.example:3478"], turnSecret: "s3cret" } });
  await srv.ready;
  room = startDedicated({ url: `ws://localhost:${PORT}`, name: "Test Dedicated", minPlayers: 2, delaySec: 0.4 });
  code = await room.ready;
});
afterAll(async () => {
  room.stop();
  await srv.close();
});

/** A game client that only speaks the relay protocol. */
async function relayClient() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  ws.binaryType = "arraybuffer";
  const evts: EvtMsg[] = [];
  const snaps: Snapshot[] = [];
  let joined: ServerToClient | null = null;
  ws.on("message", (raw, isBin) => {
    if (isBin) {
      const v = new Uint8Array(raw as ArrayBuffer);
      if (v[0] === 0) snaps.push(decodeSnapshot((raw as ArrayBuffer).slice(1))!);
      else if (v[0] === 2) evts.push(JSON.parse(new TextDecoder().decode(v.subarray(1))));
    } else {
      const m = JSON.parse(String(raw)) as ServerToClient;
      if (m.t === "joined") joined = m;
    }
  });
  await new Promise<void>((res) => ws.on("open", () => res()));
  ws.send(JSON.stringify({ t: "join", room: code }));
  await waitUntil(() => joined !== null);
  const sendFrame = (ch: number, body: Uint8Array) => ws.send(Buffer.concat([Buffer.from([ch]), body]));
  return {
    ws, evts, snaps, joined: joined as unknown as Extract<ServerToClient, { t: "joined" }>,
    goRelay: () => ws.send(JSON.stringify({ t: "signal", data: { relay: true } })),
    evt: (m: EvtMsg) => sendFrame(2, new TextEncoder().encode(JSON.stringify(m))),
    input: (seq: number, throttle: number) => sendFrame(1, new Uint8Array(encodeInput(seq, { steer: 0, throttle, brake: 0, useItem: false }))),
    lastRoom: () => [...evts].reverse().find((e) => e.t === "room") as Extract<EvtMsg, { t: "room" }> | undefined,
  };
}
async function waitUntil(pred: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("ice config", () => {
  it("emits coturn REST credentials that verify", () => {
    const now = 1_700_000_000_000;
    const cfg = iceServers({ turnUrls: ["turn:t.example:3478"], turnSecret: "s3cret", ttlSec: 600 }, now);
    expect(cfg[0]!.urls).toEqual(["stun:stun.l.google.com:19302"]);
    const turn = cfg[1]!;
    expect(turn.username).toBe(`${now / 1000 + 600}:kart`);
    expect(turn.credential).toBe(createHmac("sha1", "s3cret").update(turn.username!).digest("base64"));
  });
  it("supports static credentials and STUN-only", () => {
    expect(iceServers({ turnUrls: ["turn:x"], turnUser: "u", turnPass: "p" })[1]).toEqual({ urls: ["turn:x"], username: "u", credential: "p" });
    expect(iceServers({})).toHaveLength(1);
    expect(iceServers({ turnUrls: ["turn:x"] })).toHaveLength(1); // TURN url without any credentials is ignored
  });
  it("is served over HTTP", async () => {
    const j = (await (await fetch(`http://localhost:${PORT}/ice`)).json()) as { iceServers: { urls: string[]; credential?: string }[] };
    expect(j.iceServers[1]!.urls).toEqual(["turn:t.example:3478"]);
    expect(j.iceServers[1]!.credential).toBeTruthy();
  });
});

describe("dedicated room", () => {
  it("is listed as dedicated", async () => {
    const list = (await (await fetch(`http://localhost:${PORT}/rooms`)).json()) as RoomInfo[];
    expect(list.find((r) => r.code === code)).toMatchObject({ name: "Test Dedicated", dedicated: true, state: "lobby", players: 1 });
  });

  it("two relay clients: welcome, lobby, auto-start, countdown, race, snapshots, input", async () => {
    const a = await relayClient();
    expect(a.joined.relayOnly).toBe(true);
    a.goRelay();
    await waitUntil(() => a.evts.some((e) => e.t === "welcome"));
    expect(a.evts.find((e) => e.t === "welcome")).toMatchObject({ slot: 0 }); // no host player: slots start at 0
    a.evt({ t: "hello", name: "Ann", character: 4 });
    await waitUntil(() => a.lastRoom()?.autoIn === -1); // waiting for a second player

    const b = await relayClient();
    b.goRelay();
    await waitUntil(() => b.evts.some((e) => e.t === "welcome"));
    expect(b.evts.find((e) => e.t === "welcome")).toMatchObject({ slot: 1 });
    b.evt({ t: "hello", name: "Bob", character: 7 });
    await waitUntil(() => a.lastRoom()?.players.map((p) => p.name).join() === "Ann,Bob");
    expect(a.lastRoom()!.players.map((p) => p.name)).toEqual(["Ann", "Bob"]);

    // auto-start -> countdown -> race, snapshots flow, phases visible in snapshots
    await waitUntil(() => a.snaps.some((s) => s.phase === Phase.Countdown));
    await waitUntil(() => a.snaps.some((s) => s.phase === Phase.Race), 8000);
    const list = (await (await fetch(`http://localhost:${PORT}/rooms`)).json()) as RoomInfo[];
    expect(list.find((r) => r.code === code)).toMatchObject({ state: "racing", players: 2 });

    // input moves the kart: Bob floors it, Ann idles
    for (let i = 1; i <= 90; i++) {
      a.input(i, 0);
      b.input(i, 1);
      await new Promise((r) => setTimeout(r, 16));
    }
    const last = b.snaps.at(-1)!;
    const bob = last.karts.find((k) => k.slot === 1)!.state;
    const ann = last.karts.find((k) => k.slot === 0)!.state;
    expect(bob.speed).toBeGreaterThan(10);
    expect(ann.speed).toBeLessThan(1);
    expect(last.karts.find((k) => k.slot === 1)!.ackSeq).toBeGreaterThan(0);

    // leaving frees the slot
    b.ws.close();
    await waitUntil(() => (a.lastRoom()?.players.length ?? 2) === 1);
    a.ws.close();
  }, 30000);
});

describe("static client hosting", () => {
  it("serves files, falls back to index.html, blocks traversal, 404s missing assets", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kart-static-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "index.html"), "<h1>kart</h1>");
    fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log(1)");
    fs.writeFileSync(path.join(os.tmpdir(), "kart-secret.txt"), "secret");
    const s = createSignalingServer(18789, { staticDir: dir });
    await s.ready;
    const get = (p: string) => fetch(`http://localhost:18789${p}`);
    expect(await (await get("/")).text()).toBe("<h1>kart</h1>");
    const js = await get("/assets/app.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await (await get("/some/route")).text()).toBe("<h1>kart</h1>");
    expect((await get("/assets/missing.js")).status).toBe(404);
    expect((await get("/..%2Fkart-secret.txt")).status).not.toBe(200);
    expect(await (await get("/rooms")).json()).toEqual([]); // API still wins over static
    await s.close();
  });
});
