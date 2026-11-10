import * as THREE from "three";
import { buildTrackById, characterById, cleanTrackId, Phase, SPECIAL_CD, trackDef, trackTiles, type Track } from "@kart/shared";
import { buildItemBox, buildKartMesh, loadKartModel, buildDrone, buildExplosion, buildMissile, buildOil, buildTrackMesh, makeNameplate, setKartEffects, updateKartLook } from "./scene";
import { buildScenery } from "./scenery";
import { buildKitProps, buildKitRoad, kitReady, loadProps } from "./props";
import { Minimap } from "./minimap";
import type { Session } from "./session";
import { HostSession } from "./net/host";
import { ClientSession } from "./net/client";
import { requestReset } from "./input";
import { isTouchDevice, setTouchControlsVisible, setTouchItem, setTouchSpecial } from "./touch";
import { getCustomHead } from "./customhead";
import { askName, createHome, createRoomUI, injectStyles, ITEM_INFO, safeGet, safeSet } from "./ui";

let track: Track = buildTrackById(0);

injectStyles();
// Phones: no MSAA and a lower pixel-ratio cap. Frame time is also watched below and resolution is lowered if needed.
const renderer = new THREE.WebGLRenderer({ antialias: !isTouchDevice, powerPreference: "high-performance" });
const maxRatio = isTouchDevice ? 1.5 : 2;
let pixelRatio = Math.min(devicePixelRatio, maxRatio);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 120, 400);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 800);
const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(50, 100, 30);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x4a8f3a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// ---- track scene: rebuilt whenever the room's track changes ----
const minimap = new Minimap();
if (isTouchDevice) minimap.compact(true);
let trackGroup: THREE.Group | null = null;
let boxMeshes: THREE.Group[] = []; // item boxes live on the track; the session says which are available
let shownTrack = -1;
function applyTrack(id: number) {
  const def = trackDef(id);
  track = buildTrackById(id);
  shownTrack = id;
  if (trackGroup) scene.remove(trackGroup);
  for (const m of boxMeshes) scene.remove(m);
  trackGroup = buildTrackMesh(track, def.theme, kitReady());
  if (kitReady()) trackGroup.add(buildKitRoad(trackTiles(id), def.tile));
  trackGroup.add(buildScenery(track, def.scenery, !!def.theme.glow));
  trackGroup.add(buildKitProps(track, !!def.theme.glow));
  scene.add(trackGroup);
  boxMeshes = track.itemBoxes.map((b) => {
    const m = buildItemBox();
    m.position.x = b.x;
    m.position.z = b.z;
    scene.add(m);
    return m;
  });
  scene.background = new THREE.Color(def.theme.sky);
  scene.fog = new THREE.Fog(def.theme.fog, 120, def.theme.glow ? 320 : 400);
  (ground.material as THREE.MeshStandardMaterial).color.setHex(def.theme.ground);
  hemi.intensity = def.theme.glow ? 0.75 : 1.3; // night track
  sun.intensity = def.theme.glow ? 0.4 : 1.2;
  minimap.setTrack(track);
  camInit = false; // don't swoop the camera across the map
}
const objMeshes = new Map<number, THREE.Object3D>();
const objLast = new Map<number, { x: number; z: number; type: number; y: number }>();
const blasts: THREE.Mesh[] = [];
const DRONE_Y = 6.5; // about 5 car heights above the track

const karts = new Map<number, THREE.Group>();
const kartChar = new Map<number, number>();
const kartHead = new Map<number, string | null>(); // custom head image each built kart uses (own kart only)
const plates = new Map<number, { key: string; sprite: THREE.Sprite }>();
function kartFor(slot: number) {
  let m = karts.get(slot);
  if (!m) {
    const head = slot === session?.mySlot ? getCustomHead() : null;
    kartHead.set(slot, head);
    m = buildKartMesh(kartChar.get(slot) ?? 0, head);
    scene.add(m);
    karts.set(slot, m);
  }
  return m;
}

