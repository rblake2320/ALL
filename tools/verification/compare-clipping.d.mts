export interface AuditRow { key: string; look: string; verdict: 'PASS' | 'WARN' | 'FAIL'; checks: Array<{ name: string }> }
export function readRows(text: string): Map<string, AuditRow>;
export function compare(before: Map<string, AuditRow>, after: Map<string, AuditRow>): Record<string, unknown>;
