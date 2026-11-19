# AUDIO — contract notes / requests

Status: **resolved / non-blocking**. Items 1-3 were accepted in CONTRACTS.md decision 15 and are now in
`src/audio/contracts.ts`; the module implements them as written. No local shims are needed.

## 1. `setGameSpeed(speed)` units — ACCEPTED (decision 15)
`speed` is the `Speed` index from `src/sim/types.ts` (`0` pause, `1` 1×, `2` 2×, `3` 3×, `4` ultra), which is what GAME
passes. Behaviour: speed ≥ 3 mutes footsteps (one-shots dropped, `footstep` loops silenced), speed 4 thins the ambience
(-3 dB, ~1.8× sparser one-off calls), music tempo +1.5 % per step above 1× (max +4.5 %). Non-numbers → 1, values
outside 0..4 are clamped.

## 2. Optional `stats()` on `AudioAPI` — ACCEPTED, implemented
`stats()` returns a flat `Record<string, string | number | boolean>` (type alias `AudioStats`):
`state, unlocked, muted, ducked, sfxVoices, speechVoices, loops, ambientLoops, musicMood, musicSections, gameSpeed,
radioDuck, interruptions, dropped, musicDropped, errors`. It never throws (hostile/closed contexts read as `'closed'`).
Useful fields for `GameController.diagnostics()`: `errors` (contained exceptions), `interruptions` (times the OS/browser
suspended audio on its own — iOS calls, device loss; the engine recovers by itself), `dropped` (spam-limited one-shots).

## 3. `moon?: boolean` in `setAmbience` — ACCEPTED, implemented
On a full-moon night (`night && moon`) the ambience adds a quiet glass-harmonica shimmer bed and distant howls
(every 24-60 s, sometimes answered farther away). Ignored by day. **GAME:** pass `moon: true` on GDD §2 full-moon
nights (every 7th day) — `updateAmbience()` in `src/game/media.ts` currently passes only `{ night, indoor }`, so the
layer stays off until GAME adds the flag (and includes it in its change key).

## 4. Behaviour notes (no change needed)
- `loop(key, id, on, spatial)` accepts **any** `SfxId`: 17 ids have dedicated continuous/event-driven loops
  (shower, sinkWater, fireLoop, cook, tvChatter, tvStatic, stereoMusic, computerTyping, arcadeBlips, flies, snore,
  crickets, wind, groanAmbient, microwave, espresso, phoneRing); every other id re-triggers its one-shot with a
  natural per-id gap (e.g. `footstep` ≈ every 0.4 s, `chop` every 0.2-0.4 s). Re-calling with `on=true` only updates spatial (allocation-free,
  change-thresholded), so calling it every frame is fine. Loop requests made before `unlock()` are remembered.
- **Diegetic music priority:** while a `stereoMusic` loop plays near the camera (spatial gain > 0.15) the score ducks
  smoothly (down to -8 dB at gain 1) and comes back as the camera moves away. The stereo plays its own "station"
  (the CAZ cue's composition through a lo-fi radio chain), never the cue the score is playing, so a stereo at a
  party does not flam against the party music.
- `music(mood)` before `unlock()` is remembered and starts on unlock; same mood again is a no-op.
- `voice(seed, …)` with the same seed cuts that zombie's previous utterance (a zombie never talks over itself).
- `stopAllLoops()` does not stop the ambience bed (that is owned by `setAmbience`).
- `unlock()` may be called while muted (window hidden/unfocused at the first gesture): the gesture still unlocks the
  context, which is then parked until `setMuted(false)`.
- `createAudio(options?)` takes an optional `{ seed, contextFactory, timer }` (tests/dev); `createAudio()` unchanged.
