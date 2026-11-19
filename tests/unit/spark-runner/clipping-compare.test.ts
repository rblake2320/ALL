import { describe, expect, it } from 'vitest';
import { compare, readRows } from '../../../tools/verification/compare-clipping.mjs';

const row = (key: string, look: string, verdict: string) => JSON.stringify({ key, look, verdict, checks: [] });
describe('W-111 clipping comparison', () => {
  it('compares only matching scenario/look pairs and reports additions and removals', () => {
    const before = readRows([row('floor:crawl','classic@h1','FAIL'), row('floor:beEmbalmed','classic@h1','FAIL'), row('old','a','WARN')].join('\n'));
    const after = readRows([row('floor:crawl','classic@h1','PASS'), row('floor:beEmbalmed','classic@h1','WARN'), row('new','a','PASS')].join('\n'));
    const result = compare(before, after);
    expect(result.matched).toBe(2);
    expect(result.transitions).toEqual({ 'other:FAIL->PASS': 1, 'furnitureOnlyFloor:FAIL->WARN': 1 });
    expect(result.beforeOnlyCount).toBe(1);
    expect(result.afterOnlyCount).toBe(1);
    expect(result.beforeOnlyExamples).toEqual([{ key: 'old', look: 'a' }]);
  });
  it('refuses malformed, duplicate, missing-verdict and audit-error records', () => {
    expect(() => readRows('')).toThrow();
    expect(() => readRows('{broken')).toThrow();
    expect(() => readRows(`${row('x','y','PASS')}\n${row('x','y','FAIL')}`)).toThrow(/Duplicate/);
    expect(() => readRows(row('x','y','MISSING'))).toThrow();
    expect(() => readRows(JSON.stringify({key:'x',look:'y',verdict:'FAIL',checks:[{name:'error'}]}))).toThrow(/Audit error/);
  });
});
