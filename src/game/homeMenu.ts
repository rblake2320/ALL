/**
 * The click menu rows of the home services (docs/contract-requests/home-build-system.md steps 3-4). The engine's menu
 * belongs to the interactions an object declares; the Hearth, Wardrobe, Embalming Station and Crypt Vault also open a
 * screen, so this adds one synthetic row (`__home:<service>`) that Gameplay turns into the home dialog. Nothing here
 * reaches the sim: the screen's buttons dispatch `{ type: 'home' }` commands, which the homeServices system validates.
 */
import type { MenuEntry } from '../sim/contracts';
import type { WorldState } from '../sim/types';
import { dialogServiceOf, type HomeDialogService, HOME_DIALOG_SERVICES } from '../shared/homeServices';
import { buildHomeObjects } from '../sim/spatial/build/region';

export const HOME_ENTRY_PREFIX = '__home:';

const LABEL: Readonly<Record<HomeDialogService, { label: string; icon: MenuEntry['icon'] }>> = {
  hearth: { label: 'Tend the Hearth', icon: 'house' },
  wardrobe: { label: 'Open the Wardrobe', icon: 'star' },
  embalming: { label: 'Respec at the table', icon: 'heart' },
  vault: { label: 'Open the Crypt Vault', icon: 'plate' },
};

/** The home screen rows for the object `objectId` (none when it is not a home service object). */
export function homeMenuEntries(world: Pick<WorldState, 'objects' | 'town'>, objectId: string): MenuEntry[] {
  const defId = buildHomeObjects(world)[objectId]?.defId;
  const service = typeof defId === 'string' ? dialogServiceOf(defId) : null;
  if (!service) return [];
  const { label, icon } = LABEL[service];
  return [{ interactionId: `${HOME_ENTRY_PREFIX}${service}`, label, group: null, icon, available: true, reason: null, cost: null, params: { service } }];
}

/** The service a chosen row opens, or null when it is not a home row. */
export function homeServiceOfEntry(entry: MenuEntry): HomeDialogService | null {
  if (typeof entry.interactionId !== 'string' || !entry.interactionId.startsWith(HOME_ENTRY_PREFIX)) return null;
  const s = (entry.params as Record<string, unknown>)?.service;
  return (HOME_DIALOG_SERVICES as readonly unknown[]).includes(s) ? (s as HomeDialogService) : null;
}
