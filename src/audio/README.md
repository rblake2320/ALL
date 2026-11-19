# AUDIO module

Fully procedural WebAudio sound for Afterlife Lease: every SFX, the "Groanish" zombie language, the adaptive score
and the ambience are synthesised at runtime (no sample files → all original IP). Entry point:
`createAudio(): AudioAPI` (`src/audio/index.ts`), implemented by `AudioEngine` (`engine.ts`).

## Robustness
- The `AudioContext` is created lazily inside `unlock()` (call it from a user gesture; idempotent, de-duplicated,
  never hangs: `resume()` is raced against a 1.5 s timeout). Unlocking while muted (window hidden/unfocused at the
  first gesture) still resumes inside the gesture, then parks the context until `setMuted(false)`.
- Without WebAudio (node, locked browsers, throwing constructors/factories) every method is a no-op that never throws.
- All parameter writes go through NaN-proof helpers (`synth/core.ts`); the strict fake in `tests/unit/audio/fakeAudio.ts`
  throws where browsers throw (and fires `statechange` like browsers), and the suites assert zero contained errors.
- Mute fades, then suspends the context and stops the 25 ms timer (CPU/battery while hidden); unmute resumes both.
- Involuntary suspension (iOS interruptions, audio-device loss) is detected via `statechange`: the engine retries
  `resume()` at once and on the next pointer/key/touch gesture, then re-applies music/loops/ambience
  (`stats().interruptions` counts them). A context closed under us is replaced on the next `unlock()` (≤ 3 times),
  keeping the desired loops/music/ambience.
- The output can never clip: after the glue compressor a waveshaper safety stage is the identity below 0.8 and bends
  smoothly into a 0.98 ceiling (verified with the engine-in-the-loop stress scene).

## Graph (`graph.ts`)
`music(dry/wet) · sfx · voice · ambient · ui` buses → `master` (+4 dB makeup) → `mute` → `DynamicsCompressor`
(gentle glue limiter: threshold -10 dB, knee 10, ratio 8) → safety soft-clip (0.98 ceiling) → destination. One shared
convolution reverb (1.7 s generated IR) fed by bus sends and per-instrument music sends. Volumes use a squared taper
with 40 ms glides (no zipper noise); ducking (-9 dB music, -6 dB ambience) for dialogs; momentary music dip under
stingers; **diegetic radio duck** (the score glides down to -8 dB while a `stereoMusic` loop plays near the camera —
the stereo plays its own "station", the CAZ composition, never the cue the score is playing); indoor lowpass on
ambience.

## Pieces
| Path | What |
|---|---|
| `synth/` | toolkit (`core.ts`: envelopes, tones, filtered noise, FM bells, metal, Karplus-Strong plucks, drums, squelch, creak, LFO / random LFO, waveshaper) and cached buffers (`buffers.ts`: seamless white/pink/brown noise, crackle/rain textures, KS plucks, reverb IR, periodic waves, the smooth random-LFO table — slow modulations play it at `rateHz / 10`, so 0.2 Hz gusts really are 0.2 Hz) |
| `sfx/` | one recipe per `SfxId` (`ui`, `build`, `life-a`, `life-b`, `stingers`, `world`), loop factories (`loops.ts`), and `table.ts` (bus, category, loop/gap, loudness trims) |
| `voice/` | `groanish.ts` pure syllable/prosody planner (timbre from seed, words from utterance counter); `render.ts` formant synthesis |
| `music/` | `theory.ts` (roman numerals, chord-scales, voice leading), `moods.ts` (nine cues), `parts.ts` (bass/comp/arp/melody/drum generators), `composer.ts` (deterministic bar plans), `scheduler.ts` (lookahead math), `instruments.ts`, `player.ts` (sections, crossfades, note budget) |
| `loopManager.ts`, `ambience.ts`, `polyphony.ts` | keyed loops (16 play at once, loudest win with a 1.25× eviction margin; the rest wait as virtual voices), day/night/rain/full-moon beds (moon: glass-harmonica shimmer + distant howls), voice pools (24 one-shots / 6 voices, oldest stolen) + rate limiter |
| `analysis.ts`, `offline.ts`, `dev/` | objective verification (peak/RMS/span/DC/clip/NaN/centroid/bands/spectrogram/envelope fluctuation), offline renders, engine-in-the-loop scene mixes (`dev/scenes.ts`), sound board |

## Dev sound board & verification
```
npx vite --port 5179 --strictPort      # then open http://localhost:5179/dev/audio.html
node dev/audio.verify.mjs [--long]     # Playwright: live probe + offline renders → dev/out/audio/
```
Outputs: `report.json` (every SFX one-shot + ambience extras (howl, crow), 18 loops + 4 ambience beds (day wind,
crickets, rain, moon), 12 voice emotions, 9 × 8 s music, and 5 **engine-in-the-loop scenes** — the real engine,
master chain and scheduler rendered offline via `OfflineAudioContext.suspend()` every 50 ms: final peak/clipping,
loudness, per-bus balance at default volumes (solo renders), dropped notes and offline render speed as a CPU proxy;
`--long` adds full-form music peaks), `spectrogram-{sfx,loops,voice,music,scenes}.png`, `board.png`.
Exit code ≠ 0 on any failed check.

## Adding a sound
Add the id to `src/shared/audioIds.ts` (integration lead), write a recipe returning its duration, register it in
`sfx/table.ts` (bus/category/gap or loop), run the board verification and set a `TRIM_DB` entry so its active RMS
lands in its category band. `tests/unit/audio/sfx-table.test.ts` fails until the table covers the vocabulary exactly.
