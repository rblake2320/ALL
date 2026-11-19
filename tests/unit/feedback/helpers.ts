/** Shared fixtures for the W-110 feedback tests. */
import { bytesToBase64 } from '../../../src/persistence/bytes';
import { createMemoryBackend, type MemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { ActivityTracker } from '../../../src/persistence/activity';
import { sealReport, type FeedbackReport, type ReportBody } from '../../../src/feedback/schema';

/** A structurally valid baseline JPEG header (SOI, APP0, SOF0 with the given size, EOI) — enough for imageInfo. */
export function fakeJpeg(width: number, height: number, padTo = 0): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const body = new Uint8Array(Math.max(0, padTo - head.length - sof.length - 2));
  const out = new Uint8Array(head.length + sof.length + body.length + 2);
  out.set(head, 0);
  out.set(sof, head.length);
  out.set(body, head.length + sof.length);
  out.set([0xff, 0xd9], out.length - 2);
  return out;
}

export function jpegDataUrl(w: number, h: number): string {
  return `data:image/jpeg;base64,${bytesToBase64(fakeJpeg(w, h))}`;
}

export function baseBody(over: Partial<ReportBody> = {}): ReportBody {
  return {
    format: 'afterlife-lease-report',
    v: 1,
    id: 'FB-7Q3KM-X2P9A',
    createdAt: '2026-11-06T10:00:00.000Z',
    game: { version: '1.0.0', build: 'abc123', checklist: 'v1-105' },
    bracket: '13plus',
    type: 'bug',
    area: 'buy',
    source: 'pause',
    presets: ['cantPlace'],
    text: 'The sofa would not go next to the wall.',
    screenshot: { mime: 'image/jpeg', width: 640, height: 360, data: bytesToBase64(fakeJpeg(640, 360)) },
    save: null,
    diagnostics: {
      platform: { userAgent: 'Mozilla/5.0 test', native: null, language: 'en' },
      graphics: { quality: 'auto', level: 'medium' },
      screen: 'game',
      mode: 'buy',
      tool: 'buy:placing',
      fps: { now: 58, min: 40, avg: 55, max: 61, samples: 12 },
      events: [{ t: 10, k: 'mode:buy', n: 1 }],
      errors: [{ at: '2026-11-06T09:59:00.000Z', where: 'input.buy', message: 'placement refused at 12,4' }],
      faults: [],
      crash: null,
      text: 'Afterlife Lease 1.0.0 — diagnostics',
    },
    ...over,
  };
}

export function sealed(over: Partial<ReportBody> = {}): FeedbackReport {
  return sealReport(baseBody(over));
}

export function memoryProfile(backend: MemoryBackend = createMemoryBackend()) {
  const store = new ProfileStoreImpl(() => Promise.resolve(backend), { logger: { warn: () => {} }, activity: new ActivityTracker() });
  return { backend, store };
}
