import { useEffect, useState } from 'react';
import type { BroadcastBridge } from '../shared/contract';
import type { OnAirState } from '../shared/domain';
import { latestOnAir } from '../core/onAir';

/**
 * The newest on-air snapshot, as the Broadcast window and the On-air monitor both show it;
 * null until the first one arrives.
 *
 * Subscribes first, then reads the current state (on every load, so also after a reload):
 * nothing is missed in between, and a snapshot older than the one shown is ignored. The
 * cleanup unsubscribes, so StrictMode's double effects leave a single listener.
 */
export function useOnAir(bridge: BroadcastBridge | undefined): OnAirState | null {
  const [onAir, setOnAir] = useState<OnAirState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    const show = (snapshot: OnAirState) => setOnAir((shown) => latestOnAir(shown, snapshot));
    const unsubscribe = bridge.onOnAirChanged(show);
    void bridge.getOnAir().then(show);
    return unsubscribe;
  }, [bridge]);
  return onAir;
}
