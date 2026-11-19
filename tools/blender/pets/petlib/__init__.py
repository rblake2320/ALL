"""Procedural pet generator for Afterlife Lease (headless Blender).

Modules:
  species  - per-species proportions, colours and markings (the only place with numbers to tune)
  rig      - bone tables, semantic FK, planar two-bone leg IK, armature creation
  body     - Part builders (rest pose, armature space) for quadrupeds and the crow, normal + undead variants
  clips    - the nine animation clips per body plan (idle walk run sit sleep eat play beg flee)
  build    - Part -> skinned Blender object, materials, action baking, glTF export, GLB inspection
  preview  - Cycles contact sheets
Coordinates: Blender Z-up, pet FRONT = -Y, pet LEFT = +X (exports to glTF Y-up, front +Z). Units: metres.
Deterministic: no wall-clock, no unseeded randomness.
"""
import importlib.util
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_MESHKIT = os.path.normpath(os.path.join(_HERE, '..', '..', 'characters', 'lib', 'meshkit.py'))


def _load_meshkit():
    """The zombie pipeline's mesh toolkit (pure mathutils), loaded by path so its package is not imported."""
    spec = importlib.util.spec_from_file_location('afterlife_meshkit', _MESHKIT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mk = _load_meshkit()
