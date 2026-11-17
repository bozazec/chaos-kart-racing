/**
 * Player progression: experience points (XP), Chaos Coins and the store items bought with them, kept on this device only.
 *
 * Tamper protection (client-side, so it deters casual edits, it cannot stop a determined cheater; only a server can):
 *  - the numbers live in localStorage ("kart.progress")
 *  - a per-device HMAC key is generated once and stored in IndexedDB as a NON-extractable CryptoKey
 *  - the HMAC of the stored text is kept in IndexedDB and in a cookie, and refreshed on every save
 *  - on load (and before every save) the localStorage text is re-checked against those proofs; a mismatch means the
 *    progress was edited by hand, so it is wiped and the player gets a popup.
 */
export const XP_PER_COIN = 10;

export interface Progress {
  /** spendable XP */
  xp: number;
  /** lifetime XP earned, drives the level (spending XP never lowers your level) */
  total: number;
  /** Chaos Coins */
  coins: number;
  /** store items: id -> when it runs out (epoch ms) */
  items: Record<string, number>;
  /** latest clock reading saved so far: setting the device clock back can't stretch an item */
  seen: number;
}

const LS_KEY = "kart.progress";
const COOKIE = "kart_sig";
const DB = "kart-progress";
const STORE = "kv";

const zero = (): Progress => ({ xp: 0, total: 0, coins: 0, items: {}, seen: 0 });
let state: Progress = zero();
let ready = false;
let persistent = true; // false when WebCrypto/IndexedDB is unavailable: progress is kept for this session only
let lastRaw: string | null = null;
const listeners = new Set<() => void>();
let chain: Promise<unknown> = Promise.resolve();

export const getProgress = (): Readonly<Progress> => state;
export const progressReady = () => ready;
export const onProgress = (f: () => void) => void listeners.add(f);
const emit = () => listeners.forEach((f) => f());

/** "Now" for store items: the device clock, but never earlier than a time we already saved. */
export const storeNow = () => Math.max(Date.now(), state.seen);
/** When the player's item runs out (epoch ms), or 0 if they don't have it (never bought / expired). */
export const itemExpiry = (id: string): number => {
  const e = state.items[id] ?? 0;
  return e > storeNow() ? e : 0;
};

/** Level from lifetime XP. Level n -> n+1 costs 100 + 50(n-1) XP. */
export function levelFor(total: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(total));
  for (;;) {
    const need = 100 + 50 * (level - 1);
    if (left < need) return { level, into: left, need };
    left -= need;
    level++;
  }
}

