/**
 * PHYSICAL CATALOG CONTRACT — footprints, slots, surfaces, lights and model ids for every object.
 * Shared by: simulation (placement, routing, slots), renderer (sync), asset pipeline (Blender models),
 * UI (catalog). Gameplay data (interactions, environment score, needs) lives in src/sim/content/objects.ts
 * which spreads these specs.
 *
 * LOCAL SPACE (pre-rotation): footprint occupies tiles x in [0,w), z in [0,d); continuous points in [0,w]x[0,d].
 * FRONT = +Z (the side zombies normally approach from). Facing angles: 0 = +Z, PI/2 = +X, PI = -Z, -PI/2 = -X.
 * Approach tiles are LOCAL integer tile coords and may lie outside the footprint (e.g. z = d is the row in front).
 * For WALL-placed items: local x in [0,1] runs along the wall edge, z = 0 is the wall surface, +Z points into the
 * tile on the mounted side; local tile (0,0) is that tile.
 * For OPENINGS (doors/windows): local x in [0,1] along the edge, the model is centred on the wall plane.
 */
import type { SeatGeometry } from './seating';
import { DIM } from './dimensions';

export type BuyCategory =
  | 'seating'
  | 'surfaces'
  | 'kitchen'
  | 'preservation'
  | 'beds'
  | 'electronics'
  | 'hobbies'
  | 'decor'
  | 'lighting'
  | 'outdoor'
  | 'misc'
  | 'doors'
  | 'windows'
  | 'item';

export const BUY_CATEGORIES: { id: BuyCategory; label: string }[] = [
  { id: 'seating', label: 'Seating' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'preservation', label: 'Preservation & Bath' },
  { id: 'beds', label: 'Coffins & Beds' },
  { id: 'electronics', label: 'Electronics' },
  { id: 'hobbies', label: 'Hobbies & Skills' },
  { id: 'decor', label: 'Decor' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'outdoor', label: 'Yard' },
  { id: 'misc', label: 'Miscellaneous' },
];

export type PlacementKind = 'floor' | 'wall' | 'door' | 'window' | 'item';
export type SlotKind = 'stand' | 'sit' | 'lie' | 'bath';

export interface SlotSpec {
  id: string;
  kind: SlotKind;
  /** Candidate approach tiles (local). Engine picks the reachable one with the cheapest path. */
  approach: { x: number; z: number }[];
  /** Local pose point for the rig root. Omit when faceObject = true (pose derives from approach tile). */
  pose?: { x: number; z: number; y: number };
  /** Local facing (radians). Ignored when faceObject = true. */
  facing?: number;
  /** Pose = approach tile centre moved 0.28 toward the footprint, facing the footprint centre. */
  faceObject?: boolean;
  tags?: string[];
  /** 'sit' slots: the modelled seat measured from the slot root (src/shared/seating.ts). Required for kind 'sit'. */
  seat?: SeatGeometry;
  /**
   * 'lie' slots: the modelled lying surface (mattress / lining / slab top) under the body, object-local y (m). The sim
   * keeps `pose.y`; the renderer lifts a lying body onto this surface (src/render/agents/reach.ts lieLift). Required
   * for kind 'lie'; tests/unit/clip-audit/catalogFit.test.ts checks it against the GLB (±1.5 cm).
   */
  lie?: { height: number };
}

export interface SurfaceSpec {
  /** Local continuous point where a loose item's centre rests. */
  x: number;
  z: number;
  y: number;
}

export interface LightSpec {
  color: string;
  intensity: number;
  distance: number;
  /** Local height of the light source. */
  height: number;
  /** Needs power to glow (otherwise always on at night, e.g. candles). */
  powered: boolean;
}

/** Named nodes the GLB may contain; the model library animates/toggles them by name. */
export type DynamicPart =
  | 'screen'
  | 'glow'
  | 'bulb'
  | 'flame'
  | 'water'
  | 'door'
  | 'canvas'
  | 'servings'
  | 'flag'
  | 'broken'
  | 'frost'
  | 'speaker'
  | 'pump';

export interface PhysicalSpec {
  id: string;
  name: string;
  description: string;
  category: BuyCategory;
  price: number;
  buyable: boolean;
  placement: PlacementKind;
  footprint: { w: number; d: number };
  /** Approximate model height (picking bounds, thumbnails, cutaway). */
  height: number;
  passable?: boolean;
  /** 'rug' objects may overlap floor objects and are walkable. */
  layer?: 'floor' | 'rug';
  outdoorOnly?: boolean;
  indoorOnly?: boolean;
  needsPower?: boolean;
  tags: string[];
  slots: SlotSpec[];
  surfaces?: SurfaceSpec[];
  light?: LightSpec;
  dynamicParts?: DynamicPart[];
  /** Tintable via material named 'Paint'. Offered colour variants (hex). */
  variants?: string[];
  /** Art brief for the asset pipeline. */
  modelNotes: string;
}

const PI = Math.PI;
const HALF = Math.PI / 2;

/** Stand in front of a w-wide object, one slot per front tile. */
function frontStands(w: number, d: number, id = 'front', inset = 0.22): SlotSpec[] {
  const slots: SlotSpec[] = [];
  for (let x = 0; x < w; x++) {
    slots.push({
      id: w === 1 ? id : `${id}${x}`,
      kind: 'stand',
      approach: [{ x, z: d }],
      pose: { x: x + 0.5, z: d + inset, y: 0 },
      facing: PI,
    });
  }
  return slots;
}

/** One centred front-standing slot for a w-wide object (any front tile can be used to approach). */
function frontStandCentered(w: number, d: number, id = 'front', inset = 0.22): SlotSpec {
  const approach = [] as { x: number; z: number }[];
  const mid = Math.floor((w - 1) / 2);
  approach.push({ x: mid, z: d });
  for (let x = 0; x < w; x++) if (x !== mid) approach.push({ x, z: d });
  return { id, kind: 'stand', approach, pose: { x: w / 2, z: d + inset, y: 0 }, facing: PI };
}

/** Stand on any adjacent tile facing the object (small props, mailboxes, crates). */
function anySide(w: number, d: number, id = 'use'): SlotSpec {
  const approach: { x: number; z: number }[] = [];
  for (let x = 0; x < w; x++) approach.push({ x, z: d });
  for (let z = 0; z < d; z++) approach.push({ x: -1, z }, { x: w, z });
  for (let x = 0; x < w; x++) approach.push({ x, z: -1 });
  return { id, kind: 'stand', approach, faceObject: true };
}

/**
 * A 'sit' slot: rig root at local (x, z) facing `facing`, on a modelled seat `geom` (cushion top height, backrest
 * face behind / lip ahead of the root; see src/shared/seating.ts — tests/unit/seating checks it against the GLB).
 */
function seat(id: string, x: number, z: number, geom: SeatGeometry, approach: { x: number; z: number }[], facing = 0): SlotSpec {
  return { id, kind: 'sit', approach, pose: { x, z, y: 0 }, facing, seat: geom };
}

