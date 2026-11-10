/** Player's custom driver image: cropped to a small square, stored as a data URL in localStorage. Local only. */
const KEY = "kart.headImg";
export const HEAD_PX = 192;

let cached: string | null | undefined;
const listeners = new Set<() => void>();

export function getCustomHead(): string | null {
  if (cached === undefined) {
    try {
      cached = localStorage.getItem(KEY);
    } catch {
      cached = null;
    }
  }
  return cached;
}

export function setCustomHead(dataUrl: string | null) {
  cached = dataUrl;
  try {
    if (dataUrl) localStorage.setItem(KEY, dataUrl);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode / quota: keep it for this session only */
  }
  listeners.forEach((f) => f());
}

export function onCustomHeadChange(f: () => void) {
  listeners.add(f);
}

/** Centre-crop any image/video frame to a HEAD_PX square JPEG data URL. */
export function squareFromSource(src: CanvasImageSource, w: number, h: number): string {
  const s = Math.min(w, h);
  const cv = document.createElement("canvas");
  cv.width = cv.height = HEAD_PX;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, HEAD_PX, HEAD_PX);
  return cv.toDataURL("image/jpeg", 0.85);
}

/** Read an uploaded/captured file, shrink it, save it. Rejects if it isn't a decodable image. */
export async function saveHeadFromFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    setCustomHead(squareFromSource(img, img.naturalWidth, img.naturalHeight));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Live camera modal. Resolves true if a photo was saved. Falls back to `fallback()` when no camera is available. */
export function captureHead(fallback: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fallback();
      resolve(false);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false })
      .then((stream) => {
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        video.style.cssText = "width:min(320px,80vw);aspect-ratio:1;object-fit:cover;border-radius:50%;background:#000;transform:scaleX(-1)";
        const mkBtn = (txt: string, sec: boolean) => {
          const b = document.createElement("button");
          b.className = "k-btn" + (sec ? " sec" : "");
          b.textContent = txt;
          return b;
        };
        const snap = mkBtn("Take photo", false);
        const cancel = mkBtn("Cancel", true);
        const row = document.createElement("div");
        row.className = "k-row";
        row.style.justifyContent = "center";
        row.append(cancel, snap);
        const box = document.createElement("div");
        box.className = "k-card";
        box.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:12px";
        const title = document.createElement("h3");
        title.textContent = "Take your driver photo";
        box.append(title, video, row);
        const back = document.createElement("div");
        back.style.cssText = "position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,10,.7)";
        back.append(box);
        const done = (ok: boolean) => {
          stream.getTracks().forEach((t) => t.stop());
          back.remove();
          resolve(ok);
        };
        cancel.onclick = () => done(false);
        snap.onclick = () => {
          if (video.videoWidth) setCustomHead(squareFromSource(video, video.videoWidth, video.videoHeight));
          done(!!video.videoWidth);
        };
        document.body.appendChild(back);
      })
      .catch(() => {
        fallback(); // permission denied / no camera: let the OS picker handle it
        resolve(false);
      });
  });
}