// ------------------------------------------------------------------ storage plumbing
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE).objectStore(STORE).get(key);
    q.onsuccess = () => res(q.result as T | undefined);
    q.onerror = () => rej(q.error);
  });
}
async function idbSet(key: string, val: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbDel(key: string): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function getKey(create: boolean): Promise<CryptoKey | null> {
  const k = await idbGet<CryptoKey>("key");
  if (k) return k;
  if (!create) return null;
  const nk = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  await idbSet("key", nk);
  return nk;
}

async function sign(key: CryptoKey, text: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  let s = "";
  sig.forEach((b) => (s += b.toString(16).padStart(2, "0")));
  return s;
}

const readCookie = (): string | null => document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([0-9a-f]+)`))?.[1] ?? null;
const writeCookie = (v: string | null) => {
  document.cookie = v ? `${COOKIE}=${v}; max-age=315360000; path=/; SameSite=Lax` : `${COOKIE}=; max-age=0; path=/`;
};
const cookiesWork = () => {
  try {
    document.cookie = "kart_t=1; path=/; SameSite=Lax";
    const ok = document.cookie.includes("kart_t=1");
    document.cookie = "kart_t=; max-age=0; path=/";
    return ok;
  } catch {
    return false;
  }
};

const lsGet = () => {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
};
const lsSet = (v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, v);
  } catch {
    /* quota / private mode */
  }
};

function parse(raw: string): Progress | null {
  try {
    const o = JSON.parse(raw) as Partial<Progress>;
    const ok = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1e9;
    const time = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
    if (!ok(o.xp) || !ok(o.total) || !ok(o.coins)) return null;
    // saves from before the store have no items
    const items: Record<string, number> = {};
    if (o.items !== undefined) {
      if (typeof o.items !== "object" || o.items === null || Array.isArray(o.items)) return null;
      for (const [k, v] of Object.entries(o.items)) {
        if (!/^[a-z]{1,24}$/.test(k) || !time(v)) return null;
        items[k] = v;
      }
    }
    return { xp: o.xp!, total: o.total!, coins: o.coins!, items, seen: time(o.seen) ? o.seen : 0 };
  } catch {
    return null;
  }
}

type Verdict = "ok" | "fresh" | "tampered";

/** Compare localStorage with the proofs. */
async function verify(raw: string | null): Promise<Verdict> {
  const key = await getKey(false);
  const stored = await idbGet<string>("sig");
  const cookie = cookiesWork() ? readCookie() : (stored ?? null);
  if (raw === null) return "fresh"; // nothing to protect; deleting only loses progress
  if (!key || !stored) return "tampered"; // progress with no proof of ever being written by us
  const want = await sign(key, raw);
  if (want !== stored || want !== cookie || !parse(raw)) return "tampered";
  return "ok";
}

async function persist(): Promise<void> {
  if (!persistent) return;
  state = { ...state, seen: storeNow() };
  const raw = JSON.stringify(state);
  const key = await getKey(true);
  if (!key) return;
  const sig = await sign(key, raw);
  await idbSet("sig", sig);
  writeCookie(sig);
  lsSet(raw);
  lastRaw = raw;
}

async function wipe(): Promise<void> {
  state = zero();
  lsSet(null);
  lastRaw = null;
  try {
    await idbDel("sig");
    writeCookie(null);
    await persist();
  } catch {
    /* ignore */
  }
  emit();
}

function popup() {
  const back = document.createElement("div");
  back.style.cssText = "position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,10,.8);padding:16px";
  const box = document.createElement("div");
  box.className = "k-card";
  box.style.cssText = "max-width:380px;text-align:center;background:#1b1020;border-color:#ff5a4d";
  const h = document.createElement("h3");
  h.textContent = "⚠️ Progress compromised";
  const p = document.createElement("p");
  p.style.cssText = "margin:0 0 14px;line-height:1.4";
  p.textContent = "Your saved experience, coins and store items were changed outside the game, so they can't be trusted. Your progress has been deleted and you start from zero.";
  const b = document.createElement("button");
  b.className = "k-btn";
  b.textContent = "OK";
  b.onclick = () => back.remove();
  box.append(h, p, b);
  back.append(box);
  document.body.append(back);
}

/** Load and verify saved progress. Call once at startup. */
export async function initProgress(): Promise<void> {
  try {
    if (!crypto?.subtle || !indexedDB) throw new Error("no WebCrypto/IndexedDB");
    const raw = lsGet();
    const v = await verify(raw);
    if (v === "tampered") {
      await wipe();
      popup();
    } else if (v === "ok") {
      state = parse(raw!)!;
      lastRaw = raw;
    } else {
      await persist(); // first run (or progress was deleted): start the proof chain
    }
  } catch (e) {
    persistent = false;
    console.warn("progress is not saved on this device (needs HTTPS + IndexedDB)", e);
  }
  ready = true;
  emit();
}

/** Serialised mutation: re-verifies storage first, so a hand edit while the game is open is caught too. */
function mutate(fn: () => void): Promise<void> {
  chain = chain
    .then(async () => {
      if (persistent) {
        const raw = lsGet();
        if (raw !== lastRaw) {
          // changed since our last write: another tab of ours, or a manual edit
          const v = await verify(raw);
          if (v === "tampered") {
            await wipe();
            popup();
          } else if (v === "ok") state = parse(raw!)!;
          else state = zero();
        }
      }
      fn();
      emit();
      await persist();
    })
    .catch((e) => console.warn("progress save failed", e));
  return chain as Promise<void>;
}

export function addXp(n: number): Promise<void> {
  const g = Math.max(0, Math.floor(n));
  if (!ready || g === 0) return Promise.resolve();
  return mutate(() => {
    state = { ...state, xp: state.xp + g, total: state.total + g };
  });
}

/** Spend `count * 10` XP for `count` coins. Resolves false if there isn't enough XP. */
export async function exchangeCoins(count: number): Promise<boolean> {
  const c = Math.floor(count);
  let done = false;
  if (!ready || c <= 0) return false;
  await mutate(() => {
    if (state.xp < c * XP_PER_COIN) return;
    state = { ...state, xp: state.xp - c * XP_PER_COIN, coins: state.coins + c };
    done = true;
  });
  return done;
}

/** Pay `price` coins for an item. Buying one you already have adds the time on top. Resolves false if there aren't enough coins. */
export async function buyItem(id: string, price: number, durationMs: number): Promise<boolean> {
  const cost = Math.floor(price);
  let done = false;
  if (!ready || !(cost >= 0) || !(durationMs > 0)) return false;
  await mutate(() => {
    if (state.coins < cost) return;
    const now = storeNow();
    const items: Record<string, number> = {};
    for (const [k, v] of Object.entries(state.items)) if (v > now) items[k] = v; // expired ones are dropped
    items[id] = Math.max(now, items[id] ?? 0) + durationMs;
    state = { ...state, coins: state.coins - cost, items };
    done = true;
  });
  return done;
}

// ------------------------------------------------------------------ admin (testing)
// Only reachable from the admin hook in main.ts, which exists in dev and VITE_ADMIN=1 builds; a normal production
// build drops these. They go through the same signed save as real earnings, so nothing looks tampered afterwards.
const cap = (n: number) => Math.max(0, Math.min(999_999_999, Math.floor(n) || 0));

/** Add (or, with negative numbers, take away) coins and spendable XP. */
export function adminGrant(coins: number, xp = 0): Promise<void> {
  if (!ready) return Promise.resolve();
  return mutate(() => {
    state = { ...state, coins: cap(state.coins + coins), xp: cap(state.xp + xp), total: cap(state.total + Math.max(0, xp)) };
  });
}

/** Forget every bought item, to test buying again. */
export function adminClearItems(): Promise<void> {
  if (!ready) return Promise.resolve();
  return mutate(() => {
    state = { ...state, items: {} };
  });
}
