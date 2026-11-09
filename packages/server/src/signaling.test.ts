import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerToClient } from "@kart/shared";
import { createSignalingServer } from "./signaling";

const PORT = 18787;
let srv: ReturnType<typeof createSignalingServer>;
beforeAll(async () => {
  srv = createSignalingServer(PORT, { ttlMs: 600, sweepMs: 100 });
  await srv.ready;
});
afterAll(() => srv.close());

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const q: ServerToClient[] = [];
  const waiters: ((m: ServerToClient) => void)[] = [];
  ws.on("message", (d, isBin) => {
    if (isBin) return;
    const m = JSON.parse(d.toString());
    const w = waiters.shift();
    if (w) w(m);
    else q.push(m);
  });
  const next = () => new Promise<ServerToClient>((res) => (q.length ? res(q.shift()!) : waiters.push(res)));
  const open = new Promise<void>((res) => ws.on("open", () => res()));
  return { ws, next, open, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe("signaling", () => {
  it("host/join/relay/leave/close", async () => {
    const h = client();
    await h.open;
    h.send({ t: "host" });
    const hosted = (await h.next()) as Extract<ServerToClient, { t: "hosted" }>;
    expect(hosted.room).toMatch(/^[A-Z2-9]{4}$/);

    const p = client();
    await p.open;
    p.send({ t: "join", room: hosted.room.toLowerCase() });
    const joined = (await p.next()) as Extract<ServerToClient, { t: "joined" }>;
    expect(joined.t).toBe("joined");
    expect(await h.next()).toEqual({ t: "peer", peer: joined.peer });

    h.send({ t: "signal", to: joined.peer, data: { sdp: "offer" } });
    expect(await p.next()).toEqual({ t: "signal", from: 0, data: { sdp: "offer" } });
    p.send({ t: "signal", data: { sdp: "answer" } });
    expect(await h.next()).toEqual({ t: "signal", from: joined.peer, data: { sdp: "answer" } });

    p.ws.close();
    expect(await h.next()).toEqual({ t: "peer-left", peer: joined.peer });

    const p2 = client();
    await p2.open;
    p2.send({ t: "join", room: hosted.room });
    await p2.next();
    h.ws.close();
    expect(await p2.next()).toEqual({ t: "closed" });
  });
  it("relays binary frames both ways", async () => {
    const h = client();
    await h.open;
    h.send({ t: "host" });
    const hosted = (await h.next()) as Extract<ServerToClient, { t: "hosted" }>;
    const p = client();
    await p.open;
    p.send({ t: "join", room: hosted.room });
    const joined = (await p.next()) as Extract<ServerToClient, { t: "joined" }>;
    await h.next();
    const bin = (c: ReturnType<typeof client>) => new Promise<Buffer>((res) => c.ws.once("message", (d, isBin) => isBin && res(d as Buffer)));
    const atHost = bin(h);
    p.ws.send(Buffer.from([1, 9, 8, 7]));
    expect([...(await atHost)]).toEqual([1, joined.peer >> 8, joined.peer & 0xff, 9, 8, 7]);
    const atPeer = bin(p);
    h.ws.send(Buffer.from([0, joined.peer >> 8, joined.peer & 0xff, 5, 6]));
    expect([...(await atPeer)]).toEqual([0, 5, 6]);
    h.ws.close();
    p.ws.close();
  });
  it("lists rooms over HTTP, tracks updates, expires stale hosts", async () => {
    const h = client();
    await h.open;
    h.send({ t: "host", name: "  <i>My Race</i> " });
    const hosted = (await h.next()) as Extract<ServerToClient, { t: "hosted" }>;
    const list = async () => (await (await fetch(`http://localhost:${PORT}/rooms`)).json()) as { code: string; name: string; players: number; state: string }[];
    let r = (await list()).find((x) => x.code === hosted.room)!;
    expect(r).toMatchObject({ name: "iMy Race/i", players: 1, state: "lobby" });
    h.send({ t: "update", players: 3, state: "racing" });
    await new Promise((res) => setTimeout(res, 50));
    r = (await list()).find((x) => x.code === hosted.room)!;
    expect(r).toMatchObject({ players: 3, state: "racing" });
    // heartbeats keep it alive past the ttl
    for (let i = 0; i < 4; i++) {
      await new Promise((res) => setTimeout(res, 200));
      h.send({ t: "update", players: 3, state: "racing" });
    }
    expect((await list()).some((x) => x.code === hosted.room)).toBe(true);
    // silence -> expires
    await new Promise((res) => setTimeout(res, 900));
    expect((await list()).some((x) => x.code === hosted.room)).toBe(false);
    h.ws.close();
  });
  it("unknown room errors", async () => {
    const p = client();
    await p.open;
    p.send({ t: "join", room: "ZZZZ" });
    expect(await p.next()).toEqual({ t: "error", msg: "room not found" });
    p.ws.close();
  });
});
