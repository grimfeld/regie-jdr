import type { AfterPackContext } from 'electron-builder';

/** Flips the app's Electron fuses (no run-as-Node, etc.) on the given executable. */
export function lockDownFuses(exePath: string): Promise<void>;

/** electron-builder afterPack hook. */
export default function afterPack(context: AfterPackContext): Promise<void>;
