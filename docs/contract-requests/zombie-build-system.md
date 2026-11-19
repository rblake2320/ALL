# Zombie build system: origins, powers, weapons, movement and combos (the DCUO-style build, for zombies)

Status: **proposal, nothing built.** Author: Fable 5.2 ZSM. For Claude Cloud to accept, change or reject.

Companion to `zombie-builder.md` (looks), `crew-progression.md` (roster, upgrades, swaps) and `combat-power.md`
(stats, tactics, weapons, fairness). This document is the **build**: the menu of choices that decides how a zombie
fights, and the combos those choices make.

## 1. Owner direction (2026-11-12, verbatim)

> "we can have the zombie build that is fine but the way and how dcuo function is what I want the list and combos is
> what I am going for along with the already made"

> "zombie build is for look and style and other things not just limited to fighting ... we are about building and
> growing"

**Owner decisions recorded 2026-11-12:** the lists in §3 (five causes, six rot powers, eight weapon styles) are
accepted; the build is shown in Home mode for everyone; `crew-progression.md` decisions 1–4 are accepted (earned
currency only, crew 4 and Crypt 12, Final Rest only by choice, 24-hour crew lock). Rating O-1 is still open; this
document stays comic (E10+).

## 1a. The build is the whole zombie, not just a fighter

A zombie's build has **four parts**, all chosen and grown in one Create-a-Zombie / Zombie Card screen, with saved
builds covering all four:

| Part | What it decides | Where it is specified |
|---|---|---|
| **Look** | body (Classic, cast, premium, photo), rot stage, wound parts, dress, palette, aura | `zombie-builder.md` |
| **Style** | walk, idle, stance, voice pitch and groan set, expressions, emotes, signature pose for photos and posts | §3.6 below |
| **Life** | cause of death, traits, aspiration, skills and career, plus the **life side of the rot power** | §3.7 below; traits, aspirations and the six skills already exist in the game |
| **Fight** | role, weapon style, movement, loadout (Frontier mode only) | §3.2–3.5 |
| **Gear** | equipped items with stats, a gear score and set bonuses, for life and for fights | §3.8 below |

Everything in Look and Style is for show and can be earned or bought. Everything in Life, Fight and Gear comes only
from play. A Home-mode player builds and grows Look, Style and Life fully; the Fight part is shown on the card for
display and only becomes active once the player opts into Frontier.

## 2. How the reference game's build works (mechanics only; nothing of theirs is copied)

