import { useEffect, useState } from 'react';
import type { BroadcastBridge } from '../shared/contract';
import type { OnAirState } from '../shared/domain';
import { latestOnAir } from '../core/onAir';
import { SceneCanvas } from './SceneCanvas';

/**
 * The Broadcast window: the Active Scene's broadcast projection, drawn by the shared renderer
 * on the letterboxed 16:9 canvas, and nothing else. No buttons or other interactive elements,
 * no cursor, no theme (its fullscreen is toggled from the Control window). Which Scene is on
 * air is also exposed as data attributes.
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
      <SceneCanvas picture={onAir?.scene ?? null} blackout={onAir?.blackout} window="broadcast" />
    </main>
  );
}
