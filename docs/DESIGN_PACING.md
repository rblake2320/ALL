# Pacing — how the game opens up over a year, and the rank-40 voice treat (owner direction 2026-11-12)

> "as they rank up having normal voice at like rank 40 might be a treat — we need to think about how we want to pace
> the game out"

Status: **design; decisions recorded in §4; all of it is after Early Access 1.** Afterlife Rank (DESIGN_PROGRESSION §1–2, W-057/W-058) is designed
but **not in the code yet** (no rank state or XP in `src/sim`); this doc builds on that design and changes nothing
already built.

## 1. What the current rank curve actually means
`xp(r) = round(400 × r^1.6)` per rank. At the rate that hits the design's first target (rank 10 in 3 h ≈ 23,000 XP/h):
| Rank | Total XP | Play hours | At 3 h/day | At 1 h/day | Design target |
|---|---|---|---|---|---|
| 10 | 69,414 | 3 | day 1 | day 3 | 3 h ✔ |
| 20 | 395,784 | 17 | ~1 week | ~2.5 weeks | — |
| 30 | 1,112,197 | 48 | ~2 weeks | ~7 weeks | 2 weeks ✔ (heavy player) |
| 40 | 2,324,995 | 100 | ~5 weeks | ~3.3 months | — |
| 50 | 4,126,802 | 178 | ~2 months | ~6 months | — |
| 60 | 6,601,299 | 285 | ~3 months | ~9.5 months | 3 months ✔ (heavy player) |
| 100 | 24,700,788 | 1,068 | ~1 year | ~3 years | 1 year ✔ (heavy player) |
D-087 notes that "about 30 days" and "about 100 hours" for rank 40 seem to disagree. They agree for a player who plays
~3 h/day (100 h ≈ 33 days). The curve is internally consistent, but **only for a 3 h/day player**. A 1 h/day player reaches rank 40 after about
three months, and the gap between headline unlocks grows from 14 h (rank 10→20) to 78 h (40→50).

## 2. Pacing rules (proposal)
1. **Something every session.** Each play session ends with at least one visible gain: a rank-up, an unlock, a
   collection piece, a challenge reward or a home upgrade. Rank-ups come every ~20 min in the first hour, about once a
   session through rank 20, then weekly challenges and side projects carry the time between rank-ups.
2. **Every rank gives something.** The current unlock table skips most ranks (2, 4, 6, 7, 9, 10, 11, …). Fill them:
   - **every rank:** a small earn-only item (recipe, decoration, outfit piece, build piece, emote);
   - **every 5th rank:** a feature (a new job type on the board, a vehicle, a member slot, a build tier);
   - **every 10th rank:** a **headline** with its own moment (cutscene card, feed post, town reaction):
     10 visitors & hiring townies · 20 Mausoleum Hills · 30 contests, clubs, co-build · **40 Necropolis + normal voice (D-087)**
     · 50 full household, voice styles · 60+ towns and regions.
3. **Narrow the gap between heavy and casual players without paying for rank:** a "Rested" bonus (XP ×2 for the first
   30 min of each day's play, banked up to 3 days) and weekly challenge XP that does not depend on hours played.
   Rested alone brings a 1 h/day player to rank 40 in about 9.5 weeks instead of 14 (100 h ÷ 1.5 h-equivalent a day);
   weekly XP shortens that further, by an amount the balance harness sets. A 3 h/day player still gets there first. Season Lease boosts stay capped at +10 % (no bought ranks, MONETIZATION).
4. **"Coming at rank N" is always shown** (progression §2), so the next treat is a goal, not a surprise.
5. **The balance harness checks the targets** (rank at hours 3/17/48/100 for scripted heavy and casual players), so a
   content change that breaks pacing fails CI rather than being discovered by players.

## 3. The voice ladder (decided: D-087)
The owner's decision D-087 (2026-11-12) sets the tiers, and this doc follows it. Today only the table exists
(`src/shared/voiceTiers.ts`, `voiceTierFor(rank)`); no rank system and no new voice audio are built.
| Rank | Tier (D-087) | Proposed detail (not decided) |
|---|---|---|
| 1 | Groanish (today's voice) | — |
| 15 | Mumbled words | household and pet names come through first |
| 25 | Short phrases | optional plain-word captions under the groans |
| **40** | **Normal spoken voice** | per-household / per-zombie toggle so Groanish stays available |
| 50 / prestige | — | voice styles (pitch, rasp, accent presets) as rewards |
- **Proposed gameplay link:** rot stage affects clarity. A fresh zombie speaks clearly and a badly rotted one slurs
  back toward Groanish, which gives embalming one more visible reason.
- **What they say:** only lines from game content (interactions, moodlets, events, job-board barks). Never text a
  player typed, so nothing from another player is ever spoken and the child-profile rules hold.

### How to build the rank-40 voice (decided: formant synth, §4.3)
D-087 says **"all voice audio stays synthesized."** These options read that rule differently:
| Option | Verdict |
|---|---|
| Browser speech (`speechSynthesis`) | **Not usable:** its sound never passes through WebAudio, so the voice bus, volume sliders, mute (M) and the zombie filter cannot touch it; voices also differ per OS. |
| Extend the formant synthesizer in `src/audio/voice/` to intelligible words | Clearly within D-087. Intelligible formant speech is hard, and expect a robotic result; prototype the rank-15 mumbled-words tier first to measure. |
| On-device neural TTS (a small open-licence model in WASM/WebGPU, rendered into the voice bus, then the zombie filter chain) | **Deferred (§4.3):** a possible post-launch add-on. Licence and download size must be verified first. |

## 4. Decisions (2026-11-13)
Answered by Fable 5.2 ZSM under the owner's rule "don't ask what you can figure out" (coordination thread, comment
6839869118); the owner can override any of them. The owner's launch direction ("get this to a point of launch … it will
not have to be perfect") puts all of this **after Early Access 1** (`docs/LAUNCH_PLAN.md`): no rank code ships in EA1.
1. **Rested XP bonus:** after launch.
2. **A small reward at every rank:** yes. Kept as data in this doc (§2 rule 2) and built with the rank code after launch.
3. **Voice method:** the hand-built formant synthesizer only (fits D-087's "synthesized", and mute and volume reach
   it). An optional on-device speech model is a post-launch add-on, not in scope.
4. **Groanish after rank 40:** yes, the player may keep it (a Settings choice).

## 5. Proposed work ids
W-163 rank state + XP + unlock table in the sim (W-057/W-058 implementation) · W-164 balance-harness pacing checks
(heavy/casual scripted players) · W-165 voice tiers 15/25 on the synth (D-087) · W-166 rank-40 voice on the formant synth, with a Groanish Settings choice (all after EA1).
