import * as THREE from "three";
import { Cosmetic, Phase, type PhaseId } from "@kart/shared";
import { buildKartMesh } from "./scene";

/**
 * Looks of the store items (see shared/cosmetics.ts). Rendering only: nothing here feeds back into the game.
 * Everything is built from primitives, so the store needs no extra downloads.
 */

const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide, ...o });
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ grid girls
const SKIN_HEX = 0xdc9c6c;
const SKIN = std(SKIN_HEX, { roughness: 0.5 });
const RED = std(0xd9141e, { roughness: 0.28 });
const BLACK = std(0x16161c, { roughness: 0.4 });
const HAIR = [std(0x4b2a17, { roughness: 0.45 }), std(0xf0cf6a, { roughness: 0.45 })]; // brunette, blonde
const GIRL_SCALE = 0.92;

type V3 = [number, number, number];
/** Tapered cylinder from a (radius r0) to b (radius r1). */
function limb(a: V3, b: V3, r0: number, r1: number, m: THREE.Material): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, va.distanceTo(vb), 10), m);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return mesh;
}
const ball = (p: V3, r: number, m: THREE.Material) => {
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
  s.position.set(...p);
  return s;
};
/** Body part turned on a lathe from (radius, height) points, then flattened front to back. */
const lathe = (pts: [number, number][], m: THREE.Material) => {
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 16), m);
  mesh.scale.z = 0.74;
  return mesh;
};

let faceTex: THREE.CanvasTexture | null = null;
/** Painted face. The head ball's texture wraps all the way round; the face sits at u = 0.25 (the +z side). */
function faceTexture(): THREE.CanvasTexture {
  if (faceTex) return faceTex;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext("2d")!;
  c.fillStyle = `#${SKIN_HEX.toString(16)}`;
  c.fillRect(0, 0, 256, 128);
  const cx = 64;
  c.lineCap = "round";
  for (const s of [-1, 1]) {
    c.fillStyle = "rgba(235,90,90,.28)"; // blush
    c.beginPath();
    c.ellipse(cx + s * 25, 74, 9, 6, 0, 0, 7);
    c.fill();
    const ex = cx + s * 15;
    const ey = 58;
    // almond eye: the iris is clipped by the lids, so she looks relaxed rather than startled
    c.save();
    c.beginPath();
    c.ellipse(ex, ey, 8.5, 4.3, -s * 0.12, 0, 7);
    c.clip();
    c.fillStyle = "#fff";
    c.fillRect(ex - 10, ey - 7, 20, 14);
    c.fillStyle = "#6b3f1d";
    c.beginPath();
    c.arc(ex, ey - 0.6, 4.8, 0, 7);
    c.fill();
    c.fillStyle = "#120a06";
    c.beginPath();
    c.arc(ex, ey - 0.6, 2.3, 0, 7);
    c.fill();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(ex + 1.6, ey - 2, 1.2, 0, 7);
    c.fill();
    c.restore();
    c.strokeStyle = "#1a0f0a"; // lash line with a wing
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(ex - s * 9, ey);
    c.quadraticCurveTo(ex, ey - 7.5, ex + s * 12.5, ey - 5);
    c.stroke();
    c.strokeStyle = "#3a2010"; // brow
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(ex - s * 8, ey - 14.5);
    c.quadraticCurveTo(ex + s * 3, ey - 19, ex + s * 12, ey - 13);
    c.stroke();
  }
  c.strokeStyle = "rgba(120,60,30,.45)"; // nose
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(cx - 2.5, 73);
  c.quadraticCurveTo(cx, 75.5, cx + 2.5, 73);
  c.stroke();
  c.fillStyle = "#c81e3a"; // lips
  c.beginPath();
  c.ellipse(cx, 87, 9.5, 4.2, 0, 0, 7);
  c.fill();
  c.strokeStyle = "#7d0f22";
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(cx - 9, 86.5);
  c.quadraticCurveTo(cx, 89.5, cx + 9, 86.5);
  c.stroke();
  faceTex = new THREE.CanvasTexture(cv);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 4;
  return faceTex;
}