/** Seat geometries (metres; measured from the GLBs, see tools/blender/objects/seating.py). */
const DINING_CREAKY: SeatGeometry = { height: 0.46, back: 0.2, front: 0.23 };
const DINING_RIBCAGE: SeatGeometry = { height: 0.467, back: 0.21, front: 0.23 };
/** Upholstered seats: SEAT_BACK 0.11 / SEAT_LIP 0.17 / SEAT_KICK 0.11 in seating.py (puffy pillows bulge ~2 cm). */
const ARMCHAIR: SeatGeometry = { height: 0.455, back: 0.09, front: 0.175 };
const SOFA_MOLDY: SeatGeometry = { height: 0.455, back: 0.1, front: 0.17 };
const SOFA_VELVET: SeatGeometry = { height: 0.455, back: 0.11, front: 0.17 };
const PEW: SeatGeometry = { height: 0.46, back: 0.19, front: 0.17 };
/** Round stools (desk, chess table): backless. */
const STOOL: SeatGeometry = { height: 0.453, back: null, front: 0.18 };

const WOOD = ['#6b4a35', '#4a3326', '#8a6a4a', '#3b2a22'];
const FABRIC = ['#5b3f6e', '#3f5a4a', '#6e3b3b', '#4a4a5e', '#7a6a3a'];
const METAL = ['#6d7275', '#4b5156', '#8a8f7a'];

