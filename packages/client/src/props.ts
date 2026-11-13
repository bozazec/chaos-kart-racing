import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DEFAULT_PARAMS, trackPoint, type Track, type TilePlace } from "@kart/shared";

/**
 * Props from Kenney's Racing Kit (CC0): start gantry, barriers, grandstands, billboards, banner towers, light posts.
 * Visual only. Placement derives from the track's own points, so every peer sees the same thing with no extra data.
 * Each model is recentred (x/z centre on the origin, base on y = 0); its front faces +z, its long side runs along x.
 */
const NAMES = ["barrierWall", "overheadLights", "flagCheckers", "grandStandCovered", "grandStand", "billboard", "billboardLow", "bannerTowerGreen", "bannerTowerRed", "lightPostLarge", "pitsGarage", "roadStraight", "roadCornerLarge", "roadCornerLarger"] as const;
type PropName = (typeof NAMES)[number];

const lib = new Map<PropName, THREE.Group>();
let loading: Promise<void> | null = null;

export function loadProps(): Promise<void> {
  loading ??= (async () => {
    const loader = new GLTFLoader();
    await Promise.all(
      NAMES.map(async (n) => {
        const gltf = await loader.loadAsync(`/models/kit/${n}.glb`);
        const pivot = new THREE.Group();
        pivot.add(gltf.scene);
        pivot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(pivot);
        gltf.scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        pivot.updateMatrixWorld(true);
        lib.set(n, pivot);
      }),
    );
  })().catch((e) => console.warn("kit props failed to load, using plain scenery", e));
  return loading;
}

interface Xf {
  x: number;
  z: number;
  rot: number;
  sx: number;
  sy?: number;
  sz?: number;
  y?: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

/** One InstancedMesh per sub-mesh of the model, so hundreds of copies cost a few draw calls. */
function instance(g: THREE.Group, name: PropName, list: Xf[]) {
  const model = lib.get(name);
  if (!model || list.length === 0) return;
  const mats = list.map((t) => new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y ?? 0, t.z), tmpQ.setFromAxisAngle(UP, t.rot).clone(), new THREE.Vector3(t.sx, t.sy ?? t.sx, t.sz ?? t.sx)));
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
    mats.forEach((t, i) => im.setMatrixAt(i, tmpM.multiplyMatrices(t, m.matrixWorld)));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    g.add(im);
  });
}

export const kitReady = () => lib.size >= NAMES.length;

/** The road itself, one kit tile per layout piece (see shared/layout.ts). One tile = `tile` metres wide. */
export function buildKitRoad(tiles: TilePlace[], tile: number): THREE.Group {
  const g = new THREE.Group();
  if (!kitReady()) return g;
  const name = { straight: "roadStraight", large: "roadCornerLarge", larger: "roadCornerLarger" } as const;
  for (const kind of ["straight", "large", "larger"] as const)
    instance(
      g,
      name[kind],
      tiles.filter((t) => t.kind === kind).map((t) => ({ x: t.x, z: t.z, rot: t.rot, sx: tile, sy: 1, sz: tile, y: 0.03 })),
    );
  return g;
}

