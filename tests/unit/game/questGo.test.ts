/**
 * W-123 (D-070) controller: GameController.questAction / questGo on the REAL simulation (fresh derelict game).
 *  - Go queues the resolved action through the ordinary journaled `queue` command — once: a double click never
 *    double-queues; it toasts "<Name> is heading to the <object>"; it uses the selection, or picks and selects the
 *    best member when nobody is selected;
 *  - mode / missing / blocked results switch Build / Buy (category) / show the reason, change no sim state;
 *  - the session log records `quest.go` with `<step key>:<kind>` only (no names);
 *  - unknown / malformed rows never throw and never dispatch.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { SimModule } from '../../../src/game/simTypes';
import type { Core } from '../../../src/game/core';
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES } from '../../../src/sim/index';
import { startedHarness, type Harness } from './controllerHarness';

const real: SimModule = { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES };

async function game(): Promise<{ h: Harness; core: Core; journal: Command[] }> {
  const h = await startedHarness({ realSim: real });
  const core = (h.game as unknown as { c: Core }).c;
  const journal: Command[] = [];
  core.session!.setJournalSink({ record: (cmd: Command) => (journal.push(JSON.parse(JSON.stringify(cmd)) as Command), () => {}) } as never);
  journal.length = 0; // drop the pre-attach backlog: only what Go dispatches counts below
  return { h, core, journal };
}

const queues = (j: Command[]) => j.filter((c) => c.type === 'queue');

describe('questGo: queue', () => {
  it('Go on "Check the crooked mailbox" queues home_checkMail once; a double click does not double-queue', async () => {
    const { h, journal } = await game();
    const g = h.game;
    expect(g.sim!.state.flags.storyArc).toBe('act1');
    const preview = g.questAction({ source: 'quest', id: 'act1_claim' });
    expect(preview).toMatchObject({ kind: 'queue', interactionId: 'home_checkMail', key: 'act1_claim.mail' });
    const before = g.toasts.length;
    const r1 = g.questGo({ source: 'quest', id: 'act1_claim' });
    const r2 = g.questGo({ source: 'quest', id: 'act1_claim' });
    expect(r1).toMatchObject({ kind: 'queue', queued: true, already: false });
    expect(r2).toMatchObject({ kind: 'queue', queued: false, already: true });
    expect(queues(journal)).toHaveLength(1);
    expect(queues(journal)[0]).toMatchObject({ type: 'queue', interactionId: 'home_checkMail', target: { kind: 'object' } });
    const sim = g.sim!;
    const actor = (r1 as { agentId: string }).agentId;
    const items = [sim.state.agents[actor].active, ...sim.state.agents[actor].queue].filter((x) => x && x.interactionId === 'home_checkMail');
    expect(items).toHaveLength(1);
    const name = sim.state.agents[actor].firstName;
    const toast = g.toasts.slice(before).find((t) => t.title.includes('heading to'));
    expect(toast?.title).toBe(`${name} is heading to the ${sim.content.objects.mailbox_crooked.name}`);
    expect(g.selectedAgentId).toBe(actor);
    // the camera went to the mailbox (no DOM here: plain centring)
    expect(h.renderer.calls.some((c) => c.name === 'focus' || c.name === 'frameAt')).toBe(true);
    // and the sim runs it: the step completes
    g.setSpeed(3);
    await h.until(() => (sim.state.quests?.completions.act1_claim ?? 0) > 0, 6000);
    expect(sim.state.quests!.completions.act1_claim).toBe(1);
  }, 120_000);

  it('uses the selected member; with nobody selected it picks the best one and selects them', async () => {
    const { h } = await game();
    const g = h.game;
    const [a, b] = g.sim!.state.household.memberIds;
    g.selectAgent(b);
    expect(g.questGo({ source: 'quest', id: 'act1_claim' })).toMatchObject({ kind: 'queue', agentId: b });
    const { h: h2 } = await game();
    h2.game.selectAgent(null);
    expect(h2.game.selectedAgentId).toBeNull();
    const r = h2.game.questGo({ source: 'quest', id: 'act1_claim' });
    expect(r.kind).toBe('queue');
    expect([a, b]).toContain((r as { agentId: string }).agentId);
    expect(h2.game.selectedAgentId).toBe((r as { agentId: string }).agentId);
  }, 120_000);

  it('works with free will off', async () => {
    const h = await startedHarness({ realSim: real, settings: { autonomy: 'off' } });
    expect(h.game.settings.autonomy).toBe('off');
    expect(h.game.questGo({ source: 'daily', id: 'd_mail' })).toMatchObject({ kind: 'queue', interactionId: 'home_checkMail', queued: true });
  }, 60_000);
});

describe('questGo: mode / missing / blocked change no sim state', () => {
  it('"Build 4 wall segments" opens Build with the wall tool and a hint', async () => {
    const { h, journal } = await game();
    const g = h.game;
    const before = JSON.stringify(g.sim!.serialize());
    const r = g.questGo({ source: 'quest', id: 'act1_patch', stepId: 'walls' });
    expect(r).toMatchObject({ kind: 'mode', mode: 'build', tool: 'wall', count: 4 });
    expect(g.mode).toBe('build');
    expect(g.buildTool.kind).toBe('wall');
    expect(g.toasts.some((t) => /4 wall segments/.test(t.text))).toBe(true);
    expect(journal).toEqual([]);
    expect(JSON.stringify(g.sim!.serialize())).toBe(before);
  }, 60_000);

  it('"Finish a painting" with no easel → missing: Buy mode on the Hobbies tab, "Needs an easel"', async () => {
    const { h, journal } = await game();
    const g = h.game;
    expect(g.questAction({ source: 'daily', id: 'd_finishPainting' })).toMatchObject({ kind: 'missing', need: 'an easel', buyFilter: { defIds: ['easel_morbid'], category: 'hobbies' } });
    const r = g.questGo({ source: 'daily', id: 'd_finishPainting' });
    expect(r.kind).toBe('missing');
    expect(g.mode).toBe('buy');
    expect(g.buy.category).toBe('hobbies');
    expect(g.toasts.some((t) => t.title === 'Needs an easel')).toBe(true);
    expect(queues(journal)).toEqual([]);
  }, 60_000);

  it('"Repair something broken" with nothing broken → the reason is toasted, nothing dispatched', async () => {
    const { h, journal } = await game();
    const g = h.game;
    const r = g.questGo({ source: 'quest', id: 'story_firstRepair' });
    expect(r).toMatchObject({ kind: 'blocked', reason: 'Nothing is broken right now' });
    expect(g.toasts.some((t) => t.text === 'Nothing is broken right now')).toBe(true);
    expect(queues(journal)).toEqual([]);
    expect(g.questGo({ source: 'weekly', id: 'w_fix5' })).toMatchObject({ kind: 'blocked' });
  }, 60_000);

  it('unknown or malformed rows never throw and never dispatch', async () => {
    const { h, journal } = await game();
    const g = h.game;
    for (const ref of [null, undefined, {}, { source: 'quest', id: 'nope' }, { source: 'daily', id: '../../x' }, { source: 'boss', id: 'act1_claim' }, { source: 'quest', id: 'act1_claim', stepId: 'nope' }, { source: 'quest', id: 5 }]) {
      expect(g.questGo(ref as never).kind).toBe('blocked');
      expect(g.questAction(ref as never).kind).toBe('blocked');
    }
    expect(journal).toEqual([]);
  }, 60_000);
});

describe('questGo: session log', () => {
  it('logs quest.go with the step key and the resolved kind — ids only, never a name', async () => {
    const { h, core } = await game();
    const g = h.game;
    g.questGo({ source: 'quest', id: 'act1_claim' });
    g.questGo({ source: 'daily', id: 'd_finishPainting' });
    const log = (core.sessionLog as unknown as { rec: { toLog(): { events: { k: string; a?: string }[] } } }).rec.toLog();
    const go = log.events.filter((e) => e.k === 'quest.go').map((e) => e.a);
    expect(go).toEqual(['act1_claim.mail:queue', 'daily.d_finishPainting:missing']);
    const names = g.sim!.state.household.memberIds.map((id) => g.sim!.state.agents[id].firstName);
    for (const n of names) expect(JSON.stringify(go)).not.toContain(n);
  }, 60_000);
});
