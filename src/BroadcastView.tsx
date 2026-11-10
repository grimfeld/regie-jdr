import { useEffect, useState } from 'react';
import type { BroadcastBridge } from '../shared/contract';
import type { OnAirState } from '../shared/domain';
import { latestOnAir } from '../core/onAir';

/** The Broadcast window's fullscreen button: the page's own fullscreen, no IPC needed. */
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}

/**
 * The Broadcast window: shows exactly what is on air. Until Scenes are rendered (Milestone 1)
 * it shows an empty stage and exposes which Scene is on air as data attributes.
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
      className="stage-screen"
      data-campaign-id={onAir ? (onAir.campaignId ?? '') : undefined}
      data-active-scene-id={onAir ? (onAir.activeSceneId ?? '') : undefined}
      data-version={onAir?.version}
    >
      <button className="stage-fullscreen" onClick={toggleFullscreen} title="Plein écran">
        ⛶
      </button>
    </main>
  );
}
