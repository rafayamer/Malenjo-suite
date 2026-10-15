import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { BUNDLED_MOTION_ASSETS, isBundledMotionAsset, mayPlayDecorativeMotion } from './policy';

interface AnimationPlayerProps {
  src: string;
  autoplay?: boolean;
  loop?: boolean;
  style?: CSSProperties;
}

interface Props {
  children: ReactNode;
  size?: number;
  enabled?: boolean;
}

/**
 * One-shot, low-impact LottieFiles UI accent. Static children remain usable if
 * motion is reduced, the user is on another tab, WASM is unavailable, or the
 * optional renderer fails to load. Nothing contacts lottiefiles.com at runtime.
 */
export default function RecentFilesMotion({ children, size = 28, enabled = true }: Props) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  const [Player, setPlayer] = useState<ComponentType<AnimationPlayerProps> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const asset = BUNDLED_MOTION_ASSETS.recentFiles;

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || typeof IntersectionObserver === 'undefined' ||
      typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inViewport = false;
    const refresh = () => setActive(mayPlayDecorativeMotion({
      inViewport, reducedMotion: media.matches,
      documentHidden: document.hidden, enabled,
    }));
    const observer = new IntersectionObserver((entries) => {
      inViewport = Boolean(entries[0]?.isIntersecting);
      refresh();
    }, { threshold: 0.25 });
    observer.observe(element);
    media.addEventListener?.('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      observer.disconnect();
      media.removeEventListener?.('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled]);

  useEffect(() => {
    if (!active || unavailable || Player || !isBundledMotionAsset(asset)) return;
    let cancelled = false;
    void import('@lottiefiles/dotlottie-react').then(({ DotLottieReact }) => {
      if (!cancelled) setPlayer(() => DotLottieReact as unknown as ComponentType<AnimationPlayerProps>);
    }).catch(() => {
      if (!cancelled) setUnavailable(true); // Keep the static, functional icon.
    });
    return () => { cancelled = true; };
  }, [active, asset, Player, unavailable]);

  return <span ref={wrapperRef} aria-hidden="true"
    style={{ display: 'inline-flex', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    {active && !unavailable && Player
      ? <Player src={asset} autoplay loop={false} style={{ width: size, height: size }} />
      : children}
  </span>;
}
