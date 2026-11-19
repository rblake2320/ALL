# Zombie Builder: styles, wound parts, "be a zombie" from a photo, and fight posts in the feed

Status: **proposal, nothing built.** Author: Fable 5.2 ZSM (W-152 follow-up). For Claude Cloud to accept, change or
reject. Companion to `combat-power.md`.

## 1. Owner direction (2026-11-11)

> "I want people to be able to build out zombies like DCUO ... add things like bite marks and other things like
> exposed brains"

> "did you review and get all the ways that dcuo does their charicter builds and how they do there styles"

> "what if on a paid version we can allow people to have their image uploaded and added as their own zombie
> charicter ... that tripo grant will come in and we can use that to make people part of the game"

> "can we have a social media style like in a feed if somebody is getting attacked or home is taken it comes up
> like a media post"

## 2. What DC Universe Online does (reviewed 2026-11-11; mechanics only, nothing of theirs is to be copied)

Sources: the official site and its guides, the community wiki, one official-forum thread. Full notes with links are
in the seat's research report; the points that matter here:

- **Look is separate from stats.** Wearing an item once adds its look to the character's collection; any collected
  look can then be shown whatever is actually worn. A slot can be held so new gear does not change the look.
- **A fixed list of slots:** head, face, hair, shoulders, chest, back, hands, waist, legs, feet, skin, emblem, aura,
  accessory, weapon looks. Aura had to be split out of Accessory years later.
- **A small palette:** four colours per character; most items expose three colour channels that draw from it.
  Materials override an item's surface; "chroma" packs are materials with preset colours.
- **Whole-body skins** (undead, mummy, rock, chrome ...) replace the body surface. I found **no** modular wound
  parts there: decay is one skin swap, so it cannot be mixed.
- **Saved builds** ("armories"): a named imprint of look plus loadout, several per character, quick to swap.
- **Body types** are cosmetic (18 variants); personality changes stance and emotes only.
- **Money:** looks are earned in play, sold directly, and sold through random capsules. Completing look sets feeds
  feats that give skill points, so paid random cosmetics touch power. That is the loudest complaint players make.

## 3. Proposal: the Zombie Builder

### 3.1 Slots (fixed, short, all on the shared 22-bone rig)

| Group | Slots |
|---|---|
| Body | **Base body** (Classic, a cast body, a premium body, a photo body §4) · **Rot stage** (surface: fresh, grey, mossy, dried; ties to W-033) |
| Wounds (new; one per region) | Head · Face · Torso front · Torso back · Arm L · Arm R · Leg L · Leg R |
| Dress | Hair / headwear · Top · Bottom · Feet · Hands · Back · Accessory |
| Finish | Palette (4 colours) · Aura (flies, fog, glow) |

- **Wound parts are region swaps.** Each part declares the body region it replaces and supplies the mesh for it,
  weighted to the same bones, so it needs no new animation: exposed brain replaces the skull cap; a bite replaces a
  patch of forearm; missing flesh shows bone under it. Three layers that mix freely: rot stage (surface), wound
  decals (bites, stitches, scratches), wound parts (missing flesh, exposed brain, open ribs).
- **Conflicts are data, with a safe fallback:** a hat with an exposed brain, a sleeve over a missing forearm. A
  combination with no rule falls back to the plain region, never to a broken body.
- **Colour:** tint masks per item, three channels from the 4-colour palette. Per-item overrides are stored, so
  changing the palette does not reset them (a known flaw in the reference game).
- **Saved looks** are first-class: name, thumbnail, several per zombie, separate from any fight loadout. A look
  that cannot be saved is refused when it is made, not when it is loaded.
- **Earned once, owned on the account.** Collecting a part unlocks its look for every zombie in the household.
- **Looks never touch power** (CB-2 of `combat-power.md`): no stats, no feats that give stats, and every body
  fights with the same hit volumes. No random paid capsules; parts are earned in play or sold directly at a shown
  price.
- **Rating:** exposed brains and open ribs are comic at E10+ only if drawn as stuffing, cartoon bone and green goo.
  Realistic wounds are part of decision O-1.

### 3.2 What it needs

