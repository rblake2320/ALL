import { describe, expect, it } from 'vitest';
import { EventRouter, MAX_SFX_PER_FRAME, eventWorldPos, hashSeed, type RouterHost } from '../../../src/game/events';
import { BubbleBoard, TOAST_DEDUPE_MS, TOAST_MAX, ToastCenter, toastTtlMs } from '../../../src/game/toasts';
import { MusicDirector, chooseMusic, MUSIC_OVERRIDE_MS, type MusicContext } from '../../../src/game/music';
import { computeSpatial, OFFSCREEN_GAIN } from '../../../src/game/spatialAudio';
import type { SimEvent } from '../../../src/sim/contracts';
import { FakeAudio, FakeRenderer, FakeSim, makeWorld } from './fakes';

function setup(opts: { interactive?: boolean; speedMps?: number } = {}) {
  let t = 10_000;
  const audio = new FakeAudio();
  const renderer = new FakeRenderer();
  const toasts = new ToastCenter(() => t);
  const bubbles = new BubbleBoard();
  const sim = new FakeSim(makeWorld());
  const log: string[] = [];
  const host: RouterHost = {
    audio,
    renderer,
    viewport: () => ({ width: 1280, height: 720 }),
    now: () => t,
    toasts,
    bubbles,
    gameMinutesPerSecond: () => opts.speedMps ?? 1,
    interactive: () => opts.interactive !== false,
    isSelected: (id) => id === 'a1',
    onChoice: (id) => log.push(`choice:${id}`),
    onGameOver: (r) => log.push(`gameOver:${r}`),
    onMusic: (m) => log.push(`music:${m}`),
    onAgentLeft: (id) => log.push(`left:${id}`),
    onObjectRemoved: (id) => log.push(`removed:${id}`),
    onLotChanged: () => log.push('lot'),
    onError: (w) => log.push(`error:${w}`),
  };
  const router = new EventRouter();
  const route = (events: SimEvent[]) => router.route(sim, events, host);
  return { audio, renderer, toasts, bubbles, sim, host, router, route, log, advance: (ms: number) => (t += ms), now: () => t };
}

function notifyEvent(sim: FakeSim, id: number, kind: 'info' | 'bad' | 'skill', title: string, text: string, agentId: string | null = null): SimEvent {
  sim.state.notifications.push({ id, tick: 0, kind, title, text, agentId, objectId: null, read: false });
  return { type: 'notify', id };
}