// ---- HUD + overlays ----
const hud = document.createElement("div");
hud.style.cssText = "position:fixed;top:12px;left:12px;color:#fff;font:600 18px/1.4 system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none;white-space:pre";
document.body.appendChild(hud);
const banner = document.createElement("div");
banner.style.cssText = "position:fixed;left:0;right:0;bottom:18%;display:none;justify-content:center;color:#fff;font:700 40px system-ui,sans-serif;text-shadow:0 2px 6px #000;text-align:center;white-space:pre;pointer-events:none";
document.body.appendChild(banner);
const itemSlot = document.createElement("div");
itemSlot.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);min-width:84px;height:84px;padding:0 10px;box-sizing:border-box;border-radius:16px;background:rgba(10,16,34,.6);border:2px solid rgba(255,255,255,.4);color:#fff;font:700 13px system-ui,sans-serif;display:none;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-shadow:0 1px 3px #000";
document.body.appendChild(itemSlot);
let itemShown = -1;
const spSlot = document.createElement("div");
spSlot.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);width:min(260px,60vw);height:38px;border-radius:12px;background:rgba(10,16,34,.6);border:2px solid rgba(160,230,255,.6);color:#fff;font:700 14px system-ui,sans-serif;display:none;align-items:center;justify-content:center;pointer-events:none;text-shadow:0 1px 3px #000;overflow:hidden";
const spFill = document.createElement("div");
spFill.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(120,220,255,.35)";
const spText = document.createElement("div");
spText.style.cssText = "position:relative";
spSlot.append(spFill, spText);
document.body.appendChild(spSlot);
let spShown = "";
const leaveBtn = document.createElement("button");
leaveBtn.textContent = "Leave (Esc)";
leaveBtn.style.cssText = "position:fixed;top:12px;right:12px;display:none;padding:8px 16px;font:600 15px system-ui,sans-serif;cursor:pointer;border-radius:8px;border:0;z-index:5";
document.body.appendChild(leaveBtn);
const restartBtn = document.createElement("button");
restartBtn.textContent = "Restart";
restartBtn.style.cssText = "position:fixed;top:12px;right:140px;display:none;padding:8px 16px;font:600 15px system-ui,sans-serif;cursor:pointer;border-radius:8px;border:0;z-index:5";
restartBtn.addEventListener("click", () => session?.restart?.());
document.body.appendChild(restartBtn);

const resetBtn = document.createElement("button");
resetBtn.textContent = "↺ Checkpoint (R)";
resetBtn.title = "Back to the last checkpoint";
resetBtn.style.cssText = "position:fixed;top:56px;right:12px;display:none;padding:8px 16px;font:600 15px system-ui,sans-serif;cursor:pointer;border-radius:8px;border:0;z-index:5";
resetBtn.addEventListener("click", requestReset);
document.body.appendChild(resetBtn);
const wrongWay = document.createElement("div");
wrongWay.textContent = "⚠ Wrong direction!";
wrongWay.style.cssText = "position:fixed;left:0;right:0;top:22%;display:none;justify-content:center;color:#ff5a4d;font:800 44px system-ui,sans-serif;text-shadow:0 2px 8px #000,0 0 18px rgba(255,60,40,.6);pointer-events:none;text-align:center";
document.body.appendChild(wrongWay);
let wrongT = 0;

const camPos = new THREE.Vector3();
let camInit = false;
let session: Session | null = null;
// test/debug hook
(window as unknown as Record<string, unknown>).__kart = { get track() { return track; }, get session() { return session; } };
applyTrack(0);
// kit props load in the background; rebuild the scene dressing once they are in
void loadProps().then(() => applyTrack(shownTrack));

const roomUI = createRoomUI({
  startRace: () => session?.startRace?.(),
  toLobby: () => session?.toLobby?.(),
  restart: () => session?.restart?.(),
  setCharacter: (id) => {
    session?.setCharacter?.(id);
    safeSet("kart.char", String(id));
  },
  setTrack: (id) => {
    session?.setTrack?.(id);
    safeSet("kart.track", String(id));
  },
});

const home = createHome({
  solo: (name, character) => void start("solo", { name, character }),
  create: (name, roomName, character) => void start("host", { name, roomName, character }),
  join: (code, name, character) => void start("join", { name, code, character }),
});
home.show();

