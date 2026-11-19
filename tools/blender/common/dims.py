"""Mirror of ``DIM`` in ``src/shared/dimensions.ts``.

Keep the numbers identical: ``tests/unit/models/pipeline.test.ts`` parses this file and compares every entry
against the TypeScript source of truth. 1 unit = 1 lot tile = 1 metre.

Blender is Z-up. The glTF exporter (export_yup=True) maps Blender +Z -> glTF +Y and Blender -Y -> glTF +Z,
so the model FRONT (glTF/Three +Z) faces Blender -Y.
"""

TILE = 1
WALL_HEIGHT = 2.7
WALL_THICKNESS = 0.12
WALL_CUTAWAY_HEIGHT = 0.28
DOOR_WIDTH = 0.86
DOOR_HEIGHT = 2.1
WINDOW_WIDTH = 0.78
WINDOW_SILL = 0.9
WINDOW_HEIGHT = 1.15

SEAT_HEIGHT = 0.46
TABLE_HEIGHT = 0.76
COFFEE_TABLE_HEIGHT = 0.42
COUNTER_HEIGHT = 0.92
BED_HEIGHT = 0.42
SLAB_HEIGHT = 0.86
TUB_RIM = 0.6

CHARACTER_HEIGHT = 1.62
HEAD_TOP = 1.78

#: All values by name (same keys as the TS ``DIM`` object).
DIM = {
    'TILE': TILE,
    'WALL_HEIGHT': WALL_HEIGHT,
    'WALL_THICKNESS': WALL_THICKNESS,
    'WALL_CUTAWAY_HEIGHT': WALL_CUTAWAY_HEIGHT,
    'DOOR_WIDTH': DOOR_WIDTH,
    'DOOR_HEIGHT': DOOR_HEIGHT,
    'WINDOW_WIDTH': WINDOW_WIDTH,
    'WINDOW_SILL': WINDOW_SILL,
    'WINDOW_HEIGHT': WINDOW_HEIGHT,
    'SEAT_HEIGHT': SEAT_HEIGHT,
    'TABLE_HEIGHT': TABLE_HEIGHT,
    'COFFEE_TABLE_HEIGHT': COFFEE_TABLE_HEIGHT,
    'COUNTER_HEIGHT': COUNTER_HEIGHT,
    'BED_HEIGHT': BED_HEIGHT,
    'SLAB_HEIGHT': SLAB_HEIGHT,
    'TUB_RIM': TUB_RIM,
    'CHARACTER_HEIGHT': CHARACTER_HEIGHT,
    'HEAD_TOP': HEAD_TOP,
}

#: Blender-space sign of the model front (front faces -Y).
FRONT_Y = -1.0
#: Blender-space sign of the model back.
BACK_Y = 1.0
