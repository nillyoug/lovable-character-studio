export type Point = [number, number];
export type LayerKind = 'fur' | 'ear' | 'face' | 'hair' | 'eye' | 'detail' | 'mouth';
export type LayerSource = 'original' | 'under';
export interface ModelLayer { id: string; name: string; kind: LayerKind; source: LayerSource; points: Point[]; pivot: Point; side: number; sway?: boolean }

const box = (x1: number, y1: number, x2: number, y2: number): Point[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

/** Draw order, bottom → top. Fur sits under the face; the face base itself has no fur. */
export const layers: ModelLayer[] = [
  { id: 'fur-back', name: 'Fur · back fill', kind: 'fur', source: 'under', points: box(0, 240, 768, 768), pivot: [384, 450], side: 0 },
  { id: 'fur-left', name: 'Fur · left', kind: 'fur', source: 'under', points: box(0, 240, 262, 650), pivot: [250, 450], side: -1, sway: true },
  { id: 'fur-right', name: 'Fur · right', kind: 'fur', source: 'under', points: box(506, 240, 768, 650), pivot: [518, 450], side: 1, sway: true },
  { id: 'fur-chin', name: 'Fur · chin', kind: 'fur', source: 'under', points: box(190, 600, 578, 768), pivot: [384, 620], side: 0, sway: true },
  { id: 'ear-left', name: 'Left ear', kind: 'ear', source: 'original', points: [[140, 25], [215, 70], [290, 170], [335, 250], [320, 330], [240, 340], [170, 300], [118, 240], [112, 130]], pivot: [245, 305], side: -1 },
  { id: 'ear-right', name: 'Right ear', kind: 'ear', source: 'original', points: [[628, 25], [553, 70], [478, 170], [433, 250], [448, 330], [528, 340], [598, 300], [650, 240], [656, 130]], pivot: [523, 305], side: 1 },
  { id: 'face', name: 'Face · base (no fur)', kind: 'face', source: 'under', points: [[222, 298], [300, 318], [384, 304], [468, 318], [546, 298], [565, 360], [578, 428], [614, 448], [616, 545], [582, 562], [560, 612], [500, 652], [430, 672], [384, 678], [338, 672], [268, 652], [208, 612], [186, 562], [152, 545], [154, 448], [190, 428], [203, 360]], pivot: [384, 480], side: 0 },
  { id: 'horn-left', name: 'Left horn', kind: 'detail', source: 'original', points: [[211, 368], [207, 280], [233, 211], [246, 196], [306, 143], [280, 219], [291, 292], [320, 351], [300, 403], [240, 403]], pivot: [258, 371], side: -1 },
  { id: 'horn-right', name: 'Right horn', kind: 'detail', source: 'original', points: [[557, 368], [561, 280], [535, 211], [522, 196], [462, 143], [488, 219], [477, 292], [448, 351], [468, 403], [528, 403]], pivot: [510, 371], side: 1 },
  { id: 'top-hair', name: 'Top hair tuft', kind: 'hair', source: 'original', points: [[338, 300], [344, 257], [372, 218], [408, 204], [400, 250], [432, 245], [418, 279], [442, 288], [411, 304]], pivot: [384, 300], side: 0, sway: true },
  { id: 'eye-left', name: 'Left eye', kind: 'eye', source: 'original', points: [[214, 445], [299, 448], [349, 497], [330, 526], [243, 535], [219, 499]], pivot: [280, 493], side: -1 },
  { id: 'eye-right', name: 'Right eye', kind: 'eye', source: 'original', points: [[554, 445], [469, 448], [419, 497], [438, 526], [525, 535], [549, 499]], pivot: [488, 493], side: 1 },
  { id: 'mouth', name: 'Mouth', kind: 'mouth', source: 'original', points: [[299, 551], [470, 551], [462, 606], [420, 633], [350, 633], [307, 606]], pivot: [384, 568], side: 0 },
];

export function springStep(position: number, velocity: number, target: number, dt: number, stiffness = 90, damping = 15) {
  const step = Math.min(Math.max(dt, 0), 0.032);
  const nextVelocity = (velocity + (target - position) * stiffness * step) * Math.exp(-damping * step);
  return { position: position + nextVelocity * step, velocity: nextVelocity };
}
export function mouthAmount(value: number) { return Math.max(0, Math.min(1, value)); }

/** Microphone loudness (RMS 0..1) → mouth opening, with a noise gate. */
export function micToMouth(rms: number, gate = 0.02, gain = 9) { return mouthAmount((rms - gate) * gain); }

export type EarAction = 'twitch' | 'flick' | 'shake';
/** Extra ear rotation (radians) for a preset action, `t` seconds after it started. */
export function earActionOffset(action: EarAction, t: number, side: number) {
  if (t < 0) return 0;
  if (action === 'twitch') return t > 0.35 ? 0 : Math.sin((t / 0.35) * Math.PI) * 0.09 * side;
  if (action === 'flick') return t > 0.5 ? 0 : Math.sin((t / 0.5) * Math.PI) * -0.16 * side * (side < 0 ? 1 : 0.4);
  return t > 0.7 ? 0 : Math.sin(t * 55) * 0.05 * (1 - t / 0.7);
}

export function tracePolygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
}

/** Eye openness 0..1 from a blink score. Higher sensitivity closes sooner; past the threshold the eye is fully shut (0). */
export function eyeOpenness(blinkScore: number, sensitivity = 0.5) {
  const start = 0.55 - sensitivity * 0.35; const closed = (blinkScore - start) / 0.22;
  const c = Math.max(0, Math.min(1, closed)); return c > 0.85 ? 0 : 1 - c;
}
/** Mouth is either open or closed — no fading. Uses hysteresis so it doesn't flicker. */
export function mouthIsOpen(jaw: number, sensitivity = 0.5, wasOpen = false) {
  const v = jaw * (0.6 + sensitivity * 1.8); return wasOpen ? v > 0.18 : v > 0.28;
}
