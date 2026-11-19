# Combat: power levels and hit tactics — proposal for the lead (owner direction, 2026-11-11)

Status: **proposal, nothing built.** Author: Fable 5.2 ZSM. For Claude Cloud to accept, change or reject; it extends
`docs/DESIGN_OPEN_WORLD.md` §4.7 (combat), §4.8 (raid nights) and §4.8.1 (takeovers) and would become workboard rows
under W-141 / W-144 / W-147.

## 1. Owner direction (verbatim, 2026-11-11 evening)

> "because we are going to have zombies able to fight and try to raid and take over when somebody has more than one
> home we need to have power levels and hit tractics and so on"

> "we need to have zombies can die and respawn and all that type of thing"

> "think of how call of duty works with power and attacks it means that you will have weapons and things and maybe
> like GTA that you can take cars and things and buy and build defences systems but your main home is like safe
> place"

Reading (mine): fights, raids and takeovers of second homes need (a) a number that says how strong a zombie or a crew
is, (b) choices in a fight that matter, so the stronger side does not simply win, and (c) zombies that can be killed
in a fight and come back (respawn), as in other online games.

## 2. What already constrains this

- Raids and takeovers are opt-in, loss is bounded, primary homes are never taken (§4.8, §4.8.1; OW-13, OW-14, OW-19).
- The first build of both is **asynchronous with exact replay**: the fight must be a deterministic function of the
  recorded commands and a seed (OW-15). No float drift, no wall-clock, no unseeded randomness.
- Rating stays E10+ until the owner decides O-1: hits are comic (stuffing, dust, stars, limbs pop off and go back).
- Real money must stay out of chance outcomes (D-006) and purchased items are never at risk.

## 3. Proposal

### 3.1 Power level (one visible number per zombie, one per crew)

- **Zombie power** = `round(10 × (1 + level))` shaped by four combat stats, each 0-10, earned in play:
  | Stat | Raised by (existing systems) | Effect |
  |---|---|---|
  | Might | exercise job, moving furniture, `punch` practice | hit damage |
  | Grit | sleep, meals, low `feral` time | hit points, limb-loss resistance |
  | Reach | intact limbs (a missing arm lowers it), walking distance | who strikes first, grab range |
  | Cunning | study job, chess, lookout duty | tactic slots (§3.2), scouting detail |
- `level` = floor of the mean of the four stats. Power is shown on the zombie card and summed (with diminishing
  returns: 100 %, 80 %, 60 %, 50 % …) into **crew power**, so six weak zombies do not equal one strong crew.
- **Matchmaking band.** A raid or takeover attempt is allowed only when attacker crew power is within a band of the
  defender's posted defence power (start: 0.7× to 1.5×). Outside the band the attempt is refused with the reason
  shown. This is what stops a high-level crew farming new players.
- **Defence power** of a home = defenders present + guard pets + alarms / locks / lights (W-142), posted on the
  home's contested listing so an attacker sees the number before committing.

### 3.2 Hit tactics (the choices)

A fight is a sequence of **exchanges**. Each side picks one tactic per exchange; picks are simultaneous.

| Tactic | Beats | Loses to | Note |
|---|---|---|---|
| Swing (heavy hit) | Grab | Brace | full Might damage |
| Grab (hold / shove) | Brace | Swing | moves the target, sets up a crew-mate |
| Brace (guard) | Swing | Grab | halves damage taken, returns a little |
| Feint | reads the other side's pick first | costs the exchange if it reads nothing useful | needs Cunning ≥ 4 |

- Winning the pick multiplies that exchange's result (start: ×1.5), losing it divides (÷1.5), a tie plays straight.
  Stats set the size of a hit; tactics set who gets it. A crew 30 % weaker that reads well can win.
- **Positions:** front (takes hits first), flank (bonus when the target is Grabbed), back (lookout / carrier, cannot
  be hit until the front falls). Crew roles of §4.8 map onto them: breaker = front, guard = front on defence,
  lookout = back, carrier = back.
- **Limbs:** a lost arm removes Swing or Grab (the player chooses which hand it was), a lost leg forces the back
  position. Limbs come back after the event, as today.
- **Defender AI for the asynchronous build:** the owner saves a **defence plan** per home: positions and a tactic
  rule per defender ("Brace until hit twice, then Swing"; "Grab whoever carries"). The replay runs that plan.