/** Umbrella top: 8 panels, red and black in turn. */
function canopyGeo(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 0.36, 8, 1, true).toNonIndexed();
  const pos = g.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  const red = new THREE.Color(0xd9141e);
  const blk = new THREE.Color(0x16161c);
  for (let i = 0; i < pos.count; i += 3) {
    const ax = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const az = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const panel = Math.floor(((Math.atan2(az, ax) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4));
    const c = panel % 2 ? blk : red;
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * One grid girl, about 3 units tall, standing on y = 0 and facing +z. `k` (+1 / -1) is the side of her the kart is on:
 * that hand holds the umbrella, which leans over the kart; the other hand rests on her hip, or waves.
 */
function buildGirl(k: number, hair: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group(); // everything hangs off this so the whole figure can sway
  body.name = "body";
  g.add(body);

  for (const s of [-1, 1]) {
    body.add(limb([s * 0.17, 1.5, 0], [s * 0.13, 0.12, 0], 0.2, 0.075, SKIN)); // leg
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.36), BLACK);
    shoe.position.set(s * 0.13, 0.06, 0.07);
    body.add(shoe);
  }
  body.add(
    lathe([[0, 1.36], [0.36, 1.38], [0.39, 1.5], [0.37, 1.66], [0.3, 1.8]], RED), // mini skirt
    lathe([[0.365, 1.37], [0.397, 1.45]], BLACK), // hem
    lathe([[0.3, 1.79], [0.297, 1.86]], BLACK), // waistband
    lathe([[0.292, 1.86], [0.25, 1.97], [0.225, 2.06], [0.235, 2.16], [0.27, 2.26]], SKIN), // waist
    lathe([[0.277, 2.22], [0.28, 2.27]], BLACK), // band under the top
    lathe([[0.272, 2.25], [0.295, 2.34], [0.3, 2.44], [0.28, 2.5]], RED), // crop top
    lathe([[0.28, 2.5], [0.29, 2.56], [0.27, 2.63], [0.15, 2.7], [0.085, 2.74], [0.08, 2.92]], SKIN), // shoulders + neck
  );
  for (const s of [-1, 1]) {
    // bust: a skin ball with a red cup over its lower part, held by a halter strap
    const c: V3 = [s * 0.145, 2.4, 0.19];
    const skin = ball(c, 0.19, SKIN);
    skin.geometry = new THREE.SphereGeometry(0.19, 16, 12);
    skin.scale.set(1, 0.95, 1.05);
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58), RED);
    cup.position.set(...c);
    cup.scale.copy(skin.scale);
    cup.rotation.x = 0.25;
    body.add(skin, cup, limb([s * 0.15, 2.5, 0.22], [s * 0.05, 2.77, 0.06], 0.02, 0.02, BLACK));
  }
  const choker = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.022, 6, 16), RED);
  choker.rotation.x = Math.PI / 2;
  choker.position.y = 2.79;
  body.add(choker);

  // head: painted face, hair cap pushed back so the face shows, long hair down the back, a lock over each shoulder
  const head = new THREE.Group();
  head.name = "head";
  head.position.y = 3.05;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.55 }));
  skull.scale.set(0.9, 1.02, 0.93);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.295, 18, 14), hair);
  cap.position.set(0, 0.045, -0.075);
  const mane = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), hair);
  mane.scale.set(1.05, 1.9, 0.5);
  mane.position.set(0, -0.42, -0.2);
  head.add(skull, cap, mane);
  for (const s of [-1, 1]) head.add(limb([s * 0.24, -0.02, 0.04], [s * 0.2, -0.6, 0.15], 0.09, 0.05, hair));
  body.add(head);

  // arm on the kart's side holds the umbrella in front of her
  const hand: V3 = [k * 0.3, 2.36, 0.36];
  body.add(limb([k * 0.3, 2.6, 0], [k * 0.4, 2.22, 0.08], 0.075, 0.06, SKIN), limb([k * 0.4, 2.22, 0.08], hand, 0.06, 0.05, SKIN), ball([k * 0.4, 2.22, 0.08], 0.06, SKIN), ball(hand, 0.065, SKIN));
  const umb = new THREE.Group();
  umb.position.set(...hand);
  umb.rotation.z = -k * 0.28; // leans over the kart
  umb.rotation.x = -0.12; // and a little back, clear of her face
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.9, 6), std(0x9a9aa2, { metalness: 0.6, roughness: 0.35 }));
  pole.position.y = 0.6;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.24, 8), BLACK);
  grip.position.y = -0.24;
  const canopy = new THREE.Group();
  canopy.name = "canopy";
  canopy.position.y = 1.5;
  canopy.add(new THREE.Mesh(canopyGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, flatShading: true })), ball([0, 0.2, 0], 0.04, BLACK));
  umb.add(pole, grip, canopy);
  body.add(umb);

  // the other arm: hand on hip, or raised and waving (pivot at the shoulder)
  const f = -k;
  const hip = new THREE.Group();
  hip.name = "armHip";
  hip.add(limb([f * 0.3, 2.6, 0], [f * 0.5, 2.2, -0.06], 0.075, 0.06, SKIN), limb([f * 0.5, 2.2, -0.06], [f * 0.37, 1.84, 0.1], 0.06, 0.05, SKIN), ball([f * 0.5, 2.2, -0.06], 0.06, SKIN), ball([f * 0.37, 1.84, 0.1], 0.065, SKIN));
  const wave = new THREE.Group();
  wave.name = "armWave";
  wave.position.set(f * 0.3, 2.6, 0);
  wave.add(limb([0, 0, 0], [f * 0.28, 0.22, 0.02], 0.075, 0.06, SKIN), limb([f * 0.28, 0.22, 0.02], [f * 0.34, 0.72, 0.06], 0.06, 0.05, SKIN), ball([f * 0.28, 0.22, 0.02], 0.06, SKIN), ball([f * 0.34, 0.76, 0.06], 0.075, SKIN));
  wave.visible = false;
  body.add(hip, wave);

  g.scale.setScalar(GIRL_SCALE);
  return g;
}

