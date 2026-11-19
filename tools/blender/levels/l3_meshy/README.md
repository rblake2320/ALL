# W-053 Meshy jukebox source

Owner authorized Meshy credit use on 2026-11-05. One original gothic jukebox was
generated, then textured. No paid rerun. The full sources stay here for reuse;
the published game model is the locally adapted flat-material variant built by
`../l3_meshy_jukebox.py`. The authored alternative is retained in `parked/`.

| Resource | Task | Result | Charged credits |
|---|---|---|---:|
| text-to-3d preview | 01a1adf2-ca14-76fe-9ae9-913c637cae15 | SUCCEEDED | 5 |
| text-to-3d refine | 01a1adf4-334c-7327-8b9f-2e59dc163afa | SUCCEEDED | 10 |

CLI 0.8.3, Smart Topology meshy-t2.5, requested 1,600 triangles. Local CLI face
inspection of geometry.glb returned 1,661 faces, within the 1,800-triangle spec.
Geometry and textured thumbnails were downloaded and visually inspected. Refine
used 2K PBR textures. Total reported charge: 15 credits.

- `prompt.txt`: original geometry prompt.
- `geometry.glb`: original untextured model.
- `textured.glb`: original textured model, retained for reuse.
- `geometry-preview.png`, `textured-preview.png`: Meshy rendered previews.
- `receipt.json`: sanitized task results and local artifact hashes.
- `*_meta.json` and `*.local.json`: ignored local CLI records with signed download
  URLs; do not paste or commit their full contents.

The first geometry download wrote a complete GLB and sidecar but Node exited with
Windows libuv assertion UV_HANDLE_CLOSING. Subsequent local face inspection read
the file successfully. The thumbnail and textured downloads exited 0; no paid
generation was repeated to recover the download.

## Game adaptation

The game's current ART_DIRECTION.md disallows image textures in shipped GLBs.
The full textured source is retained. The game variant classifies source colour
regions into the existing flat palette, normalizes height to 1.65 m, preserves
the original 1,661 triangles, and adds 120 triangles of attached speaker bars and
buttons. These details remain readable without image textures. Final count:
1,781 / 1,800 triangles. It has a recolourable Paint material and a separate glow
node; vertex AO is baked locally. Meshy provenance is in the GLB asset metadata
and root node extras. The generated arch and skull detail were selected after
reviewing the exported game variant. See PARKED.md for the authored alternative.
