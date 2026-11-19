/** Web Storage (localStorage) fake with a browser-like quota (UTF-16 code units of keys + values). */
export class FakeStorage implements Storage {
  private map = new Map<string, string>();
  throwOnAccess = false;
  constructor(private readonly quotaChars = 5_000_000) {}
  private used(): number {
    let n = 0;
    for (const [k, v] of this.map) n += k.length + v.length;
    return n;
  }
  private guard(): void {
    if (this.throwOnAccess) throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  get length(): number {
    this.guard();
    return this.map.size;
  }
  clear(): void {
    this.guard();
    this.map.clear();
  }
  getItem(key: string): string | null {
    this.guard();
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    this.guard();
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.guard();
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.guard();
    const prev = this.map.get(key);
    const next = this.used() - (prev !== undefined ? key.length + prev.length : 0) + key.length + value.length;
    if (next > this.quotaChars) throw new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError');
    this.map.set(key, String(value));
  }
  [name: string]: unknown;
}
