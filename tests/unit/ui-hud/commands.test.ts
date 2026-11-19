import { describe, expect, it, vi } from 'vitest';
import type { GameController } from '../../../src/game/contracts';
import { buyReward, markNotificationsRead, renameHousehold } from '../../../src/ui/hud/lib/commands';

function fakeGame(over: Partial<GameController>): GameController {
  return { playUi: vi.fn(), ...over } as unknown as GameController;
}

describe('HUD command wrappers', () => {
  it('passes controller results through and plays feedback sounds', () => {
    const g = fakeGame({ buyReward: vi.fn(() => ({ ok: true })), renameHousehold: vi.fn(() => ({ ok: false, reason: 'Too spooky' })) });
    expect(buyReward(g, 'a1', 'r1')).toEqual({ ok: true });
    expect(g.playUi).toHaveBeenLastCalledWith('milestone');
    expect(renameHousehold(g, 'X')).toEqual({ ok: false, reason: 'Too spooky' });
    expect(g.playUi).toHaveBeenLastCalledWith('uiError');
  });
  it('contains a throwing controller', () => {
    const g = fakeGame({
      buyReward: vi.fn(() => {
        throw new Error('sim gone');
      }),
      markNotificationsRead: vi.fn(() => {
        throw 'string failure';
      }),
    });
    expect(buyReward(g, 'a1', 'r1')).toEqual({ ok: false, reason: 'sim gone' });
    expect(markNotificationsRead(g)).toEqual({ ok: false, reason: 'string failure' });
  });
  it('treats garbage return values as failures and void as success', () => {
    const g = fakeGame({ renameHousehold: vi.fn(() => 42 as never), markNotificationsRead: vi.fn(() => undefined) });
    expect(renameHousehold(g, 'The Grimsbys')).toEqual({ ok: false, reason: 'No response' });
    expect(markNotificationsRead(g)).toEqual({ ok: true });
  });
  it('refuses empty ids without calling the controller', () => {
    const spy = vi.fn(() => ({ ok: true }));
    const g = fakeGame({ buyReward: spy });
    expect(buyReward(g, '', 'r1').ok).toBe(false);
    expect(buyReward(g, 'a1', '').ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
