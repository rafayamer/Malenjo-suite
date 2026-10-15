/** Motion cannot compete with PDF rendering or require a network connection. */
export const BUNDLED_MOTION_ASSETS = {
  recentFiles: '/animations/lottiefiles-down.json',
} as const;

export interface MotionConditions {
  inViewport: boolean;
  reducedMotion: boolean;
  documentHidden: boolean;
  enabled: boolean;
}

export function mayPlayDecorativeMotion(state: MotionConditions): boolean {
  return state.enabled && state.inViewport && !state.reducedMotion && !state.documentHidden;
}

/** Every animated asset must be shipped with MALENJO, never fetched from an external host. */
export function isBundledMotionAsset(path: string): boolean {
  return /^\/animations\/[a-z0-9-]+\.(?:json|lottie)$/.test(path);
}
