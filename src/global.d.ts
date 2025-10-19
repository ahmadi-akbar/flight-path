import type { Controls } from "./managers/Controls.ts";

declare global {
  interface Window {
    earthTextureLoaded: boolean;
    minTimeElapsed: boolean;
    guiControlsInstance: Controls | null;
  }
}

export {};