describe('ToastCenter', () => {
  it('dedupes identical toasts within 2 s, allows them again after', () => {
    let t = 0;
    const c = new ToastCenter(() => t);
    expect(c.push({ kind: 'info', title: 'Bills', text: 'Due' })).not.toBeNull();
    t += TOAST_DEDUPE_MS - 1;
    expect(c.push({ kind: 'info', title: 'Bills', text: 'Due' })).toBeNull();
    t += 2;
    expect(c.push({ kind: 'info', title: 'Bills', text: 'Due' })).not.toBeNull();
    expect(c.list().length).toBe(2);
  });

  it('different kinds or texts are not duplicates; merge keys collapse different texts', () => {
    const c = new ToastCenter(() => 0);
    c.push({ kind: 'info', title: 'A', text: 'x' });
    c.push({ kind: 'bad', title: 'A', text: 'x' });
    c.push({ kind: 'info', title: 'A', text: 'y' });
    expect(c.list().length).toBe(3);
    expect(c.push({ kind: 'skill', title: 'One', text: '1', mergeKey: 'skill:a1' })).not.toBeNull();
    expect(c.push({ kind: 'skill', title: 'Two', text: '2', mergeKey: 'skill:a1' })).toBeNull();
  });

  it(`keeps at most ${TOAST_MAX} (contract: controller caps at 20), dropping the oldest`, () => {
    let t = 0;
    const c = new ToastCenter(() => t);
    expect(TOAST_MAX).toBe(20);
    for (let i = 0; i < 25; i++) {
      t += 10;
      c.push({ kind: 'info', title: `T${i}`, text: '' });
    }
    expect(c.list().length).toBe(20);
    expect(c.list()[0].title).toBe('T5');
    expect(c.list().at(-1)!.title).toBe('T24');
  });

  it('controller TTL is only a ≥ 60 s safety net (the HUD owns visible lifetime)', () => {
    expect(toastTtlMs('info')).toBeGreaterThanOrEqual(60_000);
    expect(toastTtlMs('bad')).toBeGreaterThanOrEqual(60_000);
    const c = new ToastCenter(() => 0);
    c.push({ kind: 'info', title: 'still here', text: '' });
    expect(c.prune(59_999)).toBe(false);
  });

  it('expires by kind TTL; list reference only changes on change', () => {
    let t = 0;
    const c = new ToastCenter(() => t);
    c.push({ kind: 'info', title: 'i', text: '' });
    c.push({ kind: 'bad', title: 'b', text: '' });
    const ref = c.list();
    expect(c.prune(t + 1)).toBe(false);
    expect(c.list()).toBe(ref);
    t = toastTtlMs('info') + 1;
    expect(c.prune(t)).toBe(true);
    expect(c.list().map((x) => x.title)).toEqual(['b']);
    t = toastTtlMs('bad') + 1;
    c.prune(t);
    expect(c.list()).toEqual([]);
  });

  it('sanitises junk input', () => {
    const c = new ToastCenter(() => 0);
    expect(c.push({ kind: 'weird' as never, title: '', text: '' })).toBeNull();
    const t = c.push({ kind: 'weird' as never, title: 'x'.repeat(500), text: 42 as never, agentId: 5 as never });
    expect(t!.kind).toBe('info');
    expect(t!.title.length).toBeLessThanOrEqual(120);
    expect(t!.text).toBe('42');
    expect(t!.agentId).toBeNull();
    expect(c.dismiss(t!.id)).toBe(true);
    expect(c.dismiss(t!.id)).toBe(false);
  });
});

describe('BubbleBoard', () => {
  it('one bubble per agent (new replaces old), bounded, expiring', () => {
    const b = new BubbleBoard(3);
    b.push({ agentId: 'a1', icon: 'brain', style: 'thought', positive: true, until: 100 });
    b.push({ agentId: 'a1', icon: 'zzz', style: 'thought', positive: true, until: 200 });
    expect(b.list().map((x) => x.icon)).toEqual(['zzz']);
    for (const id of ['a2', 'a3', 'a4']) b.push({ agentId: id, icon: 'chat', style: 'speech', positive: true, until: 300 });
    expect(b.list().length).toBe(3);
    expect(b.list().map((x) => x.agentId)).toEqual(['a2', 'a3', 'a4']);
    expect(b.prune(250)).toBe(false);
    expect(b.prune(301)).toBe(true);
    expect(b.list()).toEqual([]);
  });

  it('rejects junk and normalises style', () => {
    const b = new BubbleBoard();
    expect(b.push({ agentId: 7 as never, icon: 'x', style: 'thought', positive: true, until: 1 })).toBeNull();
    expect(b.push({ agentId: 'a', icon: 'x', style: 'thought', positive: true, until: NaN })).toBeNull();
    expect(b.push({ agentId: 'a', icon: 'x', style: 'yell' as never, positive: undefined as never, until: 5 })!.style).toBe('thought');
  });
});

