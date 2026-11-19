/** Player-facing labels: {target}/{param:key} templating, behaviour label overrides, activity gerunds. */
import type { InteractionDef } from '../contracts';
import type { AgentState, TargetRef } from '../types';
import { behaviorOf, callHook } from './behaviors';
import { objectName } from './objects';
import type { Engine } from './types';

export function targetDisplayName(eng: Engine, target: TargetRef): string {
  switch (target.kind) {
    case 'object':
      return objectName(eng, eng.state.objects[target.id]);
    case 'agent': {
      const a = eng.state.agents[target.id];
      return a ? a.firstName : 'someone';
    }
    case 'tile':
      return 'there';
    case 'self':
      return 'self';
  }
}

export function templateLabel(eng: Engine, label: string, target: TargetRef, params: Record<string, string | number | boolean>): string {
  let s = typeof label === 'string' ? label : '';
  s = s.replace(/\{target\}/g, () => targetDisplayName(eng, target));
  s = s.replace(/\{param:([A-Za-z0-9_]+)\}/g, (_m, k: string) => (params && params[k] !== undefined ? String(params[k]) : ''));
  return s.replace(/\s+/g, ' ').trim();
}

export function interactionLabel(
  eng: Engine,
  agent: AgentState,
  def: InteractionDef,
  target: TargetRef,
  params: Record<string, string | number | boolean> = {},
): string {
  const beh = behaviorOf(eng, def);
  if (beh && beh.label) {
    const r = callHook(eng, def, 'label', () => beh.label!(eng.ctx, agent, def, target));
    if (!r.threw && typeof r.value === 'string' && r.value.trim()) return r.value.trim();
  }
  return templateLabel(eng, def.label, target, params) || def.id;
}

const NO_DOUBLE = /[wxy]$/i;

function gerundWord(w: string): string {
  const lower = w.toLowerCase();
  if (lower.endsWith('ing') || lower.endsWith('ed')) return w;
  if (lower === 'be') return w + 'ing';
  if (lower.endsWith('ie')) return w.slice(0, -2) + 'ying';
  if (lower.endsWith('ee') || lower.endsWith('ye') || lower.endsWith('oe')) return w + 'ing';
  if (lower.endsWith('e') && lower.length > 2) return w.slice(0, -1) + 'ing';
  const vowels = lower.match(/[aeiou]+/g) ?? [];
  if (vowels.length === 1 && /[^aeiou][aeiou][^aeiou]$/.test(lower) && !NO_DOUBLE.test(lower)) return w + w[w.length - 1] + 'ing';
  return w + 'ing';
}

/** "Watch TV" -> "Watching TV", "Chat with Bob" -> "Chatting with Bob". */
export function gerund(label: string): string {
  const m = /^(\S+)(.*)$/.exec(label.trim());
  if (!m) return label;
  return gerundWord(m[1]) + m[2];
}
