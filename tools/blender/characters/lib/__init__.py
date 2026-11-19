"""Procedural zombie character generator for Afterlife Lease (headless Blender / bpy).

Modules:
  consts      - style/animation lists parsed from src/shared/appearance.ts (source of truth) + palette
  noise       - deterministic hash noise + seeded RNG helpers
  meshkit     - Part container + procedural primitives (lofts, tubes, ellipsoids, rounded boxes)
  skeleton    - bone table, armature creation, semantic FK/IK math
  body/face/hair/clothing/accessories/limbs/stitches - part builders (rest pose, armature space)
  assemble    - Part -> Blender object (weights, shape keys, colours, _rot attribute, build morph)
  materials   - named Principled materials
  anim/*      - pose maths, clip definitions, baking into slotted actions + NLA
  export      - glTF export, GLB inspection, manifest
  preview     - Cycles contact sheets
Coordinates: Blender Z-up, character FRONT = -Y, character LEFT = +X (exports to glTF +Z front).
"""
