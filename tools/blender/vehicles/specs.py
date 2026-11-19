"""Vehicle specs from docs/systems/vehicles.md §2 (ids, triangle budgets, parking size) plus the art contract.

Axes are the objects pipeline's: Blender front = -Y (glTF +Z), Z up (glTF +Y), 1 unit = 1 m, wheels on z = 0,
vehicle centred on the origin. The pet's/driver's LEFT is +X.

Node contract (docs/systems/vehicles.md §11):
  <id>            body (material `Paint` is the recolourable coat)
  wheel_*         one node per wheel, origin on the axle centre; spin about the node's local X axis
                  (cars: wheel_FL wheel_FR wheel_RL wheel_RR; bike and moped: wheel_F wheel_R)
  glow            head and tail lights (emissive; the renderer turns them on at night)
  door            cars only: the front-left door, origin on its hinge line (swing about local Y in glTF)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple


@dataclass
class VehicleSpec:
    id: str
    name: str
    budget: Tuple[int, int]            #: triangle caps (LOD0, LOD1)
    size: Tuple[float, float, float]   #: expected (width X, length along the drive axis, height) in metres
    park: str                          #: 'small' | 'car'
    paint: str                         #: default coat colour
    wheels: List[str] = field(default_factory=list)
    parts: List[str] = field(default_factory=list)   #: required nodes besides the wheels
    wheel_radius: float = 0.3
    seats: int = 1


SPECS = {s.id: s for s in [
    VehicleSpec('veh_bike', 'Bone-Shaker Bicycle', (1500, 600), (0.60, 1.84, 1.07), 'small', '#6e2a35',
                ['wheel_F', 'wheel_R'], ['glow'], 0.33, 1),
    VehicleSpec('veh_moped', 'Rattletrap Moped', (3000, 1200), (0.70, 1.73, 1.25), 'small', '#6f8f5e',
                ['wheel_F', 'wheel_R'], ['glow'], 0.22, 1),
    VehicleSpec('veh_sedan', 'Rustbucket Sedan', (6000, 2400), (1.94, 4.35, 1.62), 'car', '#7a8a96',
                ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'], ['glow', 'door'], 0.33, 4),
    VehicleSpec('veh_hearse', 'Family Hearse', (6000, 2400), (1.95, 4.90, 1.62), 'car', '#26242c',
                ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'], ['glow', 'door'], 0.35, 6),
]}
LODS = ('', '_lod1')
