/**
 * Turntable stage: owns the <canvas> handed to game.createCazPreview(), drag/keyboard rotation, pose buttons.
 * The PreviewStage is created once per mount and disposed on unmount; appearance/pose/size are pushed to it.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AnimState, ZombieAppearance } from '../../../../shared/appearance';
import { intactLimbs } from '../../../../shared/appearance';
import type { PreviewBodyStatus, PreviewStage } from '../../../../render/contracts';
import { castBody, isCastBodyId } from '../../../../shared/cast';
import { t } from '../../../../i18n';
import { useElementSize, useGameController } from '../../../hooks';
import { IconButton } from '../../../common/IconButton';
import { Segmented } from '../../../common/Segmented';
import type { IconName } from '../../../icons';
import { poseExpression, wrapYaw, yawDegrees } from '../../cazLogic';

export const CAZ_POSES: { id: AnimState; icon: IconName }[] = [
  { id: 'idle', icon: 'user' },
  { id: 'walk', icon: 'live' },
  { id: 'dance', icon: 'dance' },
  { id: 'wave', icon: 'wave' },
  { id: 'laugh', icon: 'joke' },
  { id: 'groan', icon: 'zzz' },
];

function safe(fn: () => void) {
  try {
    fn();
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[caz] preview call failed', err);
  }
}

export function CazStage({ appearance, memberKey, tryOnName = '' }: { appearance: ZombieAppearance; memberKey: number; /** Name of the premium body shown as a preview ('' = none). */ tryOnName?: string }) {
  const game = useGameController();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<PreviewStage | null>(null);
  const yawRef = useRef(0);
  const tweenRef = useRef(0);
  const dragRef = useRef<{ x: number; id: number } | null>(null);
  const [pose, setPose] = useState<AnimState>('idle');
  const [dragging, setDragging] = useState(false);
  const [hintSeen, setHintSeen] = useState(false);
  // Turntable angle for assistive tech (updated when a turn settles, not every drag frame).
  const [facing, setFacing] = useState(0);
  const size = useElementSize(wrapRef);
  // W-130: the turntable shows the classic body while a cast body loads (or offline / after a failure) — say so,
  // so a player who picked Cone-Head is never shown Classic without a word.
  const [bodyStatus, setBodyStatus] = useState<PreviewBodyStatus>('ready');
  const wantedBody = (appearance as { body?: unknown }).body;
  useEffect(() => {
    if (!isCastBodyId(wantedBody)) {
      setBodyStatus('ready');
      return;
    }
    const poll = () => {
      const s = stageRef.current;
      let st: PreviewBodyStatus = 'ready';
      try {
        st = s && typeof s.bodyStatus === 'function' ? s.bodyStatus() : 'ready';
      } catch {
        st = 'ready';
      }
      setBodyStatus(st);
    };
    poll();
    const id = setInterval(poll, 400);
    return () => clearInterval(id);
  }, [wantedBody]);
  const bodyName = isCastBodyId(wantedBody) ? castBody(wantedBody).name : '';
  // Narrow stage (small window or large UI scale): poses become icon-only buttons with tooltips.
  const remPx = typeof document !== 'undefined' ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 : 16;
  const compactPoses = size.width > 0 && size.width < remPx * 31;
  const appRef = useRef(appearance);
  appRef.current = appearance;
  const poseRef = useRef(pose);
  poseRef.current = pose;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stage: PreviewStage | null = null;
    try {
      stage = game.createCazPreview(canvas);
    } catch (err) {
      console.error('[caz] createCazPreview failed', err);
    }
    stageRef.current = stage;
    if (stage) {
      const s = stage;
      safe(() => s.setLimbs(intactLimbs()));
      safe(() => s.setAppearance(appRef.current));
      safe(() => s.setAnim(poseRef.current));
      safe(() => s.setExpression(poseExpression(poseRef.current)));
      safe(() => s.setYaw(yawRef.current));
    }
    return () => {
      cancelAnimationFrame(tweenRef.current);
      if (stage) {
        const s = stage;
        safe(() => s.dispose());
      }
      stageRef.current = null;
    };
  }, [game]);

  useEffect(() => {
    const s = stageRef.current;
    if (s) safe(() => s.setAppearance(appearance));
  }, [appearance]);

  // A fresh zombie greets you.
  useEffect(() => {
    if (memberKey < 0) return;
    setPose('wave');
    const id = setTimeout(() => setPose((p) => (p === 'wave' ? 'idle' : p)), 2600);
    return () => clearTimeout(id);
  }, [memberKey]);

  useEffect(() => {
    const s = stageRef.current;
    if (!s) return;
    safe(() => s.setAnim(pose));
    safe(() => s.setExpression(poseExpression(pose)));
  }, [pose]);

  useEffect(() => {
    const s = stageRef.current;
    if (!s || size.width <= 0 || size.height <= 0) return;
    safe(() => s.resize(size.width, size.height));
  }, [size.width, size.height]);

  const setYaw = (y: number) => {
    yawRef.current = wrapYaw(y);
    const s = stageRef.current;
    if (s) safe(() => s.setYaw(yawRef.current));
  };
  const settle = () => setFacing(yawDegrees(yawRef.current));

  const turnBy = (delta: number) => {
    cancelAnimationFrame(tweenRef.current);
    const from = yawRef.current;
    const to = from + delta;
    const reduce = document.documentElement.classList.contains('reduce-motion');
    if (reduce) {
      setYaw(to);
      settle();
      return;
    }
    const start = performance.now();
    const dur = 260;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setYaw(from + (to - from) * e);
      if (k < 1) tweenRef.current = requestAnimationFrame(step);
      else settle();
    };
    tweenRef.current = requestAnimationFrame(step);
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(tweenRef.current);
    dragRef.current = { x: e.clientX, id: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(true);
    setHintSeen(true);
  };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    d.x = e.clientX;
    setYaw(yawRef.current + dx * 0.012);
  };
  const onPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    settle();
  };
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    let delta: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -Math.PI / 12;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = Math.PI / 12;
    else if (e.key === 'PageDown') delta = -Math.PI / 2;
    else if (e.key === 'PageUp') delta = Math.PI / 2;
    else if (e.key === 'Home') delta = -wrapYaw(yawRef.current); // back to facing the camera
    if (delta === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (delta !== 0) turnBy(delta);
    setHintSeen(true);
  };

  return (
    <div class="sh-stage">
      <div class="sh-stage__spot" aria-hidden="true" />
      <div class="sh-stage__plinth" aria-hidden="true" />
      <div
        ref={wrapRef}
        class={dragging ? 'sh-stage__canvas is-dragging' : 'sh-stage__canvas'}
        role="slider"
        data-surface="" /* a drag surface with its own controls on top (tests/e2e/lib/shellAudit.mjs) */
        aria-label={t('caz.stageLabel')}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={facing}
        aria-valuetext={t('caz.facing', { deg: facing })}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} class="sh-stage__gl" />
      </div>
      <div class={hintSeen ? 'sh-stage__hint is-hidden' : 'sh-stage__hint'} aria-hidden="true">
        {t('caz.dragHint')}
      </div>
      {tryOnName ? (
        <div class="sh-stage__tryon" role="status" aria-live="polite" data-testid="caz-tryon-stage">
          <strong>{t('caz.tryOnStage', { name: tryOnName })}</strong>
          <span>{t('caz.tryOnStageSub')}</span>
        </div>
      ) : null}
      {bodyStatus !== 'ready' && bodyName ? (
        <div class={`sh-stage__body sh-stage__body--${bodyStatus}`} role="status" aria-live="polite" data-testid="caz-body-status">
          {t(`caz.body.${bodyStatus}`, { name: bodyName })}
        </div>
      ) : null}
      <div class="sh-stage__turn sh-stage__turn--left">
        <IconButton icon="rotateLeft" label={t('caz.rotateLeft')} variant="glass" onClick={() => turnBy(-Math.PI / 4)} />
      </div>
      <div class="sh-stage__turn sh-stage__turn--right">
        <IconButton icon="rotateRight" label={t('caz.rotateRight')} variant="glass" onClick={() => turnBy(Math.PI / 4)} />
      </div>
      <div class={compactPoses ? 'sh-stage__poses is-compact' : 'sh-stage__poses'}>
        <Segmented
          value={pose}
          onChange={setPose}
          ariaLabel={t('caz.poses')}
          size="sm"
          options={CAZ_POSES.map((p) =>
            compactPoses
              ? { value: p.id, label: '', icon: p.icon, ariaLabel: t(`caz.pose.${p.id}`), tooltip: t(`caz.pose.${p.id}`) }
              : { value: p.id, label: t(`caz.pose.${p.id}`), icon: p.icon },
          )}
        />
      </div>
    </div>
  );
}
