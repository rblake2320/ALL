/** Path following + nudging (README §9). */
import type { AgentState } from '../types';
import { dirToFacing } from '../../shared/dimensions';
import { FERAL_SPEED, LEG_SPEED, WALK_TILES_PER_MINUTE } from './constants';
import { limbCount } from './agents';
import { recordFault } from './faults';
import type { Engine } from './types';
import { isNum, tileCenter } from './util';
import { crossingStepAllowed } from './worldMove';

/** W-025 S3: the one step that may leave the grid — onto the far tile of an armed portal crossing. */
function leavesThroughPortal(eng: Engine, agent: AgentState, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  if (!agent.active || agent.active.data._xp !== 1 || eng.spatial.inBounds(to.x, to.z)) return false;
  return crossingStepAllowed(eng, agent, from);
}

export function agentSpeed(eng: Engine, agent: AgentState): number {
  const legs = Math.max(0, Math.min(2, limbCount(agent, 'leg')));
  return WALK_TILES_PER_MINUTE * LEG_SPEED[legs] * (agent.status && agent.status.feral ? FERAL_SPEED : 1);
}

export function walkAnim(agent: AgentState): 'walk' | 'limp' | 'crawl' {
  const legs = limbCount(agent, 'leg');
  return legs >= 2 ? 'walk' : legs === 1 ? 'limp' : 'crawl';
}

function canCross(eng: Engine, fx: number, fz: number, tx: number, tz: number): boolean {
  if (!eng.spatial.inBounds(tx, tz) || !eng.spatial.isWalkable(tx, tz)) return false;
  const dx = tx - fx;
  const dz = tz - fz;
  if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return true; // teleport-ish jump (path smoothing); trust the path
  if (dx === 0 || dz === 0) return eng.spatial.canStep(fx, fz, tx, tz);
  // diagonal: accept if either orthogonal detour is open (smoothing may graze corners)
  if (eng.spatial.canStep(fx, fz, tx, tz)) return true;
  const viaA = eng.spatial.isWalkable(tx, fz) && eng.spatial.canStep(fx, fz, tx, fz) && eng.spatial.canStep(tx, fz, tx, tz);
  const viaB = eng.spatial.isWalkable(fx, tz) && eng.spatial.canStep(fx, fz, fx, tz) && eng.spatial.canStep(fx, tz, tx, tz);
  return viaA || viaB;
}

/** Advance along agent.path. */
export function moveAlongPath(eng: Engine, agent: AgentState, dtMin: number): 'none' | 'moving' | 'arrived' | 'blocked' {
  const path = agent.path;
  if (!path) return 'none';
  if (agent.pathIndex >= path.length) return 'arrived';
  let budget = agentSpeed(eng, agent) * dtMin;
  let guardN = 64;
  while (budget > 1e-9 && agent.pathIndex < path.length && guardN-- > 0) {
    const wp = path[agent.pathIndex];
    if (!wp || !isNum(wp.x) || !isNum(wp.z)) {
      agent.pathIndex++;
      continue;
    }
    const dx = wp.x - agent.pos.x;
    const dz = wp.z - agent.pos.z;
    const d = Math.hypot(dx, dz);
    let nx: number;
    let nz: number;
    let reached = false;
    if (d <= budget) {
      nx = wp.x;
      nz = wp.z;
      budget -= d;
      reached = true;
    } else {
      nx = agent.pos.x + (dx / d) * budget;
      nz = agent.pos.z + (dz / d) * budget;
      budget = 0;
    }
    const from = eng.spatial.tileOf(agent.pos);
    const to = eng.spatial.tileOf({ x: nx, z: nz });
    if ((from.x !== to.x || from.z !== to.z) && eng.spatial.inBounds(from.x, from.z) && !canCross(eng, from.x, from.z, to.x, to.z) && !leavesThroughPortal(eng, agent, from, to)) {
      agent.anim = 'idle';
      return 'blocked';
    }
    if (d > 1e-6) agent.facing = dirToFacing(dx, dz);
    agent.pos = { x: nx, z: nz };
    if (reached) agent.pathIndex++;
  }
  agent.anim = walkAnim(agent);
  return agent.pathIndex >= path.length ? 'arrived' : 'moving';
}

/** True while the agent legitimately occupies a furniture pose (seated, lying, in front of an object). */
export function isPosed(agent: AgentState): boolean {
  const r = agent.active;
  return !!(r && r.pose && (r.phase === 'run' || r.phase === 'wait' || r.phase === 'exit'));
}

/** Never leave a free-standing agent inside a blocked tile or off the grid. */
export function nudgeIfBlocked(eng: Engine, agent: AgentState): void {
  if (isPosed(agent)) return;
  try {
    const t = eng.spatial.tileOf(agent.pos);
    const ok = isNum(agent.pos.x) && isNum(agent.pos.z) && eng.spatial.inBounds(t.x, t.z) && eng.spatial.isWalkable(t.x, t.z);
    if (ok) return;
    const p = isNum(agent.pos.x) && isNum(agent.pos.z) ? agent.pos : { x: eng.spatial.width() / 2, z: eng.spatial.depth() / 2 };
    const w = eng.spatial.nearestWalkable(p, 40);
    if (!w) return;
    const c = tileCenter(w);
    agent.pos = c;
    agent.posY = 0;
    if (agent.active && agent.active.phase === 'route') agent.active.data._v = -2; // force repath
    agent.path = null;
  } catch (e) {
    recordFault(eng, 'nudge', e);
  }
}