const girlTemplates = new Map<number, THREE.Group>();
interface Girl {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  canopy: THREE.Object3D;
  armHip: THREE.Object3D;
  armWave: THREE.Object3D;
  phase: number;
}
interface Girls {
  group: THREE.Group;
  list: Girl[];
  /** seconds since the race started (they wave, then leave) */
  leave: number;
}

/** The pair, in the kart's own frame (kart at the origin facing +z): one each side, turned to face back up the grid. */
function buildGirls(): Girls {
  const group = new THREE.Group();
  const list = [1, -1].map((side, i): Girl => {
    let tpl = girlTemplates.get(side);
    if (!tpl) {
      tpl = buildGirl(side, HAIR[i]!);
      girlTemplates.set(side, tpl);
    }
    const root = tpl.clone(true); // shares geometry and materials with the template
    root.position.set(side * 1.95, 0, 0.35);
    root.rotation.y = Math.PI + side * 0.3; // facing backwards (to the chase camera), turned a little to the kart
    group.add(root);
    const part = (n: string) => root.getObjectByName(n)!;
    return { root, body: part("body"), head: part("head"), canopy: part("canopy"), armHip: part("armHip"), armWave: part("armWave"), phase: i * 1.7 };
  });
  return { group, list, leave: 0 };
}

function animateGirls(g: Girls, t: number, waving: boolean, size: number) {
  for (const girl of g.list) {
    const p = t + girl.phase;
    girl.root.scale.setScalar(GIRL_SCALE * size);
    girl.body.rotation.z = Math.sin(p * 1.7) * 0.035; // slow sway
    girl.body.position.x = Math.sin(p * 1.7) * 0.03;
    girl.head.rotation.z = Math.sin(p * 1.1) * 0.07;
    girl.head.rotation.y = Math.sin(p * 0.6) * 0.2;
    girl.canopy.rotation.y = p * 0.9; // umbrella twirl
    girl.armHip.visible = !waving;
    girl.armWave.visible = waving;
    girl.armWave.rotation.z = Math.sin(p * 9) * 0.24;
  }
}

// ------------------------------------------------------------------ kart accessories
const GOLD_MAT = std(0xffc930, { metalness: 0.5, roughness: 0.3, emissive: 0x6a4800 });

function buildCrown(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.27, 0.17, 12, 1, true), GOLD_MAT));
  const gem = [std(0xe0203a, { emissive: 0x500010 }), std(0x2f7bff, { emissive: 0x001a50 })];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 4), GOLD_MAT);
    spike.position.set(Math.sin(a) * 0.29, 0.19, Math.cos(a) * 0.29);
    const tip = ball([Math.sin(a) * 0.29, 0.31, Math.cos(a) * 0.29], 0.035, GOLD_MAT);
    const jewel = ball([Math.sin(a + 0.52) * 0.295, 0, Math.cos(a + 0.52) * 0.295], 0.04, gem[i % 2]!);
    g.add(spike, tip, jewel);
  }
  return g;
}