describe('EventRouter', () => {
  it('notify → toast (deduped within 2 s) + ui sound by severity', () => {
    const s = setup();
    s.route([notifyEvent(s.sim, 1, 'bad', 'Power cut', 'Pay your bills')]);
    s.route([notifyEvent(s.sim, 2, 'bad', 'Power cut', 'Pay your bills')]);
    expect(s.toasts.list().length).toBe(1);
    expect(s.audio.sfxIds()).toEqual(['notifyBad']);
    s.advance(2500);
    s.route([notifyEvent(s.sim, 3, 'bad', 'Power cut', 'Pay your bills')]);
    expect(s.toasts.list().length).toBe(2);
  });

  it('unknown notification ids are ignored', () => {
    const s = setup();
    s.route([{ type: 'notify', id: 999 }]);
    expect(s.toasts.list()).toEqual([]);
  });

  it('skillUp: the engine notification and the skillUp event merge into ONE toast and ONE sound', () => {
    const s = setup();
    s.route([
      notifyEvent(s.sim, 5, 'skill', 'Skill up!', 'Mortimer reached Cooking 2', 'a1'),
      { type: 'sfx', id: 'skillUp', agentId: 'a1' },
      { type: 'skillUp', agentId: 'a1', skill: 'cooking', level: 2 },
    ]);
    expect(s.toasts.list().length).toBe(1);
    expect(s.audio.sfxIds().filter((id) => id === 'skillUp').length).toBe(1);
  });

  it('promotion / milestone → toast + sound', () => {
    const s = setup();
    s.route([{ type: 'promotion', agentId: 'a1', level: 2, title: 'Line Cook' }]);
    s.route([{ type: 'milestone', agentId: 'a2', aspirationId: 'tycoon', milestoneId: 'm1' }]);
    expect(s.toasts.list().map((t) => t.text)).toEqual(['Mortimer is now Line Cook.', 'Ghoulia: $5,000 funds (+250 points)']);
    expect(s.audio.sfxIds()).toEqual(['promotion', 'milestone']);
  });

  it('bubble expiry is in real time, scaled by game speed and clamped', () => {
    const slow = setup({ speedMps: 1 });
    slow.route([{ type: 'bubble', agentId: 'a1', icon: 'brain', style: 'thought', durationMin: 3 }]);
    expect(slow.bubbles.list()[0].until - slow.now()).toBe(3000);
    const fast = setup({ speedMps: 30 });
    fast.route([{ type: 'bubble', agentId: 'a1', icon: 'brain', style: 'thought', durationMin: 3 }]);
    expect(fast.bubbles.list()[0].until - fast.now()).toBe(1500); // clamped up to stay readable
    const long = setup({ speedMps: 1 });
    long.route([{ type: 'bubble', agentId: 'a1', icon: 'brain', style: 'thought', durationMin: 600 }]);
    expect(long.bubbles.list()[0].until - long.now()).toBe(6000);
    const def = setup({ speedMps: 0 });
    def.route([{ type: 'bubble', agentId: 'a1', icon: 'zzz', style: 'thought' }]);
    expect(def.bubbles.list()[0].until - def.now()).toBe(3000);
    def.advance(3001);
    expect(def.bubbles.prune(def.now())).toBe(true);
  });

  it('sfx get spatial hints: pan follows screen x, gain falls with distance', () => {
    const s = setup();
    s.route([{ type: 'sfx', id: 'chop', pos: { x: 20, z: 15 } }]);
    s.route([{ type: 'sfx', id: 'eat', pos: { x: 10, z: 15 } }]);
    s.route([{ type: 'sfx', id: 'drink', pos: { x: 15, z: 15 } }]);
    const calls = s.audio.named('sfx').map((c) => c.args[1] as { spatial: { pan: number; gain: number } });
    expect(calls[0].spatial.pan).toBeGreaterThan(0);
    expect(calls[1].spatial.pan).toBeLessThan(0);
    expect(calls[2].spatial.pan).toBeCloseTo(0, 5);
    expect(calls[2].spatial.gain).toBeGreaterThan(calls[0].spatial.gain);
  });

  it('flood control: after a 400-tick frame only MAX_SFX_PER_FRAME sounds play, one per id', () => {
    const s = setup();
    const ids = ['footstep', 'eat', 'drink', 'cook', 'chop', 'fridgeOpen', 'microwave', 'espresso', 'sinkWater', 'shower', 'snore', 'yawn'] as const;
    const flood: SimEvent[] = [];
    for (let i = 0; i < 400; i++) flood.push({ type: 'sfx', id: ids[i % ids.length], pos: { x: 15, z: 15 } });
    s.route(flood);
    const played = s.audio.sfxIds();
    expect(played.length).toBe(MAX_SFX_PER_FRAME);
    expect(new Set(played).size).toBe(played.length);
  });

  it('unknown sfx ids / voice emotions / NaN positions are skipped, not thrown', () => {
    const s = setup();
    s.route([
      { type: 'sfx', id: 'laserBeam' as never },
      { type: 'voice', agentId: 'a1', emotion: 'robotic' as never, durationMs: 500 },
      { type: 'sfx', id: 'eat', pos: { x: NaN, z: 1 } },
      null as never,
      { type: 'mystery' } as never,
    ]);
    expect(s.audio.sfxIds()).toEqual(['eat']);
    expect(s.audio.named('voice')).toEqual([]);
    expect(s.log.filter((l) => l.startsWith('error'))).toEqual([]);
  });

  it('voice uses the agent seed + appearance pitch and clamps duration', () => {
    const s = setup();
    s.sim.state.agents.a1.appearance.voicePitch = 0.8;
    s.route([{ type: 'voice', agentId: 'a1', emotion: 'happy', durationMs: 99_999 }]);
    const [seed, pitch, emotion, ms] = s.audio.named('voice')[0].args;
    expect([seed, pitch, emotion, ms]).toEqual([4242, 0.8, 'happy', 6000]);
    s.sim.state.agents.a2.presence = 'atWork';
    s.route([{ type: 'voice', agentId: 'a2', emotion: 'sad', durationMs: 500 }]);
    expect(s.audio.named('voice').length).toBe(1); // off-lot agents are silent
  });

  it('loops are tracked, re-spatialised, dropped when their object vanishes, and all stopped on teardown', () => {
    const s = setup();
    s.route([{ type: 'sfxLoop', id: 'shower', key: 'shower:o1', on: true, objectId: 'o1' }]);
    expect(s.router.activeLoopCount).toBe(1);
    s.router.refreshLoops(s.sim, s.host);
    expect(s.audio.named('loop').length).toBe(2);
    delete s.sim.state.objects.o1;
    s.router.refreshLoops(s.sim, s.host);
    expect(s.router.activeLoopCount).toBe(0);
    expect(s.audio.named('loop').at(-1)!.args[2]).toBe(false);
    s.route([{ type: 'sfxLoop', id: 'tvChatter', key: 'tv', on: true, pos: { x: 1, z: 1 } }]);
    s.router.stopAll(s.audio);
    expect(s.router.activeLoopCount).toBe(0);
    expect(s.audio.named('stopAllLoops').length).toBe(1);
  });

  it('the menu demo (non-interactive) produces no audio, toasts or bubbles', () => {
    const s = setup({ interactive: false });
    s.route([
      { type: 'sfx', id: 'eat' },
      { type: 'voice', agentId: 'a1', emotion: 'happy', durationMs: 500 },
      notifyEvent(s.sim, 1, 'info', 'x', 'y'),
      { type: 'bubble', agentId: 'a1', icon: 'zzz', style: 'thought' },
      { type: 'sfxLoop', id: 'shower', key: 'k', on: true },
      { type: 'choice', choiceId: 'c1' },
    ]);
    expect(s.audio.calls).toEqual([]);
    expect(s.toasts.list()).toEqual([]);
    expect(s.bubbles.list()).toEqual([]);
    expect(s.log).toEqual([]);
  });

  it('routes lifecycle events to the host', () => {
    const s = setup();
    s.route([
      { type: 'choice', choiceId: 'c7' },
      { type: 'gameOver', reason: 'Rest in Pieces' },
      { type: 'music', mood: 'party' },
      { type: 'agentDespawned', agentId: 'a2' },
      { type: 'objectRemoved', objectId: 'o2' },
      { type: 'lot', what: 'walls' },
      { type: 'focus', agentId: 'a1' },
      { type: 'interactionFailed', agentId: 'a1', reason: 'No path' },
    ]);
    // choice (auto-pause + UI flush), lot (re-validation) and focus are coalesced to once per batch, at its end.
    expect(s.log).toEqual(['gameOver:Rest in Pieces', 'music:party', 'left:a2', 'removed:o2', 'choice:c7', 'lot']);
    expect(s.renderer.last('focus')!.args[0]).toBe('a1');
    expect(s.toasts.list()).toEqual([]); // engine already notifies player-sourced failures
  });

  it('a handler crash is contained to that event (fault barrier)', () => {
    const s = setup();
    s.host.onLotChanged = () => {
      throw new Error('ui exploded');
    };
    s.route([{ type: 'lot', what: 'all' }, { type: 'sfx', id: 'eat' }]);
    expect(s.log).toContain('error:event:lot');
    expect(s.audio.sfxIds()).toEqual(['eat']);
  });

  it('eventWorldPos resolves pos > agent (on lot) > object', () => {
    const sim = new FakeSim(makeWorld());
    expect(eventWorldPos(sim, { pos: { x: 1, z: 2 } })).toMatchObject({ x: 1, z: 2 });
    expect(eventWorldPos(sim, { agentId: 'a1' })).toMatchObject({ x: 10.5, z: 10.5 });
    sim.state.agents.a1.presence = 'atWork';
    expect(eventWorldPos(sim, { agentId: 'a1' })).toBeNull();
    expect(eventWorldPos(sim, { objectId: 'o1' })).toMatchObject({ x: 5.5, z: 5.5 });
    expect(eventWorldPos(sim, { objectId: 'nope' })).toBeNull();
    expect(hashSeed('a1')).toBe(hashSeed('a1'));
  });
});

