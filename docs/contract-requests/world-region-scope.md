# Furnished-world activity scope

Independent review at e483cf0 reproduced active-neighbour food age0 and a foreign fire with its burning condition
cleared/timer0. The 40575c4 repair adds optional activeRegionIds (stable home-first) and synchronous withRegion
(active-only, restores scope on throw). Food aging/cleanup and local upkeep iterate active regions; household
pizza delivery, power watching, bills/jobs/quests remain once. Decay/limb checks keep agent order and actor scope.
Fire hazards/summons filter local agents, stale-burning filters local objects and global counters survive while
any live fire exists. Stereo loop sets use separate region keys, stop once on freeze and restart on thaw.
activeEnvironment.test.ts retains home-positive/no-home-fire, reload/continued aging, burn-out, scope failure and
stereo freeze/thaw controls. Reverting production files to0b160f1 fails both originals (age0, timer0, burningfalse);
restoring passes all3. Full gates pass at327fb93 (same production tree); Astra independently rechecked40575c4.

For lead review with the consolidated world integration: `SimContext.currentRegionId?()` exposes the region of
the already-existing scoped spatial service. System ticks use home; per-actor hooks use that actor's region.
Older fixture contexts may omit it and retain the legacy home scope. No saved field is added by this seam.

The full integration exposed household helpers scanning every active region while reading only one spatial grid.
The region-scoped object helpers now exclude foreign objects and resolve held items through their holder.
Emergency food checks, quest discovery and ownership checks have explicit matching boundaries. The engine menu
also matches dispatch's destination scope and route refusal before offering an available cross-region action.

Before correction, the dedicated furnished-neighbour tests failed 3/3; they pass after correction. Existing real
quest, autonomy and varied-start journeys also pass. This is an additive integration seam, not a new global clock,
RNG source or schema field. See `docs/desktop-reports/sol-world-batch.md` for the retained acceptance receipts.

Build/buy always edits the household home. `spatial/build/region.ts` supplies its home-only read index: absent
`regionId` means home, and held objects follow their holder. Planning target lookups, floor/wall coverage and
post-restore conflicts use that same frame; relocation checks home actors both before and after an edit. The
transaction still writes the global ID map, and carrying/user interruption follows explicit parent/object IDs.
`world/buildRegionBoundary.test.ts` exercises real furnished neighbours, foreign floor/fire/meal coordinates,
foreign sell/move refusal, opening refunds, away actors and the home-only/home-fire controls. The immutable
before-fix run fails seven cases and passes two home controls; the repair passes all nine and the native built
undo/redo control preserves the original ID, money and neighbour object.
