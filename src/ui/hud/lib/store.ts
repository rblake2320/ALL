/**
 * HUD-local UI state (not game state): remembered tabs, drawer open flags, catalog/build preferences.
 * Lives outside components so it survives mode switches and selection changes.
 */
import { useEffect, useReducer } from 'preact/hooks';
import { DEFAULT_INTERIOR_WALL } from '../../../shared/styles';
import type { RelFilter, RelSort } from './relationships';

export type AgentTab = 'needs' | 'mood' | 'skills' | 'jobs' | 'career' | 'relationships' | 'aspiration' | 'info';
export const AGENT_TABS: AgentTab[] = ['needs', 'mood', 'skills', 'jobs', 'career', 'relationships', 'aspiration', 'info'];

export interface HudUiState {
  agentTab: AgentTab;
  agentCollapsed: boolean;
  /** Viewport y (px) of the agent panel's top edge while it is mounted (the household bar fits above it). */
  agentPanelTop: number | null;
  /** Right edge (px) of the agent panel while mounted (the phone landscape queue sits right of it). */
  agentPanelRight: number | null;
  logOpen: boolean;
  logFilter: string;
  inviteMode: 'invite' | 'party';
  relFilter: RelFilter;
  relSort: RelSort;
  buyFocus: string | null;
  buySearch: string;
  /** W-123: the Buy catalog shows only these items (a quest row's "Needs an easel · Shop"); null = normal tabs. */
  buyFilter: { label: string; defIds: string[] } | null;
  styles: {
    wall: string;
    roomWall: string;
    roomFloor: string | null;
    floor: string | null;
    paint: string;
    wholeRoom: boolean;
    door: string;
    window: string;
  };
}

type Listener = () => void;

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(l: Listener): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k of Object.keys(p) as (keyof T)[]) {
        if (!Object.is(state[k], p[k])) changed = true;
      }
      if (!changed) return;
      state = { ...state, ...p };
      for (const l of [...listeners]) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const hudStore = createStore<HudUiState>({
  agentTab: 'needs',
  agentCollapsed: false,
  agentPanelTop: null,
  agentPanelRight: null,
  logOpen: false,
  logFilter: 'all',
  inviteMode: 'invite',
  relFilter: 'all',
  relSort: 'friendship',
  buyFocus: null,
  buySearch: '',
  buyFilter: null,
  styles: {
    wall: DEFAULT_INTERIOR_WALL,
    roomWall: DEFAULT_INTERIOR_WALL,
    roomFloor: 'floor_planks_worn',
    floor: 'floor_planks_worn',
    paint: 'wall_stripes_plum',
    wholeRoom: false,
    door: 'door_splintered',
    window: 'window_grimy',
  },
});

/** Subscribe a component to the HUD store; returns the current state. */
export function useHudStore(): HudUiState {
  const [, bump] = useReducer((n: number) => (n + 1) % 1_000_000, 0);
  useEffect(() => hudStore.subscribe(() => bump(0)), []);
  return hudStore.get();
}
