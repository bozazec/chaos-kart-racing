import type { Track } from "@kart/shared";

export interface MapDot {
  x: number;
  z: number;
  color: string;
  me?: boolean;
}

interface Fit {
  scale: number;
  ox: number;
  oy: number;
  size: number;
  /** Mirror x so every track is driven clockwise on the map. */
  flip: boolean;
}

/** World (x,z) -> canvas. North-up (+z up), mirrored left-right when the lap runs counter-clockwise so karts always circulate clockwise. */
function fit(track: Track, size: number, pad: number): Fit {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  // shoelace area in (x right, z up): positive = counter-clockwise
  let area = 0;
  track.points.forEach((p, i) => {
    const q = track.points[(i + 1) % track.points.length]!;
    area += p.x * q.z - q.x * p.z;
  });
  const flip = area > 0;
  if (flip) [minX, maxX] = [-maxX, -minX];
  const w = maxX - minX + track.halfWidth * 2;
  const h = maxZ - minZ + track.halfWidth * 2;
  const scale = (size - pad * 2) / Math.max(w, h);
  return { scale, ox: pad + ((size - pad * 2) - w * scale) / 2 + track.halfWidth * scale - minX * scale, oy: pad + ((size - pad * 2) - h * scale) / 2 + track.halfWidth * scale - minZ * scale, size, flip };
}
const px = (f: Fit, x: number) => f.ox + (f.flip ? -x : x) * f.scale;
const py = (f: Fit, z: number) => f.size - (f.oy + z * f.scale);

/** Draw the road outline (and start line) into a canvas context. */
export function drawTrackPath(ctx: CanvasRenderingContext2D, track: Track, size: number, pad = 10, road = "#cfd6e6") {
  const f = fit(track, size, pad);
  const path = () => {
    ctx.beginPath();
    track.points.forEach((p, i) => (i ? ctx.lineTo(px(f, p.x), py(f, p.z)) : ctx.moveTo(px(f, p.x), py(f, p.z))));
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const roadW = Math.max(4, track.halfWidth * 2 * f.scale);
  ctx.strokeStyle = "rgba(0,0,0,.65)";
  ctx.lineWidth = roadW + 3;
  path();
  ctx.stroke();
  ctx.strokeStyle = road;
  ctx.lineWidth = roadW;
  path();
  ctx.stroke();
  // start/finish line
  const a = track.points[0]!;
  const b = track.points[1]!;
  const sx = px(f, a.x);
  const sy = py(f, a.z);
  const ang = Math.atan2(py(f, b.z) - sy, px(f, b.x) - sx) + Math.PI / 2;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx - Math.cos(ang) * (roadW / 2 + 2), sy - Math.sin(ang) * (roadW / 2 + 2));
  ctx.lineTo(sx + Math.cos(ang) * (roadW / 2 + 2), sy + Math.sin(ang) * (roadW / 2 + 2));
  ctx.stroke();
  return f;
}

/** Small track preview as an image URL (track picker). */
export function trackPreviewUrl(track: Track, w = 120, h = 80): string {
  const c = document.createElement("canvas");
  const size = 200;
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  drawTrackPath(ctx, track, size, 8, "#dfe6f5");
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  // crop the square to the track's aspect by centering
  out.getContext("2d")!.drawImage(c, (size - w * (size / h)) / 2, 0, w * (size / h), size, 0, 0, w, h);
  return out.toDataURL("image/png");
}

/** Bottom-right mini map: the track and every driver's position. */
export class Minimap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private f: Fit | null = null;
  private size = 170;

  constructor() {
    this.el = document.createElement("div");
    this.canvas = document.createElement("canvas");
    this.layer = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    this.el.append(this.canvas);
    this.el.style.cssText = "position:fixed;right:12px;bottom:12px;border-radius:14px;background:rgba(10,16,34,.55);border:2px solid rgba(255,255,255,.35);display:none;pointer-events:none;overflow:hidden";
    document.body.appendChild(this.el);
    this.resize(170);
  }

  /** Phones: smaller and lifted above the ITEM/special buttons. */
  compact(on: boolean) {
    this.resize(on ? 118 : 170);
    this.el.style.bottom = on ? "calc(max(40px,env(safe-area-inset-bottom)) + 200px)" : "12px";
    this.el.style.right = on ? "20px" : "12px";
  }

  private resize(size: number) {
    this.size = size;
    const dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.track = null;
  }

  private track: Track | null = null;
  setTrack(track: Track) {
    this.track = track;
    const dpr = this.layer.width / this.size;
    const lctx = this.layer.getContext("2d")!;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, this.size, this.size);
    this.f = drawTrackPath(lctx, track, this.size, 10);
  }

  show(on: boolean) {
    this.el.style.display = on ? "block" : "none";
  }

  update(dots: MapDot[]) {
    const f = this.f;
    if (!f) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.layer, 0, 0, this.size, this.size);
    // others first, me on top
    for (const d of [...dots].sort((a, b) => Number(!!a.me) - Number(!!b.me))) {
      const x = px(f, d.x);
      const y = py(f, d.z);
      ctx.beginPath();
      ctx.arc(x, y, d.me ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = d.me ? 3 : 1.8;
      ctx.strokeStyle = d.me ? "#ffd23f" : "#ffffff";
      ctx.stroke();
    }
  }
}
