/** Product-question probe: real simulation and content, synthetic held objects; no rendering, saves or source edits. */
import { existsSync, writeFileSync } from 'node:fs';
import { createNewWorld, createSimulation, loadContent } from '../../src/sim';
import { defaultAppearance } from '../../src/shared/appearance';
import { carryFor } from '../../src/sim/engine/objects';
import { IX } from '../../src/sim/content/home/ids';
import { GATE_PARTS, gateScenarios } from './gate';

const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('usage: surveyRetainedCarry.ts <fresh-output.json>');
const defs = Object.values(loadContent().objects);
const held = [...new Map(defs.filter((d) => carryFor(d)).map((d) => [carryFor(d)!, d])).values()];
const activities = [
  { id: IX.watchTv, tag: 'tv' }, { id: IX.sit, tag: 'seat' },
  { id: IX.washHands, tag: 'sink' }, { id: IX.sleep, tag: 'bed' },
];
const observations = [];
for (const def of held) for (const activity of activities) {
  const state = createNewWorld({ seed: 923, householdName: 'Carry survey', lotTemplate: 'starter', difficulty: 'normal',
    members: [{ firstName: 'Probe', lastName: 'Carry', appearance: defaultAppearance(), traits: [], aspiration: null }] });
  const actor = state.agents[state.household.memberIds[0]];
  state.settings.autonomy = 'off';
  for (const need of ['hunger', 'energy', 'social', 'fun', 'hygiene', 'preservation'] as const) actor.needs[need] = 70;
  const id = `o${state.nextId++}`;
  state.objects[id] = { id, defId: def.id, placement: { kind: 'held', agentId: actor.id }, value: 0, purchasedTick: state.tick,
    tint: null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
    data: { servings: 1, quality: 2, ownerId: actor.id, limbId: def.id.endsWith('_leg') ? 'legL' : 'armL', createdTick: state.tick }, reservedBy: {}, inUseBy: [], rev: 0 };
  actor.carryObjectId = id;
  actor.carrying = carryFor(def);
  const sim = createSimulation(state);
  const target = Object.values(sim.state.objects).find((o) => loadContent().objects[o.defId]?.tags.includes(activity.tag));
  if (!target) { observations.push({ item: def.id, activity: activity.id, status: 'Blocked', reason: `starter has no ${activity.tag}` }); continue; }
  const queued = sim.dispatch({ type: 'queue', actorId: actor.id, interactionId: activity.id, target: { kind: 'object', id: target.id }, params: { channel: 'horror' } });
  let reached = false;
  for (let i = 0; queued.ok && i < 1800; i++) {
    sim.step();
    if (actor.active?.interactionId === activity.id && actor.active.phase === 'run') { reached = true; break; }
  }
  const invariants = sim.checkInvariants();
  observations.push({ item: def.id, carry: carryFor(def), activity: activity.id, queued, reached, anim: actor.anim,
    carrying: actor.carrying, heldObjectRetained: actor.carryObjectId === id && sim.state.objects[id]?.placement.kind === 'held', invariants });
}
const gate = GATE_PARTS.flatMap(gateScenarios);
const keys = new Set(gate.map((s) => s.key));
function expansion(items: readonly string[]): number {
 const proposed = new Set<string>();
 for (const sc of gate) {
  const act = sc.kind === 'pair' ? sc.a : sc.act;
  if (act.carry !== null) continue;
  // Count the proposed mechanical five-item expansion on actor A, preserving current gate geometry and spacing.
  // This is a capacity count, not a claim every variant passes interaction preconditions or has been measured.
  for (const item of items) {
    const key = sc.kind === 'pair' ? sc.key.replace('~', `+${item}~`) : sc.key.replace(/(\||$)/, `+${item}$1`);
    if (!keys.has(key)) proposed.add(key);
  }
 }
 return proposed.size;
}
const proposed = expansion(['plate', 'pizza', 'dish', 'limb', 'book']);
const report = { setup: 'synthetic held world objects through real createSimulation/queue/step, seed 923, autonomy off',
  gateScenarios: gate.length, proposedActorOnlyFiveItemExpansion: proposed,
  addedEvaluationsAt12Looks: proposed * 12, actorOnlyShippedItemsExpansion: expansion(held.map((d) => carryFor(d)!)),
  shippedHeldItems: held.map((d) => ({ id: d.id, carry: carryFor(d) })), observations };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = observations.some((r) => 'invariants' in r && r.invariants && r.invariants.length) ? 1 : 0;
