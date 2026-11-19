import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyPack, PackRegistry, readZip, crc32, checkPackPath, trustedPublisherKeys, PRODUCTION_PUBLISHER_KEYS, type PublisherKey } from '../../../src/packs';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { HOUSE_BRAND_SKINS, brandSkinFor, setPackBrandSkins } from '../../../src/economy/brands';
import { sha256Hex } from '../../../src/persistence/sha256';

const ROOT = join(__dirname, '../../..');
const enc = new TextEncoder();
let dir = '';
let devKey: PublisherKey;
const ENGINE = '1.0.0';

function readDir(d: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (p: string) => {
    for (const n of readdirSync(p)) {
      const f = join(p, n);
      if (statSync(f).isDirectory()) walk(f);
      else out.set(relative(d, f).split('\\').join('/'), new Uint8Array(readFileSync(f)));
    }
  };
  walk(d);
  return out;
}

/** Test zip writer (deflate or stored, optional lying sizes). */
function zip(files: [string, Uint8Array, { store?: boolean; usize?: number; flags?: number }?][]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const [name, data, o = {}] of files) {
    const nb = Buffer.from(name);
    const comp = o.store ? Buffer.from(data) : deflateRawSync(data);
    const usize = o.usize ?? data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(o.flags ?? 0, 6); lh.writeUInt16LE(o.store ? 0 : 8, 8); lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(o.flags ?? 0, 8); ch.writeUInt16LE(o.store ? 0 : 8, 10); ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

async function resign(files: Map<string, Uint8Array>, mutate: (m: Record<string, unknown>) => void, key = join(dir, 'key.json')): Promise<Map<string, Uint8Array>> {
  const m = JSON.parse(new TextDecoder().decode(files.get('pack.json')!)) as Record<string, unknown>;
  mutate(m);
  const k = JSON.parse(readFileSync(key, 'utf8')) as { privateKey: string; keyId: string };
  const { createPrivateKey } = await import('node:crypto');
  const pk = createPrivateKey({ key: Buffer.from(k.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const out = new Map(files);
  out.set('pack.json', enc.encode(JSON.stringify(m)));
  out.set('pack.sig', enc.encode(JSON.stringify({ alg: 'Ed25519', keyId: k.keyId, sig: sign(null, Buffer.from(canonicalJson(m)), pk).toString('base64') })));
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'al-pack-'));
  // a throw-away key in the temp dir (never the repo's .keys/)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  writeFileSync(join(dir, 'key.json'), JSON.stringify({ keyId: 'afterlife-dev', publicKey: raw, privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') }));
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-pack.mjs'), '--out', join(dir, 'house-brands'), '--key', join(dir, 'key.json'), '--zip'], { stdio: 'pipe' });
  devKey = { keyId: 'afterlife-dev', publicKey: raw, label: 'Test key' };
});

const opts = () => ({ trustedKeys: [devKey], engineVersion: ENGINE });

describe('content packs: first-party house-brands pack', () => {
  it('the built pack (directory and zip) verifies and registers all-or-nothing', async () => {
    const files = readDir(join(dir, 'house-brands'));
    const r = await verifyPack(files, opts());
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.pack.signed).toBe(true);
    expect(r.pack.manifest.contents.brandSkins!.map((s) => s.id)).toEqual(HOUSE_BRAND_SKINS.map((s) => s.id));
    const z = await verifyPack(new Uint8Array(readFileSync(join(dir, 'house-brands.zip'))), opts());
    expect(z.ok, z.ok ? '' : z.error).toBe(true);
    const reg = new PackRegistry((skins) => setPackBrandSkins(skins));
    expect(reg.register(r.pack)).toEqual({ ok: true });
    expect(reg.register(r.pack).ok).toBe(false); // same pack twice
    expect(brandSkinFor('fridge_humming')?.brand).toBe('Grave-Cola');
    expect(reg.unregister('house-brands')).toBe(true);
    setPackBrandSkins([]);
  });

  it('production keys are placeholders (ignored) and production builds trust nothing else', () => {
    expect(PRODUCTION_PUBLISHER_KEYS.length).toBeGreaterThan(0);
    expect(trustedPublisherKeys().some((k) => PRODUCTION_PUBLISHER_KEYS.includes(k))).toBe(false);
  });
});

