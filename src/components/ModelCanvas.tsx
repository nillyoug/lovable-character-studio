import { useEffect, useRef } from 'react';
import { strToU8 } from 'fflate';
import originalUrl from '@/assets/model/neko-original.png';
import underpaintUrl from '@/assets/model/underpaint.png';
import mouthUrl from '@/assets/model/open-mouth.png';
import { earActionOffset, eyeOpenness, layers, mouthIsOpen, springStep, tracePolygon, type ModelLayer } from '@/lib/model/rig';
import { packRcneko, RCNEKO_MIME } from '@/lib/model/rcneko';
import type { LiveState } from '@/lib/tracking';

export interface ModelSettings { fur: number; ears: number; blink: number; mouth: number }
export interface View { zoom: number; x: number; y: number }
export type ModelAction = 'export';
interface Props {
  settings: ModelSettings; live: React.RefObject<LiveState>; view: React.RefObject<View>;
  onReady: () => void; onError: (msg: string) => void; onZoom: (z: number) => void;
  actionRef: React.RefObject<((action: ModelAction) => Promise<void>) | null>;
}
const S = 768, C = 1024;
const clampZoom = (z: number) => Math.max(0.4, Math.min(3, z));
function makeCanvas(w = S, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
function loadImage(url: string) { return new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => resolve(i); i.onerror = () => reject(new Error('Artwork could not load')); i.src = url }) }
function saveBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000) }
async function bytes(c: HTMLCanvasElement) { const b = await new Promise<Blob>((res, rej) => c.toBlob(x => x ? res(x) : rej(new Error('Export failed')), 'image/png')); return new Uint8Array(await b.arrayBuffer()) }

/** Removes the white background and un-mixes white from anti-aliased edges. */
function cutOut(image: HTMLImageElement) {
  const c = makeCanvas(); const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(image, 0, 0, S, S);
  const img = x.getImageData(0, 0, S, S); const d = img.data; const bg = new Uint8Array(S * S); const queue: number[] = [];
  for (let n = 0; n < S; n++) queue.push(n, n + (S - 1) * S, n * S, n * S + S - 1);
  const whiteish = (i: number) => { const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!; return r > 200 && g > 200 && b > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 24 };
  for (let k = 0; k < queue.length; k++) { const at = queue[k]!; if (bg[at] || !whiteish(at * 4)) continue; bg[at] = 1; const col = at % S; if (col > 0) queue.push(at - 1); if (col < S - 1) queue.push(at + 1); if (at >= S) queue.push(at - S); if (at < S * (S - 1)) queue.push(at + S) }
  const dist = new Uint8Array(S * S).fill(255);
  for (let i = 0; i < S * S; i++) if (bg[i]) dist[i] = 0;
  for (let pass = 1; pass <= 3; pass++) for (let i = 0; i < S * S; i++) { if (dist[i]! <= pass) continue; const col = i % S; if ((col > 0 && dist[i - 1] === pass - 1) || (col < S - 1 && dist[i + 1] === pass - 1) || (i >= S && dist[i - S] === pass - 1) || (i < S * (S - 1) && dist[i + S] === pass - 1)) dist[i] = pass }
  for (let i = 0; i < S * S; i++) {
    const p = i * 4;
    if (bg[i]) { d[p + 3] = 0; continue }
    if (dist[i]! <= 3) {
      const r = d[p]!, g = d[p + 1]!, b = d[p + 2]!;
      let a = Math.min(1, (Math.max(255 - r, 255 - g, 255 - b) / 255) * 1.15); if (dist[i] === 1) a *= 0.85;
      if (a < 0.06) { d[p + 3] = 0; continue }
      d[p] = Math.max(0, Math.min(255, (r - 255 * (1 - a)) / a)); d[p + 1] = Math.max(0, Math.min(255, (g - 255 * (1 - a)) / a)); d[p + 2] = Math.max(0, Math.min(255, (b - 255 * (1 - a)) / a)); d[p + 3] = Math.round(a * 255);
    }
  }
  x.putImageData(img, 0, 0); return c;
}

interface Sprite { c: HTMLCanvasElement; x: number; y: number }
/** Crops each layer to its own bounds so each frame draws small images instead of 13 full-size canvases. */
function extract(layer: ModelLayer, image: HTMLCanvasElement): Sprite {
  const xs = layer.points.map(p => p[0]), ys = layer.points.map(p => p[1]);
  const x = Math.max(0, Math.floor(Math.min(...xs)) - 2), y = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const w = Math.min(S, Math.ceil(Math.max(...xs)) + 2) - x, h = Math.min(S, Math.ceil(Math.max(...ys)) + 2) - y;
  const c = makeCanvas(w, h); const g = c.getContext('2d')!; g.translate(-x, -y); tracePolygon(g, layer.points); g.clip(); g.drawImage(image, 0, 0);
  return { c, x, y };
}

