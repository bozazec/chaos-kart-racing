import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { characterById, type Track, type TrackTheme } from "@kart/shared";

export function buildTrackMesh(track: Track, theme: TrackTheme, roadless = false): THREE.Group {
  const g = new THREE.Group();
  const n = track.points.length;
  const hw = track.halfWidth;

  const ribbon = (half: number, y: number, color: number, glow = false) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = track.points[i % n]!;
      const b = track.points[(i + 1) % n]!;
      const pr = track.points[(i - 1 + n) % n]!;
      // smoothed tangent
      let tx = b.x - pr.x;
      let tz = b.z - pr.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const nx = -tz;
      const nz = tx;
      pos.push(a.x + nx * half, y, a.z + nz * half, a.x - nx * half, y, a.z - nz * half);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, ...(glow ? { emissive: color, emissiveIntensity: 0.9 } : {}) }));
    return m;
  };

  if (!roadless) {
    g.add(ribbon(hw + 1.2, 0.02, theme.kerb, !!theme.glow)); // kerb/border
    g.add(ribbon(hw, 0.04, theme.road)); // asphalt
  }

  // start/finish line
  const p0 = track.points[0]!;
  // same smoothed tangent as the ribbon, so the line sits square across the road
  const pPrev = track.points[n - 1]!;
  const pNext = track.points[1]!;
  const lineHeading = Math.atan2(pNext.x - pPrev.x, pNext.z - pPrev.z);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.5), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  line.rotation.x = -Math.PI / 2; // lay flat; the z spin (applied first, in the plane) then aims the long side across the road
  line.rotation.z = lineHeading;
  line.position.set(p0.x, 0.09, p0.z);
  g.add(line);

  // checkpoint-less centre dashes for orientation
  const dashGeo = new THREE.PlaneGeometry(0.4, 2);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf5d442 });
  for (let i = 0; i < n && !roadless; i += 2) {
    const a = track.points[i]!;
    const b = track.points[(i + 1) % n]!;
    const pr = track.points[(i - 1 + n) % n]!;
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = Math.atan2(b.x - pr.x, b.z - pr.z);
    d.position.set(a.x, 0.06, a.z);
    g.add(d);
  }
  return g;
}

const mat = (color: number, metal = false) => new THREE.MeshStandardMaterial({ color, metalness: metal ? 0.75 : 0.1, roughness: metal ? 0.3 : 0.7 });
const box = (w: number, h: number, l: number, color: number, x = 0, y = 0, z = 0, metal = false) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat(color, metal));
  m.position.set(x, y, z);
  return m;
};

const texLoader = new THREE.TextureLoader();
const kartTex = new Map<string, THREE.Texture>();
/** Driver art from the roster sheet (see scripts/extract-kart-art.sh). */
function kartTexture(id: number, view: "f" | "b"): THREE.Texture {
  const url = `/art/karts/k${id}${view}.png`;
  let t = kartTex.get(url);
  if (!t) {
    t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    kartTex.set(url, t);
  }
  return t;
}

// ---- Kenney "Racing Kit" race car (CC0), recoloured per character. Falls back to the sprite kart if it can't load. ----
let kartModel: THREE.Object3D | null = null;
const KART_SCALE = 2.5;
let modelLoad: Promise<void> | null = null;
export function loadKartModel(): Promise<void> {
  modelLoad ??= new GLTFLoader()
    .loadAsync("/models/kart.glb")
    .then((gltf) => {
      // recentre on the origin (the model's root node is offset) and sit the wheels on y = 0
      const pivot = new THREE.Group();
      pivot.add(gltf.scene);
      pivot.scale.setScalar(KART_SCALE);
      pivot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pivot);
      gltf.scene.position.set(-(box.min.x + box.max.x) / 2 / KART_SCALE, -box.min.y / KART_SCALE, -(box.min.z + box.max.z) / 2 / KART_SCALE);
      kartModel = pivot;
    })
    .catch((e) => console.warn("kart model failed to load, using fallback", e));
  return modelLoad;
}