describe('spatial audio math', () => {
  it('off-screen sources are attenuated; far zoom attenuates; NaN → undefined', () => {
    const r = new FakeRenderer();
    const vp = { width: 1280, height: 720 };
    const near = computeSpatial({ x: 15, y: 1, z: 15 }, r, vp)!;
    const off = computeSpatial({ x: 40, y: 1, z: 15 }, r, vp)!;
    expect(off.gain).toBeLessThanOrEqual(near.gain * OFFSCREEN_GAIN + 1e-9);
    expect(off.pan).toBeLessThanOrEqual(0.85 + 1e-9);
    r.camera.distance = 60;
    const zoomedOut = computeSpatial({ x: 15, y: 1, z: 15 }, r, vp)!;
    expect(zoomedOut.gain).toBeLessThan(near.gain);
    expect(computeSpatial({ x: NaN, y: 0, z: 0 }, r, vp)).toBeUndefined();
    const broken = { worldToScreen: () => { throw new Error('x'); }, getCamera: () => r.camera };
    expect(computeSpatial({ x: 1, y: 1, z: 1 }, broken, vp)).toBeUndefined();
  });

  it('a close view is heard from its zombie, not from the hidden overview camera; its own sounds are never "off-screen"', () => {
    const vp = { width: 1280, height: 720 };
    // the overview was left zoomed out over the yard; the view is now first person on a zombie 12 tiles from there
    const getCamera = () => ({ target: { x: 5, z: 5 }, yaw: 0, pitch: 0.7, distance: 40 });
    const getListener = () => ({ target: { x: 17, z: 5 }, yaw: 0, pitch: 0.05, distance: 0.12 });
    // what is ahead is on screen; the zombie's own body (x 17, behind the eye camera) is not
    const worldToScreen = (x: number) => ({ x: 640, y: 360, visible: x !== 17 });
    const close = { getCamera, getListener, worldToScreen };
    // the stove in front of it, then its own voice and steps
    const heard = [{ x: 18, y: 0.6, z: 5 }, { x: 17, y: 1.2, z: 5 }].map((p) => Number(computeSpatial(p, close, vp)!.gain.toFixed(6)));
    expect(heard).toEqual([1, 1]);
    // away from the listener "off-screen" still counts
    const behind = { getCamera, getListener, worldToScreen: () => ({ x: 640, y: 360, visible: false }) };
    expect(computeSpatial({ x: 17, y: 0.6, z: 8 }, behind, vp)!.gain).toBeCloseTo(OFFSCREEN_GAIN, 9);
    // a source without a listener (the overview, mocks) is heard from the camera exactly as before
    expect(computeSpatial({ x: 17, y: 0.6, z: 5 }, { getCamera, worldToScreen: () => ({ x: 640, y: 360, visible: true }) }, vp)!.gain).toBeCloseTo(0.175, 9);
  });
});

