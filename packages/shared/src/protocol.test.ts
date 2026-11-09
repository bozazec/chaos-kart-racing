import { describe, expect, it } from "vitest";
import { Phase, cleanName, decodeInput, decodeSnapshot, encodeInput, encodeSnapshot, quantizeInput, seqNewer } from "./index";
import type { KartState } from "./index";

const st: KartState = { x: 12.5, z: -300.25, heading: 1.25, speed: 33.33, segIdx: 321, lap: 2, nextCp: 5, finished: false, offTrack: true, item: 3, boostT: 90, stunT: 12, itemCd: 7, shield: true, confT: 33, slowT: 44, spCd: 1234, shieldT: 555 };

describe("protocol", () => {
  it("snapshot roundtrip incl. items/world, 32 B per kart", () => {
    const world = { boxMask: 0b1010_0000_0001, objs: [{ id: 7, type: 4, x: 1.5, z: -2.5 }] };
    const buf = encodeSnapshot(3, 123456, Phase.Race, [{ slot: 4, state: st, ackSeq: 70000 }], world);
    expect(buf.byteLength).toBe(8 + 32 + 5 + 10);
    const d = decodeSnapshot(buf)!;
    expect(d.epoch).toBe(3);
    expect(d.tick).toBe(123456);
    expect(d.phase).toBe(Phase.Race);
    const k = d.karts[0]!;
    expect(k.slot).toBe(4);
    expect(k.ackSeq).toBe(70000 & 0xffff);
    expect(k.state.x).toBeCloseTo(12.5, 4);
    expect(k.state.speed).toBeCloseTo(33.33, 2);
    expect(k.state).toMatchObject({ segIdx: 321, lap: 2, nextCp: 5, finished: false, offTrack: true, item: 3, boostT: 90, stunT: 12, itemCd: 7, shield: true, confT: 33, slowT: 44, spCd: 1234, shieldT: 555 });
    expect(d.world.boxMask).toBe(world.boxMask);
    expect(d.world.objs).toEqual(world.objs);
  });
  it("rejects garbage", () => {
    expect(decodeSnapshot(new ArrayBuffer(3))).toBeNull();
    expect(decodeInput(new ArrayBuffer(2))).toBeNull();
  });
  it("input roundtrip equals quantized input", () => {
    const i = { steer: -0.37, throttle: 0.9, brake: 0.1, useItem: true, useSpecial: true };
    const d = decodeInput(encodeInput(65537, i))!;
    expect(d.seq).toBe(1);
    expect(d.input).toEqual(quantizeInput(i));
  });
  it("cleanName strips junk and falls back", () => {
    expect(cleanName("  <b>Bob</b>  ", "x")).toBe("bBob/b");
    expect(cleanName("", "Player 2")).toBe("Player 2");
    expect(cleanName(42, "P")).toBe("P");
    expect(cleanName("a".repeat(40), "P").length).toBe(16);
  });
  it("seqNewer handles wrap", () => {
    expect(seqNewer(5, 4)).toBe(true);
    expect(seqNewer(4, 5)).toBe(false);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(7, 7)).toBe(false);
  });
});