Reviewed 2026-11-11 (sources in the seat's research report). A character is built from a few independent lists, and
the interesting part is how the choices combine:

1. **Origin** (where the power came from): a small perk, chosen once.
2. **Power set** (the element): sets the abilities and the **role** (damage, tank, healer, controller); the role can
   be switched later.
3. **Weapon style**: one of about a dozen; each has its own **combo strings** (tap / hold / tap-tap-hold).
4. **Movement mode**: how the character gets around and dodges.
5. **Skill points** earned by leveling, spent on power abilities, weapon combos and passive stats.
6. **Loadout**: a fixed bar of a few powers, plus one or two signature powers; saved loadouts swap whole builds.
7. **Combos across lists**: weapon strings that "clip" into a power, powers that set up another power's bonus, and
   team synergies between roles.
8. Looks are separate from all of this (`zombie-builder.md`).

## 3. The zombie version: the lists

### 3.1 Cause of death (origin): pick once, small perk

| Cause | Perk |
|---|---|
| **Plague** (died of the sickness) | poisons last 25 % longer |
| **Graveyard** (buried, dug out) | +1 armor while standing on soil or grass |
| **Swamp** (drowned) | moves at full speed in water; heals slowly when wet |
| **Lab** (experiment gone wrong) | gadgets and traps recharge 15 % faster |
| **Curse** (hex, voodoo) | one free retry on a missed Feint per fight |

### 3.2 Rot power (the element): sets the abilities and the role

| Rot power | Feel | Roles it can take | Example abilities (8 per power; 3 shown) |
|---|---|---|---|
| **Pestilence** | flies, sickness, damage over time | Bruiser, Wrangler | Fly Swarm (cone, poison), Fever Cloud (area slow), Patient Zero (spreads poison on kill) |
| **Bone** | ribs, spikes, armor | Wall, Bruiser | Rib Cage (shield), Spur Burst (spikes around you), Marrow Mend (heal self) |
| **Bog** | mud, water, drag | Wrangler, Wall | Sink Hole (root), Undertow (pull), Mud Pack (absorb) |
| **Fungal** | spores, growth, mending | Mender, Wrangler | Spore Cloud (heal over time), Mycelium Link (shares damage across the crew), Puffball (blind) |
| **Grave Call** | summons, ghouls, the dead | Bruiser, Mender | Raise Hand (grabbing hand from the ground), Ghoul Pup (minion), Wake the Crew (revive) |
| **Voltage** | lab electricity, jolts | Bruiser, Wrangler | Arc (chain hit), Defib (stun or revive), Overload (big hit, then cool-down) |

- **Role** is chosen inside the power and can be switched out of a fight (respec of role is free; respec of the
  whole power costs earned currency, see §5). Roles give one crew bonus each: Wall draws hits, Mender mends, Bruiser
  hits harder, Wrangler holds and slows.
- Each power has **8 abilities** unlocked with skill points, plus **2 signature abilities** (one big move each)
  that need level 5 and level 9 (`crew-progression.md` levels).

### 3.3 Weapon style: the combo strings

The five weapon classes of `combat-power.md` §3.5 become eight **styles**, each with its own strings built from
**Tap (T)**, **Hold (H)**, **Ranged (R)** and **Block (B)**. Strings unlock with skill points.

| Style | Examples (comic, E10+) | String examples |
|---|---|---|
| **Claws** (bare hands) | rotting nails | T-T-T flurry · T-H rend (bleed) · H launch-up |
| **Club** | shovel, femur, rolling pin | T-T-H ground slam (knock down) · H spin (area) |
| **Blade** | rusty machete, scythe | T-H lunge (gap closer) · T-T-T-H finisher |
| **Polearm** | rake, pitchfork | H sweep (trips a line) · T-R vault (jump over) |
| **Thrown** | brain jars, tombstone chunks | R-R double throw · H-R lob (over cover, area) |
| **Launcher** | bone crossbow, eyeball slingshot | R charge-shot (hold R) · B-R dodge-shot |
| **Chains** | grave chains, tow chain | T-H yank (pull to you) · H whirl (keep-away) |
| **Contraption** | lab drones, stink traps | R place · H-R detonate · T-R call-back |

The four tactics of `combat-power.md` §3.2 stay the base: Tap strings are Swings, Hold strings that pull or root are
Grabs, Block is Brace, and dodge-cancelling a string is the Feint.

### 3.4 Movement mode: how the zombie gets around and dodges

| Mode | Travel | Dodge | Fits |
|---|---|---|---|
| **Lurch** | slow, unstoppable (cannot be knocked down while moving) | shoulder-barge | Wall |
| **Crawl** | low, quiet, under fences and cars | roll | stealth, carriers |
| **Sprint** | fast runner | slide | Bruiser, Thrown |
| **Leap** | long jumps, rooftops | pounce (lands as a Grab) | Wrangler, Chains |
| **Burrow** | short tunnels through soil | pop-up (knocks up) | Graveyard origin, Bog |

### 3.5 Loadout

- **Power bar:** 6 abilities from the rot power, plus **1 signature** slot.
- **Weapon:** one style, with the strings the zombie has bought.
- **Movement:** one mode.
- **Gear:** two weapons, one tool or trap and one perk, from `combat-power.md` §3.5.
- **Saved builds:** up to 4 per zombie (a whole loadout plus role), swapped in one click outside a fight. This is
  separate from saved looks.

### 3.6 Style (look and feel beyond the body)

| Slot | Choices (start) | How unlocked |
|---|---|---|
| **Walk** | shamble, limp, stagger, march, sneak, sway, drag-foot | 3 free; more from aspirations and seasons |
| **Idle** | sway, twitch, head-tilt, scratch, hum | 2 free; more from traits and challenges |
| **Stance** | hunched, upright, lopsided | free |
| **Voice** | pitch (exists today), groan set: mumble, rasp, gurgle, howl | 2 free; more earned or sold as looks |
| **Expressions** | default mood face, laugh, angry, smug | free |
| **Emotes** | wave, dance, bow, flex, shrug, play dead, ... | earned in play; some sold as looks |
| **Signature pose** | the pose used for photos, feed posts and the Zombie Card | any owned emote or pose |

Style never changes a number. Walk, idle and emotes use the shared clips, so every body (Classic, cast, premium)
can use every style.

### 3.7 Life (the build at home)

- **Cause of death** also gives a home perk: Plague (cooking spoils 20 % slower), Graveyard (garden plants grow
  15 % faster), Swamp (needs freshness 15 % slower in the bath), Lab (repairs and crafting 15 % faster), Curse
  (+10 % aspiration points from social).
- **Traits** (23 today: Gourmand, Neat Freak, Night Owl, Bookworm, Hothead, Silver Tongue, ...), **aspiration**
  (Tycoon, Afterparty, Eternal Romance, Master Preserver, Renaissance Corpse, ...) and the **six skills** (cooking,
  charisma, mortuary, logic, creativity, fitness) already exist; they become part of the build screen.
- **Rot powers at home.** Each power has 3 life abilities beside its 8 fight abilities, on the same skill points:

  | Rot power | Life abilities |
  |---|---|
  | Pestilence | Pest Control (clears vermin), Ripen (food spoils into "aged" delicacies), Quarantine (keeps a sick mood from spreading) |
  | Bone | Bone Craft (carves furniture and decor from bones), Sturdy (lifts heavy objects alone), Rattle (wake-up alarm for the household) |
  | Bog | Pond Keeper (water features and fish), Mud Bath (fast freshness), Swamp Garden (wet-soil crops) |
  | Fungal | Green Rot (garden growth), Mend (heals others' small injuries), Spore Lamp (glowing decor) |
  | Grave Call | Ghoul Helper (a minion does one chore at a time), Séance (talk to the departed for aspiration points), Night Watch (guards the lot while asleep) |
  | Voltage | Tinker (repairs electronics), Jump-start (cars and appliances), Charge Up (a household member skips one sleep need for an evening) |

- **Careers** gain a **talent** at levels 3, 6 and 9 of the career, picked from two each time (for example a
  Mortician picks "Steady Hands" or "Graveside Manner").

### 3.8 Gear: items that buff, sets that give more (owner direction, 2026-11-12)

> "like in dcuo gear might beef and buff a player and gear set might have more powerful standings"

The reference game's rule, kept here: **gear gives the numbers, and the look of gear is separate.** Wearing a
piece once adds its appearance to the zombie's collection; the player then shows any collected look in that slot
while keeping the stats of what is actually equipped (`zombie-builder.md` §3.1 slots).

- **Slots (8):** head, face, chest, hands, legs, feet, back, trinket. A ninth "tool" slot is the weapon of §3.3.
- **Each piece** has a **gear level** and up to three stat lines from a fixed list: Might, Grit, Reach, Cunning
  (fight, `combat-power.md` §3.1) and life stats (cooking, charisma, mortuary, logic, creativity, fitness gain;
  need decay; aspiration points). Life gear works in Home mode too, e.g. *Embalmer's Gloves* (+mortuary gain),
  *Gravedigger's Boots* (+garden growth), *Party Shroud* (+social).
- **Gear score** = the average gear level of the equipped pieces. It is shown on the Zombie Card and counts in
  crew power, inside the same matchmaking band and the per-rank soft cap (`crew-progression.md` §3.5).
- **Rarity:** Common, Fine, Rare, Relic, Cursed. Higher rarity means more stat lines, not bigger single numbers.
- **Sets:** pieces belong to named sets. Wearing 2, 4 or 6 pieces of one set adds bonuses that change how the
  zombie plays, beyond the stats. Examples:

  | Set | 2 pieces | 4 pieces | 6 pieces |
  |---|---|---|---|
  | **Gravedigger** (Graveyard, life) | +10 % garden growth | Burrow costs no stamina | Night harvest: crops picked at night count double |
  | **Lab Coat** (Voltage) | +5 % Cunning | Tinker repairs upgrade one tier | Overload has no self-stun |
  | **Bog King** (Bog, wall) | +5 % Grit | Sink Hole also soaks | allies standing in your mud take 10 % less damage |
  | **Plague Doctor** (Pestilence) | poisons +10 % | Quarantine shields the crew from your own clouds | Patient Zero spreads to two targets |
  | **Mourner** (Grave Call, mender) | Séance +20 % aspiration points | Ghoul Helper does two chores | Wake the Crew revives at half health |
  | **Party Corpse** (life, social) | +10 % friendship gain | parties last an hour longer | the household's mood floor is raised one step during parties |

- **Where gear comes from, only from play:** raids and defence (Frontier), challenges, seasons, the story, crafting
  from salvage (W-029), and Grave Goods. **Gear is never sold for money, never traded and never gifted**; appearances
  may be sold, as looks.
- **Upgrading gear:** pieces level up with salvage and Bones, to a cap set by rank. Sets have a "forever" tier per
  season so there is always a next piece to chase, but a new season's top tier is at most 10 % above the last one,
  so old gear stays useful and nobody falls hopelessly behind.
- **Home mode** players earn and wear life gear and life set bonuses; fight stats on their gear stay idle until
  they opt into Frontier.

## 4. Combos across the lists (the point of the system)

### 4.0 Life combos

The same rule as the fight combos: two choices that fit together give a bonus, shown in the build screen.

| Combo | Bonus |
|---|---|
| Graveyard cause + Fungal power + Green Thumb aspiration (new; the sim has no gardening aspiration yet) | crops grow a second time from the same plant |
| Gourmand trait + Pestilence Ripen + cooking 6+ | aged dishes give a two-day mood |
| Neat Freak trait + Bone Sturdy | moving and cleaning heavy furniture counts double for the aspiration |
| Night Owl trait + Grave Call Night Watch | the guard covers the whole night with no mood cost |
| Lab cause + Voltage Tinker + logic 6+ | repaired items come back as an improved tier |
| Silver Tongue trait + Curse cause | romance and friendship gains +15 % |
| Two household members with matching rot powers | their life abilities cost half the cool-down when used together |



Three kinds, each shown in the build screen so a player can find them:

### 4.1 String into power ("clip")

Ending a weapon string on its last hit and using a power at that moment gives the power a bonus.

| Ending | Power | Bonus |
|---|---|---|
| Club T-T-H slam | Bog: Sink Hole | the root lasts twice as long on a knocked-down target |
| Chains T-H yank | Bone: Spur Burst | spikes hit the pulled target for +50 % |
| Blade T-H lunge | Pestilence: Fly Swarm | poison stacks twice |
| Thrown H-R lob | Fungal: Spore Cloud | the cloud lands where the jar burst |
| Claws H launch-up | Voltage: Arc | Arc chains to one more target while the first is in the air |

### 4.2 Power into power (setups and payoffs)

Each power has one **setup** state it applies and one **payoff** that reads it:

| Setup state | Applied by | Payoff |
|---|---|---|
| Soaked | Bog | Voltage hits on a soaked target stun |
| Infected | Pestilence | Grave Call raises a Ghoul Pup from an infected target that falls |
| Rooted | Bog, Fungal | Bone spikes on a rooted target cannot be dodged |
| Shocked | Voltage | Fungal heals on a shocked ally also clear slows |

Setups work across zombies, which makes the next kind possible.

### 4.3 Crew combos (team synergy)

| Crew of | Combo |
|---|---|
| Bog + Voltage | soak then shock: the crew's area stun |
| Pestilence + Grave Call | infect then raise: fallen enemies fight for you briefly |
| Bone (Wall) + Fungal (Mender) | the healer's link shares the tank's armor |
| any two of the same power | +5 % to that power's damage (stacks to three) |

### 4.4 Movement combos

Leap pounce lands as a Grab, so it opens Grab-starting strings. Burrow pop-up knocks up, so it opens air strings
(Claws H, Voltage Arc chain). Crawl out of sight gives the first string of a fight +25 %.

## 5. Skill points, respec and limits

- **Skill points:** one per zombie level and one per 10 levels of mastery (`crew-progression.md`), spent on power
  abilities, weapon strings and passive stat ranks. A maxed zombie cannot own everything: about 60 % of a power's
  and weapon's tree, so two zombies with the same power still differ.
- **Respec:** role switch free (outside a fight); full respec of skill points costs Bones, rising each time, and is
  free once per season. Changing the rot power or the cause of death is a major respec: Grave Goods plus a
  24-hour cool-down.
- **Fairness:** the same rules as everywhere else. Every choice comes from play, nothing in this document can be
  bought with money, and looks never change a number.
- **Balance target:** every rot power can win against every other with the right weapon and movement; no single
  combo above about 55 % win rate in tests (CB-style property check).

## 6. The already made zombies

Every existing zombie gets a ready-made build that fits its look. The player can keep it or respec it like any
other zombie.

| Zombie | Cause | Rot power (role) | Weapon | Movement |
|---|---|---|---|---|
| Classic (free starter) | Plague | Pestilence (Bruiser) | Claws | Lurch |
| The Sexton | Graveyard | Grave Call (Mender) | Polearm (shovel-scythe) | Burrow |
| Lowside | Lab | Voltage (Bruiser) | Chains | Sprint |
| Night Shift | Curse | Fungal (Mender) | Thrown | Sprint |
| Bed Nine | Lab | Voltage (Wrangler) | Contraption | Crawl |
| The Drowned | Swamp | Bog (Wall) | Club (oar) | Lurch |
| 25 cast bodies | one preset each, spread across all six powers so a new player can field a mixed crew from free bodies | | | |

A ready-made build is a **starting point**, not a better zombie: it has the same skill points as any zombie of
that level.

## 6a. Clarifications after the first implementation (2026-11-12)

- **Names:** roles are Bruiser, Wall, Mender, Wrangler, and the eighth weapon style is Contraption, so no name
  matches the reference game.
- **Personality traits vs perks:** the game's existing personality traits (3 chosen in Create-a-Zombie) stay as
  they are. The slots that open at levels 3, 6 and 9 in `crew-progression.md` §3.3 are **perks** (rule-bending
  bonuses), a separate list. The trait gate applies to perks only.
- **Setups and payoffs:** the §4.2 table is the rule as written (Bog applies two setups; Bone and Grave Call apply
  none; Bog and Pestilence read none). "One each" in the sentence above it is dropped.
- **Saved builds** store style, life, fight and gear; looks are saved separately (`zombie-builder.md`). A saved
  build cannot change cause of death or rot power (that is the major respec of §5).
- **Quarantine** in the Plague Doctor 4-piece bonus means its fight form: your own clouds do not hurt your crew.
- **Swamp home perk:** freshness decays 15 % slower while bathing.
- **Rot power** lives in the build's fight part but its life abilities work in Home mode.
- **Green Thumb** aspiration is new content the sim needs before that life combo can fire.

## 7. Decisions

Decided by the owner on 2026-11-12: the lists, the four-part build, Home-mode display, and the crew-progression
numbers. Still open: rating O-1 (comic E10+ or realistic Teen; this document assumes comic).

## 8. Acceptance checks (with the code)

| ID | Check |
|---|---|
| ZBS-1 | Every string-into-power, setup-payoff and crew combo in the tables fires in a scripted test, and none fires without its condition |
| ZBS-2 | No purchasable item grants a skill point, ability, string, role, movement mode or respec |
| ZBS-3 | Simulated round-robin of every power × weapon × movement: no build above 55 % win rate over 10,000 fights at equal level |
| ZBS-4 | A saved build reloads identically after save, reload and a content update |
| ZBS-5 | Every ready-made zombie's build spends exactly the skill points its level allows |
| ZBS-6 | No Look or Style choice changes any life or fight number (exhaustive over the catalogue) |
| ZBS-7 | Every life combo in §4.0 fires in a scripted household test and none fires without its condition |
| ZBS-8 | Every set bonus applies at exactly 2 / 4 / 6 pieces and drops when a piece is removed; no purchasable item carries a stat, a gear level or a set piece |
| ZBS-9 | Showing a collected appearance in a slot never changes the stats of the equipped piece |