describe('spatial audio: the listener\'s own sounds', () => {
  it('a first-person zombie\'s own voice is centred, not panned by a projection from behind the lens', () => {
    const vp = { width: 1280, height: 720 };
    const getCamera = () => ({ target: { x: 5, z: 5 }, yaw: 0, pitch: 0.7, distance: 40 });
    const getListener = () => ({ target: { x: 17, z: 5 }, yaw: 0, pitch: 0.05, distance: 0.12 });
    // a point behind the camera projects far to one side (and flips): exactly what a real projection does
    const worldToScreen = (x: number) => (x === 17 ? { x: -4000, y: 360, visible: false } : { x: 1100, y: 360, visible: true });
    const close = { getCamera, getListener, worldToScreen };
    const own = computeSpatial({ x: 17, y: 1.2, z: 5 }, close, vp)!;
    expect(own.pan).toBe(0);
    expect(own.gain).toBe(1);
    // anything farther than SELF_TILES keeps its pan
    const stove = computeSpatial({ x: 19, y: 0.6, z: 5 }, close, vp)!;
    expect(stove.pan).toBeGreaterThan(0.3);
    // a VISIBLE sound within a tile keeps its screen pan (only unplaceable ones are centred)
    const near = computeSpatial({ x: 17.6, y: 0.6, z: 5.6 }, { getCamera, getListener, worldToScreen: () => ({ x: 1150, y: 400, visible: true }) }, vp)!;
    expect(near.pan).toBeGreaterThan(0.5);
  });
});

