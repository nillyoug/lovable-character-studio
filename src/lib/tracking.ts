// Browser-only camera face tracking (MediaPipe Face Landmarker). Import dynamically.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface TrackedFace { x: number; y: number; width: number; blinkL: number; blinkR: number; mouth: number; roll: number; yaw: number; pitch: number }
export interface LiveState { camera: boolean; faces: TrackedFace[] }

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const DETECT_INTERVAL = 33; // ~30 detections per second keeps phones smooth

export async function startTracking(live: { current: LiveState }) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 30 } }, audio: false });
  const video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
  const files = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO' as const, numFaces: 1, outputFaceBlendshapes: true });
  let landmarker: FaceLandmarker;
  try { landmarker = await FaceLandmarker.createFromOptions(files, opts('GPU')) } catch { landmarker = await FaceLandmarker.createFromOptions(files, opts('CPU')) }
  let stopped = false, frame = 0, lastVideo = -1, lastRun = 0, lost = 0;
  let smooth: TrackedFace | null = null;
  const loop = (now: number) => {
    if (stopped) return;
    frame = requestAnimationFrame(loop);
    if (now - lastRun < DETECT_INTERVAL || video.currentTime === lastVideo || video.readyState < 2) return;
    lastRun = now; lastVideo = video.currentTime;
    const res = landmarker.detectForVideo(video, now);
    const pts = res.faceLandmarks[0];
    if (!pts) { if (++lost > 8) { smooth = null; live.current.faces = [] } return }
    lost = 0;
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y }
    const shapes = res.faceBlendshapes[0]?.categories ?? [];
    const get = (n: string) => shapes.find(c => c.categoryName === n)?.score ?? 0;
    const l = pts[33], r = pts[263], nose = pts[1];
    const roll = l && r ? Math.atan2(r.y - l.y, r.x - l.x) : 0;
    const yaw = nose ? ((nose.x - minX) / Math.max(0.001, maxX - minX) - 0.5) * 2 : 0;
    const pitch = nose ? ((nose.y - minY) / Math.max(0.001, maxY - minY) - 0.55) * 2 : 0;
    // Mirrored so the character behaves like a mirror.
    const f: TrackedFace = { x: 1 - (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, blinkL: get('eyeBlinkRight'), blinkR: get('eyeBlinkLeft'), mouth: get('jawOpen'), roll: -roll, yaw: -yaw, pitch };
    if (!smooth) smooth = f;
    else { const s = smooth, k = 0.5, mix = (a: number, b: number) => a + (b - a) * k; smooth = { x: mix(s.x, f.x), y: mix(s.y, f.y), width: mix(s.width, f.width), blinkL: f.blinkL, blinkR: f.blinkR, mouth: f.mouth, roll: mix(s.roll, f.roll), yaw: mix(s.yaw, f.yaw), pitch: mix(s.pitch, f.pitch) } }
    live.current.faces = [smooth];
  };
  live.current.camera = true; frame = requestAnimationFrame(loop);
  return () => { stopped = true; cancelAnimationFrame(frame); stream.getTracks().forEach(t => t.stop()); landmarker.close(); live.current = { camera: false, faces: [] } };
}
