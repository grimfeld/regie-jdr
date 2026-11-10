export {};

declare global {
  interface Window {
    regie?: {
      openStage: () => Promise<boolean>;
      importImages: () => Promise<{ name: string; url: string }[]>;
      updateScene: (scene: unknown) => void;
      onSceneUpdated: (callback: (scene: unknown) => void) => void;
      toggleStageFullscreen: () => void;
    };
  }
}
