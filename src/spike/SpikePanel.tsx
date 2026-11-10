// THROWAWAY: Discord / single-monitor spike (#19). Not for merge.
import { useEffect, useRef, useState } from 'react';

type Where = 'control' | 'broadcast';

// Control window: one long LOW beep per second ("boop ... boop ...").
// Broadcast window: two short HIGH beeps per second ("bip-bip ... bip-bip ...").
const PATTERNS: Record<Where, { freq: number; beeps: [number, number][] }> = {
  control: { freq: 330, beeps: [[0, 0.45]] },
  broadcast: { freq: 1320, beeps: [[0, 0.1], [0.18, 0.1]] }
};

// The pattern is rendered into a 1-second buffer and looped by the audio
// engine, so it keeps playing even if the window's JavaScript is throttled.
function makePatternBuffer(ctx: AudioContext, where: Where): AudioBuffer {
  const { freq, beeps } = PATTERNS[where];
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, rate, rate);
  const data = buffer.getChannelData(0);
  const fade = 0.005 * rate;
  for (const [start, length] of beeps) {
    const s = Math.floor(start * rate);
    const n = Math.floor(length * rate);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / fade, (n - i) / fade);
      data[s + i] = 0.3 * env * Math.sin((2 * Math.PI * freq * i) / rate);
    }
  }
  return buffer;
}

function readFlags() {
  const params = new URLSearchParams(window.location.search);
  return {
    noThrottle: params.get('spikeNoThrottle') === '1',
    noOcclusion: params.get('spikeNoOcclusion') === '1'
  };
}

export function SpikePanel({ where }: { where: Where }) {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const flags = readFlags();

  // Moving clock, frame counter and bar, all driven by requestAnimationFrame:
  // if the window stops painting, they freeze on the stream.
  useEffect(() => {
    let frames = 0;
    let id = 0;
    const tick = () => {
      frames++;
      const now = new Date();
      const tenths = Math.floor(now.getMilliseconds() / 100);
      if (clockRef.current) clockRef.current.textContent = `${now.toLocaleTimeString('fr-FR')}.${tenths}`;
      if (frameRef.current) frameRef.current.textContent = String(frames);
      if (barRef.current) barRef.current.style.left = `${((now.getTime() % 4000) / 4000) * 90}%`;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => () => void ctxRef.current?.close(), []);

  function start() {
    const ctx = ctxRef.current ?? new AudioContext();
    ctxRef.current = ctx;
    void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = makePatternBuffer(ctx, where);
    source.loop = true;
    source.connect(ctx.destination);
    source.start();
    sourceRef.current = source;
    setPlaying(true);
  }

  function stop() {
    sourceRef.current?.stop();
    sourceRef.current = null;
    setPlaying(false);
  }

  const big = where === 'broadcast';
  const label = where === 'control' ? 'CONTROL tone: low "boop"' : 'BROADCAST tone: high "bip-bip"';

  return (
    <div
      style={{
        position: 'fixed', zIndex: 9999, left: 12, right: big ? 12 : 'auto', bottom: big ? 12 : 40,
        width: big ? 'auto' : 420, padding: 12, borderRadius: 8, fontFamily: 'monospace',
        background: 'rgba(0,0,0,0.85)', color: '#fff', border: '2px solid #ff0', fontSize: 14
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>SPIKE #19</strong>
        <button
          onClick={playing ? stop : start}
          style={{ padding: '6px 14px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer', background: playing ? '#f44' : '#4c4', color: '#000', border: 0, borderRadius: 4 }}
        >
          {playing ? 'STOP tone' : 'START tone'}
        </button>
        <span>{label}{playing ? ' (playing)' : ''}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: big ? 40 : 16, fontWeight: 'bold' }}>
        <span ref={clockRef}>--:--:--.-</span>{' '}
        <span style={{ fontSize: big ? 18 : 12, opacity: 0.8 }}>frame <span ref={frameRef}>0</span></span>
      </div>
      <div style={{ position: 'relative', height: big ? 24 : 10, marginTop: 6, background: '#333' }}>
        <div ref={barRef} style={{ position: 'absolute', top: 0, width: '10%', height: '100%', background: '#ff0' }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
        Broadcast window background throttling: {flags.noThrottle ? 'DISABLED' : 'normal'} · Window occlusion tracking:{' '}
        {flags.noOcclusion ? 'DISABLED' : 'normal'}
      </div>
    </div>
  );
}
