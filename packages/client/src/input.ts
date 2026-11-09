import type { KartInput } from "@kart/shared";
import { touchInput } from "./touch";

const keys = new Set<string>();
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

let resetUntil = 0;
/** On-screen button: hold the reset request for a moment so a dropped input packet can't lose it. */
export function requestReset() {
  resetUntil = performance.now() + 150;
}

const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);

export function sampleInput(): KartInput {
  // test hook: automated clients drive via window.__kartInput
  const override = (window as unknown as { __kartInput?: () => KartInput }).__kartInput;
  if (override) return override();
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  let steer = (right ? 1 : 0) - (left ? 1 : 0);
  let throttle = keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0;
  let brake = keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0;
  let useItem = keys.has("Space");
  let useSpecial = keys.has("KeyE") || keys.has("ShiftLeft");

  const pad = navigator.getGamepads?.().find((g) => g && g.connected);
  if (pad) {
    const ax = dead(pad.axes[0] ?? 0);
    if (ax !== 0) steer = ax;
    throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0, pad.buttons[0]?.pressed ? 1 : 0);
    brake = Math.max(brake, pad.buttons[6]?.value ?? 0, pad.buttons[1]?.pressed ? 1 : 0);
    useItem = useItem || !!pad.buttons[2]?.pressed;
    useSpecial = useSpecial || !!pad.buttons[3]?.pressed;
  }
  const t = touchInput();
  if (t) {
    if (t.steer !== 0) steer = t.steer;
    throttle = Math.max(throttle, t.throttle);
    brake = Math.max(brake, t.brake);
    useItem = useItem || t.useItem;
    useSpecial = useSpecial || !!t.useSpecial;
  }
  const reset = keys.has("KeyR") || performance.now() < resetUntil || !!pad?.buttons[8]?.pressed;
  return { steer, throttle, brake, useItem, useSpecial, reset };
}