/** Recoloured copy of the car + a chibi 3D driver in the character's colours. Faces +z. */
const headTex = new Map<number, THREE.CanvasTexture>();
const HEAD_ZOOM = 0.9; // < 1 zooms the art in so the head outline reaches the edge of the ball
/**
 * One texture for the whole head ball: left half = face, right half = back of head (roster art), over a skin/hair
 * fill that shows at the sides. Vertex UVs project each half straight along z (see build3DKart).
 */
function headTexture(id: number, custom?: string | null): THREE.CanvasTexture {
  let t = custom ? undefined : headTex.get(id);
  if (t) return t;
  const { skin, hair } = characterById(id).kart;
  const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 256;
  const ctx = cv.getContext("2d")!;
  const base = () => {
    ctx.fillStyle = css(skin);
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = css(hair);
    ctx.fillRect(0, 0, 512, 90);
  };
  base();
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (custom) {
    // player's own photo: same image on the front and the back half
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 256, 256);
      ctx.drawImage(img, 256, 0, 256, 256);
      t!.needsUpdate = true;
    };
    img.src = custom;
    return t;
  }
  headTex.set(id, t);
  (["f", "b"] as const).forEach((v, i) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, i * 256, 0, 256, 256);
      t!.needsUpdate = true;
    };
    img.src = `/art/heads/h${id}${v}.png`;
  });
  return t;
}

function headBall(id: number, custom?: string | null): THREE.Mesh {
  const R = 0.46;
  const geo = new THREE.SphereGeometry(R, 32, 24);
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const front = pos.getZ(i) >= 0;
    const u = (front ? pos.getX(i) : -pos.getX(i)) / R;
    const v = pos.getY(i) / R;
    uv.setXY(i, ((u * HEAD_ZOOM * 0.5 + 0.5) * 0.5) + (front ? 0 : 0.5), v * HEAD_ZOOM * 0.5 + 0.5);
  }
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: headTexture(id, custom), roughness: 0.8, metalness: 0 }));
  m.position.y = 0.98;
  return m;
}

function build3DKart(g: THREE.Group, characterId: number, customHead?: string | null) {
  const { body: bodyC, accent, trim, skin, hair, metal } = characterById(characterId).kart;
  const car = kartModel!.clone(true);
  const mats = new Map<string, THREE.Material>();
  car.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    let c = mats.get(src.name);
    if (!c) {
      const n = src.clone();
      if (src.name === "red") {
        n.color.setHex(bodyC);
        if (metal) {
          n.metalness = 0.55;
          n.roughness = 0.35;
        }
      } else if (src.name === "grey") n.color.setHex(accent);
      mats.set(src.name, n);
      c = n;
    }
    m.material = c;
  });
  g.add(car);
  // driver: torso + big head + hair + simple face
  const d = new THREE.Group();
  d.position.set(0, 0.62, -0.25);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.3, 4, 10), mat(trim));
  torso.position.y = 0.3;
  // head ball wrapped in the roster art: face on the front half, back of the head on the back half
  d.add(torso, headBall(characterId, customHead));
  for (const sx of [-0.17, 0.17]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 3, 8), mat(trim));
    arm.position.set(sx * 2.1, 0.32, 0.3);
    arm.rotation.x = Math.PI / 2.6;
    d.add(arm);
  }
  g.add(d);
}

const SPRITE = 2.8; // standee size in world units (kart + wheels are ~2.7 wide)
const HALF_L = 1.15; // proxy kart half length: standees stand just outside both ends

/**
 * A character's kart. Faces +z.
 *  - two "cardboard standees" cut from the roster art: the FRONT view faces forward, the BACK view faces backward
 *    (the chase camera sees the back view almost all the time)
 *  - a lean 3D proxy (body, big wheels, torso, head in skin/hair colors) that shows through at the sides, where
 *    the standees are edge-on and fade out. See updateKartLook().
 */