async function start(kind: "solo" | "host" | "join", o: { name: string; character: number; roomName?: string; code?: string }) {
  await Promise.all([loadKartModel(), loadProps()]);
  home.error(kind === "solo" ? "" : "connecting…");
  try {
    if (kind === "join") {
      session = await ClientSession.join(o.code!, { name: o.name, character: o.character, forceRelay: new URLSearchParams(location.search).has("relay") });
    } else {
      const h = new HostSession(cleanTrackId(Number(safeGet("kart.track"))), o.name, o.character);
      session = h;
      if (kind === "host") await h.listen(o.roomName ?? "Kart room");
    }
    home.hide();
    leaveBtn.style.display = "block";
    resetBtn.style.display = "block";
    restartBtn.style.display = session.restart ? "block" : "none";
    setTouchControlsVisible(true);
    document.title = kind === "host" ? "Hosting · Kart" : "Kart";
  } catch (e) {
    session?.dispose();
    session = null;
    home.error(e instanceof Error ? e.message : String(e));
  }
}

function leave() {
  if (!session) return;
  session.dispose();
  session = null;
  for (const m of karts.values()) scene.remove(m);
  karts.clear();
  kartChar.clear();
  plates.clear();
  minimap.show(false);
  for (const m of objMeshes.values()) scene.remove(m);
  objMeshes.clear();
  objLast.clear();
  itemSlot.style.display = "none";
  spSlot.style.display = "none";
  spShown = "";
  itemShown = -1;
  setTouchItem("");
  camInit = false;
  hud.textContent = "";
  banner.style.display = "none";
  leaveBtn.style.display = "none";
  resetBtn.style.display = "none";
  wrongWay.style.display = "none";
  wrongT = 0;
  restartBtn.style.display = "none";
  roomUI.hide();
  setTouchControlsVisible(false);
  document.title = "Kart";
  history.replaceState(null, "", location.pathname);
  home.error("");
  home.show();
}
leaveBtn.addEventListener("click", leave);
addEventListener("keydown", (e) => {
  if (e.code === "Escape") leave();
  if (e.code === "KeyL") session?.toLobby?.();
});

// host tab hidden => sim still runs (worker) but rendering/input stop: warn via title
document.addEventListener("visibilitychange", () => {
  if (session?.isHost && session.roomCode) document.title = document.hidden ? "⚠ Hosting: keep this tab visible" : "Hosting · Kart";
});

const urlJoin = new URLSearchParams(location.search).get("join");
if (urlJoin) {
  home.prefill(urlJoin);
  void (async () => {
    const n = safeGet("kart.name")?.trim() || (await askName());
    if (n) void start("join", { name: n, character: Number(safeGet("kart.char")) || 0, code: urlJoin.toUpperCase() });
  })();
}

