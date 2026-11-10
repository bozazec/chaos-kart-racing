import { captureHead, getCustomHead, onCustomHeadChange, saveHeadFromFile, setCustomHead } from "./customhead";
import { buildTrackById, characterById, CHARACTERS, DEFAULT_PARAMS, MAX_PLAYERS, paramsFor, Phase, SPECIAL_CD, STUN_TICKS, trackDef, TRACKS, type PlayerInfo, type RoomInfo } from "@kart/shared";
import { trackPreviewUrl } from "./minimap";
import { ROOMS_URL } from "./net/signaling";
import type { RoomView } from "./session";

type Child = Node | string;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Omit<HTMLElementTagNameMap[K], "style">> & { class?: string; style?: string } = {}, ...kids: Child[]) {
  const e = document.createElement(tag);
  const { class: cls, style, ...rest } = props as Record<string, unknown>;
  if (cls) e.className = cls as string;
  if (typeof style === "string") e.setAttribute("style", style);
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
/** "Special: icon name — what it does · cooldown" block. */
const specialBlock = (id: number) => {
  const sp = characterById(id).special;
  return h("div", { class: "k-sp" }, h("div", { class: "k-muted", textContent: "SPECIAL POWER" }), h("b", { textContent: `${sp.icon} ${sp.name}` }), h("div", { textContent: sp.desc }), h("div", { class: "k-muted", textContent: `${Math.round(SPECIAL_CD / 60)} s cooldown · key E / button` }));
};
const previews = new Map<number, string>();
/** Cached mini preview image of a track's layout. */
const trackPreview = (id: number) => {
  let u = previews.get(id);
  if (!u) {
    u = trackPreviewUrl(buildTrackById(id));
    previews.set(id, u);
  }
  return u;
};
const portrait = (id: number) => `/art/characters/c${id}.jpg`;
/** Round character avatar with a kart-color ring. */
const avatar = (character: number, size = 30) => {
  const c = characterById(character);
  return h("img", { class: "k-av", src: portrait(c.id), alt: c.name, title: c.name, style: `width:${size}px;height:${size}px;border-color:${hex(c.color)}` });
};
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
export const ITEM_INFO: Record<number, { icon: string; name: string }> = {
  1: { icon: "⚡", name: "Boost" },
  2: { icon: "🛡️", name: "Shield" },
  3: { icon: "🚀", name: "Missile" },
  4: { icon: "🛢️", name: "Oil slick" },
};

export const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

export function injectStyles() {
  document.head.appendChild(
    h("style", {
      textContent: `
:root{font-family:system-ui,sans-serif;color:#fff}
.k-screen{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;background:linear-gradient(#0e1630,#1b2a52);overflow:auto;padding:24px 16px;box-sizing:border-box;-webkit-user-select:text;user-select:text;touch-action:pan-y}
.k-screen::before{content:"";position:fixed;inset:-30px;background:url(/art/poster.jpg) center/cover;filter:blur(14px) brightness(.45) saturate(1.2);z-index:-1}
.k-logo{width:min(560px,88vw);height:auto;margin:0 0 6px;-webkit-mask-image:linear-gradient(to right,transparent,#000 7%,#000 93%,transparent),linear-gradient(#000 85%,transparent);mask-image:linear-gradient(to right,transparent,#000 7%,#000 93%,transparent),linear-gradient(#000 85%,transparent);-webkit-mask-composite:source-in;mask-composite:intersect;filter:drop-shadow(0 4px 12px rgba(0,0,0,.6))}
.k-chars{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
@media(max-width:760px){.k-chars{grid-template-columns:repeat(4,minmax(0,1fr))}}
.k-char{padding:0;border:3px solid transparent;border-radius:12px;overflow:hidden;cursor:pointer;background:#000;aspect-ratio:208/213;display:block;transition:transform .12s}
.k-char:hover{transform:translateY(-2px)}
.k-char img{width:100%;height:100%;object-fit:cover;display:block}
.k-char.sel{border-color:#ffd23f;box-shadow:0 0 16px rgba(255,210,63,.85)}
.k-pick{display:flex;gap:16px;align-items:flex-start}
.k-me{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
.k-me .k-in{flex:1;min-width:140px}
.k-dt{margin-top:14px;font-weight:700;font-size:14px}
@media(max-width:760px){.k-pick{flex-direction:column}.k-detail{width:100%!important}}
.k-detail{width:270px;flex:none;box-sizing:border-box;background:rgba(0,0,0,.28);border-radius:12px;padding:12px}
.k-hp{width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #ffd23f;flex:none}
.k-dh{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.k-dh img{width:72px;height:72px;border-radius:12px;object-fit:cover;object-position:50% 60%;border:3px solid #fff;flex:none}
.k-dn{font-size:20px;font-weight:800;line-height:1.1}
.k-theme{display:inline-block;margin-top:4px;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;color:#111}
.k-stat{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:12px;font-weight:700;letter-spacing:.5px}
.k-stat .l{width:78px;opacity:.85}
.k-stat .v{width:74px;text-align:right;opacity:.6;font-weight:600;white-space:nowrap}
.k-bar{flex:1;display:flex;gap:3px}
.k-bar i{flex:1;height:10px;border-radius:3px;background:rgba(255,255,255,.16);transition:background .2s}
.k-bar i.on{background:linear-gradient(#ffe066,#ffb000)}
.k-luck{margin-top:10px;font-size:12px;opacity:.9}
.k-sp{margin-top:10px;padding:8px 10px;border-radius:10px;background:rgba(120,220,255,.14);border:1px solid rgba(160,230,255,.4);font-size:12px}
.k-sp b{font-size:14px}
.k-tracks{display:flex;gap:8px;margin:6px 0 10px;flex-wrap:wrap}
.k-tracks button{width:104px;padding:4px;border:2px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(0,0,0,.25);color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}
.k-tracks button:disabled{cursor:default;opacity:.55}
.k-tracks button.sel{border-color:#ffd23f;opacity:1;box-shadow:0 0 8px rgba(255,210,63,.7)}
.k-tracks img{width:92px;height:61px;border-radius:6px;background:rgba(0,0,0,.35)}
.k-pickrow{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0 4px}
.k-pickrow button{padding:0;border:2px solid transparent;border-radius:50%;background:none;cursor:pointer}
.k-pickrow button.sel{border-color:#ffd23f;box-shadow:0 0 8px #ffd23f}
.k-chip{display:inline-block;margin:3px 4px 0 0;padding:3px 8px;border-radius:99px;background:rgba(255,255,255,.14);font-size:12px}
.k-av{border-radius:50%;object-fit:cover;object-position:50% 58%;flex:none;border:2px solid #fff;background:#000}
.k-sub{opacity:.7;margin-bottom:16px}
.k-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;width:100%;max-width:1000px}
@media(max-width:760px){.k-grid{grid-template-columns:1fr}}
.k-card{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:16px;box-sizing:border-box}
.k-card h3{margin:0 0 10px;font-size:18px}
.k-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.k-in{padding:9px 10px;font:inherit;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.25);color:#fff;min-width:0}
.k-btn{padding:9px 18px;font:600 15px system-ui,sans-serif;border:0;border-radius:8px;cursor:pointer;background:#ffd23f;color:#222}
.k-btn.sec{background:rgba(255,255,255,.18);color:#fff}
.k-btn:disabled{opacity:.4;cursor:default}
.k-rooms{display:flex;flex-direction:column;gap:6px;max-height:42vh;overflow:auto}
.k-room{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.22)}
.k-room .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.k-room .c{opacity:.6;font-size:13px;font-family:monospace}
.k-badge{font-size:12px;padding:2px 8px;border-radius:99px;background:#2fb34a}
.k-badge.racing{background:#d98a1f}
.k-badge.ded{background:#5b6fd8}
.k-err{color:#ff9a9a;min-height:1.4em;margin-top:8px}
.k-muted{opacity:.65}
.k-help li{margin:4px 0}
.k-overlay{position:fixed;inset:0;display:none;align-items:flex-start;justify-content:center;padding-top:9vh;box-sizing:border-box;pointer-events:none;color:#fff;text-shadow:0 2px 6px #000}
.k-overlay .k-card{pointer-events:auto;background:rgba(10,16,34,.82);min-width:min(420px,90vw);max-height:80vh;overflow:auto;text-shadow:none}
.k-count{margin-top:12vh;font-size:140px;font-weight:900;text-shadow:0 4px 12px #000}
.k-pl{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.1)}
.k-sw{width:14px;height:14px;border-radius:4px;flex:none}
.k-pl .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k-tag{font-size:12px;opacity:.7}
.k-board{position:fixed;top:56px;right:12px;min-width:150px;font:600 14px system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none;display:none}
.k-board div{display:flex;gap:6px;align-items:center;padding:1px 0}
.k-wait{position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:99px;background:rgba(10,16,34,.8);font:600 15px system-ui,sans-serif;display:none;pointer-events:none}
`,
    }),
  );
}

// ------------------------------------------------------------------ name prompt
/** Modal asking for a player name. Resolves with the trimmed name, or null if dismissed. */
export function askName(initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { class: "k-in", placeholder: "Your name", maxLength: 16, value: initial, style: "width:100%;box-sizing:border-box" });
    const ok = h("button", { class: "k-btn", textContent: "Continue" });
    const cancel = h("button", { class: "k-btn sec", textContent: "Cancel" });
    const msg = h("div", { class: "k-err" });
    const box = h("div", { class: "k-card", style: "width:min(360px,90vw);display:flex;flex-direction:column;gap:12px" }, h("h3", { textContent: "Enter your name" }), h("div", { class: "k-muted", textContent: "Other players will see it in the room." }), input, msg, h("div", { class: "k-row", style: "justify-content:flex-end" }, cancel, ok));
    const back = h("div", { style: "position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,10,.6)" }, box);
    const done = (v: string | null) => {
      back.remove();
      resolve(v);
    };
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        msg.textContent = "Please enter a name.";
        input.focus();
        return;
      }
      safeSet("kart.name", v);
      done(v);
    };
    ok.onclick = submit;
    cancel.onclick = () => done(null);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // don't drive the kart / trigger shortcuts while typing
      if (e.key === "Enter") submit();
      else if (e.key === "Escape") done(null);
    });
    document.body.appendChild(back);
    input.focus();
  });
}