### 3.3 Death and respawn

- A zombie at 0 hit points **dies** (they are zombies: it is a comic collapse into a heap, per §4.7 `comic`).
- **Respawn:** it rises again at its household's **respawn point** after a timer. Start values: 20 s in an open-world
  scuffle, 60 s in a raid or takeover, and each further death in the same event adds 30 s. The respawn point is the
  household's coffin / grave marker on the **primary home** lot (always safe ground, §4.8); a crew attacking away
  from home may place one **field marker** on public ground before the event, which the defenders can knock over.
- **What a death costs** (bounded, nothing permanent): the carried loot of that zombie drops where it fell and can be
  picked up by either side; the zombie comes back with half hit points and its lost limbs still off until the
  event ends; a short "freshly risen" weakness (start: 30 s, Might and Reach -2).
- **What a death never costs:** stats, level, power, owned items, purchased items, currency, the zombie itself.
- **Event end by deaths:** an attacking crew that has every member dead at the same moment has failed the attempt;
  a defence with every defender dead and no guard pet standing has lost the home's at-risk set (raid) or control of
  the home (takeover). In the asynchronous build respawns follow the same timers inside the replay.
- **Spawn safety:** a freshly risen zombie cannot be hit for 5 s and cannot hit during them (no spawn camping, no
  spawn rushing).

### 3.4 Fairness rules (non-negotiable in this proposal)

1. **Bought looks give no power.** Premium bodies, cast bodies and cosmetics change nothing in §3.1 or §3.2. Stats
   come only from play. (Keeps D-006 intact and avoids pay-to-win.)
2. Power can never be bought, gifted or traded; a new household starts every zombie at the same stats.
3. The band (§3.1) and bounded loss (§4.8) apply to every fight that can take anything.
4. A player who never opts in never fights another player.

### 3.5 Weapons, loadouts, vehicles and defences (owner direction, later the same evening)

The owner's model: fights play **in real time** the way a modern shooter does (levels, weapons, loadouts), the open
world lets you **take vehicles** the way an open-world crime game does, and players **buy and build defence
systems**, while the **main home stays a safe place**. This section adopts the mechanics of those genres; it copies
no game's names, weapons, maps, characters or look.

- **Real time is the main mode.** In shoulder / first person (W-136, W-137) the player aims and hits directly. The
  four tactics of §3.2 become the **melee move set** (Swing, Grab, Brace, Feint) with the same beats / loses-to
  table; ranged weapons sit beside them. The exchange resolver of §3.2 stays as the rule the **asynchronous replay**
  and every AI defender use, so one set of numbers drives both.
- **Weapons** in five classes, each with a clear job and a counter:
  | Class | Examples in this game's tone | Strong | Weak |
  |---|---|---|---|
  | Melee | shovel, femur club, rolling pin | close, silent | range |
  | Thrown | brain jar, tombstone chunk, stink egg | area, over cover | slow, few carried |
  | Launcher | bone crossbow, eyeball slingshot, casserole cannon | range | reload, noise |
  | Trap | bear-trap dentures, glue puddle, banana peel | holds ground | must be placed first |
  | Tool | crowbar (doors), bolt cutter (fences), ladder | gets a crew in | no damage |
- **Loadout:** two weapons, one tool or trap, one perk. Chosen before an event, fixed during it. Slots, weapon
  classes and perks unlock with **level** (§3.1) and Afterlife Rank (W-057), never with money.
- **Weapon progression:** using a weapon levels that weapon (handling, reload, one cosmetic skin per tier). A
  level-1 weapon and a max-level weapon differ by a bounded amount (start: 20 % in total), so skill and tactics
  decide more than time played.
- **Where weapons come from:** crafted from salvage at crafting stations (W-029), found in the open world, earned
  from quests and events. **Sold for real money: skins only.** A bought skin never changes a number (CB-2 extends
  to weapons).
- **Vehicles (extends W-031):** any unlocked vehicle on **public ground** can be taken and driven, non-player
  vehicles always, another player's only during an event both sides joined. A taken vehicle is a **loan**: it
  returns to its owner's garage when the event ends or after a timer (start: 10 minutes), repaired, with nothing of
  the owner's lost. Vehicles on a home lot are part of that home and follow its rules. In a raid a vehicle is the
  carrier's way out: loot is only kept once it reaches the crew's own ground.
