/** Thumbnail image with a shimmer placeholder and an icon fallback when the renderer cannot produce one. */
import { useEffect, useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import { Icon } from '../parts/icons';
import { cachedThumb, loadThumb, thumbFailed } from './thumbs';

export function Thumb({ game, defId, tint, fallbackIcon, size = '4.25rem', alt = '' }: { game: GameController; defId: string; tint?: string | null; fallbackIcon: string; size?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(() => cachedThumb(defId, tint));
  const [failed, setFailed] = useState(() => thumbFailed(defId, tint));
  useEffect(() => {
    let alive = true;
    const hit = cachedThumb(defId, tint);
    setSrc(hit);
    setFailed(!hit && thumbFailed(defId, tint));
    if (!hit) {
      loadThumb(game, defId, tint).then(
        (url) => alive && setSrc(url),
        () => alive && setFailed(true),
      );
    }
    return () => {
      alive = false;
    };
  }, [defId, tint ?? '']);
  return (
    <span class={`hud-thumb${src ? ' is-ready' : failed ? ' is-failed' : ' is-loading'}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt={alt} draggable={false} decoding="async" /> : failed ? <Icon name={fallbackIcon} size="1.75rem" /> : <span class="hud-thumb__shimmer" />}
    </span>
  );
}
