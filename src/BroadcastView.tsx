import { useEffect, useState, type CSSProperties } from 'react';
import type { BroadcastBridge } from '../shared/contract';
import type { NormalizedPoint, OnAirScene, OnAirState } from '../shared/domain';
import { latestOnAir } from '../core/onAir';
import { MediaImage } from './MediaImage';

/** The Broadcast window's fullscreen button: the page's own fullscreen, no IPC needed. */
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}

/** A normalized point as CSS custom properties, read by the Broadcast window styles. */
function at({ x, y }: NormalizedPoint, extra: Record<string, string> = {}): CSSProperties {
  return { '--x': `${x * 100}%`, '--y': `${y * 100}%`, ...extra } as CSSProperties;
}

/**
 * The Active Scene's picture, filling the window: Backgrounds stacked bottom to top, then the
 * Overlays by stacking order. Only visible placements are ever sent here. Images go through
 * MediaImage, which shows nothing for a missing Media. (The fixed 16:9 canvas is Milestone 1.)
 */
function BroadcastPicture({ scene }: { scene: OnAirScene }) {
  const overlays = [...scene.overlays].sort((a, b) => a.zIndex - b.zIndex);
  return (
    <>
      {scene.backgrounds.map((background) => (
        <div
          key={background.id}
          className={`broadcast-layer fit-${background.fit}`}
          data-background-id={background.id}
          style={at(background.position)}
        >
          <MediaImage address={background.src} alt="" window="broadcast" />
        </div>
      ))}
      {overlays.map((overlay) => (
        <div
          key={overlay.id}
          className="broadcast-overlay"
          data-overlay-id={overlay.id}
          style={at(overlay.position, { '--height': `${overlay.scale * 100}%` })}
        >
          <MediaImage address={overlay.src} alt="" window="broadcast" />
        </div>
      ))}
    </>
  );
}

/**
 * The Broadcast window: shows exactly what is on air, the Active Scene's picture. Which Scene
 * is on air is also exposed as data attributes.
 */
export default function BroadcastView({ bridge }: { bridge: BroadcastBridge | undefined }) {
  const [onAir, setOnAir] = useState<OnAirState | null>(null);

  // Subscribe first, then read the current state (on every load, so also after a reload):
  // nothing is missed in between, and a snapshot older than the one shown is ignored.
  // The cleanup unsubscribes, so StrictMode's double effects leave a single listener.
  useEffect(() => {
    if (!bridge) return;
    const show = (snapshot: OnAirState) => setOnAir((shown) => latestOnAir(shown, snapshot));
    const unsubscribe = bridge.onOnAirChanged(show);
    void bridge.getOnAir().then(show);
    return unsubscribe;
  }, [bridge]);

  return (
    <main
      className="broadcast-screen"
      data-campaign-id={onAir ? (onAir.campaignId ?? '') : undefined}
      data-active-scene-id={onAir ? (onAir.activeSceneId ?? '') : undefined}
      data-version={onAir?.version}
    >
      {onAir?.scene && <BroadcastPicture scene={onAir.scene} />}
      <button className="broadcast-fullscreen" onClick={toggleFullscreen} title="Plein écran">
        ⛶
      </button>
    </main>
  );
}
