import { describe, expect, it } from 'vitest';
import { AgentMaterialWarmupGate } from '../../../src/render/core/agentMaterialWarmup';

describe('AgentMaterialWarmupGate', () => {
  it('precompiles once for a new rig set or render revision', () => {
    const gate = new AgentMaterialWarmupGate();
    expect(gate.shouldCompile('')).toBe(false);
    expect(gate.shouldCompile('z1:0')).toBe(true);
    expect(gate.shouldCompile('z1:0')).toBe(false);
    expect(gate.shouldCompile('z1:0|z2:0')).toBe(true);
    expect(gate.shouldCompile('z1:1|z2:0')).toBe(true);
    expect(gate.shouldCompile('z1:1|z2:0')).toBe(false);
  });

  it('does not suppress a later revision after all agents leave the scene', () => {
    const gate = new AgentMaterialWarmupGate();
    expect(gate.shouldCompile('z1:0')).toBe(true);
    expect(gate.shouldCompile('')).toBe(false);
    expect(gate.shouldCompile('z1:0')).toBe(true);
    expect(gate.shouldCompile('z1:1')).toBe(true);
  });
});
