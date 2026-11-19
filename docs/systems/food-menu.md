# W-074 Food menu & pricing tiers — owner direction (2026-11-05)

Different foods cost different amounts and do different things. E10+: zombie food is comedic and synthetic
(lab-grown "brain" products, bone broths, bugs, swamp produce) — **never people or pets** (D-008).
Builds on GDD §5 (7 existing recipes keep their numbers; balance targets in BALANCE.md must still pass).

## 1. Price rule
Value per $ falls as you move up tiers; higher tiers pay you back in **quality, moodlets, freshness, Passing and
social bonuses**, not just hunger. Reference: Synthetic Brain Loaf = $12 / 4 servings / 45 hunger = **$0.067 per
hunger point** (budget anchor). Tier multipliers on $/hunger: Scavenged 0 · Budget 1.0× · Home 1.3× · Specialty 2× ·
Gourmet 3.5× · Event/Collection (earn-only, not sold).

## 2. Menu (new items marked ★; existing GDD §5 items keep their numbers)
| Tier | Item | Source | Cost | Servings | Hunger/srv | Extra effect |
|---|---|---|---|---|---|---|
| Scavenged | ★ Grave Grubs | dig (L2) | free | 1 | 15 | *Ate Bugs* (−3, unless Bug Lover trait +4) |
| Scavenged | ★ Dumpster Surprise | trash rummage | free | 1 | 12 | 30 % *Food Poisoning* |
| Scavenged | ★ Pigeon Crumbs | chase pigeons | free | 1 | 5 | *Comedic Failure* fun +5 |
| Scavenged | ★ Swamp Mushrooms | forage (yard/L4) | free | 1 | 18 | Gardening xp |
| Scavenged | ★ Mystery Fish | fishing (L2/L4) | free | 2 | 25 | cookable into Fish Stew |
| Budget | Brain Jerky Snack | fridge | $5 | 1 | 20 | — |
| Budget | Microwave Brain Burrito | microwave | $8 | 1 | 40 | — |
| Budget | Synthetic Brain Loaf | stove | $12 | 4 | 45 | — |
| Budget | ★ Bone Broth | stove | $9 | 4 | 35 | Freshness +3 |
| Budget | ★ Rot-Pop soda (house brand) | fridge/vending | $3 | 1 | 5 | Energy +8 |
| Home | Cerebellum Stew | stove (cook 2) | $20 | 4 | 55 | — |
| Home | ★ Fish Stew | stove (cook 2) + Mystery Fish | $6 | 4 | 50 | Freshness +4 |
| Home | ★ Brain Bran Cereal (house brand) | fridge | $14 | 6 | 30 | quick breakfast, Energy +5 |
| Home | ★ Coffin Coffee (house brand) | coffee maker | $4 | 1 | 0 | Energy +20, *Wired* |
| Specialty | Frontal Lobe Lasagna | stove (cook 4) | $30 | 6 | 60 | — |
| Specialty | Brain Pizza (delivery) | phone | $35 | 6 | 50 | social +3 shared |
| Specialty | ★ Swamp Gumbo | stove (cook 4), L4 market | $34 | 6 | 62 | *Spicy!* fun +6 |
| Specialty | ★ Rot Row Diner Plate | eat out (L3 diner) | $18 | 1 | 65 | social +5, no dishes |
| Gourmet | Gourmet Medulla Flambé | stove (cook 7, Cryo-Fridge) | $45 | 4 | 70 | — |
| Gourmet | ★ Embalmer's Tasting Menu | Mausoleum Hills restaurant | $90 | 1 | 85 | Freshness +10, Passing +5 (6 h), *Fine Dining* +12 |
| Gourmet | ★ Grave-Cola Float | diner/vending | $12 | 1 | 10 | *Sugar Rush* fun +10 |
| Event | ★ Full Moon Brain Mooncake | moon festival quest | earn-only | 4 | 60 | *Moonstruck* +10 |
| Event | ★ Halloween Candy Bones | Halloween challenge | earn-only | 6 | 10 | fun +8 each |

## 3. Where you buy
Fridge grocery charge (existing flow) for home cooking; **Rot Row Market** (L3) sells ingredients by tier with a daily
special (−15 %); **eat-out venues** (diner, restaurant) charge per plate and leave no dishes; **delivery** costs a
premium + wait; vending machines (house brands). Grocery prices visible before buying; Look Alive Passing affects
fancy-restaurant entry (D-039 fairness applies to outfits, not food).

## 4. Balance guardrails
- Budget + scavenged food alone must keep a broke household alive (DESIGN_SURVIVAL §2 targets).
- Gourmet food never becomes required; bonuses are capped (moodlets don't stack beyond +20 from food).
- Re-run `npm run balance` after adding items; unattended households must not change behaviour (new items require the
  player or explicit autonomy ads below existing staples).