export const PHYSICAL_SPECS: PhysicalSpec[] = [
  // ─────────────── Seating ───────────────
  {
    id: 'chair_creaky',
    name: 'Creaky Dining Chair',
    description: 'Every creak is a little memento mori. Seats one, wobbles always.',
    category: 'seating',
    price: 60,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.95,
    tags: ['seat', 'chair', 'diningChair'],
    slots: [seat('sit', 0.5, 0.5, DINING_CREAKY, [{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }])],
    variants: WOOD,
    modelNotes: 'Simple wooden dining chair, slightly crooked back slats, one leg shorter. Seat top at SEAT_HEIGHT. Backrest at local -Z (back), seat faces +Z.',
  },
  {
    id: 'chair_ribcage',
    name: 'Ribcage Dining Chair',
    description: 'A tasteful chair whose backrest is an actual (decorative, ethically-sourced) ribcage.',
    category: 'seating',
    price: 180,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.05,
    tags: ['seat', 'chair', 'diningChair'],
    slots: [seat('sit', 0.5, 0.5, DINING_RIBCAGE, [{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }])],
    variants: ['#e8e0c8', '#cfc3a4', '#b9b09a'],
    modelNotes: 'Bone-white dining chair; backrest made of curved rib bones; dark cushion. Seat top at SEAT_HEIGHT. Back at -Z.',
  },
  {
    id: 'armchair_tattered',
    name: 'Tattered Armchair',
    description: 'Stuffing escapes it the way your sense of smell escaped you. Very comfy.',
    category: 'seating',
    price: 240,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.05,
    tags: ['seat', 'armchair', 'comfy'],
    slots: [seat('sit', 0.5, 0.52, ARMCHAIR, [{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 }])],
    variants: FABRIC,
    modelNotes: 'Overstuffed wingback armchair with torn patches and visible stuffing tufts. Seat cushion top at SEAT_HEIGHT. Back at -Z. Seat frame (from the slot root at local z 0.52): backrest face 0.09 behind, cushion lip 0.17 ahead, base recessed 0.11 ahead so shins/feet have room (src/shared/seating.ts).',
  },
  {
    id: 'sofa_moldy',
    name: 'Moldy Loveseat',
    description: 'Two seats, one ecosystem. The mold is mostly decorative.',
    category: 'seating',
    price: 320,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 0.95,
    tags: ['seat', 'sofa', 'comfy', 'napSpot'],
    slots: [
      seat('sit0', 0.55, 0.5, SOFA_MOLDY, [{ x: 0, z: 1 }, { x: -1, z: 0 }]),
      seat('sit1', 1.45, 0.5, SOFA_MOLDY, [{ x: 1, z: 1 }, { x: 2, z: 0 }]),
    ],
    variants: FABRIC,
    modelNotes: 'Two-seat sofa, saggy cushions, greenish mold blotches. Seat top at SEAT_HEIGHT. Back along -Z edge, armrests at both X ends.',
  },
  {
    id: 'sofa_velvet',
    name: 'Velvet Mourning Sofa',
    description: 'Deep crushed velvet in funeral-parlour hues. Seats three grieving guests.',
    category: 'seating',
    price: 780,
    buyable: true,
    placement: 'floor',
    footprint: { w: 3, d: 1 },
    height: 1.0,
    tags: ['seat', 'sofa', 'comfy', 'napSpot', 'fancy'],
    slots: [
      seat('sit0', 0.55, 0.5, SOFA_VELVET, [{ x: 0, z: 1 }, { x: -1, z: 0 }]),
      seat('sit1', 1.5, 0.5, SOFA_VELVET, [{ x: 1, z: 1 }]),
      seat('sit2', 2.45, 0.5, SOFA_VELVET, [{ x: 2, z: 1 }, { x: 3, z: 0 }]),
    ],
    variants: ['#4b1f3a', '#2c2346', '#1f3a33', '#5a1c1c'],
    modelNotes: 'Elegant tufted chesterfield-style three-seater, rolled arms, button tufting, carved dark wood feet. Seat top at SEAT_HEIGHT.',
  },
  {
    id: 'pew_salvaged',
    name: 'Salvaged Pew',
    description: 'Rescued from a deconsecrated chapel. Promotes excellent posture and mild guilt.',
    category: 'seating',
    price: 150,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 1.0,
    tags: ['seat', 'bench'],
    slots: [
      seat('sit0', 0.55, 0.5, PEW, [{ x: 0, z: 1 }, { x: -1, z: 0 }]),
      seat('sit1', 1.45, 0.5, PEW, [{ x: 1, z: 1 }, { x: 2, z: 0 }]),
    ],
    variants: WOOD,
    modelNotes: 'Wooden church pew with carved end panels and a tall straight back. Seat top at SEAT_HEIGHT.',
  },

  // ─────────────── Surfaces ───────────────
  {
    id: 'table_rickety',
    name: 'Rickety Table',
    description: 'A small square table. Seats up to four if nobody makes sudden movements.',
    category: 'surfaces',
    price: 90,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: DIM.TABLE_HEIGHT,
    tags: ['table', 'surface', 'diningTable'],
    slots: [],
    surfaces: [{ x: 0.5, z: 0.5, y: DIM.TABLE_HEIGHT }],
    variants: WOOD,
    modelNotes: 'Small square wooden table, top at TABLE_HEIGHT, spindly legs, a folded coaster under one leg.',
  },
  {
    id: 'table_wake',
    name: 'Long Wake Table',
    description: 'Built for funeral receptions. Now hosts the dinners that come after.',
    category: 'surfaces',
    price: 340,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: DIM.TABLE_HEIGHT,
    tags: ['table', 'surface', 'diningTable'],
    slots: [],
    surfaces: [
      { x: 0.5, z: 0.5, y: DIM.TABLE_HEIGHT },
      { x: 1.5, z: 0.5, y: DIM.TABLE_HEIGHT },
    ],
    variants: WOOD,
    modelNotes: 'Long rectangular dining table with a lace runner and a dripping candle in the middle. Top at TABLE_HEIGHT.',
  },
  {
    id: 'counter_butcher',
    name: 'Butcher Block Counter',
    description: 'Scarred, stained, sturdy. Do not ask about the stains.',
    category: 'surfaces',
    price: 110,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: DIM.COUNTER_HEIGHT,
    tags: ['counter', 'surface', 'counterHeight'],
    slots: frontStands(1, 1, 'front'),
    surfaces: [{ x: 0.5, z: 0.45, y: DIM.COUNTER_HEIGHT }],
    variants: WOOD,
    modelNotes: 'Kitchen base cabinet with butcher-block top at COUNTER_HEIGHT, cabinet doors facing +Z, a cleaver stuck in the top near the back.',
  },
  {
    id: 'counter_slab',
    name: 'Mortuary Slab Counter',
    description: 'Cold marble repurposed from a morgue. Keeps leftovers (and you) fresh-looking.',
    category: 'surfaces',
    price: 260,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: DIM.COUNTER_HEIGHT,
    tags: ['counter', 'surface', 'counterHeight', 'fancy'],
    slots: frontStands(1, 1, 'front'),
    surfaces: [{ x: 0.5, z: 0.45, y: DIM.COUNTER_HEIGHT }],
    variants: ['#d9d6cf', '#9aa1a6', '#2f3236'],
    modelNotes: 'Kitchen base cabinet with veined grey marble top at COUNTER_HEIGHT and brushed steel drawer pulls.',
  },
  {
    id: 'table_coffinlid',
    name: 'Coffin-Lid Coffee Table',
    description: 'A coffin lid on stubby legs. Conversation starter; occasionally conversation ender.',
    category: 'surfaces',
    price: 120,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: DIM.COFFEE_TABLE_HEIGHT,
    tags: ['coffeeTable', 'surface'],
    slots: [],
    surfaces: [
      { x: 0.6, z: 0.5, y: DIM.COFFEE_TABLE_HEIGHT },
      { x: 1.4, z: 0.5, y: DIM.COFFEE_TABLE_HEIGHT },
    ],
    variants: WOOD,
    modelNotes: 'Hexagonal-tapered coffin lid lying flat on four short legs, brass handles on the sides. Top at COFFEE_TABLE_HEIGHT.',
  },
  {
    id: 'table_urnstand',
    name: 'Urn Stand End Table',
    description: 'A pedestal end table. Formerly displayed Aunt Mildred. She has since moved on.',
    category: 'surfaces',
    price: 70,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.62,
    tags: ['endTable', 'surface'],
    slots: [],
    surfaces: [{ x: 0.5, z: 0.5, y: 0.62 }],
    variants: WOOD,
    modelNotes: 'Round pedestal side table, top at 0.62, turned column, claw feet.',
  },

  // ─────────────── Kitchen ───────────────
  {
    id: 'fridge_humming',
    name: 'Humming Fridge',
    description: 'Keeps brains chilled and leftovers questionable. Hums in a minor key.',
    category: 'kitchen',
    price: 450,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.9,
    needsPower: true,
    tags: ['fridge', 'appliance'],
    slots: frontStands(1, 1, 'front', 0.3),
    dynamicParts: ['door', 'glow', 'broken'],
    variants: ['#cfd6c4', '#9fb3a5', '#e0d2b8'],
    modelNotes: 'Rounded 1950s-style fridge, chrome handle, a few magnets and a "BRAINS" note. Door hinged on the left side, pivot node named "door". Front at +Z.',
  },
  {
    id: 'fridge_cryo',
    name: 'Cryo-Fridge 3000',
    description: 'Stainless, frosty and smart. Halves spoilage and unlocks gourmet brain cuts.',
    category: 'kitchen',
    price: 1200,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 2.0,
    needsPower: true,
    tags: ['fridge', 'appliance', 'fancy', 'cryoFridge'],
    slots: frontStands(1, 1, 'front', 0.3),
    dynamicParts: ['door', 'glow', 'frost', 'broken'],
    variants: ['#b8c2c8', '#3a3f45'],
    modelNotes: 'Sleek stainless fridge with an icy-blue LED panel (node "glow") and frost on the edges (node "frost"). Door pivot "door".',
  },
  {
    id: 'stove_greasefire',
    name: 'Grease-Fire Range',
    description: 'Four burners and a decades-old film of grease. Cook with skill, or with a fire extinguisher handy.',
    category: 'kitchen',
    price: 400,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: DIM.COUNTER_HEIGHT + 0.15,
    needsPower: true,
    tags: ['stove', 'appliance', 'counterHeight'],
    slots: frontStands(1, 1, 'front'),
    dynamicParts: ['flame', 'broken'],
    variants: ['#d8cfb8', '#7c8a6e'],
    modelNotes: 'Old enamel range, cooktop at COUNTER_HEIGHT with four coil burners (node "flame" = red-hot burner glow), oven door on front, a stained pot.',
  },
  {
    id: 'stove_necrochef',
    name: 'Necro-Chef Pro Range',
    description: 'Professional grade. Even your fumbling, partially-detached hands cook well here.',
    category: 'kitchen',
    price: 1100,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: DIM.COUNTER_HEIGHT + 0.2,
    needsPower: true,
    tags: ['stove', 'appliance', 'counterHeight', 'fancy'],
    slots: frontStands(1, 1, 'front'),
    dynamicParts: ['flame', 'broken'],
    variants: ['#2b2b2b', '#8c1d1d'],
    modelNotes: 'Black professional range with gas burners (node "flame" = blue flames), chunky knobs, skull-shaped knob caps.',
  },
  {
    id: 'microwave_nuke',
    name: 'Nuke-o-Matic Cart',
    description: 'A microwave on a rolling cart. Reheats leftovers to roughly the temperature of the sun.',
    category: 'kitchen',
    price: 150,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.15,
    needsPower: true,
    tags: ['microwave', 'appliance'],
    slots: frontStands(1, 1, 'front'),
    dynamicParts: ['screen', 'broken'],
    variants: METAL,
    modelNotes: 'Metal kitchen cart with a boxy retro microwave on top; window node "screen" glows orange when running.',
  },
  {
    id: 'espresso_embalmer',
    name: "Embalmer's Espresso Machine",
    description: 'Brews coffee with a splash of formaldehyde. Wakes the dead. Well, more awake.',
    category: 'kitchen',
    price: 260,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.3,
    needsPower: true,
    tags: ['espresso', 'appliance'],
    slots: frontStands(1, 1, 'front'),
    dynamicParts: ['glow', 'broken'],
    variants: ['#8a6a3a', '#5e6b5a'],
    modelNotes: 'Small cabinet with a brass steampunk espresso machine with gauges and a green-glowing fluid tank (node "glow").',
  },
  {
    id: 'sink_rusty',
    name: 'Rust-Stained Sink',
    description: 'For washing dishes, hands, and any limb you intend to reattach.',
    category: 'kitchen',
    price: 180,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: DIM.COUNTER_HEIGHT + 0.25,
    tags: ['sink', 'counterHeight'],
    slots: frontStands(1, 1, 'front'),
    dynamicParts: ['water', 'broken'],
    variants: WOOD,
    modelNotes: 'Base cabinet with a chipped porcelain basin set into the counter at COUNTER_HEIGHT, gooseneck faucet; node "water" = falling water stream.',
  },
  {
    id: 'trash_lidded',
    name: 'Lidded Trash Can',
    description: 'Holds dirty dishes, rotten limbs and broken dreams.',
    category: 'kitchen',
    price: 50,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.75,
    tags: ['trash'],
    slots: [anySide(1, 1)],
    variants: METAL,
    modelNotes: 'Dented galvanised trash can with a lid, a fly or two painted on.',
  },

  // ─────────────── Preservation & bath ───────────────
  {
    id: 'shower_drizzle',
    name: 'Drizzle Shower',
    description: 'Lukewarm, low-pressure, and vaguely brown. Stops the smell, mostly.',
    category: 'preservation',
    price: 350,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 2.2,
    tags: ['shower', 'plumbing'],
    slots: [{ id: 'inside', kind: 'stand', approach: [{ x: 0, z: 1 }], pose: { x: 0.5, z: 0.5, y: 0.05 }, facing: 0 }],
    dynamicParts: ['water'],
    variants: ['#cfd6c4', '#b7c4c9'],
    modelNotes: 'Square shower stall: tiled base tray, curtain rail with a mouldy curtain on the +Z front (drawn mostly open), rusty showerhead. Node "water" = falling water. Interior must stay clear for a standing zombie.',
  },
  {
    id: 'tub_icebath',
    name: 'Ice Bath Tub',
    description: 'A clawfoot tub with a built-in ice maker. Cold soaks restore that just-buried glow.',
    category: 'preservation',
    price: 900,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: DIM.TUB_RIM,
    needsPower: true,
    tags: ['tub', 'iceBath', 'plumbing'],
    slots: [{ id: 'bath', kind: 'bath', approach: [{ x: 0, z: 1 }, { x: 1, z: 1 }], pose: { x: 0.85, z: 0.5, y: 0.12 }, facing: HALF }],
    dynamicParts: ['frost', 'water', 'broken'],
    variants: ['#e6e1d6', '#b9c8c8', '#3c4a4f'],
    modelNotes: 'Clawfoot bathtub lengthwise along X, filled with icy blue water and ice cubes (node "water"), frost on rim (node "frost"), small ice machine at the -X end. Rim at TUB_RIM.',
  },
  {
    id: 'station_embalming',
    name: 'Home Embalming Station',
    description: 'The single best investment an undead household can make. Pumps preservation fluid; skill helps.',
    category: 'preservation',
    price: 1600,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 1.6,
    tags: ['embalm', 'slab'],
    slots: [
      {
        id: 'lie',
        kind: 'lie',
        approach: [{ x: 0, z: 1 }, { x: 1, z: 1 }, { x: -1, z: 0 }, { x: 2, z: 0 }],
        pose: { x: 1.0, z: 0.5, y: DIM.SLAB_HEIGHT },
        facing: HALF,
        lie: { height: DIM.SLAB_HEIGHT },
      },
      { id: 'work', kind: 'stand', approach: [{ x: 1, z: 1 }, { x: 0, z: 1 }], pose: { x: 1.0, z: 1.25, y: 0 }, facing: PI },
    ],
    dynamicParts: ['pump', 'glow'],
    variants: METAL,
    modelNotes: 'Stainless steel embalming table along X (top at SLAB_HEIGHT) with a drain lip, plus a pump machine with glass tank of glowing green fluid (node "glow") and a moving piston (node "pump") at the +X end, tubing draped to the table.',
  },
  {
    id: 'table_stitchnmend',
    name: 'Stitch-n-Mend Table',
    description: 'Needles, thread, and an alarming amount of surgical glue. Reattach what falls off.',
    category: 'preservation',
    price: 120,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.85,
    tags: ['sewing'],
    slots: frontStands(1, 1, 'front'),
    variants: WOOD,
    modelNotes: 'Small sewing table with a pincushion, spools of thread, a big curved needle and a magnifying lamp.',
  },
  {
    id: 'mirror_cracked',
    name: 'Cracked Floor Mirror',
    description: 'Seven years bad luck already used up. Perfect for admiring your decay.',
    category: 'preservation',
    price: 160,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.85,
    tags: ['mirror'],
    slots: frontStands(1, 1, 'front', 0.38),
    variants: WOOD,
    modelNotes: 'Free-standing oval cheval mirror in an ornate frame with a visible crack across the glass (glass = slightly reflective dark silver). Glass faces +Z.',
  },

  // ─────────────── Coffins & beds ───────────────
  {
    id: 'plot_budget',
    name: 'Budget Burial Plot',
    description: 'A patch of dirt and a wooden marker. Free-range rest for the frugal corpse.',
    category: 'beds',
    price: 80,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 2 },
    height: 0.6,
    outdoorOnly: true,
    tags: ['bed', 'grave', 'dirtBed'],
    slots: [
      {
        id: 'lie',
        kind: 'lie',
        approach: [{ x: -1, z: 0 }, { x: -1, z: 1 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 2 }, { x: 0, z: -1 }],
        pose: { x: 0.5, z: 1.0, y: 0.04 },
        facing: 0,
        lie: { height: 0.045 },
      },
    ],
    modelNotes: 'Rectangular mound of turned dark soil (shallow dip in the middle), wooden cross marker at the -Z (head) end, a few weeds.',
  },
  {
    id: 'coffin_pine',
    name: 'Pine Box Coffin',
    description: 'Simple, honest, splintery. Halts decay while you rest.',
    category: 'beds',
    price: 300,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 2 },
    height: 0.62,
    tags: ['bed', 'coffin'],
    slots: [
      {
        id: 'lie',
        kind: 'lie',
        approach: [{ x: -1, z: 0 }, { x: -1, z: 1 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 2 }],
        pose: { x: 0.5, z: 1.0, y: DIM.BED_HEIGHT },
        facing: 0,
        lie: { height: DIM.BED_HEIGHT },
      },
    ],
    variants: WOOD,
    modelNotes: 'Classic hexagonal pine coffin lengthwise along Z, open, lid leaning off at the side (inside footprint), pale cloth lining with lining top at BED_HEIGHT, head end at -Z.',
  },
  {
    id: 'coffin_chillrest',
    name: 'Chill-Rest Refrigerated Coffin',
    description: 'Refrigerated lining restores preservation while you sleep. Requires power.',
    category: 'beds',
    price: 1400,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 2 },
    height: 0.7,
    needsPower: true,
    tags: ['bed', 'coffin', 'refrigerated'],
    slots: [
      {
        id: 'lie',
        kind: 'lie',
        approach: [{ x: -1, z: 0 }, { x: -1, z: 1 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 2 }],
        pose: { x: 0.5, z: 1.0, y: DIM.BED_HEIGHT },
        facing: 0,
        lie: { height: DIM.BED_HEIGHT },
      },
    ],
    dynamicParts: ['frost', 'glow', 'broken'],
    variants: ['#d9d9d9', '#2f4a5a', '#5a2f3a'],
    modelNotes: 'Glossy lacquered casket with chrome trim and a refrigeration unit at the foot (+Z) end with a blue status light (node "glow"); frosty blue lining (node "frost"). Lining top at BED_HEIGHT, head at -Z.',
  },
  {
    id: 'sarcophagus_cryo',
    name: 'Cryo Sarcophagus',
    description: 'Ancient design, modern cryogenics. Sleep in it to slowly rebuild Vitality itself.',
    category: 'beds',
    price: 4800,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 2 },
    height: 1.0,
    needsPower: true,
    tags: ['bed', 'coffin', 'cryo', 'fancy'],
    slots: [
      {
        id: 'lie',
        kind: 'lie',
        approach: [{ x: -1, z: 0 }, { x: -1, z: 1 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 2 }],
        pose: { x: 0.5, z: 1.0, y: DIM.BED_HEIGHT + 0.1 },
        facing: 0,
        lie: { height: DIM.BED_HEIGHT + 0.1 },
      },
    ],
    dynamicParts: ['glow', 'frost', 'broken'],
    variants: ['#c9a94a', '#7f8fa6'],
    modelNotes: 'Egyptian-style gilded sarcophagus base with a glass cryo canopy tilted open, glowing cyan hieroglyph panels (node "glow"), mist inside (node "frost").',
  },
  {
    id: 'bed_normal',
    name: 'Suspiciously Normal Bed',
    description: 'A warm, fluffy double bed. Zombies find it deeply unsettling but romantic.',
    category: 'beds',
    price: 500,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 2 },
    height: 1.1,
    tags: ['bed', 'doubleBed', 'humanBed'],
    slots: [
      { id: 'lie0', kind: 'lie', approach: [{ x: -1, z: 0 }, { x: -1, z: 1 }, { x: 0, z: 2 }], pose: { x: 0.55, z: 1.05, y: DIM.BED_HEIGHT + 0.12 }, facing: 0, lie: { height: 0.595 } },
      { id: 'lie1', kind: 'lie', approach: [{ x: 2, z: 0 }, { x: 2, z: 1 }, { x: 1, z: 2 }], pose: { x: 1.45, z: 1.05, y: DIM.BED_HEIGHT + 0.12 }, facing: 0, lie: { height: 0.595 } },
    ],
    variants: FABRIC,
    modelNotes: 'Cosy double bed, headboard at -Z, two pillows, patterned quilt. Mattress top at BED_HEIGHT+0.12.',
  },

  // ─────────────── Electronics ───────────────
  {
    id: 'tv_crt',
    name: 'Flickering CRT',
    description: 'A boxy television on a wobbly stand. Mostly static; occasionally horror reruns.',
    category: 'electronics',
    price: 300,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.15,
    needsPower: true,
    tags: ['tv', 'electronic'],
    slots: [{ id: 'watch', kind: 'stand', approach: [{ x: 0, z: 2 }, { x: 0, z: 3 }], pose: { x: 0.5, z: 2.5, y: 0 }, facing: PI }],
    dynamicParts: ['screen', 'broken'],
    variants: WOOD,
    modelNotes: 'Wood-veneer CRT TV with rabbit-ear antenna on a small stand; screen (node "screen") faces +Z.',
  },
  {
    id: 'tv_seance',
    name: 'Big-Screen Séance TV',
    description: 'Enormous, crisp, and it picks up channels from the Other Side.',
    category: 'electronics',
    price: 1500,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 1.5,
    needsPower: true,
    tags: ['tv', 'electronic', 'bigTv', 'fancy'],
    slots: [{ id: 'watch', kind: 'stand', approach: [{ x: 0, z: 2 }, { x: 1, z: 2 }, { x: 0, z: 3 }], pose: { x: 1.0, z: 2.5, y: 0 }, facing: PI }],
    dynamicParts: ['screen', 'broken'],
    variants: ['#1c1c1f', '#3b2a4a'],
    modelNotes: 'Wide flat-screen on a gothic carved media console; screen (node "screen") faces +Z, candles on the console.',
  },
  {
    id: 'stereo_boombox',
    name: 'Boombox of the Damned',
    description: 'Plays funeral marches remixed as dance tracks. Shake what decay gave you.',
    category: 'electronics',
    price: 250,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.95,
    needsPower: true,
    tags: ['stereo', 'electronic'],
    slots: frontStands(1, 1, 'front'),
    dynamicParts: ['speaker', 'broken'],
    variants: ['#2b2b2b', '#5a1f4a', '#1f4a3a'],
    modelNotes: 'Big chunky boombox on a low speaker cabinet; speaker cones (node "speaker", scale-pulses with music), a cassette deck, skull stickers.',
  },
  {
    id: 'desk_hauntedpc',
    name: 'Haunted Desktop PC',
    description: 'Desk, stool and a computer that occasionally types by itself. Work, play, browse the ForbiddenWeb.',
    category: 'electronics',
    price: 1050,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 2 },
    height: 1.35,
    needsPower: true,
    tags: ['computer', 'desk', 'electronic'],
    slots: [seat('sit', 0.5, 1.35, STOOL, [{ x: 0, z: 2 }, { x: -1, z: 1 }, { x: 1, z: 1 }], PI)],
    surfaces: [],
    dynamicParts: ['screen', 'broken'],
    variants: WOOD,
    modelNotes: 'Desk occupying the -Z tile (desktop at TABLE_HEIGHT) with a beige tower and CRT monitor facing +Z (node "screen"), keyboard at the +Z edge of the desk; a round stool on the +Z tile, stool top at SEAT_HEIGHT, centred at local (0.5, 1.35).',
  },

  // ─────────────── Hobbies & skills ───────────────
  {
    id: 'table_bonechess',
    name: 'Bone Chess Table',
    description: 'Pieces carved from knucklebones. Logic for two; trash talk optional.',
    category: 'hobbies',
    price: 380,
    buyable: true,
    placement: 'floor',
    footprint: { w: 3, d: 1 },
    height: 0.8,
    tags: ['chess', 'logicObject'],
    slots: [
      seat('sitL', 0.55, 0.5, STOOL, [{ x: 0, z: 1 }, { x: 0, z: -1 }, { x: -1, z: 0 }], HALF),
      seat('sitR', 2.45, 0.5, STOOL, [{ x: 2, z: 1 }, { x: 2, z: -1 }, { x: 3, z: 0 }], -HALF),
    ],
    variants: WOOD,
    modelNotes: 'Small square chess table in the middle tile (board top ~0.72) with bone chess pieces; a round stool on the left tile and right tile (stool tops at SEAT_HEIGHT).',
  },
  {
    id: 'shelf_moldering',
    name: 'Moldering Bookshelf',
    description: 'Cookbooks, mortuary textbooks and trashy romance novels. Damp but readable.',
    category: 'hobbies',
    price: 280,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 2.05,
    tags: ['bookshelf'],
    slots: frontStands(1, 1, 'front'),
    variants: WOOD,
    modelNotes: 'Tall narrow bookshelf, backed against -Z, crammed with leaning books of varied colours, cobwebs in a corner, a skull bookend.',
  },
  {
    id: 'easel_morbid',
    name: 'Morbid Easel',
    description: 'Paint still lifes of rotting fruit, or of yourself. Sells surprisingly well.',
    category: 'hobbies',
    price: 350,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.75,
    tags: ['easel', 'creativeObject'],
    slots: frontStands(1, 1, 'front', 0.3),
    dynamicParts: ['canvas'],
    variants: WOOD,
    modelNotes: 'Wooden A-frame easel holding a canvas (node "canvas") facing +Z, a paint-splattered palette and jar of brushes on the tray.',
  },
  {
    id: 'gym_limb',
    name: 'Limb Gym',
    description: 'A weight bench that strengthens loose joints. Fewer limbs fall off when you keep fit.',
    category: 'hobbies',
    price: 700,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 1.7,
    tags: ['gym', 'fitnessObject'],
    slots: [{ id: 'train', kind: 'stand', approach: [{ x: 0, z: 1 }, { x: 1, z: 1 }], pose: { x: 1.0, z: 0.62, y: 0 }, facing: 0 }],
    variants: METAL,
    modelNotes: 'Squat rack with a barbell and bone-shaped plates, rubber mat; the zombie stands in the middle facing +Z; keep a clear 0.6m-wide standing area at local x 0.7..1.3.',
  },
  {
    id: 'arcade_tombstone',
    name: 'Tombstone Arcade Cabinet',
    description: 'Play "Grave Invaders" until your thumbs fall off. (They might.)',
    category: 'hobbies',
    price: 950,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.85,
    needsPower: true,
    tags: ['arcade', 'electronic'],
    slots: frontStands(1, 1, 'front', 0.32),
    dynamicParts: ['screen', 'broken'],
    variants: ['#3a3a4a', '#4a2a2a', '#2a4a3a'],
    modelNotes: 'Upright arcade cabinet shaped like a tombstone, glowing screen (node "screen") facing +Z, joystick and buttons, RIP marquee.',
  },

  // ─────────────── Decor ───────────────
  {
    id: 'plant_deadfern',
    name: 'Thoroughly Dead Fern',
    description: 'Low maintenance. No maintenance. It is beyond maintenance.',
    category: 'decor',
    price: 45,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.95,
    tags: ['plant', 'decor'],
    slots: [anySide(1, 1)],
    modelNotes: 'Terracotta pot with a drooping brown fern, a few fallen fronds.',
  },
  {
    id: 'plant_carnivorous',
    name: 'Carnivorous Houseplant',
    description: 'The only living thing in the house. Feed it occasionally; it purrs.',
    category: 'decor',
    price: 160,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.25,
    tags: ['plant', 'decor', 'carnivorous'],
    slots: [anySide(1, 1)],
    modelNotes: 'Large potted venus-flytrap-style plant with three toothy heads on curling stalks, vivid green and purple.',
  },
  {
    id: 'rug_rag',
    name: 'Stain-Resistant Rag Rug',
    description: 'Braided from old burial shrouds. Hides most things.',
    category: 'decor',
    price: 90,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 2 },
    height: 0.02,
    passable: true,
    layer: 'rug',
    tags: ['rug', 'decor'],
    slots: [],
    variants: FABRIC,
    modelNotes: 'Flat oval braided rag rug, 2x2 tiles, 1-2cm thick.',
  },
  {
    id: 'rug_funeral',
    name: 'Ornate Funeral Rug',
    description: 'A sumptuous runner from a defunct funeral home. Mourners not included.',
    category: 'decor',
    price: 420,
    buyable: true,
    placement: 'floor',
    footprint: { w: 3, d: 2 },
    height: 0.02,
    passable: true,
    layer: 'rug',
    tags: ['rug', 'decor', 'fancy'],
    slots: [],
    variants: ['#5a1c2a', '#1c2a5a', '#2a3a1c'],
    modelNotes: 'Rectangular persian-style rug 3x2 tiles with fringe, deep red with gold medallion pattern (vertex colours or simple geometry pattern).',
  },
  {
    id: 'painting_greatgrand',
    name: 'Portrait of Great-Grandzombie',
    description: 'His eyes follow you around the room. One of them literally fell out and is following you.',
    category: 'decor',
    price: 200,
    buyable: true,
    placement: 'wall',
    footprint: { w: 1, d: 1 },
    height: 1.0,
    tags: ['painting', 'decor', 'wallDecor'],
    slots: [{ id: 'admire', kind: 'stand', approach: [{ x: 0, z: 0 }], pose: { x: 0.5, z: 0.62, y: 0 }, facing: PI }],
    modelNotes: 'Gilded frame portrait (0.7 wide x 0.9 tall) of a stern zombie ancestor, hung with centre at y=1.6, back flat at z=0 projecting +Z by 0.06.',
  },
  {
    id: 'headstone_decor',
    name: 'Decorative Headstone',
    description: 'Engraved with a pun of your choosing. Yard décor for the recently deceased.',
    category: 'outdoor',
    price: 120,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.0,
    outdoorOnly: true,
    tags: ['decor', 'headstone'],
    slots: frontStands(1, 1, 'front'),
    modelNotes: 'Mossy rounded granite headstone with "R.I.P." carving facing +Z, tufts of grass at the base.',
  },
  {
    id: 'tree_gnarled',
    name: 'Gnarled Dead Tree',
    description: 'Leafless year-round. Ravens included at no additional charge.',
    category: 'outdoor',
    price: 250,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 4.5,
    outdoorOnly: true,
    tags: ['decor', 'tree'],
    slots: [],
    modelNotes: 'Twisted leafless tree, thick trunk, spreading crooked branches up to ~4.5m, a crow on one branch. Trunk fits within the 1x1 tile.',
  },
  {
    id: 'zapper_fly',
    name: 'Fly Zapper Pole',
    description: 'Zaps the flies that follow you. Pleasant blue glow. Satisfying crackle.',
    category: 'misc',
    price: 110,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.9,
    needsPower: true,
    tags: ['flyZapper'],
    slots: [],
    dynamicParts: ['glow', 'broken'],
    modelNotes: 'Standing pole with a cylindrical bug-zapper cage at the top glowing violet-blue (node "glow").',
  },
  {
    id: 'diffuser_formaldehyde',
    name: 'Formaldehyde Diffuser',
    description: 'Pine-scented preservative mist. Rooms with one smell 40% less like you.',
    category: 'misc',
    price: 95,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.75,
    tags: ['airFreshener'],
    slots: [],
    modelNotes: 'Small pedestal with a glass apothecary diffuser bottle emitting a faint green wisp.',
  },
  {
    id: 'mailbox_crooked',
    name: 'Crooked Mailbox',
    description: 'Bills arrive here. So does the occasional fan letter. Mostly bills.',
    category: 'outdoor',
    price: 50,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.25,
    outdoorOnly: true,
    tags: ['mailbox'],
    slots: [anySide(1, 1)],
    dynamicParts: ['flag'],
    modelNotes: 'Leaning post with a rusty rounded mailbox; red flag (node "flag", pivot at hinge) that rotates up when mail is waiting.',
  },
  {
    id: 'kit_reanimation',
    name: 'Reanimation Kit',
    description: 'Lightning in a crate. One use: bring a crumbled housemate back from the bone pile.',
    category: 'misc',
    price: 1500,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.75,
    tags: ['reanimationKit', 'consumable'],
    slots: [anySide(1, 1)],
    dynamicParts: ['glow'],
    modelNotes: 'Wooden crate stencilled with a lightning bolt, jumper cables and a crackling tesla coil on top (node "glow").',
  },
  {
    id: 'crate_prosthetic',
    name: 'Prosthetic Limb Crate',
    description: 'Contains one handsome wooden arm or leg, fitted to whatever you are missing.',
    category: 'misc',
    price: 250,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.65,
    tags: ['prostheticCrate', 'consumable'],
    slots: [anySide(1, 1)],
    modelNotes: 'Open slatted crate with straw and a wooden arm and a peg leg sticking out.',
  },

  // ─────────────── Lighting ───────────────
  {
    id: 'lamp_skull',
    name: 'Skull Floor Lamp',
    description: 'A standing lamp with a skull-shaped shade. Warm light, cold stare.',
    category: 'lighting',
    price: 140,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.65,
    needsPower: true,
    tags: ['light'],
    slots: [],
    light: { color: '#ffc27a', intensity: 6, distance: 6, height: 1.45, powered: true },
    dynamicParts: ['bulb'],
    modelNotes: 'Brass floor lamp; translucent skull lampshade (node "bulb" glows warm when on).',
  },
  {
    id: 'candelabra_drippy',
    name: 'Drippy Candelabra',
    description: 'Five candles, infinite wax. Needs no power; may need a fire extinguisher.',
    category: 'lighting',
    price: 90,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.35,
    tags: ['light', 'candle'],
    slots: [],
    light: { color: '#ffb35a', intensity: 4, distance: 5, height: 1.3, powered: false },
    dynamicParts: ['flame'],
    modelNotes: 'Tall wrought-iron candelabra with five dripping candles (node "flame" groups the five flames).',
  },
  {
    id: 'sconce_candle',
    name: 'Candle Wall Sconce',
    description: 'A single candle in a tarnished bracket. Mood lighting for the moodily deceased.',
    category: 'lighting',
    price: 75,
    buyable: true,
    placement: 'wall',
    footprint: { w: 1, d: 1 },
    height: 0.4,
    tags: ['light', 'candle', 'wallDecor'],
    slots: [],
    light: { color: '#ffb35a', intensity: 3, distance: 4.5, height: 1.75, powered: false },
    dynamicParts: ['flame'],
    modelNotes: 'Tarnished bronze wall bracket with one candle, centre at y=1.7, back plate at z=0, projecting +Z ~0.18. Node "flame".',
  },
  {
    id: 'lantern_post',
    name: 'Graveyard Lantern Post',
    description: 'An iron lamp post for the yard. Guides lost souls and pizza delivery ghouls.',
    category: 'lighting',
    price: 180,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 2.5,
    outdoorOnly: true,
    needsPower: true,
    tags: ['light', 'outdoorLight'],
    slots: [],
    light: { color: '#ffd59a', intensity: 10, distance: 9, height: 2.3, powered: true },
    dynamicParts: ['bulb'],
    modelNotes: 'Black wrought-iron lamp post with a caged lantern head (node "bulb").',
  },

  // ─────────────── Doors & windows (build mode) ───────────────
  {
    id: 'door_splintered',
    name: 'Splintered Door',
    description: 'A wooden door that has clearly been clawed at. Charming.',
    category: 'doors',
    price: 120,
    buyable: true,
    placement: 'door',
    footprint: { w: 1, d: 1 },
    height: DIM.DOOR_HEIGHT,
    tags: ['door'],
    slots: [],
    variants: WOOD,
    modelNotes: 'Door + frame for a wall opening DOOR_WIDTH x DOOR_HEIGHT, wall thickness WALL_THICKNESS, centred on the wall plane (z=0), x spans the 1-tile edge; scratched panels, a brass knob.',
  },
  {
    id: 'door_crypt',
    name: 'Crypt Door',
    description: 'Heavy iron-banded door salvaged from a mausoleum. Very dramatic entrances.',
    category: 'doors',
    price: 380,
    buyable: true,
    placement: 'door',
    footprint: { w: 1, d: 1 },
    height: DIM.DOOR_HEIGHT,
    tags: ['door', 'fancy'],
    slots: [],
    variants: ['#3a3a3a', '#4a3a2a'],
    modelNotes: 'Arched-top dark wood door with iron bands and a knocker, plus stone frame; same opening size as door_splintered.',
  },
  {
    id: 'window_grimy',
    name: 'Grimy Window',
    description: 'Lets in some light, keeps out some smell.',
    category: 'windows',
    price: 90,
    buyable: true,
    placement: 'window',
    footprint: { w: 1, d: 1 },
    height: DIM.WINDOW_HEIGHT,
    tags: ['window'],
    slots: [],
    variants: WOOD,
    modelNotes: 'Wooden double-hung window frame WINDOW_WIDTH x WINDOW_HEIGHT with sill at WINDOW_SILL, smudged semi-transparent glass (material name "Glass").',
  },
  {
    id: 'window_gothic',
    name: 'Gothic Arched Window',
    description: 'Pointed arches and leaded glass. Very "haunted manor".',
    category: 'windows',
    price: 240,
    buyable: true,
    placement: 'window',
    footprint: { w: 1, d: 1 },
    height: DIM.WINDOW_HEIGHT + 0.25,
    tags: ['window', 'fancy'],
    slots: [],
    variants: ['#3a3a3a', '#5a4a3a'],
    modelNotes: 'Pointed-arch window with leaded diamond panes, stained glass accents (material "Glass" tinted); sill at WINDOW_SILL.',
  },

  // ─────────────── Loose items (spawned by gameplay, never bought) ───────────────
  {
    id: 'item_meal',
    name: 'Meal',
    description: 'A platter of freshly cooked brains. Grab a serving.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.18,
    passable: true,
    tags: ['meal', 'food'],
    slots: [anySide(1, 1, 'grab')],
    dynamicParts: ['servings'],
    modelNotes: 'Serving platter (~0.45 wide, origin at its base centre) with a pink brain-shaped loaf and garnish; four portion nodes named serving_0..serving_3 that can be hidden one by one.',
  },
  {
    id: 'item_pizza',
    name: 'Brain Pizza',
    description: 'Delivered piping hot. Extra cerebellum.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.12,
    passable: true,
    tags: ['meal', 'food', 'pizza'],
    slots: [anySide(1, 1, 'grab')],
    dynamicParts: ['servings'],
    modelNotes: 'Open cardboard pizza box (~0.45 wide) with a pizza whose toppings look like brain matter; slices as serving_0..serving_3.',
  },
  {
    id: 'item_dish',
    name: 'Dirty Dish',
    description: 'Someone should really clean this up.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.05,
    passable: true,
    tags: ['dish', 'dirty'],
    slots: [anySide(1, 1, 'grab')],
    modelNotes: 'Single dirty plate (~0.26 diameter) with smears and a fork, origin at base centre.',
  },
  {
    id: 'item_limb_arm',
    name: 'Detached Arm',
    description: 'It was attached a minute ago. It can be again, with a needle and some optimism.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.12,
    passable: true,
    tags: ['limb'],
    slots: [anySide(1, 1, 'grab')],
    modelNotes: 'A zombie forearm+upper arm lying on the floor (~0.6 long along X), greenish skin, ragged sleeve cuff, stitched wrist. Origin at its centre on the floor.',
  },
  {
    id: 'item_limb_leg',
    name: 'Detached Leg',
    description: 'A leg, unleashed. Still wearing its shoe.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.14,
    passable: true,
    tags: ['limb'],
    slots: [anySide(1, 1, 'grab')],
    modelNotes: 'A zombie leg lying on the floor (~0.85 long along X) with a trouser cuff and a shoe. Origin at its centre on the floor.',
  },
  {
    id: 'item_bonepile',
    name: 'Bone Pile',
    description: 'All that remains of a housemate who let themselves go. A Reanimation Kit could help.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.35,
    passable: true,
    tags: ['bonePile'],
    slots: [anySide(1, 1, 'tend')],
    dynamicParts: ['glow'],
    modelNotes: 'Heap of bones with a skull on top, scraps of clothing; faint ghostly wisp (node "glow"). ~0.8 wide.',
  },
  {
    id: 'item_urn',
    name: 'Memorial Urn',
    description: 'Here lies someone who could not be reanimated in time. Gone, but not forgotten.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.45,
    passable: true,
    tags: ['urn', 'decor'],
    slots: [anySide(1, 1, 'mourn')],
    modelNotes: 'Ornate bronze funeral urn on a small square plinth.',
  },
  {
    id: 'item_painting',
    name: 'Finished Painting',
    description: 'An original work of morbid art, propped against the wall. Sell it or admire it.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.75,
    passable: true,
    tags: ['paintingItem', 'decor'],
    slots: [anySide(1, 1, 'look')],
    dynamicParts: ['canvas'],
    modelNotes: 'Framed canvas (0.6 x 0.5) leaning back on a small stand; front faces +Z; canvas node "canvas" for a tinted abstract image.',
  },
  {
    id: 'item_fire',
    name: 'Fire',
    description: 'This is bad. Zombies are extremely flammable.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 1.0,
    passable: false,
    tags: ['fire'],
    slots: [anySide(1, 1, 'fight')],
    dynamicParts: ['flame'],
    modelNotes: 'Cluster of stylised low-poly flame tongues (orange/yellow, emissive) ~0.8 wide; node "flame" (renderer flickers it).',
  },
  {
    id: 'item_ash',
    name: 'Pile of Ash',
    description: 'Formerly furniture.',
    category: 'item',
    price: 0,
    buyable: false,
    placement: 'item',
    footprint: { w: 1, d: 1 },
    height: 0.1,
    passable: true,
    tags: ['ash', 'dirty'],
    slots: [anySide(1, 1, 'grab')],
    modelNotes: 'Low grey ash heap with a couple of charred sticks.',
  },
  // ───────────── home services (docs/contract-requests/home-build-system.md section 2; built by tools/blender/homeservices) ─────────────
  {
    id: 'hearth_stone',
    name: 'The Hearth',
    description: 'The heart of the house: a stone fireplace that runs on your utilities. Spend Rot Essence here on home upgrades. Cold when the power is cut.',
    category: 'decor',
    price: 450,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 1.7,
    tags: ['hearth', 'service'],
    slots: [],
    light: { color: '#ffb35a', intensity: 4, distance: 6, height: 0.8, powered: false },
    dynamicParts: ['flame'],
    modelNotes: 'Stone fireplace with a chimney breast against the back (-Y) edge, arched firebox with an iron grate and a small fire (node "flame"), a mantel with a skull candle holder and two candles, a log stack at one side and an iron poker on a hook. Cosy, not gory.',
  },
  {
    id: 'wardrobe_coffin',
    name: 'Wardrobe Coffin',
    description: 'An upright coffin with a mirror door. Save up to four builds per zombie and swap between them here.',
    category: 'beds',
    price: 380,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 1.9,
    tags: ['wardrobe', 'service'],
    slots: [],
    variants: ['#4a3326', '#3b2a22', '#6b4a35'],
    modelNotes: 'Tall hexagonal coffin stood on its foot end (wider at the shoulders), two doors with a cloudy mirror panel and brass handles, carved trim, little bone-knob feet. Faces +Y front (-Y back).',
  },
  {
    id: 'vault_crypt',
    name: 'Crypt Vault',
    description: 'A stone crypt chest for the household stash: scrap, wood, cloth, bone, glass, wire and ectoplasm.',
    category: 'misc',
    price: 520,
    buyable: true,
    placement: 'floor',
    footprint: { w: 1, d: 1 },
    height: 0.95,
    tags: ['vault', 'service'],
    slots: [],
    modelNotes: 'Squat stone sarcophagus-style chest with a slightly domed lid, iron bands and a big padlock, a carved skull plaque on the front, moss in the corners. Closed.',
  },
  {
    id: 'workbench_bone',
    name: 'Bone Workbench',
    description: 'A sturdy bench on bone legs with a vise and tools. The home crafting station.',
    category: 'hobbies',
    price: 640,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 1.0,
    tags: ['workbench', 'service'],
    slots: [],
    variants: ['#6b4a35', '#4a3326', '#8a6a4a'],
    modelNotes: 'Thick plank bench top on four big femur-style legs with cross braces, an iron vise at one end, a mallet, a saw and a coil of wire on the top, a bone-handled hammer hung on a short rail at the back, a lantern-less peg board.',
  },
  {
    id: 'gate_bone',
    name: 'Bone Gate',
    description: 'A freestanding arch of bone with a swirling green glow. Fast travel to the graveyard and town once the town map is open.',
    category: 'misc',
    price: 900,
    buyable: true,
    placement: 'floor',
    footprint: { w: 2, d: 1 },
    height: 2.3,
    tags: ['bonegate', 'service'],
    slots: [],
    dynamicParts: ['glow'],
    modelNotes: 'Freestanding gothic arch built from stacked bones and two small skulls at the spring points, on two stone plinths, filled with a flat, faintly swirling green glow disc (node "glow", emissive). No gore.',
  },
];