export function ModelCanvas({ settings, live, view, onReady, onError, onZoom, actionRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const cb = useRef({ onReady, onError, onZoom }); cb.current = { onReady, onError, onZoom };

  useEffect(() => {
    let disposed = false, frame = 0; const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const css = getComputedStyle(canvas); const eyeBacking = css.getPropertyValue('--eye-backing') || '#1b2440'; const lidColor = css.getPropertyValue('--eye-lid') || '#0a0f1e';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motion = layers.map(() => ({ position: 0, velocity: 0 }));
    let previous = 0, mouthOpen = false, lastHead = { roll: 0, yaw: 0, pitch: 0 }, nextTwitch = 2, twitch: { at: number; side: number; strength: number } | null = null;

    Promise.all([loadImage(originalUrl), loadImage(underpaintUrl), loadImage(mouthUrl)]).then(([src, under, open]) => {
      if (disposed) return;
      const original = cutOut(src), underpainting = cutOut(under), opened = cutOut(open);
      const sprites = layers.map(l => extract(l, l.source === 'under' ? underpainting : original));
      const mouthIdx = layers.findIndex(l => l.id === 'mouth');
      const openSprite = extract(layers[mouthIdx]!, opened);
      cb.current.onReady();

      actionRef.current = async () => {
        const files: Record<string, Uint8Array> = {};
        for (let i = 0; i < layers.length; i++) { const full = makeCanvas(); full.getContext('2d')!.drawImage(sprites[i]!.c, sprites[i]!.x, sprites[i]!.y); files[`layers/${String(i + 1).padStart(2, '0')}-${layers[i]!.id}.png`] = await bytes(full) }
        const m = makeCanvas(); m.getContext('2d')!.drawImage(openSprite.c, openSprite.x, openSprite.y); files['layers/mouth-open.png'] = await bytes(m);
        files['rig.json'] = strToU8(JSON.stringify({ format: 'Neko browser 2D rig', width: S, height: S, drawOrder: 'bottom to top', layers }, null, 2));
        files['README.txt'] = strToU8('NEKO model (.rcneko)\nZIP container. Composite layers/01..13 bottom to top on a 768x768 canvas. mouth-open.png replaces the mouth when open.');
        const { bytes: packed, filename } = packRcneko(files, 'neko');
        saveBlob(new Blob([new Uint8Array(packed)], { type: RCNEKO_MIME }), filename);
      };

      const draw = (now: number) => {
        if (disposed) return; frame = requestAnimationFrame(draw);
        const s = settingsRef.current; const t = now / 1000; const dt = Math.min(previous ? t - previous : 1 / 60, 0.05); previous = t;
        const state = live.current; const face = state?.camera ? state.faces[0] ?? null : null;
        const idle = !reduced;
        // Head movement speed drives extra fur & ear bounce while the camera is on.
        let headVel = 0, headSide = 0;
        if (face) {
          const dr = face.roll - lastHead.roll, dy = face.yaw - lastHead.yaw, dp = face.pitch - lastHead.pitch;
          headVel = (dr * 2 + dy * 0.6 + dp * 0.4) / Math.max(dt, 1 / 120); headSide = dr + dy * 0.3;
          lastHead = { roll: face.roll, yaw: face.yaw, pitch: face.pitch };
          if (t > nextTwitch) { const r = Math.random(); twitch = { at: t, side: r < 0.4 ? -1 : r < 0.8 ? 1 : 0, strength: 0.7 + Math.random() * 0.6 }; nextTwitch = t + 2.2 + Math.random() * 4.5 }
        } else twitch = null;
        const furK = s.fur * 2, earK = s.ears * 2;

        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, C, C);
        const v = view.current!; const scale = 1.17 * v.zoom; const breath = idle ? Math.sin(t * 1.8) * 1.2 : 0;
        const tilt = face ? face.roll * 0.35 : 0;
        ctx.translate(C / 2 + v.x, C / 2 + v.y + breath); ctx.rotate(tilt); ctx.scale(scale, scale); ctx.translate(-S / 2, -S / 2);

        for (let i = 0; i < layers.length; i++) {
          const l = layers[i]!, sp = sprites[i]!, m = motion[i]!;
          let goal = 0;
          if (l.kind === 'ear') {
            if (idle) goal += (Math.sin(t * 1.2 + l.side * 2) * 0.014 + Math.pow(Math.max(0, Math.sin(t * 0.72 + l.side * 1.7)), 22) * l.side * 0.06) * (0.5 + s.ears);
            if (face) {
              goal += face.roll * 0.5 * earK - face.pitch * 0.08 * earK * l.side;
              m.velocity += headVel * 0.035 * earK * l.side * dt * 60 * 0.1 + headSide * l.side * 0.8 * earK;
              if (twitch && (twitch.side === 0 || twitch.side === l.side)) { const e = t - twitch.at; goal += earActionOffset('twitch', e, l.side) * 1.6 * earK * twitch.strength + (e < 0.45 ? Math.sin(e * 70) * 0.025 * earK * (1 - e / 0.45) : 0) }
            }
          }
          if (l.sway) {
            if (idle) goal += Math.sin(t * 1.5 + i * 1.3) * (l.kind === 'fur' ? 0.018 : 0.03) * (0.5 + s.fur);
            if (face) {
              goal += (-face.roll * 0.45 + face.yaw * 0.08) * furK;
              m.velocity += -headSide * 1.4 * furK + headVel * 0.004 * furK * (l.side || 1);
            }
          }
          const next = springStep(m.position, m.velocity, goal, dt, 90, face ? 9 : 14); m.position = Math.max(-0.5, Math.min(0.5, next.position)); m.velocity = next.velocity;

          ctx.save();
          if (m.position !== 0) { ctx.translate(l.pivot[0], l.pivot[1]); ctx.rotate(m.position); ctx.translate(-l.pivot[0], -l.pivot[1]) }
          if (l.kind === 'eye') {
            let openness = 1;
            if (face) openness = eyeOpenness(l.side < 0 ? face.blinkL : face.blinkR, s.blink);
            else if (idle) { const ph = t % 5.8; openness = ph > 5.5 ? (Math.abs(ph - 5.65) < 0.06 ? 0 : Math.abs(ph - 5.65) / 0.15) : 1 }
            if (openness < 0.98) {
              ctx.save(); tracePolygon(ctx, l.points); ctx.clip(); ctx.fillStyle = eyeBacking; ctx.fillRect(sp.x, sp.y, sp.c.width, sp.c.height); ctx.restore();
              if (openness <= 0.02) { // fully shut: draw a lid line instead of the eye
                ctx.beginPath(); ctx.moveTo(l.points[0]![0] + l.side * -6, l.pivot[1] + 4); ctx.quadraticCurveTo(l.pivot[0], l.pivot[1] + 18, l.points[2]![0] + l.side * 4, l.pivot[1] + 4);
                ctx.strokeStyle = lidColor; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore(); continue;
              }
              ctx.translate(0, l.pivot[1]); ctx.scale(1, openness); ctx.translate(0, -l.pivot[1]);
            }
          }
          if (i === mouthIdx) {
            const jaw = face ? face.mouth : 0; mouthOpen = face ? mouthIsOpen(jaw, s.mouth, mouthOpen) : false;
            ctx.drawImage(sp.c, sp.x, sp.y); if (mouthOpen) ctx.drawImage(openSprite.c, openSprite.x, openSprite.y);
          } else ctx.drawImage(sp.c, sp.x, sp.y);
          ctx.restore();
        }
      };
      frame = requestAnimationFrame(draw);
    }).catch(() => cb.current.onError('Artwork unavailable — refresh to retry'));
    return () => { disposed = true; cancelAnimationFrame(frame); actionRef.current = null };
  }, [actionRef, live, view]);

  // Drag to move, pinch or scroll to zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>()); const pinch = useRef(0);
  const toCanvas = (e: React.PointerEvent | React.WheelEvent) => { const b = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect(); return C / b.width };
  const setZoom = (z: number) => { view.current!.zoom = clampZoom(z); cb.current.onZoom(view.current!.zoom) };
  return <canvas ref={ref} width={C} height={C} className="model-canvas" aria-label="Neko character — drag to move, pinch or scroll to zoom"
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }) }}
    onPointerMove={e => {
      const p = pointers.current.get(e.pointerId); if (!p) return; const k = toCanvas(e);
      if (pointers.current.size === 1) { view.current!.x += (e.clientX - p.x) * k; view.current!.y += (e.clientY - p.y) * k }
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y); if (pinch.current) setZoom(view.current!.zoom * d / pinch.current); pinch.current = d }
    }}
    onPointerUp={e => { pointers.current.delete(e.pointerId); pinch.current = 0 }}
    onPointerCancel={e => { pointers.current.delete(e.pointerId); pinch.current = 0 }}
    onWheel={e => setZoom(view.current!.zoom * (e.deltaY < 0 ? 1.08 : 0.93))}
  />;
}
