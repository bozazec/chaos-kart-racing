import { safeGet, safeSet } from "./ui";

const VOLUME = 0.35; // medium-low: sits under the game sounds
const KEY = "kart.music"; // "0" = muted

/** Looping background music + a speaker toggle in the top-right corner. Autoplay is blocked until the first click/key. */
export function initMusic() {
  const audio = new Audio("/audio/music.mp3");
  audio.loop = true;
  audio.volume = VOLUME;
  audio.preload = "auto";
  let on = safeGet(KEY) !== "0";

  const btn = document.createElement("button");
  btn.style.cssText = "position:fixed;top:12px;right:12px;z-index:60;width:38px;height:38px;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(10,16,34,.6);color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center";
  const play = () => {
    if (on) void audio.play().catch(() => undefined);
  };
  const render = () => {
    btn.textContent = on ? "🔊" : "🔇";
    btn.title = btn.ariaLabel = on ? "Mute music" : "Unmute music";
  };
  btn.onclick = () => {
    on = !on;
    safeSet(KEY, on ? "1" : "0");
    if (on) play();
    else audio.pause();
    render();
    btn.blur(); // keep Space/arrows for the game
  };
  render();
  document.body.appendChild(btn);

  // browsers only allow audio after a user gesture
  const unlock = () => {
    play();
    removeEventListener("pointerdown", unlock);
    removeEventListener("keydown", unlock);
  };
  addEventListener("pointerdown", unlock);
  addEventListener("keydown", unlock);
  play(); // works if the browser already allows autoplay
}
