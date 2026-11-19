/**
 * The browser's side of the shared town, without the browser: prediction of your own zombie, and smooth playback of
 * everybody else. PURE (time is passed in), so it is tested without a network.
 *
 *  - Your own zombie moves the moment you press a key (`localInput` runs the server's own `stepWalk`). When the server
 *    reports where it has you, the page starts again from that position and replays the steps the server has not
 *    applied yet. If both agree, nothing visible happens; if not, the server wins.
 *  - Other zombies are drawn a little in the past (`INTERP_DELAY_MS`), sliding between the two newest reports, so
 *    they move smoothly although reports arrive only 15 times a second.
 */
import { stepWalk, TOWN_TICK_HZ, type Walker } from './room';
import type { WalkArea } from './street';
import type { InputMsg, PlayerInfo, SnapMsg, TownLook, WelcomeMsg } from './protocol';

/** Other zombies are shown this far in the past. Two snapshot intervals, so one lost report does not cause a stop. */
export const INTERP_DELAY_MS = 140;
/** Unconfirmed steps kept for replay (four seconds). Older ones are forgotten and the server's position is taken. */
export const PENDING_MAX = TOWN_TICK_HZ * 4;
/** A remote zombie whose reports stopped is frozen in place after this long instead of sliding on. */
export const STALE_MS = 1000;

interface Sample {
  at: number;
  x: number;
  z: number;
  f: number;
  moving: boolean;
}

export interface RemoteView {
  id: number;
  name: number;
  look: TownLook;
  x: number;
  z: number;
  facing: number;
  moving: boolean;
}

export interface SelfView extends Walker {
  id: number;
  moving: boolean;
}

interface Remote {
  info: PlayerInfo;
  samples: Sample[];
}

/** Shortest way round from angle a to angle b, a fraction t of the way. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class TownClientCore {
  private me: (Walker & { id: number }) | null = null;
  private seq = 0;
  private pending: InputMsg[] = [];
  private lastMoveInputAt = -Infinity;
  private readonly remotes = new Map<number, Remote>();
  minute = 0;
  day = 0;
  /** Times the server's position differed from the page's own after replay (a measure of prediction quality). */
  corrections = 0;

  constructor(private readonly area: WalkArea) {}

  get joined(): boolean {
    return this.me !== null;
  }

  get playerCount(): number {
    return this.me ? this.remotes.size + 1 : 0;
  }

  welcome(msg: WelcomeMsg, nowMs: number): boolean {
    const mine = msg.players.find((p) => p.id === msg.id);
    if (!mine) return false;
    this.me = { id: msg.id, x: mine.x, z: mine.z, facing: mine.f };
    this.seq = 0;
    this.pending = [];
    this.remotes.clear();
    this.minute = msg.minute;
    this.day = msg.day;
    for (const p of msg.players) if (p.id !== msg.id) this.join(p, nowMs);
    return true;
  }

  join(p: PlayerInfo, nowMs: number): void {
    if (!this.me || p.id === this.me.id) return;
    this.remotes.set(p.id, { info: p, samples: [{ at: nowMs, x: p.x, z: p.z, f: p.f, moving: false }] });
  }

  leave(id: number): void {
    this.remotes.delete(id);
  }

  /** The connection dropped: forget everyone. */
  reset(): void {
    this.me = null;
    this.pending = [];
    this.remotes.clear();
  }

  /** Take one step in (mx, mz) now and return the message to send, or null before the welcome. */
  localInput(mx: number, mz: number, nowMs: number): InputMsg | null {
    if (!this.me) return null;
    this.seq += 1;
    const msg: InputMsg = { t: 'in', seq: this.seq, mx, mz };
    if (stepWalk(this.me, mx, mz, this.area)) this.lastMoveInputAt = nowMs;
    this.pending.push(msg);
    if (this.pending.length > PENDING_MAX) this.pending.splice(0, this.pending.length - PENDING_MAX);
    return msg;
  }

  onSnap(snap: SnapMsg, nowMs: number): void {
    if (!this.me) return;
    this.minute = snap.minute;
    // own zombie: the server's position, plus every step it has not applied yet
    this.pending = this.pending.filter((m) => m.seq > snap.a);
    const replay: Walker = { x: snap.you[0], z: snap.you[1], facing: this.me.facing };
    for (const m of this.pending) stepWalk(replay, m.mx, m.mz, this.area);
    if (replay.x !== this.me.x || replay.z !== this.me.z) this.corrections += 1;
    this.me.x = replay.x;
    this.me.z = replay.z;
    // everyone else
    for (const [id, x, z, f, moving] of snap.p) {
      const r = this.remotes.get(id);
      if (!r) continue; // a zombie we have not been introduced to yet (its `join` is on the way)
      r.samples.push({ at: nowMs, x, z, f, moving: moving === 1 });
      if (r.samples.length > 8) r.samples.splice(0, r.samples.length - 8);
    }
  }

  self(nowMs: number): SelfView | null {
    if (!this.me) return null;
    return { id: this.me.id, x: this.me.x, z: this.me.z, facing: this.me.facing, moving: nowMs - this.lastMoveInputAt < 200 };
  }

  /** Everyone else, where they were `INTERP_DELAY_MS` ago, lowest id first. */
  others(nowMs: number): RemoteView[] {
    const out: RemoteView[] = [];
    const t = nowMs - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const s = r.samples;
      const newest = s[s.length - 1];
      let x = newest.x;
      let z = newest.z;
      let f = newest.f;
      let moving = newest.moving;
      if (t <= s[0].at) {
        ({ x, z, f } = s[0]);
        moving = s[0].moving;
      } else if (t < newest.at) {
        for (let i = s.length - 2; i >= 0; i--) {
          if (s[i].at <= t) {
            const a = s[i];
            const b = s[i + 1];
            const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
            x = a.x + (b.x - a.x) * k;
            z = a.z + (b.z - a.z) * k;
            f = lerpAngle(a.f, b.f, k);
            moving = b.moving;
            break;
          }
        }
      } else if (nowMs - newest.at > STALE_MS) {
        moving = false;
      }
      out.push({ id: r.info.id, name: r.info.name, look: r.info.look, x, z, facing: f, moving });
    }
    return out.sort((a, b) => a.id - b.id);
  }
}
