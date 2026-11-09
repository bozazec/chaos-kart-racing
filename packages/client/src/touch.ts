import type { KartInput } from "@kart/shared";

/** On-screen controls for touch devices: left joystick (steer + throttle/brake), right item button. */
export const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

const state = { x: 0, y: 0, item: false, special: false }; // x,y in -1..1, y up is negative

const SIZE = 150;
const KNOB = 64;
const DEAD = 0.12;

let root: HTMLDivElement | null = null;
let itemBtn: HTMLDivElement | null = null;
let specialBtn: HTMLDivElement | null = null;

/** Special button: character icon, dimmed while recharging (0..1). */
export function setTouchSpecial(icon: string, charge: number) {
  if (!specialBtn) return;
  specialBtn.textContent = icon;
  specialBtn.style.opacity = charge >= 1 ? "1" : "0.45";
  specialBtn.style.background = charge >= 1 ? "rgba(120,220,255,.45)" : `conic-gradient(rgba(120,220,255,.5) ${Math.round(charge * 360)}deg, rgba(255,255,255,.12) 0)`;
}

/** Show the held item on the ITEM button (emoji), or plain text when empty. */
export function setTouchItem(icon: string) {
  if (itemBtn) itemBtn.textContent = icon || "ITEM";
  if (itemBtn) itemBtn.style.fontSize = icon ? "40px" : "16px";
}

function build(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;display:none";

  const base = document.createElement("div");
  base.style.cssText = `position:absolute;left:max(24px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom));width:${SIZE}px;height:${SIZE}px;border-radius:50%;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.45);pointer-events:auto;touch-action:none`;
  const knob = document.createElement("div");
  knob.style.cssText = `position:absolute;left:${(SIZE - KNOB) / 2}px;top:${(SIZE - KNOB) / 2}px;width:${KNOB}px;height:${KNOB}px;border-radius:50%;background:rgba(255,255,255,.65);box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none`;
  base.appendChild(knob);

  let active: number | null = null;
  const move = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    state.x = dx;
    state.y = dy;
    const travel = (SIZE - KNOB) / 2;
    knob.style.transform = `translate(${dx * travel}px,${dy * travel}px)`;
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    state.x = state.y = 0;
    knob.style.transform = "";
  };
  base.addEventListener("pointerdown", (e) => {
    if (active !== null) return;
    active = e.pointerId;
    base.setPointerCapture(e.pointerId);
    move(e);
    e.preventDefault();
  });
  base.addEventListener("pointermove", (e) => e.pointerId === active && move(e));
  base.addEventListener("pointerup", release);
  base.addEventListener("pointercancel", release);

  const item = document.createElement("div");
  itemBtn = item;
  item.textContent = "ITEM";
  item.style.cssText = `position:absolute;right:max(28px,env(safe-area-inset-right));bottom:max(40px,env(safe-area-inset-bottom));width:96px;height:96px;border-radius:50%;background:rgba(255,200,40,.35);border:2px solid rgba(255,220,100,.8);color:#fff;font:700 16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none`;
  item.addEventListener("pointerdown", (e) => {
    state.item = true;
    item.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  const itemUp = () => (state.item = false);
  item.addEventListener("pointerup", itemUp);
  item.addEventListener("pointercancel", itemUp);

  const special = document.createElement("div");
  specialBtn = special;
  special.textContent = "★";
  special.style.cssText = `position:absolute;right:max(36px,env(safe-area-inset-right));bottom:calc(max(40px,env(safe-area-inset-bottom)) + 112px);width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(160,230,255,.85);color:#fff;font:700 34px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none`;
  special.addEventListener("pointerdown", (e) => {
    state.special = true;
    special.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  const specialUp = () => (state.special = false);
  special.addEventListener("pointerup", specialUp);
  special.addEventListener("pointercancel", specialUp);

  el.append(base, item, special);
  document.body.appendChild(el);
  return el;
}

export function setTouchControlsVisible(visible: boolean) {
  if (!isTouchDevice) return;
  root ??= build();
  root.style.display = visible ? "block" : "none";
  if (!visible) {
    state.x = state.y = 0;
    state.item = false;
    state.special = false;
  }
}

/** Joystick -> kart input. Up = throttle, down = brake/reverse, left/right = steer. */
export function touchInput(): KartInput | null {
  if (!isTouchDevice) return null;
  const sx = Math.abs(state.x) < DEAD ? 0 : state.x;
  const up = -state.y;
  return {
    steer: sx,
    throttle: up > DEAD ? Math.min(1, up * 1.5) : 0,
    brake: up < -DEAD ? Math.min(1, -up * 1.5) : 0,
    useItem: state.item,
    useSpecial: state.special,
  };
}
