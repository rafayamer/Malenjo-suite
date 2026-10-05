import { useEffect, useState, type RefObject } from 'react';

export function useScrollFps(target: RefObject<HTMLElement | null>): number | null {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    const element = target.current;
    if (!element) return;

    let frame = 0;
    let running = false;
    let frames = 0;
    let started = 0;
    let lastScroll = 0;

    const sample = (now: number) => {
      frames += 1;
      const elapsed = now - started;

      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        if (now - lastScroll < 140) {
          started = now;
          frames = 0;
          frame = requestAnimationFrame(sample);
        } else {
          running = false;
        }
        return;
      }

      frame = requestAnimationFrame(sample);
    };

    const onScroll = () => {
      lastScroll = performance.now();
      if (running) return;
      running = true;
      frames = 0;
      started = performance.now();
      frame = requestAnimationFrame(sample);
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [target]);

  return fps;
}
