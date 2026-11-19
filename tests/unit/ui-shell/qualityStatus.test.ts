/** W-039 / D-025: the Render quality status line ("Auto — currently Medium", Ultra's internal resolution). */
import { describe, expect, it } from 'vitest';
import type { GraphicsInfo } from '../../../src/render/contracts';
import { qualityStatus } from '../../../src/ui/shell/dialogs/SettingsDialog';

const info = (o: Partial<GraphicsInfo>): GraphicsInfo => ({
  level: 'medium', auto: null, pixelRatio: 1, bufferWidth: 1920, bufferHeight: 1080, supersampled: false, pixelRatioExplicit: false, ...o,
});
const auto = (level: 'low' | 'medium' | 'high', phase: 'probe' | 'watch') =>
  ({ level, phase, ceiling: 'high', gpuKind: 'integrated', gpu: 'x', lastP95: NaN, downgrades: 0 }) as const;

describe('qualityStatus', () => {
  it('Auto names the level it runs at, and says when it is still measuring', () => {
    expect(qualityStatus({ quality: 'auto' }, info({ level: 'medium', auto: auto('medium', 'watch') }))).toBe('Auto — currently Medium.');
    expect(qualityStatus({ quality: 'auto' }, info({ level: 'low', auto: auto('low', 'watch') }))).toBe('Auto — currently Low.');
    expect(qualityStatus({ quality: 'auto' }, info({ level: 'high', auto: auto('high', 'probe') }))).toBe('Auto — measuring this device (currently High).');
  });

  it('Auto without a live renderer (mocks, before init) explains itself instead of guessing a level', () => {
    expect(qualityStatus({ quality: 'auto' }, null)).toMatch(/Low, Medium or High/);
    expect(qualityStatus({ quality: 'auto' }, undefined)).toMatch(/Low, Medium or High/);
    expect(qualityStatus({ quality: 'auto' }, info({ auto: null }))).toMatch(/Low, Medium or High/);
  });

  it("Ultra shows its internal resolution: supersampled with an unset Pixel Ratio, the player's ratio otherwise", () => {
    expect(qualityStatus({ quality: 'ultra' }, info({ level: 'ultra', pixelRatio: 1.5, bufferWidth: 2880, bufferHeight: 1620, supersampled: true })))
      .toBe('Ultra renders internally at 2880 × 1620 (supersampled).');
    expect(qualityStatus({ quality: 'ultra' }, info({ level: 'ultra', pixelRatioExplicit: true })))
      .toBe('Renders internally at 1920 × 1080: your Resolution scale overrides Ultra’s supersampling.');
    // a 2x display needs no supersampling: plain internal resolution
    expect(qualityStatus({ quality: 'ultra' }, info({ level: 'ultra', pixelRatio: 2, bufferWidth: 3840, bufferHeight: 2160 })))
      .toBe('Renders internally at 3840 × 2160.');
  });

  it('fixed Low/Medium/High show nothing extra; garbage graphics info never throws', () => {
    for (const q of ['low', 'medium', 'high'] as const) expect(qualityStatus({ quality: q }, info({ level: q }))).toBeNull();
    expect(qualityStatus({ quality: 'ultra' }, null)).toBeNull();
    expect(qualityStatus({ quality: 'ultra' }, info({ level: 'ultra', bufferWidth: 0, bufferHeight: 0 }))).toBeNull();
  });
});