let flagTex: THREE.CanvasTexture | null = null;
const FLAG_W = 1.0;
function buildFlag(): { group: THREE.Group; cloth: THREE.Mesh } {
  if (!flagTex) {
    const cv = document.createElement("canvas");
    cv.width = 96;
    cv.height = 64;
    const c = cv.getContext("2d")!;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6; x++) {
        c.fillStyle = (x + y) % 2 ? "#111" : "#fff";
        c.fillRect(x * 16, y * 16, 16, 16);
      }
    flagTex = new THREE.CanvasTexture(cv);
    flagTex.colorSpace = THREE.SRGBColorSpace;
    flagTex.magFilter = THREE.NearestFilter;
  }
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6), std(0xd8d8de, { metalness: 0.6, roughness: 0.3 }));
  pole.position.y = 1.05;
  const geo = new THREE.PlaneGeometry(FLAG_W, 0.66, 10, 1);
  geo.translate(FLAG_W / 2, 0, 0); // hoist edge on the pole
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }));
  cloth.position.y = 1.75;
  cloth.rotation.y = Math.PI / 2; // streams out behind the kart
  group.add(pole, cloth, ball([0, 2.12, 0], 0.05, GOLD_MAT));
  return { group, cloth };
}
function waveFlag(cloth: THREE.Mesh, t: number) {
  const pos = cloth.geometry.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin(x * 7 - t * 9) * 0.1 * (x / FLAG_W));
  }
  pos.needsUpdate = true;
}

let glowTex: THREE.CanvasTexture | null = null;
function buildGlow(): THREE.Mesh {
  if (!glowTex) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const c = cv.getContext("2d")!;
    const gr = c.createRadialGradient(64, 64, 14, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.55, "rgba(255,255,255,.55)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gr;
    c.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(cv);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 5.8), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.11;
  m.renderOrder = 1;
  return m;
}

// ------------------------------------------------------------------ world-space effects
const TRAIL_N = 34;
const TRAIL_LIFE = 0.9;
let rainbowTex: THREE.CanvasTexture | null = null;
/** Six colour bands side by side, stretched across the ribbon. */
function rainbowTexture(): THREE.CanvasTexture {
  if (rainbowTex) return rainbowTex;
  const cv = document.createElement("canvas");
  cv.width = 6;
  cv.height = 1;
  const c = cv.getContext("2d")!;
  ["#ff2b3a", "#ff9a1f", "#ffe32b", "#2fd65a", "#2f8bff", "#a23bff"].forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect(i, 0, 1, 1);
  });
  rainbowTex = new THREE.CanvasTexture(cv);
  rainbowTex.colorSpace = THREE.SRGBColorSpace;
  rainbowTex.magFilter = rainbowTex.minFilter = THREE.NearestFilter;
  rainbowTex.generateMipmaps = false;
  return rainbowTex;
}
/** Rainbow ribbon laid on the track behind a moving kart. */
class Trail {
  mesh: THREE.Mesh;
  private pts: { x: number; z: number; px: number; pz: number; age: number }[] = [];
  private pos = new Float32Array((TRAIL_N + 1) * 6);
  private col = new Float32Array((TRAIL_N + 1) * 8).fill(1); // white: only the alpha changes

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4));
    const uv = new Float32Array((TRAIL_N + 1) * 4);
    for (let i = 0; i <= TRAIL_N; i++) uv.set([0, 0.5, 1, 0.5], i * 4);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rainbowTexture(), vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh.frustumCulled = false; // the vertices are in world space and move every frame
    this.mesh.renderOrder = 1;
  }

  update(x: number, z: number, heading: number, dt: number) {
    const head = { x: x - Math.sin(heading) * 1.45, z: z - Math.cos(heading) * 1.45, px: Math.cos(heading), pz: -Math.sin(heading), age: 0 };
    const last = this.pts[0];
    const gap = last ? Math.hypot(head.x - last.x, head.z - last.z) : Infinity;
    if (gap > 25) this.pts.length = 0; // teleported (new round, back to a checkpoint), not just one slow frame
    if (gap > 0.3) this.pts.unshift({ ...head });
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && (this.pts.length > TRAIL_N || this.pts[this.pts.length - 1]!.age > TRAIL_LIFE)) this.pts.pop();
    // the ribbon starts at the kart's tail, then runs through the saved samples
    const line = [head, ...this.pts];
    line.forEach((p, i) => {
      const k = 1 - p.age / TRAIL_LIFE;
      const w = 0.2 + 0.5 * k;
      this.pos.set([p.x + p.px * w, 0.45, p.z + p.pz * w, p.x - p.px * w, 0.45, p.z - p.pz * w], i * 6);
      this.col[i * 8 + 3] = this.col[i * 8 + 7] = k * 0.9;
    });
    const geo = this.mesh.geometry;
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.color!.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, line.length - 1) * 6);
  }
}

