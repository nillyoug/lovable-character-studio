import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Download, Maximize, Minimize, Minus, Plus, RotateCcw, Scan } from 'lucide-react';
import { ModelCanvas, type ModelSettings, type ModelAction, type View } from '@/components/ModelCanvas';
import type { LiveState } from '@/lib/tracking';

export const Route = createFileRoute('/')({
  ssr: false,
  head: () => ({ meta: [
    { title: 'Neko · Live VTuber Model' },
    { name: 'description', content: 'A camera-tracked blue cat VTuber model with reactive fur, twitching ears, blinking and talking.' },
    { property: 'og:title', content: 'Neko · Live VTuber Model' },
    { property: 'og:description', content: 'Camera-tracked blue cat VTuber model with reactive fur and ears.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Index,
});

const DEFAULTS: ModelSettings = { fur: 0.6, ears: 0.6, blink: 0.5, mouth: 0.5 };
const SLIDERS: { key: keyof ModelSettings; label: string }[] = [
  { key: 'fur', label: 'Fur sensitivity' },
  { key: 'ears', label: 'Ear sensitivity' },
  { key: 'blink', label: 'Blink sensitivity' },
  { key: 'mouth', label: 'Mouth sensitivity' },
];

function Index() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [status, setStatus] = useState('Loading');
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off');
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const live = useRef<LiveState>({ camera: false, faces: [] });
  const view = useRef<View>({ zoom: 1, x: 0, y: 0 });
  const action = useRef<((a: ModelAction) => Promise<void>) | null>(null);
  const stopCam = useRef<(() => void) | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const s = localStorage.getItem('neko-settings'); if (s) setSettings({ ...DEFAULTS, ...JSON.parse(s) }) } catch { /* ignore */ } }, []);
  useEffect(() => { localStorage.setItem('neko-settings', JSON.stringify(settings)) }, [settings]);
  useEffect(() => { const f = () => { if (!document.fullscreenElement) setFull(false) }; document.addEventListener('fullscreenchange', f); return () => { document.removeEventListener('fullscreenchange', f); stopCam.current?.() } }, []);

  const toggleCamera = async () => {
    if (stopCam.current) { stopCam.current(); stopCam.current = null; setCamera('off'); setStatus('Ready'); return }
    setCamera('starting'); setStatus('Starting camera');
    try { const { startTracking } = await import('@/lib/tracking'); stopCam.current = await startTracking(live); setCamera('on'); setStatus('Tracking') }
    catch { setCamera('off'); setStatus('Camera blocked — allow access and retry') }
  };
  const changeZoom = (z: number) => { const v = Math.max(0.4, Math.min(3, z)); view.current.zoom = v; setZoom(v) };
  const recenter = () => { view.current = { zoom: 1, x: 0, y: 0 }; setZoom(1) };
  const toggleFull = async () => {
    if (full) { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); setFull(false); return }
    setFull(true); await stage.current?.requestFullscreen?.().catch(() => {});
  };
  const exportModel = async () => { try { await action.current?.('export') } catch { setStatus('Export failed — retry') } };

  return (
    <main className="app">
      <header className="bar">
        <span className="brand">neko</span>
        <div className="bar-actions">
          <button className="icon-btn" onClick={exportModel} aria-label="Export .rcneko"><Download /></button>
          <button className={`pill ${camera === 'on' ? 'pill-on' : ''}`} onClick={toggleCamera} disabled={camera === 'starting'}>
            {camera === 'on' ? <CameraOff /> : <Camera />}{camera === 'on' ? 'Stop' : camera === 'starting' ? 'Starting' : 'Camera'}
          </button>
        </div>
      </header>

      <div ref={stage} className={`stage ${full ? 'stage-full' : ''}`}>
        <div className="canvas-wrap">
          <ModelCanvas settings={settings} live={live} view={view} actionRef={action}
            onReady={() => setStatus('Ready')} onError={setStatus} onZoom={setZoom} />
        </div>
        <div className="stage-status"><span className={`dot ${camera === 'on' ? 'dot-on' : ''}`} />{status}</div>
        <button className="icon-btn stage-full-btn" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? <Minimize /> : <Maximize />}</button>
        <div className="zoom">
          <button onClick={() => changeZoom(zoom - 0.1)} aria-label="Zoom out"><Minus /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => changeZoom(zoom + 0.1)} aria-label="Zoom in"><Plus /></button>
          <i />
          <button onClick={recenter} aria-label="Recenter"><Scan /></button>
        </div>
      </div>

      <section className="settings">
        <div className="settings-head"><h2>Settings</h2><button className="icon-btn" onClick={() => setSettings(DEFAULTS)} aria-label="Reset settings"><RotateCcw /></button></div>
        {SLIDERS.map(({ key, label }) => (
          <label key={key} className="slider">
            <span><b>{label}</b><em>{Math.round(settings[key] * 100)}</em></span>
            <input type="range" min={0} max={1} step={0.01} value={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: Number(e.target.value) }))} />
          </label>
        ))}
        <p className="hint">Drag to move · pinch or scroll to zoom</p>
      </section>
    </main>
  );
}
