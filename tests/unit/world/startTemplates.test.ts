import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../src/sim';
import { createStartTemplate, START_TEMPLATE_IDS } from '../../../src/sim/world/startTemplates';
import { validateStartLot } from '../../../src/sim/world/startValidation';

const registry = loadContent();
describe('S7 real lot data admission', () => {
  for (const id of START_TEMPLATE_IDS) it(`${id}: legal furniture and every interaction reachable from both entrances`, () => {
    const result = validateStartLot(createStartTemplate(id), registry, id.startsWith('derelict'));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    if (id.startsWith('derelict')) expect(result.dayOne).toHaveLength(3);
  });
  it('refuses unbuilt template ids', () => expect(() => createStartTemplate('unknown_house')).toThrow('Unknown start template'));
});