interface Burst {
  pts: THREE.Points;
  vel: Float32Array;
  age: number;
}
const CONFETTI = [0xff3b5c, 0xffd23f, 0x35d07f, 0x3fa9ff, 0xc56bff, 0xffffff];

interface SlotFx {
  kart: THREE.Group;
  mask: number;
  /** pieces hung on the kart */
  parts: THREE.Object3D[];
  glow?: THREE.Mesh;
  crown?: THREE.Group;
  crownY: number;
  flag?: THREE.Mesh;
  trail?: Trail;
  girls?: Girls;
}

/** Draws every kart's active store items. One per scene. */
export class CosmeticsFx {
  private slots = new Map<number, SlotFx>();
  private bursts: Burst[] = [];
  private hue = new THREE.Color();

  constructor(private scene: THREE.Scene) {}

  /** Call every frame for every kart on screen, after the kart has been placed. `mask` = that player's items. */
  update(slot: number, kart: THREE.Group, mask: number, phase: PhaseId, t: number, dt: number) {
    let s = this.slots.get(slot);
    if (!s || s.kart !== kart || s.mask !== mask) {
      if (s) this.drop(s);
      s = this.make(kart, mask);
      this.slots.set(slot, s);
    }
    if (s.glow) {
      const m = s.glow.material as THREE.MeshBasicMaterial;
      m.color.copy(this.hue.setHSL((t * 0.12 + slot * 0.13) % 1, 1, 0.5));
      m.opacity = 0.75 + Math.sin(t * 4) * 0.2;
    }
    if (s.crown) {
      s.crown.rotation.y = t * 1.6;
      s.crown.position.y = s.crownY + Math.sin(t * 2.6) * 0.05;
    }
    if (s.flag) waveFlag(s.flag, t);
    s.trail?.update(kart.position.x, kart.position.z, kart.rotation.y, dt);
    if (s.girls) {
      const g = s.girls;
      if (phase === Phase.Lobby || phase === Phase.Countdown) {
        // on the grid: they stand with the kart
        g.group.position.set(kart.position.x, 0, kart.position.z);
        g.group.rotation.y = kart.rotation.y;
        g.group.visible = true;
        g.leave = 0;
      } else if (phase === Phase.Race && g.group.visible) {
        // lights out: they stay where they stood, wave the kart off, then go
        g.leave += dt;
        if (g.leave > 2.6) g.group.visible = false;
      } else g.group.visible = false;
      if (g.group.visible) animateGirls(g, t, phase !== Phase.Lobby, 1 - smooth(2.1, 2.6, g.leave));
    }
  }

  private make(kart: THREE.Group, mask: number): SlotFx {
    const s: SlotFx = { kart, mask, parts: [], crownY: 0 };
    const sprite = !!kart.userData.front; // fallback sprite kart: its driver sits a little higher
    const hang = (o: THREE.Object3D) => {
      kart.add(o);
      s.parts.push(o);
    };
    if (mask & Cosmetic.Underglow) hang((s.glow = buildGlow()));
    if (mask & Cosmetic.Crown) {
      s.crown = buildCrown();
      s.crownY = sprite ? 2.45 : 2.22;
      s.crown.position.set(0, s.crownY, sprite ? -0.1 : -0.25);
      hang(s.crown);
    }
    if (mask & Cosmetic.Flag) {
      const f = buildFlag();
      f.group.position.set(0.7, 0.45, -1.25);
      s.flag = f.cloth;
      hang(f.group);
    }
    if (mask & Cosmetic.Trail) {
      s.trail = new Trail();
      this.scene.add(s.trail.mesh);
    }
    if (mask & Cosmetic.GridGirls) {
      s.girls = buildGirls();
      s.girls.group.visible = false;
      this.scene.add(s.girls.group);
    }
    return s;
  }

  private drop(s: SlotFx) {
    for (const p of s.parts) s.kart.remove(p);
    s.glow?.geometry.dispose();
    (s.glow?.material as THREE.Material | undefined)?.dispose();
    s.flag?.geometry.dispose();
    if (s.trail) {
      this.scene.remove(s.trail.mesh);
      s.trail.mesh.geometry.dispose();
      (s.trail.mesh.material as THREE.Material).dispose();
    }
    if (s.girls) this.scene.remove(s.girls.group);
  }

