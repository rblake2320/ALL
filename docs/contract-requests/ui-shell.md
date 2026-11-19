# Contract requests — UI-SHELL

Everything below is already worked around inside `src/ui/**`; nothing is blocked. Ordered by impact.

## 1. Content before a simulation exists (GameController)
Create-a-Zombie runs while `game.sim === null`, so trait/aspiration names, descriptions and conflicts come from a
fallback copy of GDD §8/§12 in `src/ui/shell/data.ts` (ids identical). If SIM-PEOPLE tweaks copy or conflicts, CAZ drifts.
**Request:** `readonly content: ContentRegistry | null` on `GameController` (the loaded registry, available from boot).
The shell already prefers `game.sim?.content`; it would switch to `game.content ?? game.sim?.content`.

## 2. Structured CAZ validation
`validateCaz(): string[]` can't be mapped to a member or field, so the shell shows a summary chip + tooltip list and
computes its own per-member "incomplete" dot. **Request (additive):**
`validateCazDetailed(): { memberIndex: number | null; field: 'householdName' | 'firstName' | 'traits' | 'aspiration'; message: string }[]`.

## 3. Keyboard: honour `defaultPrevented`
UI widgets (modal Esc, sliders, tabs, segmented, select listbox) call `preventDefault()` and `stopPropagation()`.
The controller's window `keydown` currently ignores editable targets but not handled events.
**Request:** early-return in the controller's key handler when `e.defaultPrevented` is true, so UI-owned keys can
never double-fire (e.g. Esc closing a nested confirm *and* the parent dialog).

## 4. Dialog parent / Save-Load mode
`DialogId` is single-valued. The shell keeps its own parent stack (Pause → Settings → back to Pause) and infers the
Save/Load tab (in game: Save; from the menu or Pause → "Load Game": Load) in `src/ui/shell/nav.ts`.
**Request (optional):** `openDialog(d, opts?: { returnTo?: DialogId; mode?: 'save' | 'load' })` if the controller ever
opens these itself (quick-load, autosave failure → saves).

## 5. CAZ voice seed
The "Hear a groan" preview seeds `audio.voice()` from `voiceSeed(first, last, index)` (FNV hash). The in-game agent gets
its `voiceSeed` from the sim, so the timbre heard in CAZ may differ in game.
**Request:** `NewMemberSpec.voiceSeed?: number` honoured by `createNewWorld`, or `cazVoiceSeed(index): number`.

## 6. `GameController.version` semantics
Typed `number` with no doc. The shell reads the app version from `package.json` (`src/ui/shell/version.ts`).
**Request:** document whether `version` is a change counter; if an app version is wanted, add `appVersion: string`.

## 7. First-run defaults
`DEFAULT_SETTINGS.reduceMotion = false`. **Suggestion:** seed it from `matchMedia('(prefers-reduced-motion: reduce)')`
on first run (profile owner). The UI already treats the setting as authoritative via `html.reduce-motion`.

## Behaviour the shell relies on (please keep)
- `goto('newGame')` creates `caz` when missing; `goto('caz')` from `newGame` keeps it (lot + difficulty chosen there).
- `startGame()` rejects/returns without throwing when validation fails; the shell disables Start while `validateCaz()` is non-empty.
- `saveGame(undefined, name)` is safe to call from the fatal screen ("Try emergency save") while the sim is intact.
- `loadGame()` / `continueLatest()` switch to the `game` screen themselves; the shell then closes its dialogs.


---
**RESOLVED by integration lead:** 1, 2, 4, 6 added to GameController (content, validateCazDetailed, dialogOptions/openDialog opts, appVersion; version documented as change counter). 3 → binding hotkey rule (contracts.ts above KEYMAP). 5 → NewMemberSpec.voiceSeed? added; engine honours it. 7 → GAME seeds reduceMotion from prefers-reduced-motion on first run. See docs/CONTRACTS.md decision #17.

## Hardening pass (UI-SHELL hardener) — new items, all worked around in `src/ui/**`

### H1. `lastSaveLabel` format is undocumented (GAME / contract comment) — [open]
The controller returns a complete player-facing phrase (`"Saved 12 min ago"`, `"Saved just now"`, `"Save failed"`,
see `src/game/autosave.ts formatSaveLabel`), but the shell used to wrap it as `"Last saved {label}"` →
"Last saved Saved 12 min ago". The shell now shows the label verbatim (and only prefixes bare times) via
`src/ui/shell/saveText.ts saveStatus()`. **Request:** document on `GameController.lastSaveLabel` that it is a complete
phrase, or (better, localisable) add `lastSavedAt: number | null` (epoch ms) + `lastSaveFailed: boolean`.

### H2. "New save" vs. the world's manual slot (GAME) — [fyi / please confirm]
`saveGame(undefined, name)` always writes the world's single manual slot (`save-<seed>` or the loaded slot), so a
second "New save" silently overwrote the first. The Save dialog now mints a fresh id for "New save"
(`newSaveSlotId()` → `save-<base36 time>`, valid per PLATFORM's rule) and passes it explicitly; "Overwrite" passes the
row's id; F5 quick-save keeps the default slot. **Request:** confirm UI-supplied slot ids are supported long-term (or
add `saveGame({ slotId: 'new', name })`). Autosave rows can't be overwritten from the UI (button disabled + tooltip).

### H3. Toasts on screens without the HUD (contract comment) — [fyi]
Decision #16 makes the HUD own toast lifetime "while mounted". On the menu / New Game / CAZ / loading / game over the
controller still raises toasts (import/export results, failed loads, deletes) that nobody showed — they popped up
stale once the HUD mounted. The shell now hosts them on every screen except `'game'` (`src/ui/shell/ShellToasts.tsx`:
top-right, newest first, max 3, ~6 s unhovered, hover/focus pauses, `dismissToast` on expiry). Please mirror this in
the `toasts` comment: "HUD on 'game', shell elsewhere".

### H4. `validateCazDetailed` field usage (GAME) — [open]
The union now has `'household' | 'appearance'`, but `src/game/cazState.ts` still reports lot/difficulty/member-count
problems as `field: 'householdName'` and a corrupt appearance as `field: 'firstName'` (its comment predates #19). The
shell handles both (unknown/mismatched fields are re-homed: household-level → general household notice, member-level
→ Body tab), but with the old mapping a "Choose a lot" message still appears under the household-name input.
**Request:** emit `'household'` / `'appearance'` as the contract now allows.

### H5. Root type scale cap (FYI for UI-HUD) — [fyi]
`html { font-size: min(auto × uiScale, 1.25vw, 2.2223vh) }` (base.css; mirrored in `src/ui/theme/scale.ts`): 100 % is
never capped at ≥ 1024×640, but 140 % on 1280×720 resolves to ≈ 118 % so every screen still fits. Smallest type
tokens have px floors (`--fs-2xs` ≥ 9.5 px … `--fs-md` ≥ 11.75 px). Settings explains the cap when it applies.


---
**RESOLVED by integration lead:** H1 → `lastSavedAt` + `lastSaveFailed` added, `lastSaveLabel` documented as a complete phrase. H2 → confirmed: UI-supplied fresh slot ids are supported long-term (documented on saveGame). H3 → toasts comment updated (HUD on game, shell elsewhere). H4 → GAME must emit household/appearance fields (decision #22). H5 noted.