// ------------------------------------------------------------------ home
export interface HomeActions {
  solo(name: string, character: number): void;
  create(name: string, roomName: string, character: number): void;
  join(code: string, name: string, character: number): void;
}

export function createHome(a: HomeActions) {
  const name = h("input", { class: "k-in", placeholder: "Your name", maxLength: 16, value: safeGet("kart.name") ?? "" });
  const roomName = h("input", { class: "k-in", placeholder: "Room name", maxLength: 16, value: safeGet("kart.room") ?? "" });
  const search = h("input", { class: "k-in", placeholder: "Search rooms…", style: "flex:1;min-width:120px" });
  const hideFull = h("input", { type: "checkbox", checked: true });
  const lobbyOnly = h("input", { type: "checkbox" });
  const code = h("input", { class: "k-in", placeholder: "CODE", maxLength: 4, style: "width:80px;text-transform:uppercase;text-align:center" });
  const err = h("div", { class: "k-err" });
  const list = h("div", { class: "k-rooms" });
  const status = h("div", { class: "k-muted", style: "font-size:13px;margin-top:6px" });

  let character = Number(safeGet("kart.char"));
  if (!Number.isInteger(character) || character < 0 || character >= CHARACTERS.length) character = 0;
  const chars = h("div", { class: "k-chars" });
  const detail = h("div", { class: "k-detail" });
  /** Skill sheet for a character: stat bars, top speed, theme and item luck. */
  const showDetail = (id: number) => {
    const c = characterById(id);
    const p = paramsFor(id);
    const rows: [string, number, string][] = [
      ["SPEED", c.stats.speed, `${Math.round(p.maxSpeed * 3.6)} km/h`],
      ["ACCEL", c.stats.accel, `${(p.accel / DEFAULT_PARAMS.accel).toFixed(1)}x`],
      ["HANDLING", c.stats.handling, `${(p.steerRate / DEFAULT_PARAMS.steerRate).toFixed(1)}x`],
      ["TOUGHNESS", c.stats.toughness, `${(Math.round(STUN_TICKS * (1 - 0.15 * (c.stats.toughness - 3))) / 60).toFixed(1)} s spin`],
    ];
    const lucky = c.itemBias.map((b, i) => [i + 1, b] as const).filter(([, b]) => b > 1);
    detail.replaceChildren(
      h("div", { class: "k-dh" }, h("img", { src: portrait(id), alt: c.name, style: `border-color:${hex(c.color)}` }), h("div", {}, h("div", { class: "k-dn", textContent: c.name }), h("span", { class: "k-theme", textContent: c.theme, style: `background:${hex(c.color)};${c.color < 0x404040 ? "color:#fff" : ""}` }))),
      ...rows.map(([label, v, hint]) =>
        h("div", { class: "k-stat" }, h("span", { class: "l", textContent: label }), h("span", { class: "k-bar" }, ...[1, 2, 3, 4, 5].map((n) => h("i", { class: n <= v ? "on" : "" }))), h("span", { class: "v", textContent: hint })),
      ),
      specialBlock(id),
      h("div", { class: "k-luck" }, h("div", { class: "k-muted", textContent: "Item luck" }), ...(lucky.length ? lucky.map(([it, b]) => h("span", { class: "k-chip", textContent: `${ITEM_INFO[it]!.icon} ${ITEM_INFO[it]!.name} ×${b}` })) : [h("span", { class: "k-chip", textContent: "Balanced" })])),
    );
  };
  const tiles = CHARACTERS.map((c) => {
    const b = h("button", { class: "k-char", title: `${c.name} · ${c.theme}` }, h("img", { src: portrait(c.id), alt: c.name, draggable: false }));
    b.onclick = () => {
      character = c.id;
      safeSet("kart.char", String(c.id));
      mark();
    };
    b.onmouseenter = () => showDetail(c.id); // hover = preview
    b.onmouseleave = () => showDetail(character);
    return b;
  });
  const mark = () => {
    tiles.forEach((t, i) => t.classList.toggle("sel", i === character));
    showDetail(character);
  };
  chars.append(...tiles);
  mark();

  const nm = () => {
    const v = name.value.trim() || "Player";
    safeSet("kart.name", name.value.trim());
    return v;
  };
  /** Name for joining/creating: asks in a popup when the field is empty. null = cancelled. */
  const needName = async (): Promise<string | null> => {
    if (name.value.trim()) return nm();
    const v = await askName();
    if (v) name.value = v;
    return v;
  };
  // custom driver photo (own kart's head, front and back; stored locally)
  const headPrev = h("img", { class: "k-hp", alt: "Your photo" });
  const headMsg = h("div", { class: "k-muted", style: "font-size:12px;margin-top:6px" });
  const fileIn = h("input", { type: "file", accept: "image/*", style: "display:none" });
  const camIn = h("input", { type: "file", accept: "image/*", style: "display:none" });
  camIn.setAttribute("capture", "user"); // phones open the selfie camera
  const upBtn = h("button", { class: "k-btn sec", textContent: "Upload" });
  const camBtn = h("button", { class: "k-btn sec", textContent: "Camera" });
  const clrBtn = h("button", { class: "k-btn sec", textContent: "Remove" });
  const syncHead = () => {
    const c = getCustomHead();
    headPrev.style.display = c ? "block" : "none";
    if (c) headPrev.src = c;
    clrBtn.style.display = c ? "" : "none";
    headMsg.textContent = c ? "Your photo is the driver's face (front and back). Saved on this device." : "Optional: use your own face as the driver.";
  };
  onCustomHeadChange(syncHead);
  syncHead();
  const fromFile = async (inp: HTMLInputElement) => {
    const f = inp.files?.[0];
    inp.value = "";
    if (!f) return;
    try {
      await saveHeadFromFile(f);
    } catch {
      headMsg.textContent = "Couldn't read that image.";
    }
  };
  fileIn.onchange = () => void fromFile(fileIn);
  camIn.onchange = () => void fromFile(camIn);
  upBtn.onclick = () => fileIn.click();
  camBtn.onclick = () => void captureHead(() => camIn.click());
  clrBtn.onclick = () => setCustomHead(null);

  const create = h("button", { class: "k-btn", textContent: "Create room" });
  create.onclick = async () => {
    const n = await needName();
    if (!n) return;
    safeSet("kart.room", roomName.value.trim());
    a.create(n, roomName.value.trim() || `${n}'s room`, character);
  };
  const solo = h("button", { class: "k-btn sec", textContent: "Solo practice" });
  solo.onclick = () => a.solo(nm(), character);
  const join = h("button", { class: "k-btn", textContent: "Join" });
  join.onclick = async () => {
    if (!code.value.trim()) return;
    const n = await needName();
    if (n) a.join(code.value.trim().toUpperCase(), n, character);
  };

  let rooms: RoomInfo[] = [];
  let failed = false;
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const shown = rooms.filter(
      (r) => (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)) && (!hideFull.checked || r.players < r.max) && (!lobbyOnly.checked || r.state === "lobby"),
    );
    list.replaceChildren(
      ...shown.map((r) => {
        const b = h("button", { class: "k-btn", textContent: r.players >= r.max ? "Full" : "Join", disabled: r.players >= r.max });
        b.onclick = async () => {
          const n = await needName();
          if (n) a.join(r.code, n, character);
        };
        return h("div", { class: "k-room" }, h("span", { class: "n", textContent: r.name }), h("span", { class: "c", textContent: r.code }), h("span", { class: "k-muted", style: "font-size:12px", textContent: trackDef(r.track ?? 0).name }), h("span", { textContent: `${r.players}/${r.max}` }), h("span", { class: `k-badge ${r.state}`, textContent: r.state === "lobby" ? "lobby" : "racing" }), ...(r.dedicated ? [h("span", { class: "k-badge ded", textContent: "dedicated", title: "Runs on a server: nobody has to keep a tab open" })] : []), b);
      }),
    );
    status.textContent = failed ? "⚠ Can't reach the room server. Is `pnpm dev` running?" : shown.length ? "" : rooms.length ? "No rooms match your filters." : "No open rooms yet. Create one!";
  };
  for (const e of [search, hideFull, lobbyOnly]) e.addEventListener("input", render);

  let timer: number | null = null;
  const poll = async () => {
    try {
      const r = await fetch(ROOMS_URL, { cache: "no-store" });
      rooms = (await r.json()) as RoomInfo[];
      failed = false;
    } catch {
      failed = true;
    }
    render();
  };

  const el = h(
    "div",
    { class: "k-screen" },
    h("img", { class: "k-logo", src: "/art/logo.png", alt: "Global Chaos Kart" }),
    h("div", { class: "k-sub", textContent: "Browser kart racing · up to 8 players · rooms are hosted by players" }),
    h("div", { class: "k-card", style: "width:100%;max-width:1000px;margin-bottom:16px;box-sizing:border-box" }, h("h3", { textContent: "Choose your driver" }), h("div", { class: "k-pick" }, h("div", { style: "flex:1;min-width:0" }, chars, h("div", { class: "k-me" }, name), h("div", { class: "k-dt", textContent: "Custom driver image" }), h("div", { class: "k-me", style: "margin-top:6px" }, headPrev, upBtn, camBtn, clrBtn, fileIn, camIn), headMsg), detail)),
    h(
      "div",
      { class: "k-grid" },
      h(
        "div",
        { class: "k-card" },
        h("h3", { textContent: "Open rooms" }),
        h("div", { class: "k-row" }, search, h("label", { class: "k-muted" }, hideFull, " hide full"), h("label", { class: "k-muted" }, lobbyOnly, " lobby only")),
        list,
        status,
        h("div", { class: "k-row", style: "margin-top:12px" }, h("span", { class: "k-muted", textContent: "Have a code?" }), code, join),
        err,
      ),
      h(
        "div",
        { style: "display:flex;flex-direction:column;gap:16px" },
        h("div", { class: "k-card" }, h("h3", { textContent: "Play" }), h("div", { class: "k-row" }, roomName), h("div", { class: "k-row" }, create, solo)),
        h(
          "div",
          { class: "k-card k-help" },
          h("h3", { textContent: "How it works" }),
          h("ul", { style: "margin:0;padding-left:18px" }, h("li", { textContent: "The player who creates a room hosts it. Keep that tab open and visible." }), h("li", { textContent: "Joining mid-race? You spectate until the next round." }), h("li", { textContent: "Keys: WASD / arrows. Gamepad and touch joystick work too." }), h("li", { textContent: "Esc leaves the room. R = back to last checkpoint." })),
        ),
      ),
    ),
  );
  document.body.appendChild(el);

  return {
    el,
    show() {
      el.style.display = "flex";
      void poll();
      timer ??= window.setInterval(poll, 2500);
    },
    hide() {
      el.style.display = "none";
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    error(msg: string) {
      err.textContent = msg;
    },
    askName: needName,
    prefill(c: string) {
      code.value = c;
    },
  };
}

