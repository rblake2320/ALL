/**
 * Build/buy cursor labels (GameController.buildPreviewLabel): "$45 · 3 walls", "+$30 · 3 walls removed",
 * "$300 · 4×5 room", "$40 · 8 tiles", or the preview's failure reason.
 */
import type { BuildCommand, BuildPreview } from '../../sim/contracts';

export function formatMoney(cost: number): string {
  if (!Number.isFinite(cost) || cost === 0) return 'Free';
  const n = Math.round(Math.abs(cost)).toLocaleString('en-US');
  return cost < 0 ? `+$${n}` : `$${n}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildLabel(cmd: BuildCommand, preview: BuildPreview | null): string | null {
  if (!preview) return null;
  if (!preview.ok) return preview.reason && preview.reason.length > 0 ? preview.reason : "Can't build here";
  const money = formatMoney(preview.cost);
  switch (cmd.type) {
    case 'addWalls':
      return `${money} · ${plural(cmd.edges.length, 'wall')}`;
    case 'removeWalls':
      return `${money} · ${plural(cmd.edges.length, 'wall')} removed`;
    case 'room':
      return `${money} · ${Math.max(0, cmd.x1 - cmd.x0)}×${Math.max(0, cmd.z1 - cmd.z0)} room`;
    case 'floor': {
      const n = Math.max(0, cmd.x1 - cmd.x0) * Math.max(0, cmd.z1 - cmd.z0);
      return cmd.styleId === null ? `${money} · remove ${plural(n, 'floor tile')}` : `${money} · ${plural(n, 'tile')}`;
    }
    case 'paintWall':
      return `${money} · paint wall`;
    case 'paintRoom':
      return `${money} · paint room`;
    case 'buyOpening':
      return money;
    default:
      return money;
  }
}

/**
 * Screen-reader announcements for keyboard placement in Buy mode (GameController.placementAnnouncement).
 * Complete sentences so a live region reads them on their own.
 */
export const placementText = {
  start: (name: string): string => `Placing ${name}. Arrow keys move it, R rotates, Enter or Space places one, Shift+Enter places and keeps placing, Escape cancels.`,
  at: (name: string, x: number, z: number, where: string, status: string): string => `${name} at tile ${x}, ${z}, ${where}. ${status}`,
  ok: (cost: number): string => `Can place here for ${formatMoney(cost)}.`,
  okMove: (): string => 'Can move here.',
  blockedSlots: (): string => 'Some spots around it are blocked.',
  invalid: (reason: string): string => `Can't place here: ${reason.replace(/[.!]\s*$/, '')}.`,
  placed: (name: string, cost: number): string => `Placed ${name} for ${formatMoney(cost)}. Still placing: move on, or press Escape to stop.`,
  /** W-116: one item placed and placement ended (the Sims convention). */
  placedDone: (name: string, cost: number): string => `Placed ${name} for ${formatMoney(cost)}. Back to the catalog.`,
  done: (): string => 'Back to the catalog.',
  moved: (name: string): string => `Moved ${name}.`,
  failed: (): string => "Couldn't place it there.",
  cancelled: (name: string): string => `Stopped placing ${name}.`,
  rotated: (quarter: number): string => `Rotated to ${quarter * 90} degrees.`,
};
