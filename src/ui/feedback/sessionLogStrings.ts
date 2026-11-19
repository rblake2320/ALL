/**
 * Playtest session log strings (English, W-117), registered under the `sessionLog.` prefix (the feedback strings.ts
 * pattern). Resolve with `slt('key')`.
 */
import { registerStrings, t, type StringParams } from '../../i18n';

export const SESSION_LOG_EN: Record<string, string> = {
  entry: 'Copy session log',
  title: 'Playtest session log',
  subtitle: 'What you did this session, as numbers and game ids — no names, nothing you typed. It stays on this device until you copy it.',
  copy: 'Copy',
  copied: 'Copied — paste it into your playtest notes.',
  copyFailed: 'Could not copy automatically. The text is selected — press Ctrl+C (or ⌘C).',
  save: 'Save file',
  saved: 'Saved — check your downloads.',
  saveFailed: 'This page cannot save files. Use Copy instead.',
  loading: 'Reading the log…',
  empty: 'Nothing recorded yet.',
  off: 'The session log is off. Switch it on in Settings → Help ("Record playtest session log").',
  session: 'Session',
  'session.current': 'This session',
  'session.previous': '{date} · {duration}',
  'setting.label': 'Record playtest session log (stays on this device)',
  'setting.desc': 'Notes what you do while playing — screens, quest steps, clicks, purchases, frame rate — as numbers and game ids, never names. Nothing is sent anywhere; you choose when to copy it. The last 3 sessions are kept.',
  'setting.descKids': 'Off for younger players unless a grown-up switches it on. It only stays on this device and can only be copied, never sent.',
  clear: 'Clear session log',
  cleared: 'Session log cleared.',
};

registerStrings(Object.fromEntries(Object.entries(SESSION_LOG_EN).map(([k, v]) => [`sessionLog.${k}`, v])));

export function slt(key: string, params?: StringParams): string {
  return t(`sessionLog.${key}`, params);
}
