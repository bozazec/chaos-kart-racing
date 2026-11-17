import { exchangeCoins, getProgress, levelFor, onProgress, progressReady, XP_PER_COIN } from "./progress";

/** Top-right XP + Chaos Coin counters (left of the music button): XP opens the exchange, coins open the store. Also shows "+5 Overtake" toasts. */
export function initProgressHud(openStore: () => void): (xp: number, why: string) => void {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;top:12px;right:60px;z-index:60;display:flex;gap:8px;align-items:center;font:700 14px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000";
  const chip = (title: string) => {
    const b = document.createElement("button");
    b.style.cssText = "height:38px;padding:0 12px;border-radius:19px;border:2px solid rgba(255,255,255,.55);background:rgba(10,16,34,.6);color:#fff;font:inherit;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap";
    b.title = title;
    return b;
  };
  const xpChip = chip("Experience points. Click to exchange for Chaos Coins");
  const coinChip = chip("Chaos Coins. Click to open the store");
  wrap.append(xpChip, coinChip);
  const toasts = document.createElement("div");
  toasts.style.cssText = "position:fixed;top:146px;right:12px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:4px;pointer-events:none;font:800 15px system-ui,sans-serif;color:#ffd23f;text-shadow:0 1px 4px #000";
  document.body.append(wrap, toasts);

  const bar = (into: number, need: number) => `<span style="display:inline-block;width:46px;height:6px;border-radius:3px;background:rgba(255,255,255,.25);overflow:hidden"><span style="display:block;height:100%;width:${Math.round((into / need) * 100)}%;background:#ffd23f"></span></span>`;
  const render = () => {
    if (!progressReady()) return;
    const p = getProgress();
    const lv = levelFor(p.total);
    xpChip.innerHTML = `⭐ Lv ${lv.level} · ${p.xp} XP ${bar(lv.into, lv.need)}`;
    coinChip.innerHTML = `🪙 ${p.coins}`;
  };
  onProgress(render);
  render();

  let open: HTMLElement | null = null;
  let redraw = () => {};
  onProgress(() => open && redraw());
  const exchange = () => {
    if (open) return open.remove(), (open = null), undefined;
    const box = document.createElement("div");
    box.className = "k-card";
    box.style.cssText = "position:fixed;top:56px;right:12px;z-index:70;width:260px;background:rgba(10,16,34,.95);font:600 14px system-ui,sans-serif;color:#fff";
    const draw = () => {
      const p = getProgress();
      const max = Math.floor(p.xp / XP_PER_COIN);
      box.innerHTML = `<h3>🪙 Chaos Coins</h3><div style="margin-bottom:10px;line-height:1.4">${XP_PER_COIN} XP = 1 coin.<br>You have <b>${p.xp} XP</b> and <b>${p.coins} coins</b>.<br><small style="opacity:.7">Spend coins in the store: click 🪙.</small></div>`;
      const row = document.createElement("div");
      row.className = "k-row";
      const mk = (txt: string, n: number) => {
        const b = document.createElement("button");
        b.className = "k-btn" + (n === 0 ? " sec" : "");
        b.textContent = txt;
        b.disabled = n > 0 && max < n;
        b.onclick = () => {
          if (n === 0) {
            open?.remove();
            open = null;
          } else void exchangeCoins(n === Infinity ? max : n);
          b.blur();
        };
        return b;
      };
      row.append(mk("+1", 1), mk("+10", 10), mk("All", max > 0 ? Infinity : 1), mk("Close", 0));
      box.append(row);
    };
    redraw = draw;
    draw();
    document.body.append(box);
    open = box;
  };
  xpChip.onclick = () => {
    exchange();
    xpChip.blur();
  };
  coinChip.onclick = () => {
    if (open) exchange(); // the store has its own exchange row
    openStore();
    coinChip.blur();
  };

  return (xp, why) => {
    const t = document.createElement("div");
    t.textContent = `+${xp} XP · ${why}`;
    t.style.cssText = "transition:opacity .6s, transform .6s;opacity:1";
    toasts.append(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(-8px)";
    }, 1800);
    setTimeout(() => t.remove(), 2500);
  };
}