// ------------------------------------------------------------- in-room UI
export interface RoomActions {
  startRace(): void;
  toLobby(): void;
  restart(): void;
  setCharacter(id: number): void;
  setTrack(id: number): void;
}
export interface RoomCtx {
  mySlot: number;
  isHost: boolean;
  code: string | null;
}

export function createRoomUI(act: RoomActions) {
  const overlay = h("div", { class: "k-overlay" });
  const board = h("div", { class: "k-board" });
  const wait = h("div", { class: "k-wait", textContent: "Round in progress. You're in the queue for the next one" });
  document.body.append(overlay, board, wait);

  const playerRow = (p: PlayerInfo, mySlot: number, showPos: boolean, showTime: boolean) =>
    h(
      "div",
      { class: "k-pl" },
      showPos ? h("b", { textContent: p.pos ? `${p.pos}.` : "–", style: "width:24px" }) : "",
      avatar(p.character),
      h("span", { class: "n", textContent: p.name + (p.slot === mySlot ? " (you)" : "") }),
      p.waiting ? h("span", { class: "k-tag", textContent: "waiting" }) : showTime ? h("span", { class: "k-tag", textContent: p.finishTime >= 0 ? fmt(p.finishTime) : "DNF" }) : "",
    );

  let sig = "";
  return {
    update(v: RoomView, ctx: RoomCtx) {
      const key = JSON.stringify([v.phase, v.trackId, Math.ceil(v.countdown), Math.ceil(v.resultsIn), v.players, v.waiting, v.autoIn === undefined ? null : Math.ceil(v.autoIn), ctx]);
      if (key === sig) return;
      sig = key;

      wait.style.display = v.waiting && v.phase !== Phase.Lobby ? "block" : "none";

      // live standings
      if (v.phase === Phase.Race) {
        const racers = v.players.filter((p) => !p.waiting).sort((a, b) => a.pos - b.pos);
        board.replaceChildren(...racers.map((p) => h("div", {}, h("span", { textContent: `${p.pos}.` }), avatar(p.character, 22), h("span", { textContent: p.name + (p.slot === ctx.mySlot ? " ◀" : "") }))));
        board.style.display = "block";
      } else board.style.display = "none";

      if (v.phase === Phase.Race) {
        overlay.style.display = "none";
      } else if (v.phase === Phase.Countdown) {
        overlay.replaceChildren(h("div", { class: "k-count", textContent: v.countdown > 0 ? String(Math.ceil(v.countdown)) : "GO!" }));
        overlay.style.display = "flex";
      } else if (v.phase === Phase.Lobby) {
        const invite = ctx.code ? `${location.origin}${location.pathname}?join=${ctx.code}` : null;
        const mine = v.players.find((p) => p.slot === ctx.mySlot);
        const pickRow = h(
          "div",
          { class: "k-pickrow" },
          ...CHARACTERS.map((c) => {
            const b = h("button", { class: mine?.character === c.id ? "sel" : "", title: `${c.name} · ${c.theme}` }, avatar(c.id, 34));
            b.onclick = () => act.setCharacter(c.id);
            return b;
          }),
        );
        const trackRow = h(
          "div",
          { class: "k-tracks" },
          ...TRACKS.map((d) => {
            const b = h("button", { class: v.trackId === d.id ? "sel" : "", title: `${d.name}: ${d.blurb}`, disabled: !ctx.isHost }, h("img", { src: trackPreview(d.id), alt: d.name }), h("span", { textContent: d.name }));
            b.onclick = () => act.setTrack(d.id);
            return b;
          }),
        );
        const start = h("button", { class: "k-btn", textContent: v.players.filter((p) => !p.waiting).length > 1 ? "Start race" : "Start race (solo)" });
        start.onclick = act.startRace;
        overlay.replaceChildren(
          h(
            "div",
            { class: "k-card" },
            h("h3", { textContent: ctx.code ? `Lobby · room ${ctx.code}` : "Lobby" }),
            ...(invite ? [h("div", { class: "k-muted", style: "font-size:13px;margin-bottom:8px;word-break:break-all", textContent: `Invite: ${invite}` })] : []),
            ...v.players.map((p) => playerRow(p, ctx.mySlot, false, false)),
            h("div", { class: "k-muted", style: "margin:8px 0 0", textContent: ctx.isHost ? "Track" : `Track: ${trackDef(v.trackId).name} (the host picks)` }),
            trackRow,
            h("div", { class: "k-muted", style: "margin:0 0 2px", textContent: `${v.players.length}/${MAX_PLAYERS} players · pick your driver` }),
            pickRow,
            mine ? specialBlock(mine.character) : "",
            h("div", { style: "height:8px" }),
            ctx.isHost ? start : h("div", { class: "k-muted", textContent: v.autoIn === undefined ? "Waiting for the host to start…" : v.autoIn < 0 ? "Dedicated room · the race starts automatically when 2 players are in" : `Dedicated room · race starts in ${Math.ceil(v.autoIn)} s` }),
          ),
        );
        overlay.style.display = "flex";
      } else {
        const rows = [...v.players].filter((p) => !p.waiting).sort((a, b) => a.pos - b.pos);
        const back = h("button", { class: "k-btn", textContent: "Back to lobby" });
        back.onclick = act.toLobby;
        const again = h("button", { class: "k-btn", textContent: "Restart now" });
        again.onclick = act.restart;
        overlay.replaceChildren(
          h("div", { class: "k-card" }, h("h3", { textContent: "Results" }), ...rows.map((p) => playerRow(p, ctx.mySlot, true, true)), h("div", { class: "k-muted", style: "margin:8px 0", textContent: `Next game starts in ${Math.ceil(v.resultsIn)} s` }), ...(ctx.isHost ? [again, back] : [])),
        );
        overlay.style.display = "flex";
      }
    },
    hide() {
      sig = "";
      overlay.style.display = board.style.display = wait.style.display = "none";
    },
  };
}