export const PHYSICAL_BY_ID: Record<string, PhysicalSpec> = Object.fromEntries(PHYSICAL_SPECS.map((s) => [s.id, s]));

/** Non-catalog environment props the asset pipeline must also produce (neighbourhood dressing). */
export const ENV_MODELS = [
  { id: 'env_house_a', size: { w: 8, d: 8, h: 7 }, notes: 'Neighbour house: two-storey crooked Victorian, boarded window, ~8x8m footprint, ~7m tall, faces +Z.' },
  { id: 'env_house_b', size: { w: 9, d: 7, h: 5 }, notes: 'Neighbour house: squat bungalow with sagging porch and overgrown hedge, ~9x7m, faces +Z.' },
  { id: 'env_house_c', size: { w: 6, d: 8, h: 10 }, notes: 'Neighbour house: narrow tall gothic townhouse with a tower and weather vane, ~6x8m, faces +Z.' },
  { id: 'env_streetlamp', size: { w: 1.2, d: 0.6, h: 4 }, notes: 'Curved iron street lamp ~4m with a glowing head (node "bulb").' },
  { id: 'env_fence', size: { w: 1, d: 0.12, h: 1.1 }, notes: 'One 1m section of crooked wrought-iron fence along X, 1.1m tall, origin at segment start (x=0..1).' },
  { id: 'env_tree_a', size: { w: 6.5, d: 6.5, h: 6 }, notes: 'Large dead tree ~6m.' },
  { id: 'env_tree_b', size: { w: 2.2, d: 2.2, h: 5 }, notes: 'Spooky pine/cypress ~5m, dark green.' },
  { id: 'env_bush', size: { w: 1.2, d: 1.2, h: 1 }, notes: 'Overgrown thorny bush ~1m.' },
  { id: 'env_hydrant', size: { w: 0.45, d: 0.45, h: 0.8 }, notes: 'Rusty fire hydrant.' },
  { id: 'env_hearse', size: { w: 5, d: 1.9, h: 1.8 }, notes: 'Carpool hearse (long black station-wagon hearse with curtains), ~5m long along X, wheels on y=0.' },
  { id: 'env_cart', size: { w: 1.2, d: 0.7, h: 1.2 }, notes: 'Delivery ghoul pushcart with a pizza warmer box, ~1.2m long.' },
  { id: 'env_gravestones', size: { w: 2, d: 1.2, h: 1 }, notes: 'Cluster of 3 old leaning headstones for background graveyard dressing.' },
] as const;