describe('music direction', () => {
  const base: Omit<MusicContext, 'override'> = { screen: 'game', mode: 'live', fatal: false, isNight: false, partyActive: false, tense: false };
  it.each([
    [{ screen: 'menu' }, 'menu'],
    [{ screen: 'caz' }, 'caz'],
    [{ screen: 'newGame' }, 'caz'],
    [{ screen: 'gameOver' }, 'sad'],
    [{ screen: 'boot' }, 'none'],
    [{}, 'live'],
    [{ isNight: true }, 'night'],
    [{ mode: 'build' }, 'build'],
    [{ mode: 'buy', partyActive: true }, 'build'],
    [{ partyActive: true, tense: true }, 'party'],
    [{ tense: true, isNight: true }, 'tense'],
    [{ fatal: true }, 'none'],
  ] as const)('%o → %s', (over, mood) => {
    expect(chooseMusic({ ...base, override: null, ...over } as MusicContext)).toBe(mood);
  });

  it('director only switches on change; sim moods override for a while, then expire', () => {
    const d = new MusicDirector();
    const played: string[] = [];
    d.update(base, 0, (m) => played.push(m));
    d.update(base, 10, (m) => played.push(m));
    d.onEvent('romance', 20);
    d.update(base, 30, (m) => played.push(m));
    d.update(base, 20 + MUSIC_OVERRIDE_MS + 1, (m) => played.push(m));
    d.onEvent('sad', 0);
    d.onEvent('normal', 0);
    d.update({ ...base, isNight: true }, 99, (m) => played.push(m));
    d.onEvent('dubstep', 0);
    expect(played).toEqual(['live', 'romance', 'live', 'night']);
  });
});
