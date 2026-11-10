import type { BroadcastBridge } from '../shared/contract';
import { SceneCanvas } from './SceneCanvas';
import { useOnAir } from './useOnAir';

/**
 * The Broadcast window: the Active Scene's broadcast projection, drawn by the shared renderer
 * on the letterboxed 16:9 canvas, and nothing else. No buttons or other interactive elements,
 * no cursor, no theme (its fullscreen is toggled from the Control window). Which Scene is on
 * air is also exposed as data attributes.
 */
export default function BroadcastView({ bridge }: { bridge: BroadcastBridge | undefined }) {
  const onAir = useOnAir(bridge);

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
