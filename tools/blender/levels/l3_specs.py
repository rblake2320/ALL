"""W-053 mesh inventory from L3-rotrow sections 4, 10 and 11.

New floor styles remain renderer-owned; floor_dance_lit is a matching visual tile
and shader integration reference, not a claim that floor-style gameplay landed.
Reused home objects are deliberately not duplicated. Heights not fixed by the
design are art proposals, preserved here for contact/placement integration.
"""
from .spec import LevelSpec

LEVEL_ID='rotrow'
DOC='docs/levels/L3-rotrow.md'
ROWS=[
 ('counter_pantry',3,1,1.18,1800,'market'),
 ('shelf_pantry',3,1,1.85,2200,'market'),
 ('bin_donation',1,1,1.1,600,'market'),
 ('crate_supplies',1,1,.7,400,'market'),
 ('shelf_grocery',3,1,1.7,2800,'market'),
 ('counter_checkout',2,1,1.25,1500,'market'),
 ('counter_curio',2,1,1.2,1900,'market'),
 ('stall_fish',2,1,1.35,1600,'market'),
 ('stall_flowers',2,1,1.35,1700,'market'),
 ('display_showroom',3,2,1.65,3500,'market'),
 ('fridge_rotpop',1,1,1.9,1200,'market'),
 ('treadmill_rattle',1,2,1.25,1800,'gym'),
 ('bag_punching',1,1,2.05,900,'gym'),
 ('mat_stretch',2,2,.09,200,'gym'),
 ('counter_reception',2,1,1.06,1500,'salon'),
 ('bench_locker',2,1,1.55,700,'gym'),
 ('pool_plunge',3,2,.5,2600,'gym'),
 ('shelf_library',3,1,2.05,3000,'library'),
 ('table_reading',3,1,1.15,1600,'library'),
 ('catalog_cards',1,1,1.55,800,'library'),
 ('counter_loan',2,1,1.2,1400,'library'),
 ('bench_lab',2,1,1.55,2400,'lab'),
 ('server_rack',1,1,1.95,900,'lab'),
 ('pod_nap',1,2,1.1,2200,'lab'),
 ('booth_dj',2,1,2.05,2800,'club'),
 ('bar_counter',4,1,1.32,3200,'club'),
 ('stage_small',3,2,2.1,2200,'club'),
 ('booth_velvet',2,1,1.1,1600,'club'),
 ('chair_salon',1,1,1.15,1500,'salon'),
 ('station_waxpreserve',1,2,.95,1800,'salon'),
 ('dryer_hood',1,1,1.65,1400,'salon'),
 ('floor_dance_lit',1,1,.035,200,'club'),
 ('env_shopfront_a',5,3,6.4,4500,'street'),
 ('env_shopfront_b',3,3,6.7,3500,'street'),
 ('env_brick_block',6,4,10.5,3000,'street'),
 ('env_tram_stop',3,2,2.7,1800,'street'),
 ('env_neon_sign',1.5,.3,.7,300,'street'),
 ('sign_neonCustom',1,.18,.48,800,'noir'),
 ('ball_mirrorSkull',1,1,1.2,1000,'noir'),
 ('jukebox_ghoul',1,1,1.65,1800,'noir'),
 ('lamp_bankerGreen',1,1,.48,700,'noir'),
 ('rug_checkerboard',2,3,.025,200,'noir'),
 ('stool_barChrome',1,1,.72,650,'noir'),
 ('poster_gigTattered',1,.03,.8,500,'noir'),
 ('display_cryptkicks',1,.25,1.2,1100,'street'),
 ('env_rooftop_billboard',4,1,3,1500,'street'),
 ('item_mealbox',.25,.18,.12,350,'carry'),
 ('item_libraryBook',.2,.15,.04,300,'carry'),
 ('item_bouquet',.32,.32,.48,800,'carry'),
]
PAINT={
 'fridge_rotpop':'#763e51','treadmill_rattle':'#626d76','bag_punching':'#875347',
 'mat_stretch':'#725877','bench_locker':'#8b694e','table_reading':'#6a4736',
 'pod_nap':'#5c6d78','booth_dj':'#44354e','dryer_hood':'#7ca89e',
 'sign_neonCustom':'#c25a8a','booth_velvet':'#6d2d45','ball_mirrorSkull':'#a6b4b8',
 'jukebox_ghoul':'#4b304f','lamp_bankerGreen':'#557f62','rug_checkerboard':'#b6b3a0',
 'stool_barChrome':'#6d2d45','poster_gigTattered':'#c4ab88',
}
PARTS={
 'fridge_rotpop':['door','glow','brand'], 'treadmill_rattle':['screen','belt'],
 'bag_punching':['bag'], 'pool_plunge':['water','frost'], 'table_reading':['bulb'],
 'bench_lab':['glow'], 'server_rack':['glow'], 'pod_nap':['door','glow'],
 'booth_dj':['glow','platter_L','platter_R'], 'bar_counter':['menu'],
 'station_waxpreserve':['glow'], 'floor_dance_lit':['glow'],
 'shelf_grocery':['brand'], 'env_tram_stop':['ad_panel'], 'env_neon_sign':['glow'],
 'sign_neonCustom':['glow','sign'], 'ball_mirrorSkull':['glow'],
 'jukebox_ghoul':['glow'], 'lamp_bankerGreen':['bulb'],
 'display_cryptkicks':['brand'], 'env_rooftop_billboard':['ad_panel'],
}

def specs():
    out={}
    for sid,w,d,h,budget,cat in ROWS:
        kind='env' if sid.startswith('env_') else 'item' if cat=='carry' else 'floor'
        wall=sid in ('sign_neonCustom','poster_gigTattered','display_cryptkicks')
        if wall: kind='wall'
        out[sid]=LevelSpec(sid,sid,kind,w,d,h,budget,cat,DOC+' '+('§4' if sid in [r[0] for r in ROWS[:32]] else '§10/11'),
            paint=PAINT.get(sid),parts=PARTS.get(sid,[]),states=['frost'] if sid=='pool_plunge' else [],
            wall_centre=1.5 if wall else None,tags=[cat,'rotrow'])
    return out
