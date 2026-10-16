// Browser-only camera face tracking (MediaPipe Face Landmarker). Import dynamically.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface TrackedFace { x: number; y: number; width: number; blinkL: number; blinkR: number; mouth: number; roll: number; yaw: number }
export interface LiveState { camera: boolean; faces: TrackedFace[] }

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export async function startTracking(live: { current: LiveState }) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  const video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
  const files = await FilesetResolver.forVisionTasks(WASM);
  const landmarker = await FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true });
  let stopped = false, frame = 0, last = -1, lostFrames = 0;
  let smooth: TrackedFace[] = [];
  const loop = () => {
    if (stopped) return;
    if (video.currentTime !== last) {
      last = video.currentTime;
      const res = landmarker.detectForVideo(video, performance.now());
      const raw: TrackedFace[] = res.faceLandmarks.map((pts, i) => {
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
        const shapes = res.faceBlendshapes[i]?.categories ?? [];
        const get = (n: string) => shapes.find(c => c.categoryName === n)?.score ?? 0;
        const l = pts[33], r = pts[263], nose = pts[1];
        const roll = l && r ? Math.atan2(r.y - l.y, r.x - l.x) : 0;
        const yaw = nose ? ((nose.x - minX) / Math.max(0.001, maxX - minX) - 0.5) * 2 : 0;
        // Mirror horizontally so the character moves like a mirror.
        return { x: 1 - (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, blinkL: get('eyeBlinkRight'), blinkR: get('eyeBlinkLeft'), mouth: Math.min(1, get('jawOpen') * 1.6), roll: -roll, yaw: -yaw };
      }).sort((a, b) => a.x - b.x);
      if (raw.length === 0) { lostFrames++; if (lostFrames > 6) smooth = [] }
      else {
        lostFrames = 0;
        if (raw.length !== smooth.length) smooth = raw;
        else smooth = raw.map((f, i) => { const s = smooth[i]!; const k = 0.45; const mix = (a: number, b: number) => a + (b - a) * k; return { x: mix(s.x, f.x), y: mix(s.y, f.y), width: mix(s.width, f.width), blinkL: f.blinkL, blinkR: f.blinkR, mouth: mix(s.mouth, f.mouth), roll: mix(s.roll, f.roll), yaw: mix(s.yaw, f.yaw) } });
      }
      live.current.faces = smooth;
    }
    frame = requestAnimationFrame(loop);
  };
  live.current.camera = true; frame = requestAnimationFrame(loop);
  return () => { stopped = true; cancelAnimationFrame(frame); stream.getTracks().forEach(t => t.stop()); landmarker.close(); live.current = { camera: false, faces: [] } };
}
