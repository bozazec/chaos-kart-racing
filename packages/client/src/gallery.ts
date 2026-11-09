// Dev tool (not part of the production build): all character karts side by side, with nameplates.
// Open http://localhost:5173/gallery.html. Add ?t=2 to freeze the orbit at 2 s for screenshots.
// Karts turn slowly so you see front, side and back views.
import * as THREE from "three";
import { CHARACTERS } from "@kart/shared";
import { buildKartMesh, makeNameplate, updateKartLook } from "./scene";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2a4a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(30, 60, 40);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x2a3556 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const cols = 4;
const karts = CHARACTERS.map((c, i) => {
  const k = buildKartMesh(c.id);
  k.position.set((i % cols - (cols - 1) / 2) * 7, 0, -Math.floor(i / cols) * 10 + 10);
  k.add(makeNameplate(c.name, c.id));
  scene.add(k);
  return k;
});
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
const fixed = new URLSearchParams(location.search).get("t");
renderer.setAnimationLoop((now) => {
  const t = fixed === null ? now / 1000 : Number(fixed);
  karts.forEach((k, i) => (k.rotation.y = t * 0.6 + i * 0.5));
  camera.position.set(0, 14, 26);
  camera.lookAt(0, 0.5, -2);
  karts.forEach((k) => updateKartLook(k, camera.position));
  renderer.render(scene, camera);
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