- **Defence systems (extends W-142):** bought with in-game money or crafted, placed in Build mode: walls and gates
  with health, locks, alarms and lights, traps, lookout posts, guard pets, and comic turrets (pie launcher, sprinkler
  of holy water). Each home tier has a **defence budget** (points), so a rich player cannot stack without limit, and
  every defence has a tool or tactic that answers it. The total is the home's **defence power** (§3.1), shown to an
  attacker before they commit.
- **The main home is safe ground.** Already the rule (§4.8, §4.8.1; OW-13, OW-19) and unchanged: no weapon works on
  a primary home's lot against its household outside an event they joined, the primary home can never be taken, and
  the respawn marker lives there. Second homes that the owner lists as contested are the only homes at risk.
- **Rating (owner decision O-1, now pressing).** Comic weapons that fire food, bones and gadgets, with stuffing and
  stars for hits, are the shape that has shipped at E10+ in other family shooters. Realistic firearms, blood, or
  car theft shown as crime would move the game to Teen and change who may be shown ads (W-128, W-145). This proposal
  stays inside E10+: no real-world firearms, vehicles are "borrowed" and come back.

Further acceptance checks: **CB-9** a taken vehicle always returns to its owner, repaired, by the end of the event
or the timer (property test). **CB-10** no placement of defences exceeds the home tier's defence budget, and every
defence type is defeated by at least one tool or tactic in a scripted test. **CB-11** weapon level changes any
weapon number by at most the stated bound. **CB-12** on a primary home's lot, outside a joined event, no weapon,
trap or vehicle can damage or move the household or its things (fuzz).

### 3.6 Play modes and the age rule (owner direction, later the same evening)

> "if there is a way to have different play modes like you cant fight and build and defend if you are not even
> working on a second home or more. We could have age restricted play to only the sims mode if we can build that all
> to work"

One game, two modes. The mode is a property of the **household's account state**, checked by the rules, not a menu
choice that can be flipped mid-event.

| | **Home mode** (the life sim) | **Frontier mode** (fight, raid, defend) |
|---|---|---|
| Who | Everyone, from the first minute. The only mode for a child profile | A household that owns or is building a **second home**, on a profile of 15 or over, that has switched it on |
| What you do | Needs, careers, social, build / buy, pets, jobs, the walkable town, visiting friends | Everything in Home mode, plus weapons and loadouts, taking vehicles, defences, raid nights, takeovers |
| Can be attacked | Never, anywhere | Only on a contested second home or inside an event the household joined; never on the primary home |
| Sees of the other mode | Other players' homes from outside; no weapons in hand, no fights rendered near them (a Frontier fight is not shown to a Home-mode player) | Home-mode players as neutral: cannot be targeted, hit, robbed, blocked or pushed |
| Store | Looks, furniture, lots | The same, plus weapon and defence skins |

- **The switch into Frontier mode needs all three:** a second home (owned or under construction), an answered age
  gate of 15 or over (`CHILD_AGE_LIMIT`, PR #94), and an explicit opt-in screen that says what can be lost (the
  at-risk set, §4.8). Leaving Frontier mode is always allowed when no event is under way and no home is held;
  contested listings are withdrawn first.
- **Child profiles (under 15) are Home mode only.** No weapons, no raids, no takeovers, no defence building, no
  Frontier chat, and no Frontier content in their store or feed. A second home on a child profile is a second
  place to live and build, nothing more. Unanswered or damaged age data counts as a child profile (the existing
  fail-closed rule).
- **Why this also helps the plan:** Home mode is today's game plus the walkable world, so it can launch first and
  alone. Frontier mode can arrive later without changing what Home-mode players have.
- **Honest limit on the rating:** rating boards rate the most intense content a product can show to anyone, so
  locking children out of Frontier mode protects the children but does not by itself keep the whole game at E10+.
  If Frontier mode goes beyond comic violence, the options are a Teen rating for the one game, or shipping Frontier
  as a separately rated add-on. That is decision O-1 and it is the owner's.

Further acceptance checks: **CB-13** a child profile, an unanswered age gate or a household without a second home
cannot enter Frontier mode, equip a weapon, place a defence, join an event or appear as a target, by any command
path (fuzz over the command surface). **CB-14** a Home-mode zombie takes no damage, loss, push or block from any
Frontier action anywhere in the world. **CB-15** leaving Frontier mode mid-event is refused; leaving outside an event
removes every contested listing first.

