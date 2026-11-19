/**
 * Security review 2026-11-05 L-8: scripts/build-pack.mjs used to fall back SILENTLY to the dev signing key when
 * --key was omitted. It now refuses to sign (exit 2, nothing written) unless the key is explicit: --key <file> or --dev.
 */
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const dir = mkdtempSync(join(tmpdir(), 'al-buildpack-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts/build-pack.mjs'), ...args], { encoding: 'utf8' });

describe('L-8 build-pack.mjs never signs with an implicit key', () => {
  it('exploit: no --key and no --dev → refuses (exit 2), writes no pack and generates no key', () => {
    const out = join(dir, 'implicit');
    const r = run('--out', out, '--zip');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refusing to sign without an explicit key/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.zip`)).toBe(false);
  });

  it('--key without a value, or --key together with --dev → refuses', () => {
    expect(run('--out', join(dir, 'a'), '--key').status).toBe(2);
    expect(run('--key', '--dev', '--out', join(dir, 'b')).status).toBe(2);
    const k = join(dir, 'k.json');
    writeFileSync(k, '{}');
    expect(run('--key', k, '--dev', '--out', join(dir, 'c')).status).toBe(2);
    for (const p of ['a', 'b', 'c']) expect(existsSync(join(dir, p))).toBe(false);
  });

  it('an explicit --key signs with exactly that key', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    const keyFile = join(dir, 'release.json');
    writeFileSync(keyFile, JSON.stringify({ keyId: 'test-release', publicKey: raw, privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') }));
    const out = join(dir, 'explicit');
    const r = run('--key', keyFile, '--out', out);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'pack.sig'), 'utf8')).keyId).toBe('test-release');
    expect(r.stderr).not.toMatch(/DEV key/);
  });
});
