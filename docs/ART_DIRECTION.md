# Art Direction — "Cosy Macabre Diorama"

**One-liner:** a warm, toy-like dollhouse of the undead — soft bevelled shapes, chunky proportions, moody lighting,
funny-gross details. Think hand-painted miniature set, not horror realism. Readable at a zoomed-out isometric-ish camera.

## Palette (sRGB hex)
- **Night plum** `#1d1726` (UI base, sky at night) · **Grave slate** `#2b2f3a` · **Moss** `#6f8f5e` · **Toxic glow** `#9fe870` (accents, selection wisp)
- **Bone** `#e8e0c8` · **Parchment** `#d9cfb8` · **Rust** `#a5532f` · **Blood wine** `#6e2a35` · **Candle** `#ffb35a` · **Cryo** `#7fe0ff`
- Skin tones: see `SKIN_TONES` in `src/shared/appearance.ts` (desaturated greens, greys, lilacs, parchments).
- Avoid pure black/white; keep saturation moderate except emissive accents (screens, candles, cryo, toxic glow).

## Shapes & materials
- Everything bevelled (bevel width 0.01–0.03 m, 2 segments) with smooth/auto-smooth shading; slightly crooked/asymmetric
  (rotate parts 1–4°, uneven legs, sagging cushions). Chunky proportions (+15% thickness vs realistic).
- Materials: Principled BSDF, roughness 0.55–0.9, metallic only for chrome/steel (0.6–0.9). Flat colours + optional vertex-colour
  ambient occlusion. No image textures in GLBs (keeps assets tiny and stylised). Emissive materials for screens/flames/glows
  (strength 2–6) — the renderer's bloom picks them up.
- Recolourable primary material MUST be named `Paint`. Glass named `Glass` (alpha ~0.35). Emissive parts as their own nodes
  named by `DynamicPart` (see `src/shared/catalog.ts`).
- Poly budget: furniture 300–3,000 tris; large items ≤ 6,000; character ≤ 14,000 tris total with all variants hidden-but-present (≈4k visible per zombie, ≤ ~28 draw calls).

## Exception: the premium tier (D-084)
- The five premium bodies (W-152, `tools/blender/cast/premium/`) are a deliberate second tier: realistic, gritty, sold
  for Grave Gold. Only for them: image textures (base colour, normal, ORM) and a larger budget, a high file (~30k tris,
  2K maps) for the High/Ultra graphics levels and a low file (8.8k tris, 1K) inside the cast budget for the rest.
- Everything else, the Classic starter and the 25 cast bodies included, keeps the rules above.
- "Not horror realism" still holds for the world. The tier must fit E10+ (D-085): mild blood only; no exposed bone,
  teeth or jaw through torn flesh, no empty eye sockets, no organs or deep wounds. Wound add-on parts stay out. Provenance: `tools/blender/cast/premium/PROVENANCE.md`.

## Characters (zombies)
- Stylised chibi-adjacent proportions: head ~1/4.5 of height, big expressive eyes (droopy lids), small nose, wide thin mouth,
  slightly hunched posture, long arms. Visible stitch seams (dark thread crosses) when `stitches` on. Skin tinted by tone,
  shifting toward a sicklier green-grey with darker blotches as decay rises.
- Clothing reads as worn and old-fashioned: frayed hems, patches, a missing button.
- Animation feel: zombies are slow and floppy but *earnest* — they do mundane things carefully. Walk = shuffling, slight drag
  of one foot, arms half-raised; idle = gentle sway, occasional head tilt/twitch; happy = bouncy shoulders; sad = slump.
  Never menacing toward the player; comedic timing.

## Lighting & world
- Day: soft warm-grey overcast sun, long shadows, light fog `#9aa39a`. Dusk: lilac/orange. Night: deep blue-plum ambient with
  a big pale moon, warm interior lamps, emissive windows glowing at night. Full-moon nights tint everything slightly green.
- Ground: muted moss grass with subtle noise, cracked sidewalk, dark road with faded lines, neighbouring crooked houses,
  dead trees and an iron fence fading into fog.
- Post: ACES tonemapping, subtle bloom on emissives, gentle vignette. No heavy grain/chromatic aberration.
- **Miniature-set look (signature, High/Ultra; `src/render/core/diorama.ts`):** tilt-shift focus keeps the middle
  60 % of the view sharp and softens the top and bottom edges (max 4.5 px at 720p, scaled with view height), so the
  lot reads as a tiny model on a table. Shadows lean plum, highlights lean candle. It switches off in build/buy mode,
  the focus line stays centred under Reduce motion, and players can turn it off (Settings → Miniature focus).

## UI
- "Gothic stationery": dark plum glass panels (`rgba(29,23,38,0.86)` + 1px bone border at 15% opacity), bone-white text,
  toxic-green and candle-orange accents, 10–14px rounded corners, soft drop shadows. Display font: a characterful serif
  (bundled offline: system serif fallback stack `"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif`);
  UI font: system sans stack. Icons: custom inline SVG (rounded strokes 1.75px).
- Need bars colour ramp: low = candle orange `#ff9a4a`, high = teal `#55d6be` (colourblind-safe); colourblind mode adds hatching.
- Motion: 120–200ms ease-out panel transitions; respect `reduceMotion`.