export function buildKitProps(track: Track, night: boolean, startSign?: string): THREE.Group {
  const g = new THREE.Group();
  if (!kitReady()) return g;
  const n = track.points.length;
  const hw = track.halfWidth;
  const at = (i: number, lat: number) => trackPoint(track, ((i % n) + n) % n, lat);
  const heading = (i: number) => {
    const a = track.points[((i % n) + n) % n]!;
    const b = track.points[(((i + 1) % n) + n) % n]!;
    return Math.atan2(b.x - a.x, b.z - a.z); // direction of travel; local +z points along it
  };
  /** +z faces `to` */
  const facing = (x: number, z: number, i: number, lat: number) => {
    const r = at(i, 0);
    void lat;
    return Math.atan2(r.x - x, r.z - z);
  };

  // barriers along both edges, just outside the wall the sim enforces
  const edge = hw + DEFAULT_PARAMS.wallMargin + 0.8;
  const walls: Xf[] = [];
  for (let i = 0; i < n; i++)
    for (const s of [-1, 1]) {
      const p = at(i, s * edge);
      walls.push({ x: p.x, z: p.z, rot: heading(i) - Math.PI / 2, sx: track.spacing * 1.04, sy: 5, sz: 5 });
    }
  instance(g, "barrierWall", walls);

  // start / finish: gantry over the line, checkered flags, grandstands and garages beside it
  const p0 = at(0, 0);
  instance(g, "overheadLights", [{ x: p0.x, z: p0.z, rot: heading(0), sx: (hw * 2 + 4) / 1.26, sy: 8 }]);
  if (startSign) {
    // the top beam of the gantry (model units: y 0.50..0.69, z -0.095..0.066 around the recentred origin)
    const sx = (hw * 2 + 4) / 1.26;
    const sy = 8;
    g.add(startBanner(startSign, 0.6 * sy, 0.066 * sx, -0.095 * sx, 0.18 * sy, p0.x, p0.z, heading(0), night));
  }
  instance(
    g,
    "flagCheckers",
    [-1, 1].map((s) => {
      const p = at(0, s * (hw + 5));
      return { x: p.x, z: p.z, rot: heading(0), sx: 8 };
    }),
  );
  const stands: Xf[] = [];
  const garages: Xf[] = [];
  for (const [s, i] of [[-1, 6], [1, n - 6]] as const) {
    const p = at(i, s * (hw + 19));
    stands.push({ x: p.x, z: p.z, rot: facing(p.x, p.z, i, s), sx: 11 });
    const q = at(i + (s < 0 ? 12 : -12), s * (hw + 17));
    garages.push({ x: q.x, z: q.z, rot: facing(q.x, q.z, i, s), sx: 9 });
  }
  instance(g, "grandStandCovered", stands);
  instance(g, "pitsGarage", garages);

  // billboards and banner towers along the lap
  const boards: Xf[] = [];
  const lowBoards: Xf[] = [];
  const towersG: Xf[] = [];
  const towersR: Xf[] = [];
  for (let i = 24, k = 0; i < n - 16; i += 26, k++) {
    const s = k % 2 ? 1 : -1;
    const p = at(i, s * (hw + 13));
    (k % 3 ? boards : lowBoards).push({ x: p.x, z: p.z, rot: facing(p.x, p.z, i, s) + Math.PI, sx: 7 });
  }
  for (let i = 10, k = 0; i < n - 8; i += 15, k++) {
    const s = k % 2 ? 1 : -1;
    const p = at(i, s * (hw + 7.5));
    (k % 4 < 2 ? towersG : towersR).push({ x: p.x, z: p.z, rot: heading(i), sx: 6 });
  }
  instance(g, "billboard", boards);
  instance(g, "billboardLow", lowBoards);
  instance(g, "bannerTowerGreen", towersG);
  instance(g, "bannerTowerRed", towersR);

  // light posts: both sides at night, one side by day
  const posts: Xf[] = [];
  for (let i = 3; i < n; i += night ? 6 : 14)
    for (const s of night ? [-1, 1] : [-1]) {
      const p = at(i, s * (hw + 5.5));
      posts.push({ x: p.x, z: p.z, rot: facing(p.x, p.z, i, s) + Math.PI / 2, sx: 8 });
    }
  instance(g, "lightPostLarge", posts);
  void tmpE;
  return g;
}

/** Lettering on the gantry's top beam, front and back face (readable from both sides). */
function startBanner(text: string, y: number, zFront: number, zBack: number, h: number, x: number, z: number, rot: number, night: boolean): THREE.Group {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 112;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#b3202a";
  ctx.fillRect(0, 0, 1024, 112);
  ctx.strokeStyle = "#f4d03f";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 1016, 104);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 92;
  ctx.font = `800 ${size}px system-ui, "Segoe UI", sans-serif`;
  while (ctx.measureText(text).width > 960 && size > 30) ctx.font = `800 ${(size -= 4)}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText(text, 512, 60);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const w = h * (1024 / 112);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: night ? 0xcccccc : 0xffffff });
  const grp = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  front.position.set(0, y, zFront + 0.05);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  back.rotation.y = Math.PI;
  back.position.set(0, y, zBack - 0.05);
  grp.add(front, back);
  grp.position.set(x, 0, z);
  grp.rotation.y = rot;
  return grp;
}