- **Art (my lane):** the premium bodies were generated as one mesh each; wound parts need the body cut into the
  eight regions once per base body, then parts authored in Blender on the same skeleton. The Classic and the cast
  kit need the same region cut to share parts. First set proposed: bite (arm), stitched scar (face), exposed brain
  (head), open ribs (torso), bone forearm (arm), chewed calf (leg).
- **Runtime:** a region-hide mask per body, part attach on the skinned mesh, tint masks; draw-call budget per zombie
  rises from 1 to a bounded few (to be measured before it is promised).
- **UI:** Create-a-Zombie gains the slot list and saved looks.

## 4. "Be a zombie": a player's own likeness as a body (paid)

Technically proven tonight on five characters: picture → three-view turnaround → Tripo detailed model → rig →
the cast pipeline, about 95 Tripo credits and 9 image credits per character, then an automated Blender build. A
Tripo grant would cover generation cost. What has to be true before it is sold:

1. **Only your own face, adults only.** Account holder 18 or over, a live selfie check against the uploaded photo
   (not a picture of a picture), an explicit consent screen. No uploads from child or teen profiles.
2. **Biometric and privacy law.** A face scan is biometric data in several places (Illinois BIPA, Texas, Washington,
   the EU's GDPR special category). Needs written consent, a published retention schedule, deletion on request that
   really deletes the photo, the model and every cached copy, and no use of the photo for anything else. Legal
   review under W-095 before any upload is accepted.
3. **Moderation before it enters the world.** Automated checks (nudity, minors, known public figures, hate
   symbols) and a human review queue (W-102); the body is visible only to its owner until approved. Other players
   can report a body.
4. **The generation service's terms.** Whether a grant or plan allows faces of real people and commercial resale
   has to be read from the provider's terms; not checked yet.
5. **Automation.** Today a seat runs the pipeline by hand. Selling it needs a queue, a build worker with pinned
   Blender, the same budget validators as the cast kit, and a refund path when a result is rejected.
6. **Fairness.** A photo body is a look: same hit volumes, same stats as every body.
7. **Price.** Each one costs real generation and review time, so it is a premium one-off purchase, not part of a
   subscription with unlimited tries. Start: one body plus two retries.

Recommended first step: a closed test with the owner and a handful of consenting adults, bodies visible only to
their owners, to measure quality, cost and review time before any law-facing work is paid for.

## 5. Fight posts in the feed (extends W-069 social feed, W-144, W-147)

- Events that write a post: a raid started on a home, a raid won or lost, a takeover, a retake, a home returned by
  itself, a crew's first win, a new defence record.
- A post is a card: what happened, where, who (crew names, never real names), a picture taken by the game at the
  moment, and **Watch**, which plays the recorded fight (the replay already exists by design, OW-15).
- Who sees it: the people involved and their friends by default; the neighbourhood if the home owner allows it.
  A home under attack sends its owner and friends with `defend` a live alert with **Help defend**.
- Safety: posts are generated by the game from fixed templates, so nobody types in them; reactions are a fixed
  set; comments follow the chat rules (15 and over, filtered, report on every item, W-143). Home-mode players and
  child profiles see no Frontier posts (§3.6 of `combat-power.md`). A player can mute a crew or all fight posts.
- No post ever shows what was taken in money terms, and nothing in a post can be bought from the post.

## 6. Acceptance checks (with the code)

| ID | Check |
|---|---|
| ZB-1 | Every combination of wound part × dress item × base body either renders by a stated rule or falls back to the plain region (exhaustive over the catalogue) |
| ZB-2 | No look, part, palette or photo body changes any fight number or hit volume |
| ZB-3 | A saved look loads to the identical appearance after save, reload and a content update |
| ZB-4 | A photo body cannot be requested from a child or teen profile, without the consent record, or without the selfie match; deleting it removes the photo, the model and the cached files (verified by listing storage) |
| ZB-5 | An unapproved photo body is never sent to another player's client |
| ZB-6 | A fight post contains only template text, crew names and a game-made picture; a Home-mode or child profile receives none |
| ZB-7 | Draw calls and triangles per zombie with a full set of parts stay inside a stated budget on the low file |
