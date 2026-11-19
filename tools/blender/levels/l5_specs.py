"""W-055 art inventory; fixed table budgets from L5 sections 5, 11 and 12."""
from .spec import LevelSpec
ROWS=[
 ('organ_pipe',3,1,2.6,5800,'interiors'),
 ('fireplace_grand',2,1,1.65,3500,'interiors'),
 ('bookshelf_grand',2,1,2.5,3200,'interiors'),
 ('table_banquet',4,2,1.45,3800,'interiors'),
 ('statue_marble',1,1,1.9,2800,'gallery'),
 ('gramophone_brass',1,1,1.25,1600,'interiors'),
 ('table_billiards',3,2,.95,3600,'interiors'),
 ('armoire_gilded',1,1,2.1,2000,'interiors'),
 ('telescope_brass',1,1,1.65,1800,'interiors'),
 ('pool_reflecting',4,2,.28,1400,'grounds'),
 ('skeleton_display',4,3,2.9,6000,'gallery'),
 ('counter_museum',3,1,1.2,1800,'gallery'),
 ('case_curio',2,1,1.55,1400,'gallery'),
 ('wall_painting_frame',1,1,1.8,900,'gallery'),
 ('lawn_croquet',8,6,.65,2000,'grounds'),
 ('green_putting',6,5,1.25,1800,'grounds'),
 ('table_tea',1,1,1.1,1200,'interiors'),
 ('dais_viewing',3,2,1.2,2400,'gallery'),
 ('platter_catered',1,1,.12,600,'items'),
 ('roof_mansard',12,8,3.7,6000,'architecture'),
 ('env_mansion_a',10,7,8,6000,'architecture'),
 ('env_mansion_b',10,8,9,6000,'architecture'),
 ('env_topiary',1,1,2,600,'grounds'),
 ('chandelier_candle',1,1,2.3,1800,'store'),
 ('rug_gilded',2,3,.025,500,'store'),
 ('vase_urnGilded',1,1,.75,1000,'store'),
 ('portrait_largeOval',1,.1,1.1,1200,'store'),
 ('clock_grandfather',1,1,2.1,1800,'store'),
]
PARTS={
 'organ_pipe':['speaker','flame'], 'fireplace_grand':['flame'],
 'table_banquet':['flame'], 'gramophone_brass':['speaker','record'],
 'armoire_gilded':['door'], 'pool_reflecting':['water'],
 'skeleton_display':['head'], 'case_curio':['Glass','display_0','display_1','display_2','display_3'],
 'wall_painting_frame':['canvas'], 'green_putting':['flag'],
 'chandelier_candle':['flame'], 'clock_grandfather':['pendulum'],
 'roof_mansard':['dormers','cresting','tower_cap'],
}
PAINT={'armoire_gilded':'#514255','organ_pipe':'#47342c','table_billiards':'#496e53',
       'dais_viewing':'#574157','rug_gilded':'#582f4c','vase_urnGilded':'#c3a15e',
       'clock_grandfather':'#50352f','chandelier_candle':'#b89a55'}
def specs():
    out={}
    for sid,w,d,h,budget,cat in ROWS:
        kind='env' if sid.startswith('env_') or sid=='roof_mansard' else 'item' if cat=='items' else 'floor'
        wall=sid=='portrait_largeOval'
        if wall:kind='wall'
        out[sid]=LevelSpec(sid,sid,kind,w,d,h,budget,cat,'docs/levels/L5-mausoleum.md §§5,11,12',
            parts=PARTS.get(sid,[]),paint=PAINT.get(sid),wall_centre=1.5 if wall else None,
            tags=['mausoleum',cat])
    return out
