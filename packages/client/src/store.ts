import { COSMETICS, type CosmeticDef } from "@kart/shared";
import { buyItem, exchangeCoins, getProgress, itemExpiry, onProgress, progressReady, storeNow, XP_PER_COIN } from "./progress";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bitmask of the store items this player has right now. Items that ran out drop out by themselves. */
export function activeCosmetics(): number {
  let m = 0;
  for (const c of COSMETICS) if (itemExpiry(c.id)) m |= c.bit;
  return m;
}

/** "13d 4h", "5h 12m", "9m" */
const timeLeft = (ms: number) => {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
};

const CSS = `
.k-store{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgba(0,0,10,.72);padding:12px;box-sizing:border-box}
.k-store-box{width:min(940px,100%);max-height:100%;display:flex;flex-direction:column;background:#141c3a;border:1px solid rgba(255,255,255,.18);border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.6);font:600 14px system-ui,sans-serif;color:#fff;overflow:hidden}
.k-store-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:rgba(0,0,0,.25)}
.k-store-top h3{margin:0;font-size:20px;flex:1;white-space:nowrap}
.k-store-bal{padding:6px 12px;border-radius:99px;background:rgba(255,210,63,.16);border:1px solid rgba(255,210,63,.6);white-space:nowrap}
.k-store-x{width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer}
.k-store-ex{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 16px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.1)}
.k-store-ex .k-btn{padding:5px 12px;font-size:13px}
.k-store-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));grid-auto-rows:max-content;gap:12px;padding:14px 16px 16px;overflow:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch}
.k-item{display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.07);border:2px solid rgba(255,255,255,.12)}
.k-item.own{border-color:#35d07f;box-shadow:0 0 12px rgba(53,208,127,.35)}
.k-item-pic{position:relative;flex:none;aspect-ratio:4/3;background:#18224a;display:flex;align-items:center;justify-content:center;font-size:64px;overflow:hidden}
.k-item-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.k-dur{position:absolute;left:8px;bottom:8px;padding:2px 8px;border-radius:99px;background:rgba(0,0,10,.7);font-size:12px;line-height:1.4}
.k-item-body{display:flex;flex-direction:column;gap:6px;padding:10px;flex:1}
.k-item-body b{font-size:15px}
.k-item-body .k-btn{flex:none}
.k-item-body p{margin:0;font-weight:400;font-size:12.5px;line-height:1.35;opacity:.85;flex:1}
.k-item-st{font-size:12px;min-height:16px;color:#7dffb0}
.k-item-st.no{color:#ff9a9a}
.k-store-foot{padding:8px 16px;font-size:12px;font-weight:400;opacity:.65;border-top:1px solid rgba(255,255,255,.1)}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * The Chaos Store: spend coins on kart styling that lasts a set number of days. Purchases are saved with the
 * player's progress (same tamper check). Returns the function that opens / closes it.
 * `thumb` draws an item's picture (null if it can't: the card then shows the item's icon).
 */
export function initStore(thumb: (c: CosmeticDef) => Promise<string | null>): () => void {
  document.head.append(Object.assign(el("style"), { textContent: CSS }));
  let back: HTMLElement | null = null;
  let draw = () => {};
  let tick: number | null = null;

  const close = () => {
    back?.remove();
    back = null;
    if (tick !== null) clearInterval(tick);
    tick = null;
  };

  const open = () => {
    const box = el("div", "k-store-box");
    const bal = el("span", "k-store-bal");
    const x = el("button", "k-store-x", "✕");
    x.title = "Close (Esc)";
    x.onclick = close;
    const top = el("div", "k-store-top");
    top.append(el("h3", "", "🛒 Chaos Store"), bal, x);

    // coins come from XP: the exchange is right here so nobody has to leave the store to afford something
    const ex = el("div", "k-store-ex");
    const exInfo = el("span");
    const exBtns = [1, 10, Infinity].map((n) => {
      const b = el("button", "k-btn sec", n === Infinity ? "All" : `+${n} 🪙`);
      b.onclick = () => {
        void exchangeCoins(n === Infinity ? Math.floor(getProgress().xp / XP_PER_COIN) : n);
        b.blur();
      };
      return { b, n };
    });
    ex.append(exInfo, ...exBtns.map((e) => e.b));

    const grid = el("div", "k-store-grid");
    let flash: { id: string; text: string; bad: boolean; until: number } | null = null; // "Purchased!" on a card for a moment
    const cards = COSMETICS.map((c) => {
      const card = el("div", "k-item");
      const pic = el("div", "k-item-pic", c.icon);
      const img = el("img");
      img.alt = c.name;
      img.style.display = "none";
      void thumb(c).then((u) => {
        if (!u) return;
        img.src = u;
        img.style.display = "";
      });
      pic.append(img, el("span", "k-dur", `⏳ ${c.days} days`)); // the price is on the button
      const body = el("div", "k-item-body");
      const st = el("div", "k-item-st");
      const buy = el("button", "k-btn");
      buy.onclick = async () => {
        buy.blur();
        buy.disabled = true;
        const ok = await buyItem(c.id, c.price, c.days * DAY_MS);
        flash = { id: c.id, text: ok ? "Purchased!" : "Not enough coins", bad: !ok, until: performance.now() + 2000 };
        draw();
        setTimeout(draw, 2100);
      };
      body.append(el("b", "", `${c.icon} ${c.name}`), el("p", "", c.desc), st, buy);
      card.append(pic, body);
      grid.append(card);
      return { c, card, st, buy };
    });
    draw = () => {
      const p = getProgress();
      const ready = progressReady();
      bal.textContent = `🪙 ${p.coins} coins`;
      const can = Math.floor(p.xp / XP_PER_COIN);
      exInfo.textContent = `⭐ ${p.xp} XP · ${XP_PER_COIN} XP = 1 coin`;
      for (const { b, n } of exBtns) b.disabled = !ready || (n === Infinity ? can < 1 : can < n);
      for (const { c, card, st, buy } of cards) {
        const until = itemExpiry(c.id);
        card.classList.toggle("own", until > 0);
        const f = flash && flash.id === c.id && performance.now() < flash.until ? flash : null;
        st.textContent = f ? f.text : until ? `✔ Active · ${timeLeft(until - storeNow())} left` : "";
        st.classList.toggle("no", !!f?.bad);
        buy.textContent = until ? `Extend · 🪙 ${c.price}` : `Buy · 🪙 ${c.price}`;
        buy.title = until ? `Adds ${c.days} more days` : "";
        buy.disabled = !ready || p.coins < c.price;
        if (p.coins < c.price) buy.title = `You need ${c.price - p.coins} more coins`;
      }
    };

    box.append(top, ex, grid, el("div", "k-store-foot", "Items are for looks only: they never change how your kart drives. Everyone in your room sees them. Saved on this device."));
    back = el("div", "k-store");
    back.append(box);
    back.onpointerdown = (e) => {
      if (e.target === back) close(); // click outside the box
    };
    document.body.append(back);
    draw();
    tick = window.setInterval(draw, 30000); // "time left" keeps counting while the store is open
  };

  onProgress(() => back && draw());
  // Esc closes the store instead of leaving the room
  addEventListener(
    "keydown",
    (e) => {
      if (!back || e.code !== "Escape") return;
      e.stopImmediatePropagation();
      close();
    },
    true,
  );
  return () => (back ? close() : open());
}
