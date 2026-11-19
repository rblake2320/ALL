# Afterlife Lease house-brand decals

Eight original vector marks for the cosy-macabre diorama. Each SVG has a transparent 1024 × 1024 viewBox; the matching PNG is a 1024 × 1024 transparent raster for a decal or texture atlas. [Contact sheet](contact-sheet.jpg) shows them on parchment. These are source assets; they are not yet wired into game materials.

| File stem | Brand | Intended object | Visual idea |
|---|---|---|---|
| mulch-master | Mulch Master | ride-on mower | sprout and mower in a garden shield |
| grave-cola | Grave-Cola | vending machine or fridge | fizzy bottle in a plum placard |
| volt-hearse | Volt-Hearse | electric hearse | angular current and road-sign pennant |
| brain-bran | Brain Bran | cereal box | brain on a warm cereal label |
| rot-pop | Rot-Pop | soda container | fizzy bubbles inside a burst seal |
| coffin-coffee | Coffin Coffee | coffee machine, bag or cup | steaming cup framed by a coffin |
| crypt-kicks | Crypt-Kicks | sneaker or shoebox | a chunky shoe and motion marks |
| necro-tech | Necro-Tech | computer or monitor | circuit-like N on a dark screen |

The work is original first-party vector art; no external images or logos were used. No real-brand endorsement or license is implied. Similarity and name clearance remain an owner/legal review before commercial release; no claim of trademark clearance is made.

## Rebuild

`python art/brands/draw.py` writes the SVG masters. With Playwright and local Chrome installed, set `NODE_PATH` to the Playwright module directory and run `node art/brands/build.cjs` to rasterize. The reference render used Windows Georgia and Arial; SVG text is editable and depends on those fonts or fallbacks, so raster exports may vary on another machine. The checked-in PNGs preserve the reviewed appearance.

Reviewed as a contact sheet at 300 × 300 pixels per mark; final game placement, atlas filtering and readability at actual in-world sizes require the W-014 integration pass.
