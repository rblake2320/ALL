/**
 * Live-mode input: hover labels + renderer hover highlight, click to select household zombies, click
 * objects / other zombies / the ground with a zombie selected to open the interaction menu at the cursor,
 * double-click a household zombie to select + focus the camera.
 */
import type { SimulationAPI } from '../../sim/contracts';
import type { AgentId, ObjectId } from '../../sim/types';
import { petHoverLabel } from '../petMenu';
import type { InputHost, ModeHandler, Mods, PointerPos, PrimaryDownResult } from './types';

export function isHouseholdMember(sim: SimulationAPI, id: AgentId): boolean {
  const ids = sim.state?.household?.memberIds;
  return Array.isArray(ids) && ids.includes(id);
}

export function agentHoverLabel(sim: SimulationAPI, id: AgentId): string | null {
  const s = sim.summary(id);
  if (!s) return null;
  const who = s.isVisitor ? `${s.name} (visitor)` : s.name;
  return s.activity ? `${who} — ${s.activity}` : who;
}

export function objectHoverLabel(sim: SimulationAPI, id: ObjectId, withSellValue = false): string | null {
  const v = sim.objectView(id);
  if (!v) return null;
  const parts = [v.name];
  if (v.broken) parts.push('Broken');
  else if (!v.powered) parts.push('No power');
  if (v.detail) parts.push(v.detail);
  if (withSellValue && Number.isFinite(v.sellValue)) parts.push(`Sell $${Math.max(0, Math.round(v.sellValue))}`);
  return parts.join(' · ');
}

export class LiveInput implements ModeHandler {
  private actorAtDown: AgentId | null | undefined;
  constructor(private readonly host: InputHost) {}

  hover(pos: PointerPos): void {
    const sim = this.host.sim();
    if (!sim) return this.clearHover();
    const pick = this.host.renderer.pick(pos.cx, pos.cy, { agents: true, objects: true, walls: false, tiles: false });
    if (pick.kind === 'agent') {
      this.host.renderer.setHover({ kind: 'agent', id: pick.agentId });
      this.host.setHoverLabel(agentHoverLabel(sim, pick.agentId));
    } else if (pick.kind === 'object') {
      this.host.renderer.setHover({ kind: 'object', id: pick.objectId });
      this.host.setHoverLabel(objectHoverLabel(sim, pick.objectId));
    } else if (pick.kind === 'pet') {
      this.host.renderer.setHover(null);
      this.host.setHoverLabel(petHoverLabel(sim.state, pick.petKind, pick.petId));
    } else {
      this.clearHover();
    }
  }

  private clearHover(): void {
    this.host.renderer.setHover(null);
    this.host.setHoverLabel(null);
  }

  primaryDown(): PrimaryDownResult {
    this.actorAtDown = this.host.selectedAgentId();
    return 'deferred';
  }

  toolMove(): void {}
  toolEnd(): void {}
  toolCancel(): void {}

  click(pos: PointerPos, mods: Mods): void {
    const sim = this.host.sim();
    if (!sim) return;
    // First click with a menu open just closes it (standard popup behaviour).
    if (this.host.isMenuOpen()) {
      this.host.closeMenu();
      return;
    }
    const pick = this.host.renderer.pick(pos.cx, pos.cy, { agents: true, objects: true, walls: false, tiles: true });
    const selected = this.host.selectedAgentId();
    const actorAtDown = this.actorAtDown;
    this.actorAtDown = undefined;
    const walk = (target: import('../../shared/world').WorldRouteTarget): void => {
      if (selected === null) {
        this.host.toast('info', 'Select a zombie first', 'Select a household zombie to walk there.');
        return;
      }
      // An order belongs to the actor selected when the gesture started.
      if (actorAtDown !== undefined && actorAtDown !== selected) return;
      if (this.host.walkTo) this.host.walkTo(selected, target);
      else this.host.toast('warning', 'Go Here', 'Walking to this place is unavailable.');
    };
    switch (pick.kind) {
      case 'agent': {
        const id = pick.agentId;
        const household = isHouseholdMember(sim, id);
        if (household && (selected === null || mods.shift || mods.ctrl) && id !== selected) {
          this.host.selectAgent(id, false, true);
          this.host.sfx('uiClick');
          return;
        }
        if (selected === null) {
          this.host.toast('info', 'Select a zombie first', 'Click one of your household zombies (or their portrait) to give orders.');
          return;
        }
        this.host.openMenuFor(id === selected ? { kind: 'self' } : { kind: 'agent', id }, pos.vx, pos.vy);
        return;
      }
      case 'pet':
        if (selected === null) {
          this.host.toast('info', 'Select a zombie first', 'Click one of your household zombies (or their portrait) to give orders.');
          return;
        }
        this.host.openPetMenu(pick.petKind, pick.petId, pos.vx, pos.vy);
        return;
      case 'object':
        if (selected === null) {
          this.host.toast('info', 'Select a zombie first', 'Click one of your household zombies (or their portrait) to give orders.');
          return;
        }
        this.host.openMenuFor({ kind: 'object', id: pick.objectId }, pos.vx, pos.vy);
        return;
      case 'tile':
        // A home tile pick has no region in TargetRef: an away member must get the explicit home route,
        // otherwise its local tile menu would resolve those coordinates inside the member's current region.
        if (sim.state.town && (pos.pointerType === 'touch' || (selected !== null &&
          (sim.state.agents[selected]?.regionId ?? sim.state.town.homeLotId) !== sim.state.town.homeLotId))) {
          walk({ regionId: sim.state.town.homeLotId, x: pick.x, z: pick.z });
          return;
        }
        if (selected === null) return;
        this.host.openMenuFor({ kind: 'tile', x: pick.x, z: pick.z }, pos.vx, pos.vy);
        return;
      case 'worldTile':
        walk(pick.target);
        return;
      default:
        return;
    }
  }

  secondaryClick(): void {
    this.host.closeMenu();
  }

  doubleClick(pos: PointerPos): void {
    const sim = this.host.sim();
    if (!sim) return;
    const pick = this.host.renderer.pick(pos.cx, pos.cy, { agents: true, objects: false, walls: false, tiles: false });
    if (pick.kind === 'agent' && isHouseholdMember(sim, pick.agentId)) {
      this.host.closeMenu();
      this.host.selectAgent(pick.agentId, true, true);
    }
  }

  escape(): boolean {
    return this.host.closeMenu();
  }

  reset(): void {
    this.actorAtDown = undefined;
    this.clearHover();
  }
}