// ---- render loop ----
let lastFrame = performance.now();
let slowFrames = 0;
let fastFrames = 0;
/** Adaptive resolution: ~120 slow frames in a row (<~35 fps) -> -20% pixel ratio; recover slowly when fast. */
function adaptResolution(dtMs: number) {
  if (dtMs > 28) {
    slowFrames++;
    fastFrames = 0;
  } else if (dtMs < 20) {
    fastFrames++;
    slowFrames = Math.max(0, slowFrames - 1);
  }
  const next = slowFrames > 120 ? Math.max(0.6, pixelRatio * 0.8) : fastFrames > 600 ? Math.min(Math.min(devicePixelRatio, maxRatio), pixelRatio * 1.15) : pixelRatio;
  if (next !== pixelRatio) {
    pixelRatio = next;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    slowFrames = fastFrames = 0;
  }
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  if (session) adaptResolution(now - lastFrame);
  lastFrame = now;
  if (session?.closedReason) {
    const reason = session.closedReason;
    leave();
    home.error(`⚠ ${reason}`);
  }
  if (session) {
    session.update(now);
    if (session.trackId() !== shownTrack) applyTrack(session.trackId());
    const rv = session.room();
    // character changed (lobby switch / new player): rebuild that kart in the new style
    for (const p of rv.players) {
      const wantHead = p.slot === session.mySlot ? getCustomHead() : null;
      if (kartChar.get(p.slot) !== p.character || (karts.has(p.slot) && kartHead.get(p.slot) !== wantHead)) {
        kartChar.set(p.slot, p.character);
        const km = karts.get(p.slot);
        if (km) {
          scene.remove(km);
          karts.delete(p.slot);
          plates.delete(p.slot);
        }
      }
    }
    const info = new Map(rv.players.map((p) => [p.slot, p]));
    const rendered = session.render(now);
    const present = new Set<number>();
    let focus = null as { x: number; z: number; heading: number } | null;
    let boosting = false;
    const t = now / 1000;
    const wv = session.world(now);
    boxMeshes.forEach((m, i) => {
      m.visible = ((wv.boxMask >>> i) & 1) === 1;
      m.rotation.y = t * 2;
      m.position.y = 1.4 + Math.sin(t * 3 + i) * 0.25;
    });
    const seen = new Set<number>();
    for (const o of wv.objects) {
      seen.add(o.id);
      let m = objMeshes.get(o.id);
      if (!m) {
        m = o.type === 3 ? buildMissile() : o.type === 5 ? buildDrone() : buildOil();
        scene.add(m);
        objMeshes.set(o.id, m);
      }
      m.position.x = o.x;
      m.position.z = o.z;
      const last = objLast.get(o.id);
      if ((o.type === 3 || o.type === 5) && last && (o.x !== last.x || o.z !== last.z)) m.rotation.y = Math.atan2(o.x - last.x, o.z - last.z);
      if (o.type === 5) {
        m.position.y = DRONE_Y;
        const prop = m.userData.prop as THREE.Object3D | undefined;
        if (prop) prop.rotation.z += 1.5;
      }
      objLast.set(o.id, { x: o.x, z: o.z, type: o.type, y: o.type === 5 ? DRONE_Y : 0.9 });
    }
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i]!;
      const a = (b.userData.age += dt);
      b.scale.setScalar(0.6 + a * 9);
      (b.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - a * 2.2);
      if (a > 0.4) {
        scene.remove(b);
        blasts.splice(i, 1);
      }
    }
    for (const [id, m] of objMeshes) {
      if (!seen.has(id)) {
        scene.remove(m);
        objMeshes.delete(id);
        const gone = objLast.get(id);
        if (gone && (gone.type === 3 || gone.type === 5)) {
          // missile/drone is gone: it hit something
          const b = buildExplosion();
          b.position.set(gone.x, gone.type === 5 ? 1.5 : gone.y, gone.z);
          scene.add(b);
          blasts.push(b);
        }
        objLast.delete(id);
      }
    }
    for (const k of rendered) {
      const m = kartFor(k.slot);
      m.position.set(k.x, 0, k.z);
      m.rotation.y = k.heading;
      setKartEffects(m, k, t);
      // floating portrait + name (hidden on your own kart: it would sit in your camera)
      const pi = info.get(k.slot);
      const plateKey = `${pi?.name ?? ""}|${pi?.character ?? 0}`;
      let pl = plates.get(k.slot);
      if (!pl || pl.key !== plateKey) {
        if (pl) m.remove(pl.sprite);
        pl = { key: plateKey, sprite: makeNameplate(pi?.name ?? "", pi?.character ?? 0) };
        m.add(pl.sprite);
        plates.set(k.slot, pl);
      }
      pl.sprite.visible = k.slot !== session.mySlot;
      present.add(k.slot);
      if (k.slot === session.mySlot) {
        focus = k;
        boosting = !!k.boosting;
      }
    }
    focus ??= rendered[0] ?? null; // spectate while waiting for next round
    for (const [slot, m] of karts) {
      if (!present.has(slot)) {
        scene.remove(m);
        karts.delete(slot);
        plates.delete(slot);
      }
    }
    minimap.show(true);
    minimap.update(rendered.map((k) => ({ x: k.x, z: k.z, color: "#" + characterById(kartChar.get(k.slot) ?? 0).color.toString(16).padStart(6, "0"), me: k.slot === session!.mySlot })));
    if (focus) {
      const fx = Math.sin(focus.heading);
      const fz = Math.cos(focus.heading);
      const target = new THREE.Vector3(focus.x - fx * 9, 4.5, focus.z - fz * 9);
      if (!camInit) {
        camPos.copy(target);
        camInit = true;
      }
      camPos.lerp(target, 1 - Math.exp(-6 * dt));
      camera.position.copy(camPos);
      camera.lookAt(focus.x + fx * 5, 1, focus.z + fz * 5);
      const fov = boosting ? 80 : 65;
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov += (fov - camera.fov) * (1 - Math.exp(-8 * dt));
        camera.updateProjectionMatrix();
      }
    }

    for (const km of karts.values()) updateKartLook(km, camera.position);
    roomUI.update(rv, { mySlot: session.mySlot, isHost: session.isHost, code: session.roomCode });
    const h = session.hud();
    const st = h.me;
    const heldItem = st && !rv.waiting && rv.phase === Phase.Race ? st.item : -1;
    if (heldItem !== itemShown) {
      itemShown = heldItem;
      const info = ITEM_INFO[heldItem];
      itemSlot.style.display = heldItem < 0 ? "none" : "flex";
      itemSlot.replaceChildren(
        ...(info
          ? [Object.assign(document.createElement("div"), { textContent: info.icon, style: "font-size:40px;line-height:1" }), Object.assign(document.createElement("div"), { textContent: isTouchDevice ? info.name : `${info.name} · Space` })]
          : [Object.assign(document.createElement("div"), { textContent: "ITEM", style: "opacity:.5" })]),
      );
      setTouchItem(info?.icon ?? "");
    }
    // character special: meter on desktop, ring on the touch button
    const me = rv.players.find((p) => p.slot === session!.mySlot);
    if (st && me && !rv.waiting && rv.phase === Phase.Race) {
      const sp = characterById(me.character).special;
      const charge = 1 - Math.min(1, st.spCd / SPECIAL_CD);
      const ready = st.spCd === 0;
      const key = `${me.character}|${Math.round(charge * 50)}|${ready}`;
      if (key !== spShown) {
        spShown = key;
        spFill.style.width = `${Math.round(charge * 100)}%`;
        spText.textContent = ready ? `${sp.icon} ${sp.name} · READY${isTouchDevice ? "" : " (E)"}` : `${sp.icon} ${sp.name} · ${Math.ceil(st.spCd / 60)} s`;
        setTouchSpecial(sp.icon, ready ? 1 : charge);
      }
      spSlot.style.display = isTouchDevice ? "none" : "flex";
    } else {
      spSlot.style.display = "none";
      spShown = "";
    }
    const mine = rv.players.find((p) => p.slot === session!.mySlot);
    const keys = isTouchDevice ? "Joystick: drive · ITEM · ★ special · ↺ checkpoint" : "WASD/arrows · Space item · E special" + (session.isHost ? " · L lobby" : "") + " · R checkpoint";
    if (st && !rv.waiting) {
      const pos = rv.phase === Phase.Race || rv.phase === Phase.Results ? `Pos ${mine?.pos || "–"}/${rv.players.filter((p) => !p.waiting).length}\n` : "";
      hud.textContent = `${pos}Lap ${Math.min(st.lap + 1, track.laps)}/${track.laps}\n${(Math.abs(st.speed) * 3.6).toFixed(0)} km/h${st.offTrack ? "  (off track)" : ""}\n${h.raceTime.toFixed(2)} s${st.shield ? `\n🛡 Shield ${Math.ceil(st.shieldT / 60)} s` : ""}\n${h.info}\n${keys}`;
    } else hud.textContent = `${h.info}\n${keys}`;
    // driving against the track for 2 s -> warning
    let backwards = false;
    if (st && !rv.waiting && rv.phase === Phase.Race && !st.finished && st.stunT === 0 && Math.abs(st.speed) > 3) {
      const a = track.points[st.segIdx]!;
      const b = track.points[(st.segIdx + 1) % track.points.length]!;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const dir = Math.sign(st.speed);
      backwards = ((Math.sin(st.heading) * (b.x - a.x) + Math.cos(st.heading) * (b.z - a.z)) / l) * dir < -0.3;
    }
    wrongT = backwards ? wrongT + dt : 0;
    wrongWay.style.display = wrongT > 2 ? "flex" : "none";
    if (st?.finished && rv.phase === Phase.Race) {
      banner.style.display = "flex";
      banner.textContent = `Finished! ${h.raceTime.toFixed(2)} s`;
    } else banner.style.display = "none";
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