  /** The kart left the scene. */
  remove(slot: number) {
    const s = this.slots.get(slot);
    if (s) this.drop(s);
    this.slots.delete(slot);
  }

  /** Confetti cannon at a kart that just finished. */
  burst(x: number, z: number) {
    const n = 140;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = 1.5 + Math.random() * 4.5;
      pos.set([x, 1.2, z], i * 3);
      vel.set([Math.cos(a) * out, 7 + Math.random() * 6, Math.sin(a) * out], i * 3);
      c.setHex(CONFETTI[i % CONFETTI.length]!);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.bursts.push({ pts, vel, age: 0 });
  }

  /** Once per frame: move the confetti. */
  frame(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      const pos = b.pts.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      const drag = Math.exp(-1.6 * dt);
      for (let j = 0; j < a.length; j += 3) {
        b.vel[j] = b.vel[j]! * drag;
        b.vel[j + 2] = b.vel[j + 2]! * drag;
        b.vel[j + 1] = Math.max(-3.5, b.vel[j + 1]! - 14 * dt); // paper: falls slowly once it has turned over
        a[j] = a[j]! + b.vel[j]! * dt;
        a[j + 1] = Math.max(0.08, a[j + 1]! + b.vel[j + 1]! * dt);
        a[j + 2] = a[j + 2]! + b.vel[j + 2]! * dt;
      }
      pos.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = 1 - smooth(2.4, 3.2, b.age);
      if (b.age > 3.2) {
        this.scene.remove(b.pts);
        b.pts.geometry.dispose();
        (b.pts.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  /** Left the room: take everything out of the scene. */
  clear() {
    for (const s of this.slots.values()) this.drop(s);
    this.slots.clear();
    for (const b of this.bursts) {
      this.scene.remove(b.pts);
      b.pts.geometry.dispose();
      (b.pts.material as THREE.Material).dispose();
    }
    this.bursts.length = 0;
  }
}

// ------------------------------------------------------------------ store thumbnails
/**
 * Picture of one item on the player's kart, for its card in the store. Drawn with the game's own renderer into a
 * corner of its canvas and copied out straight away; the next game frame paints over it before the browser shows it.
 */
export function renderCosmeticThumb(renderer: THREE.WebGLRenderer, bit: number, character: number, w = 320, h = 240): string | null {
  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18224a);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(3, 8, -6);
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 40), new THREE.MeshStandardMaterial({ color: 0x2b3454 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const kart = buildKartMesh(character, null, !!(bit & Cosmetic.Gold));
    scene.add(kart);
    const fx = new CosmeticsFx(scene);
    // a short drive up to the origin, so the trail has something to show
    const steps = bit & Cosmetic.Trail ? 30 : 1;
    for (let i = 0; i < steps; i++) {
      kart.position.z = (i - steps + 1) * 0.4;
      fx.update(0, kart, bit, Phase.Lobby, 1.3 + i * 0.02, 0.02);
    }
    if (bit & Cosmetic.Confetti) {
      fx.burst(0, 0);
      fx.frame(0.3);
      fx.frame(0.3);
    }
    const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 200);
    if (bit & Cosmetic.GridGirls) {
      cam.position.set(1.2, 2.5, -7.8); // from behind the kart: the girls face this way
      cam.lookAt(0, 1.75, 0);
    } else if (bit & Cosmetic.Trail) {
      cam.position.set(5.5, 3.6, -9);
      cam.lookAt(0, 0.7, -3.2);
    } else if (bit & Cosmetic.Confetti) {
      cam.position.set(5, 3, -9.5);
      cam.lookAt(0, 2.9, 0);
    } else {
      cam.position.set(3.6, 2.9, -5.8);
      cam.lookAt(0, 1.2, -0.1);
    }
    const pr = renderer.getPixelRatio();
    const el = renderer.domElement;
    const k = Math.min(1, el.width / (w * pr), el.height / (h * pr)); // tiny window: smaller picture
    const pw = Math.round(w * pr * k);
    const ph = Math.round(h * pr * k);
    const view = renderer.getViewport(new THREE.Vector4());
    renderer.setViewport(0, 0, pw / pr, ph / pr);
    renderer.render(scene, cam);
    renderer.setViewport(view);
    const out = document.createElement("canvas");
    out.width = pw;
    out.height = ph;
    out.getContext("2d")!.drawImage(el, 0, el.height - ph, pw, ph, 0, 0, pw, ph);
    return out.toDataURL("image/jpeg", 0.88);
  } catch (e) {
    console.warn("store picture failed", e);
    return null;
  }
}