### 3.7 Corrections from Astra's review (2026-11-11, `<private-evidence-archive>`)

Accepted in full; where they differ from the text above, these win.

1. **A safe home is safe in both directions.** Nobody on a primary home's lot can shoot, throw, place traps or run a
   turret across the boundary. Ownership and zone are checked when an effect **lands**, not only when it is fired
   (projectiles in flight, lingering effects, rams, pets, traps laid before a permission change).
2. **Vehicles have ownership classes.** World and townie vehicles can be taken where allowed. A player's personal
   vehicle is protected like the rest of their things and is never a free target; §3.5's "another player's vehicle
   during a joined event" is limited to vehicles the owner put in the event's at-risk set.
3. **One simulation for live play and replay.** §3.5 said the exchange table drives the asynchronous replay. That
   would not be an exact replay of an aimed fight. Instead: record tick-stamped movement, aim, fire, reload and
   ability inputs with the seed and the versions of the world and weapon data, and replay the same authoritative
   simulation; AI defenders issue inputs into it. The exchange table remains the rule for melee moves and for AI
   decisions, not a second resolver. The server decides damage, ammunition, cooldowns and rewards; the client only
   predicts for feel.
4. **The power band is taken from a snapshot at entry:** loadout, active crew, defences and vehicles, frozen for the
   event; swaps that would leave the band are refused. 0.7 to 1.5 and the 20 % weapon bound are starting guesses to
   test with mixed-level crews and newcomers, not proven fair.
5. **Looks never change a fight:** bought bodies, body proportions and the detail level in use change no damage,
   reach, hit volume, collision or line of sight. Every body fights with the same hit volumes (extends CB-2). This
   binds my premium bodies: their two detail levels and the Classic share one set of hit volumes.
6. **Settle once:** death, respawn and dropped loot settle exactly once across disconnect, retry, crash, event expiry
   and rollback; replays pin their versions so a balance patch never re-pays or re-reads an old fight.
7. **First slice to build** (before any weapon list grows or player raids open): safe home, leave on foot, take a
   permitted world vehicle, fight one encounter that is not another player with one ranged weapon and one melee
   move, die and respawn, return home, save and reload. Then one small defence encounter.

## 4. Acceptance checks (to be written with the code)

| ID | Check |
|---|---|
| CB-1 | Same seed + same commands → byte-identical fight result (extends OW-15) |
| CB-2 | No appearance field (body, outfit, cosmetic, purchased flag) changes any fight result (property test) |
| CB-3 | An attempt outside the power band is refused before anything is at risk (fuzz) |
| CB-4 | For equal stats, each tactic wins, loses and ties against exactly the tactics in the table |
| CB-5 | A crew 30 % below the defender wins at least once and loses at least once over a fixed seed set (tactics matter, power matters) |
| CB-6 | A death never changes stats, level, owned or purchased items or currency, and every dead zombie respawns (property test over random fights) |
| CB-8 | A freshly risen zombie neither takes nor deals damage during spawn protection; respawn timers follow the table exactly in a replay |
| CB-7 | Every hit has a non-gore visual and a sound at `comic` intensity (OW-17) |

## 5. What this needs from other lanes

- **Art:** weapon, trap, turret and defence models (comic tone); weapon skins as the sold cosmetic.
- **Animation:** the shared set has `punch` and `chase` only. Also needed: aim / fire for launchers, throw, place trap. Needed on the shared rig (so every body, the premium
  five included, gets them): `swing`-style heavy hit, grab / shove, brace, hit reaction, death collapse, rise from the grave (respawn). Astra
  built the last 35 clips (W-051).
- **Sim (lead):** the four stats on the zombie record, the exchange resolver, the defence plan, the band check.
- **UI:** power on the zombie and crew cards, defence power on a contested listing, the tactic picker.

## 6. Open questions for the owner

1. Is "power comes only from play, never from purchases" right? (I recommend yes.)
2. Answered 2026-11-11: fights are real time with weapons (§3.5). Still open: **rating.** §3.5 keeps comic weapons
   and E10+. Do you want realistic weapons and a Teen rating instead (decision O-1)?
3. Death as written costs time, position and carried loot, never anything owned. Do you want a harsher cost (for
   example a stat dip that lasts a day), or is this right?
4. May a household use its strongest zombies in every home, or is each zombie tied to the home it lives in?
