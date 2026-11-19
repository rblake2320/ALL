/**
 * Music + ambience selection from controller state (pure-ish; all sim/audio calls guarded).
 */
import type { SimulationAPI } from '../sim/contracts';
import type { Core } from './core';

/** Overdue bills or anything burning on the lot. */
export function worldIsTense(sim: SimulationAPI): boolean {
  try {
    if (sim.bills().overdue > 0) return true;
  } catch {
    /* economy system missing: ignore */
  }
  try {
    for (const o of Object.values(sim.state.objects ?? {})) if (o && (o.defId === 'item_fire' || o.condition?.burning === true)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function updateMusic(c: Core): void {
  const s = c.session;
  let isNight = false;
  let partyActive = false;
  let tense = false;
  if (s && c.screen === 'game') {
    try {
      isNight = s.sim.time().isNight;
    } catch {
      /* default */
    }
    try {
      partyActive = s.sim.party()?.active === true;
    } catch {
      /* default */
    }
    tense = worldIsTense(s.sim);
  }
  c.musicDirector.update(
    { screen: c.screen, mode: c.play ? c.play.mode : 'live', fatal: c.fatal !== null, isNight, partyActive, tense },
    c.env.now(),
    (m) => c.guard('audio.music', () => c.audio.music(m)),
  );
}

export function updateAmbience(c: Core, sim: SimulationAPI): void {
  try {
    const t = sim.time();
    const night = t.isNight === true;
    // Full-moon nights get the extra 'moon' layer (AudioAPI.setAmbience, contract decision #15; GDD §2).
    const moon = night && t.fullMoon === true;
    const cam = c.renderer.getListener?.() ?? c.renderer.getCamera();
    const indoor = sim.spatial.isIndoor(Math.floor(cam.target.x), Math.floor(cam.target.z)) === true;
    const key = `${night}|${indoor}|${moon}`;
    if (key === c.lastAmbience) return;
    c.lastAmbience = key;
    c.audio.setAmbience({ night, indoor, moon });
  } catch (e) {
    c.report('audio.ambience', e);
  }
}