export function buildKartMesh(characterId: number, customHead?: string | null): THREE.Group {
  const g = new THREE.Group();
  const { body: bodyC, trim, skin, hair, metal } = characterById(characterId).kart;
  if (kartModel) build3DKart(g, characterId, customHead);
  else {
    // proxy kart (hidden while a standee is facing the camera)
    const proxy = new THREE.Group();
    g.add(proxy);
    g.userData.proxy = proxy;
    proxy.add(box(1.5, 0.5, HALF_L * 2, bodyC, 0, 0.6, 0, metal));
    proxy.add(box(1.0, 0.25, 0.8, trim, 0, 0.9, HALF_L - 0.1)); // hood
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = mat(0x151515);
    for (const [x, z] of [[-1.0, 0.85], [1.0, 0.85], [-1.0, -0.85], [1.0, -0.85]] as const) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.5, z);
      proxy.add(w);
    }
    proxy.add(box(0.8, 0.6, 0.5, trim, 0, 1.15, -0.15)); // torso
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 10), mat(skin));
    head.position.set(0, 1.78, -0.1);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.49, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair));
    hairCap.position.copy(head.position);
    hairCap.rotation.x = -0.25; // hair sweeps back
    proxy.add(head, hairCap);

    // standees
    const mk = (view: "f" | "b") => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(SPRITE, SPRITE),
        new THREE.MeshBasicMaterial({ map: kartTexture(characterId, view), transparent: true, depthWrite: false, opacity: view === "b" ? 1 : 0 }),
      );
      m.position.set(0, SPRITE / 2, view === "f" ? HALF_L + 0.12 : -HALF_L - 0.12);
      if (view === "b") m.rotation.y = Math.PI;
      m.renderOrder = 2;
      return m;
    };
    const front = mk("f");
    const back = mk("b");
    g.add(front, back);
    g.userData.front = front;
    g.userData.back = back;

  }

  // effects, toggled from snapshot state
  const shield = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 14), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.28, depthWrite: false }));
  shield.position.y = 1.2;
  shield.visible = false;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 10), new THREE.MeshBasicMaterial({ color: 0xff9020 }));
  flame.rotation.x = -Math.PI / 2; // tip points backwards (-z)
  flame.position.set(0, 0.6, -HALF_L - 1.7);
  flame.visible = false;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 8, 28), new THREE.MeshBasicMaterial({ color: 0xc040ff }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 3.0;
  ring.visible = false;
  const ice = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, HALF_L * 2 + 0.4), new THREE.MeshBasicMaterial({ color: 0x70c8ff, transparent: true, opacity: 0.4, depthWrite: false }));
  ice.position.y = 0.7;
  ice.visible = false;
  g.add(shield, flame, ring, ice);
  g.userData.shield = shield;
  g.userData.flame = flame;
  g.userData.ring = ring;
  g.userData.ice = ice;
  return g;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Show the standee facing the camera (front or back view) and fade both out when seen from the side. */
