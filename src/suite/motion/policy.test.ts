import { describe, it, expect } from 'vitest';
import {
  BUNDLED_MOTION_ASSETS, isBundledMotionAsset, mayPlayDecorativeMotion,
} from './policy';

describe('accessible, offline decorative Lottie motion', () => {
  it('only plays when visible, allowed and user motion settings permit it', () => {
    const ready={inViewport:true,reducedMotion:false,documentHidden:false,enabled:true};
    expect(mayPlayDecorativeMotion(ready)).toBe(true);
    expect(mayPlayDecorativeMotion({...ready,inViewport:false})).toBe(false);
    expect(mayPlayDecorativeMotion({...ready,reducedMotion:true})).toBe(false);
    expect(mayPlayDecorativeMotion({...ready,documentHidden:true})).toBe(false);
    expect(mayPlayDecorativeMotion({...ready,enabled:false})).toBe(false);
  });

  it('never resolves remote or traversal animation assets', () => {
    expect(isBundledMotionAsset(BUNDLED_MOTION_ASSETS.recentFiles)).toBe(true);
    for (const path of [
      'https://lottiefiles.com/animation.json', '//cdn.example/animation.lottie',
      '/animations/../private.json', '/animations/folder.svg',
      '/animations/folder.json?token=1', 'data:application/json;base64,abc',
    ]) expect(isBundledMotionAsset(path)).toBe(false);
  });
});
