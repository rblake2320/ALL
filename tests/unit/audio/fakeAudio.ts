/**
 * Minimal but strict fake of the WebAudio API for node tests. It throws where browsers throw
 * (non-finite values, negative times, double start(), stop() before start(), cross-context connects,
 * bad buffers), records automation so tests can inspect values, and counts nodes/sources.
 */

class DOMErr extends Error {
  constructor(name: string, msg: string) {
    super(msg);
    this.name = name;
  }
}

function checkFinite(v: unknown, what: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what}: non-finite value ${String(v)}`);
}

function checkTime(t: unknown, what: string): void {
  checkFinite(t, what);
  if ((t as number) < 0) throw new RangeError(`${what}: negative time ${String(t)}`);
}

export interface ParamEvent {
  type: string;
  value: number;
  time: number;
  tc?: number;
}

export class FakeParam {
  private v: number;
  readonly events: ParamEvent[] = [];
  readonly inputs: FakeNode[] = [];
  constructor(readonly ctx: FakeContext, readonly name: string, v: number) {
    this.v = v;
  }
  get value(): number {
    return this.v;
  }
  set value(x: number) {
    checkFinite(x, `${this.name}.value`);
    this.v = x;
  }
  get defaultValue(): number {
    return 0;
  }
  setValueAtTime(v: number, t: number): this {
    checkFinite(v, `${this.name}.setValueAtTime value`);
    checkTime(t, `${this.name}.setValueAtTime time`);
    this.events.push({ type: 'set', value: v, time: t });
    this.ctx.paramEvents++;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    checkFinite(v, `${this.name}.linearRamp value`);
    checkTime(t, `${this.name}.linearRamp time`);
    this.events.push({ type: 'lin', value: v, time: t });
    this.ctx.paramEvents++;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    checkFinite(v, `${this.name}.expRamp value`);
    checkTime(t, `${this.name}.expRamp time`);
    if (v === 0) throw new RangeError(`${this.name}.expRamp to zero`);
    this.events.push({ type: 'exp', value: v, time: t });
    this.ctx.paramEvents++;
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    checkFinite(v, `${this.name}.setTarget value`);
    checkTime(t, `${this.name}.setTarget time`);
    checkFinite(tc, `${this.name}.setTarget tc`);
    if (tc < 0) throw new RangeError('negative time constant');
    this.events.push({ type: 'target', value: v, time: t, tc });
    this.ctx.paramEvents++;
    return this;
  }
  cancelScheduledValues(t: number): this {
    checkTime(t, `${this.name}.cancel time`);
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].time >= t) this.events.splice(i, 1);
    return this;
  }
  cancelAndHoldAtTime(t: number): this {
    return this.cancelScheduledValues(t);
  }
  setValueCurveAtTime(): this {
    throw new DOMErr('NotSupportedError', 'curves are banned in this codebase');
  }
  /** Last scheduled target value (or current value). */
  lastTarget(): number {
    return this.events.length ? this.events[this.events.length - 1].value : this.v;
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode | FakeParam>();
  disconnected = 0;
  constructor(readonly context: FakeContext, readonly kind: string) {
    context.nodes.push(this);
    context.nodesCreated++;
    context.byKind.set(kind, (context.byKind.get(kind) ?? 0) + 1);
  }
  connect<T>(dest: T): T {
    const d = dest as unknown as FakeNode | FakeParam;
    if (!(d instanceof FakeNode) && !(d instanceof FakeParam)) throw new TypeError('connect target is not an AudioNode/AudioParam');
    const dctx = d instanceof FakeNode ? d.context : d.ctx;
    if (dctx !== this.context) throw new DOMErr('InvalidAccessError', 'cross-context connect');
    this.outputs.add(d);
    if (d instanceof FakeParam) d.inputs.push(this);
    return dest;
  }
  disconnect(): void {
    this.outputs.clear();
    this.disconnected++;
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(ctx: FakeContext) {
    super(ctx, 'gain');
    this.gain = new FakeParam(ctx, 'gain', 1);
  }
}

export class FakeSource extends FakeNode {
  started = false;
  startTime = NaN;
  stopTime = Infinity;
  stopCalls = 0;
  onended: (() => void) | null = null;
  constructor(ctx: FakeContext, kind: string) {
    super(ctx, kind);
    ctx.sources.push(this);
  }
  start(when = 0, offset?: number, duration?: number): void {
    checkTime(when, `${this.kind}.start`);
    if (offset !== undefined) checkTime(offset, `${this.kind}.start offset`);
    if (duration !== undefined) checkTime(duration, `${this.kind}.start duration`);
    if (this.started) throw new DOMErr('InvalidStateError', 'start() called twice');
    this.started = true;
    this.startTime = when;
  }
  stop(when = 0): void {
    checkTime(when, `${this.kind}.stop`);
    if (!this.started) throw new DOMErr('InvalidStateError', 'stop() before start()');
    this.stopTime = when;
    this.stopCalls++;
  }
}

export class FakeOscillator extends FakeSource {
  private t: OscillatorType = 'sine';
  readonly frequency: FakeParam;
  readonly detune: FakeParam;
  wave: unknown = null;
  constructor(ctx: FakeContext) {
    super(ctx, 'oscillator');
    this.frequency = new FakeParam(ctx, 'osc.frequency', 440);
    this.detune = new FakeParam(ctx, 'osc.detune', 0);
  }
  get type(): OscillatorType {
    return this.t;
  }
  set type(v: OscillatorType) {
    if (v === 'custom') throw new DOMErr('InvalidStateError', "type='custom' needs setPeriodicWave");
    if (!['sine', 'square', 'sawtooth', 'triangle'].includes(v)) throw new TypeError(`bad oscillator type ${v}`);
    this.t = v;
  }
  setPeriodicWave(w: unknown): void {
    if (!(w instanceof FakePeriodicWave)) throw new TypeError('not a PeriodicWave');
    this.wave = w;
    this.t = 'custom';
  }
}

export class FakeBufferSource extends FakeSource {
  private buf: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: FakeParam;
  readonly detune: FakeParam;
  constructor(ctx: FakeContext) {
    super(ctx, 'bufferSource');
    this.playbackRate = new FakeParam(ctx, 'abs.playbackRate', 1);
    this.detune = new FakeParam(ctx, 'abs.detune', 0);
  }
  get buffer(): FakeBuffer | null {
    return this.buf;
  }
  set buffer(b: FakeBuffer | null) {
    if (this.buf !== null && b !== null) throw new DOMErr('InvalidStateError', 'buffer already set');
    if (b !== null && !(b instanceof FakeBuffer)) throw new TypeError('not an AudioBuffer');
    this.buf = b;
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  readonly gain: FakeParam;
  readonly detune: FakeParam;
  constructor(ctx: FakeContext) {
    super(ctx, 'biquad');
    this.frequency = new FakeParam(ctx, 'biquad.frequency', 350);
    this.Q = new FakeParam(ctx, 'biquad.Q', 1);
    this.gain = new FakeParam(ctx, 'biquad.gain', 0);
    this.detune = new FakeParam(ctx, 'biquad.detune', 0);
  }
}

export class FakePanner extends FakeNode {
  readonly pan: FakeParam;
  constructor(ctx: FakeContext) {
    super(ctx, 'stereoPanner');
    this.pan = new FakeParam(ctx, 'pan', 0);
  }
}

export class FakeShaper extends FakeNode {
  private c: Float32Array | null = null;
  oversample: OverSampleType = 'none';
  constructor(ctx: FakeContext) {
    super(ctx, 'waveShaper');
  }
  get curve(): Float32Array | null {
    return this.c;
  }
  set curve(c: Float32Array | null) {
    if (c && c.length < 2) throw new DOMErr('InvalidStateError', 'curve too short');
    this.c = c ? c.slice() : null;
  }
}

export class FakeConvolver extends FakeNode {
  private b: FakeBuffer | null = null;
  normalize = true;
  constructor(ctx: FakeContext) {
    super(ctx, 'convolver');
  }
  get buffer(): FakeBuffer | null {
    return this.b;
  }
  set buffer(b: FakeBuffer | null) {
    if (b && b.sampleRate !== this.context.sampleRate) throw new DOMErr('NotSupportedError', 'IR sample rate mismatch');
    if (b && ![1, 2, 4].includes(b.numberOfChannels)) throw new DOMErr('NotSupportedError', 'IR channel count');
    this.b = b;
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold: FakeParam;
  readonly knee: FakeParam;
  readonly ratio: FakeParam;
  readonly attack: FakeParam;
  readonly release: FakeParam;
  reduction = 0;
  constructor(ctx: FakeContext) {
    super(ctx, 'compressor');
    this.threshold = new FakeParam(ctx, 'comp.threshold', -24);
    this.knee = new FakeParam(ctx, 'comp.knee', 30);
    this.ratio = new FakeParam(ctx, 'comp.ratio', 12);
    this.attack = new FakeParam(ctx, 'comp.attack', 0.003);
    this.release = new FakeParam(ctx, 'comp.release', 0.25);
  }
}

export class FakePeriodicWave {}

export class FakeBuffer {
  private readonly data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    if (!(c >= 0 && c < this.numberOfChannels)) throw new DOMErr('IndexSizeError', 'channel');
    return this.data[c];
  }
}

export class FakeContext {
  sampleRate: number;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  nodesCreated = 0;
  paramEvents = 0;
  readonly byKind = new Map<string, number>();
  readonly sources: FakeSource[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  /** If set, resume() never settles (locked autoplay). */
  hangResume = false;
  /** If set, resume() rejects and the state stays put (e.g. iOS while an interruption lasts). */
  rejectResume = false;
  /** statechange listeners (addEventListener) + onstatechange, fired in a microtask like browsers do. */
  private readonly listeners = new Set<() => void>();
  onstatechange: (() => void) | null = null;
  stateEvents = 0;

  constructor(opts: { sampleRate?: number } = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.destination = new FakeNode(this, 'destination');
  }

  advance(dt: number): void {
    if (this.state === 'running') this.currentTime += dt;
  }

  addEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') this.listeners.delete(fn);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }

  private setState(s: AudioContextState | 'interrupted'): void {
    if (this.state === s) return;
    this.state = s as AudioContextState;
    void Promise.resolve().then(() => {
      this.stateEvents++;
      for (const fn of [...this.listeners]) fn();
      this.onstatechange?.();
    });
  }

  /** The OS/browser takes the device (phone call, Bluetooth switch): state changes without anyone asking. */
  interrupt(state: 'suspended' | 'interrupted' = 'interrupted'): void {
    if (this.state !== 'closed') this.setState(state);
  }
  /** The OS gives the device back on its own (Safari ends an interruption). */
  endInterruption(): void {
    if (this.state !== 'closed') this.setState('running');
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.hangResume) return new Promise(() => undefined);
    if (this.rejectResume) return Promise.reject(new DOMErr('InvalidStateError', 'interrupted'));
    if (this.state === 'closed') return Promise.reject(new DOMErr('InvalidStateError', 'closed'));
    this.setState('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state === 'closed') return Promise.reject(new DOMErr('InvalidStateError', 'closed'));
    this.setState('suspended');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.setState('closed');
    return Promise.resolve();
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }
  createConvolver(): FakeConvolver {
    return new FakeConvolver(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array): FakePeriodicWave {
    if (real.length !== imag.length || real.length < 2) throw new DOMErr('IndexSizeError', 'periodic wave lengths');
    return new FakePeriodicWave();
  }
  createBuffer(ch: number, len: number, sr: number): FakeBuffer {
    if (!(ch >= 1 && ch <= 32)) throw new DOMErr('NotSupportedError', 'channels');
    if (!(len >= 1)) throw new DOMErr('NotSupportedError', 'length');
    if (!(sr >= 3000 && sr <= 768000)) throw new DOMErr('NotSupportedError', 'sampleRate');
    return new FakeBuffer(ch, Math.floor(len), sr);
  }

  /** Sources started and never given a stop (or stopped after `t`). */
  liveSources(t = Infinity): FakeSource[] {
    return this.sources.filter((s) => s.started && s.stopTime >= t);
  }
}

export function asCtx(c: FakeContext): BaseAudioContext {
  return c as unknown as BaseAudioContext;
}