export function updateKartLook(kart: THREE.Group, cam: THREE.Vector3) {
  if (!kart.userData.front) return; // real 3D kart: nothing to fade
  const dx = cam.x - kart.position.x;
  const dz = cam.z - kart.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const d = (dx * Math.sin(kart.rotation.y) + dz * Math.cos(kart.rotation.y)) / len; // >0: camera in front of the kart
  const f = smooth(0.25, 0.45, d);
  const b = smooth(0.25, 0.45, -d);
  ((kart.userData.front as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = f;
  ((kart.userData.back as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = b;
  (kart.userData.proxy as THREE.Group).visible = Math.max(f, b) < 0.6; // the standee already shows the wheels and the driver
}

const avatarImgs = new Map<number, HTMLImageElement>();
function avatarImg(id: number): HTMLImageElement {
  let img = avatarImgs.get(id);
  if (!img) {
    img = new Image();
    img.src = `/art/characters/c${id}.jpg`;
    avatarImgs.set(id, img);
  }
  return img;
}

/** Floating "portrait + name" tag above a kart. Redraws itself once the portrait has loaded. */
export function makeNameplate(name: string, characterId: number): THREE.Sprite {
  const W = 360;
  const Hh = 100;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Hh;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const c = characterById(characterId);
  const draw = () => {
    ctx.clearRect(0, 0, W, Hh);
    ctx.fillStyle = "rgba(10,16,34,.78)";
    ctx.beginPath();
    ctx.roundRect(4, 8, W - 8, Hh - 16, 40);
    ctx.fill();
    const color = "#" + c.color.toString(16).padStart(6, "0");
    ctx.save();
    ctx.beginPath();
    ctx.arc(52, Hh / 2, 36, 0, Math.PI * 2);
    ctx.clip();
    const img = avatarImg(characterId);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, img.naturalHeight * 0.1, img.naturalWidth, img.naturalWidth, 16, Hh / 2 - 36, 72, 72);
    else {
      ctx.fillStyle = color;
      ctx.fillRect(16, 14, 72, 72);
    }
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(52, Hh / 2, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 36px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 12), 100, Hh / 2 + 2, W - 116);
    tex.needsUpdate = true;
  };
  draw();
  const img = avatarImg(characterId);
  if (!img.complete) img.addEventListener("load", draw, { once: true });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(4.0, 1.11, 1);
  sprite.position.y = 3.9;
  return sprite;
}

export function setKartEffects(kart: THREE.Group, fx: { shield?: boolean; boosting?: boolean; confused?: boolean; slowed?: boolean }, t = 0) {
  (kart.userData.shield as THREE.Mesh).visible = !!fx.shield;
  (kart.userData.flame as THREE.Mesh).visible = !!fx.boosting;
  const ring = kart.userData.ring as THREE.Mesh;
  ring.visible = !!fx.confused;
  ring.rotation.z = t * 8;
  (kart.userData.ice as THREE.Mesh).visible = !!fx.slowed;
}

/** Floating item box. */
export function buildItemBox(): THREE.Group {
  const g = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 1.7, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x35d0ff, emissive: 0x1a6aa0, transparent: true, opacity: 0.8 }),
  );
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xaa8800 }));
  g.add(cube, inner);
  g.position.y = 1.4;
  return g;
}

export function buildMissile(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.8, 10), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
  body.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0xd33333 }));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 1.2;
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xffa030 }));
  fire.rotation.x = -Math.PI / 2;
  fire.position.z = -1.3;
  g.add(body, tip, fire);
  g.position.y = 0.9;
  return g;
}

/** Shahed-136 style loitering drone: slim fuselage, big delta wing with tip fins, pusher prop at the back. Faces +z. */
export function buildDrone(): THREE.Group {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0xcfd3c4, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f36, roughness: 0.7 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.2, 10), grey);
  fus.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 10), grey);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.05;
  // delta wing: apex forward, wide at the back
  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 1.4, -1.7, 0, -1.5, 1.7, 0, -1.5], 3));
  wg.computeVertexNormals();
  const wing = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0xd9dccf, side: THREE.DoubleSide, roughness: 0.6 }));
  wing.position.y = 0.02;
  g.add(fus, nose, wing);
  for (const x of [-1.7, 1.7]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.7), dark);
    fin.position.set(x, 0.3, -1.4);
    g.add(fin);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), dark);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = -1.75;
  const prop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.1), dark);
  prop.position.z = -1.92;
  g.add(hub, prop);
  g.userData.prop = prop;
  return g;
}

/** Short orange fireball where a missile/drone blew up. Remove it when `update` returns false. */
export function buildExplosion(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, depthWrite: false }));
  m.userData.age = 0;
  return m;
}

export function buildOil(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(2, 20), new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.15, metalness: 0.6 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.08;
  return m;
}
