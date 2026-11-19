# W-052: interface and world-surface artwork

This directory contains source artwork for integration and review. It does not
wire assets into the game. Use `icons.json`, `surfaces.json`, and `loading.json`
as inventories; the game should provide accessible text and states alongside
icons and must not depend on artwork alone to communicate meaning.

## Icons

The 18 original SVGs in `icons/` use a 48-unit viewBox and inherit `currentColor`.
They cover store, quest, both currencies, collection, placement, homes, invites,
wardrobe, parties, social feed, newspaper, photos, vehicles, seasons, building,
crafting, and daily activities. `icons-contact.png` shows 24px and 48px on light
and dark surfaces. Rebuild with `python art/ui/build_icons.py`.

## In-world artwork

Four original editable SVG advertisements in `../brands/ads/` cover TV,
billboard, magazine and bus-stop formats using the W-008 house-brand masters.
The Daily Grave masthead and editable edition layout are in `daily-grave/`.
The edition is a template: its placeholder headline, image rectangle and story
lines must be populated before display. `surfaces-contact.png` is the review
sheet. Rebuild with `python art/ui/build_surfaces.py` after W-008 is present.

Three 360×200 source illustrations for feed cards and three 96×96 collection
badges live in `social/`; `python art/ui/build_social.py` regenerates them.
They are artwork samples, not live feed implementation. `responsive-1920.png`
and `responsive-390.png` show the cards, badges and icons at 24, 48 and 96 CSS
pixels in a source review layout; real game UI layout remains an integration
check. Run `node art/ui/preview_responsive.cjs` with Playwright and Chrome to
regenerate the previews.

## Loading artwork

`loading/` holds original generated environment illustrations for the seven
planned areas. The source PNGs have no title or progress UI baked in; overlay
localized labels and real loading progress in the game. They are creative
interpretations, not evidence that the level maps or these views exist in game.
The scene briefs, generation method, source dimensions and hashes are recorded
in `loading.json`; `python art/ui/catalog_loading.py` rebuilds the catalog.

An early vector study and the pre-correction L3 image are retained under
`parked/loading-vector-study/` for review; they are not the selected artwork.

## Checks

Run `python art/ui/verify_assets.py` for manifest, SVG parsing, accessibility
labels, declared dimensions, and self-contained source checks. The contact sheets
were rendered in Chromium with Playwright using the adjacent `preview_*.cjs`
scripts; they require Playwright and Chrome. Review actual game rendering and
readability during integration, especially small labels and responsive crops.