describe('content packs: adversarial', () => {
  const base = () => readDir(join(dir, 'house-brands'));
  const expectReject = async (src: Uint8Array | Map<string, Uint8Array>, re: RegExp, o: Partial<ReturnType<typeof opts>> & { creatorMode?: boolean } = {}) => {
    const r = await verifyPack(src, { ...opts(), ...o });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  };

  it('altered asset → rejected (SHA-256)', async () => {
    const f = base();
    const p = [...f.keys()].find((k) => k.endsWith('.svg'))!;
    const b = f.get(p)!.slice();
    b[b.length - 2] ^= 1;
    f.set(p, b);
    await expectReject(f, /altered|SHA-256/);
  });

  it('bad signature / edited manifest / unknown publisher / swapped key id → rejected', async () => {
    const f = base();
    const m = JSON.parse(new TextDecoder().decode(f.get('pack.json')!));
    m.contents.brandSkins[0].flavorText = 'Edited after signing';
    f.set('pack.json', enc.encode(JSON.stringify(m)));
    await expectReject(f, /signature does not match/);
    await expectReject(base(), /not on the allowed list/, { trustedKeys: [] });
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    await expectReject(base(), /signature does not match/, { trustedKeys: [{ ...devKey, publicKey: other }] });
    const g = base();
    g.set('pack.sig', enc.encode('{"alg":"RSA","keyId":"x","sig":"AAAA"}'));
    await expectReject(g, /malformed/);
  });

  it('unsigned packs: refused normally, allowed only in Creator mode (and labelled)', async () => {
    const f = base();
    f.delete('pack.sig');
    await expectReject(f, /not signed/);
    const r = await verifyPack(f, { ...opts(), creatorMode: true });
    expect(r.ok && r.pack.signed).toBe(false);
    expect(r.ok && r.pack.label).toMatch(/Creator mode/);
  });

  it('path traversal / absolute / backslash / dot-file / deep nesting / nested archive → rejected', async () => {
    for (const bad of ['../evil.svg', '/etc/passwd', 'assets\\x.svg', 'assets/../../x', 'C:/x', '.hidden', 'a/b/c/d/e/f/g.svg', 'assets/inner.zip', 'assets/x\u0000.svg', 'Assets/X.svg', '']) {
      expect(checkPackPath(bad).ok, bad).toBe(false);
      const f = base();
      f.set(bad, enc.encode('x'));
      await expectReject(f, /./);
    }
    // traversal inside a zip entry name, and a manifest asset path
    const zipped = zip([['pack.json', base().get('pack.json')!], ['../../escape.txt', enc.encode('x')]]);
    await expectReject(zipped, /traversal|segment/);
    const f = await resign(base(), (m) => ((m.assets as { path: string }[])[0].path = '../x.svg'));
    await expectReject(f, /traversal/);
  });

  it('unlisted extra file, missing asset, wrong size → rejected', async () => {
    const f = base();
    f.set('assets/extra.svg', enc.encode('<svg/>'));
    await expectReject(f, /not listed/);
    const g = base();
    g.delete([...g.keys()].find((k) => k.endsWith('.svg'))!);
    await expectReject(g, /missing/);
  });

  it('oversize file / too many files / oversize manifest → rejected', async () => {
    const f = base();
    f.set('assets/big.svg', new Uint8Array(9 * 1024 * 1024));
    await expectReject(f, /too large/);
    const many = base();
    for (let i = 0; i < 600; i++) many.set(`assets/f${i}.svg`, enc.encode('x'));
    await expectReject(many, /too many/);
    const g = base();
    g.set('pack.json', enc.encode(`{"pad":"${'x'.repeat(300 * 1024)}"}`));
    await expectReject(g, /too large/);
  });

  it('zip bombs: high ratio, lying declared size, encrypted entry, deep JSON nesting → rejected without inflating', async () => {
    const zeros = new Uint8Array(4 * 1024 * 1024);
    await expectReject(zip([['pack.json', base().get('pack.json')!], ['assets/bomb.svg', zeros]]), /compression ratio|zip bomb/);
    // declared small but inflates big
    const lying = zip([['pack.json', base().get('pack.json')!], ['assets/lie.svg', new Uint8Array(200_000), { usize: 100 }]]);
    await expectReject(lying, /declared size|zip bomb|CRC|size/);
    await expectReject(zip([['pack.json', base().get('pack.json')!, { flags: 1 }]]), /encrypted/);
    let deep = '1';
    for (let i = 0; i < 40; i++) deep = `[${deep}]`;
    const f = await resign(base(), (m) => ((m.contents as Record<string, unknown>).objects = JSON.parse(deep)));
    await expectReject(f, /nested too deeply/);
    await expectReject(new Uint8Array([1, 2, 3]), /not a zip/);
  });

  it('content rules: licensed/unknown brands, unregistrable kinds, future engine, prototype keys → rejected', async () => {
    await expectReject(await resign(base(), (m) => (((m.contents as { brandSkins: Record<string, unknown>[] }).brandSkins[0].licensed = true))), /licensed/);
    await expectReject(await resign(base(), (m) => (((m.contents as { brandSkins: Record<string, unknown>[] }).brandSkins[0].brand = 'Coca-Cola'))), /not an approved house brand/);
    await expectReject(await resign(base(), (m) => ((m.contents as Record<string, unknown>).objects = [{ id: 'x' }])), /cannot load "objects"/);
    await expectReject(await resign(base(), (m) => ((m.requires as Record<string, string>).engine = '>=9.0.0')), /needs game version/);
    await expectReject(await resign(base(), (m) => (m.ageRating = 'M')), /ageRating/);
    const f = base();
    f.set('pack.json', enc.encode('{"__proto__":{"polluted":true}}'));
    await expectReject(f, /reserved key/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('registry is all-or-nothing: a clash leaves the previous state untouched', async () => {
    const applied: number[] = [];
    const reg = new PackRegistry((s) => applied.push(s.length));
    const ok = await verifyPack(base(), opts());
    if (!ok.ok) throw new Error(ok.error);
    const clash = await verifyPack(await resign(base(), (m) => { m.id = 'other-pack'; }), opts());
    if (!clash.ok) throw new Error(clash.error);
    expect(reg.register(ok.pack).ok).toBe(true);
    const before = applied.length;
    expect(reg.register(clash.pack).ok).toBe(false);
    expect(applied.length).toBe(before);
    expect(reg.list().map((p) => p.manifest.id)).toEqual(['house-brands']);
  });

  it('zip reader round-trips stored + deflate entries and checks CRC', async () => {
    const files = await readZip(zip([['a.txt', enc.encode('hello')], ['b/c.txt', enc.encode('world'), { store: true }]]));
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('hello');
    expect(new TextDecoder().decode(files.get('b/c.txt'))).toBe('world');
    expect(await sha256Hex(files.get('a.txt')!)).toMatch(/^[0-9a-f]{64}$/);
  });
});
