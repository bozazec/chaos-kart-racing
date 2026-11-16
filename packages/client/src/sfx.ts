import { safeGet } from "./ui";

let ctx: AudioContext | null = null;

function tone(c: AudioContext, freq: number, at: number, dur: number, vol: number, type: OscillatorType = "triangle") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** Synthesised "ding": a rising arpeggio, longer and brighter for bigger awards. Follows the music mute toggle. */
export function playXpSound(xp: number) {
  if (safeGet("kart.music") === "0") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const notes = xp >= 60 ? [523, 659, 784, 1047, 1319] : xp >= 15 ? [659, 784, 1047] : [880, 1175];
    notes.forEach((f, i) => tone(ctx!, f, t + i * 0.07, 0.22, 0.12));
    if (xp >= 60) tone(ctx, 262, t, 0.5, 0.08, "sine");
  } catch {
    /* no audio */
  }
}
