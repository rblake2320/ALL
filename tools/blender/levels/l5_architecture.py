"""Second Empire and gothic neighbour silhouettes; original geometry, no interiors."""
from common import shapes as S
from .kit import builder,add,node
from .l5_common import *

def roof(m,w,d,z,h,parts=False):
    rings=[]
    for sx,sy,zz in ((w,d,z),(w*.77,d*.73,z+h*.73),(w*.74,d*.70,z+h)):
        rings.append([(-sx/2,-sy/2,zz),(sx/2,-sy/2,zz),(sx/2,sy/2,zz),(-sx/2,sy/2,zz)])
    add(m,S.loft(rings,cap_bottom=True),'MhRoof')
    box(m,(w+.08,d+.08,.12),(0,0,z),'MhMarble')
    if parts:
        for p in ('dormers','cresting','tower_cap'):node(m,p,p)
    for x in [w*f for f in (-.32,-.16,0,.16,.32)]:
        for side in (-1,1):
            y=side*d*.44
            box(m,(.63,.55,.70),(x,y,z+.35),'MhMarble','dormers' if parts else None)
            box(m,(.39,.012,.47),(x,y+side*.28,z+.45),'MhWindow','dormers' if parts else None,b=0)
            add(m,S.prism([(-.42,0),(.42,0),(0,.35)],.7,.01,1,loc=(x,y,z+1.05)),
                'MhRoof','dormers' if parts else None)
    part='cresting' if parts else None
    for side in (-1,1):
        y=side*d*.34
        tube(m,[(-w*.35,y,z+h+.08),(w*.35,y,z+h+.08)],.02,'Iron',5,part)
        for i in range(13):
            x=(i-6)*w*.056
            tube(m,[(x,y,z+h),(x,y,z+h+.27)],.016,'Iron',5,part)
            add(m,S.cone(.033,.09,5,base=(x,y,z+h+.27)),'Iron',part)

@builder('roof_mansard')
def mansard_kit(m,s):
    palette(m);roof(m,11.8,7.8,0,2.1,True)
    box(m,(2.05,2.05,.75),(-3.5,1.3,2.1),'MhMarble','tower_cap')
    for y in (.265,2.335):box(m,(.65,.012,.45),(-3.5,y,2.25),'MhWindow','tower_cap',b=0)
    rings=[]
    for a,z in ((1.20,2.85),(.72,3.48),(.67,3.55)):
        rings.append([(-3.5-a,1.3-a,z),(-3.5+a,1.3-a,z),(-3.5+a,1.3+a,z),(-3.5-a,1.3+a,z)])
    add(m,S.loft(rings,cap_bottom=True),'MhRoof','tower_cap')
    tube(m,[(-3.5,1.3,3.55),(-3.5,1.3,3.7)],.025,'Iron',6,'tower_cap')
    m.nodes[m.body].extras.update(renderOnly=True,roofBase=0,referenceSize=[12,8],attachment='top of house walls')

def windows(m,w,d,z,rows=2,gothic=False):
    node(m,'windows','windows')
    for level in range(rows):
        zz=z+level*1.65
        for x in (-w*.34,-w*.17,w*.17,w*.34):
            for side in (-1,1):
                y=side*(d/2+.012)
                box(m,(.65,.018,1.02),(x,y,zz),'MhWindow','windows',b=0)
                frame(m,.72,1.12,(x,y+side*.015,zz+.51),'MhMarble')
                box(m,(.035,.025,1.02),(x,y+side*.025,zz),'MhInk',b=0)
                if gothic:add(m,S.prism([(-.36,0),(.36,0),(0,.38)],.08,0,0,loc=(x,y,zz+1.08)),'MhMarble')

@builder('env_mansion_a')
def mansion_second_empire(m,s):
    palette(m)
    box(m,(9.6,6.6,.3),(0,0,0),'MhMarble')
    box(m,(9.2,6.2,4.9),(0,0,.3),'MhVein')
    for z in (.30,2.8,5.08):box(m,(9.4,6.4,.13),(0,0,z),'MhMarble')
    windows(m,9.2,6.2,1.0)
    for x in (-4.55,-2.3,2.3,4.55):
        box(m,(.18,.16,4.72),(x,-3.17,.4),'MhMarble')
        for z in (1.0,1.6,2.2,2.8,3.4,4.0,4.6):box(m,(.27,.17,.12),(x,-3.18,z),'MhMarble',b=0)
    roof(m,9.6,6.6,5.2,1.75)
    # The entry tower is a connected mass with a mansard cap, not a floating roof.
    box(m,(1.85,1.65,6.9),(0,-2.65,.30),'MhMarble')
    box(m,(.95,.025,1.8),(0,-3.49,.3),'MhWalnut')
    for z in (2.6,4.4,6.0):box(m,(.65,.018,.8),(0,-3.49,z),'MhWindow','windows',b=0)
    add(m,S.loft([[(-1.1,-3.7,7.2),(1.1,-3.7,7.2),(1.1,-1.6,7.2),(-1.1,-1.6,7.2)],
                    [(-.7,-3.3,7.8),(.7,-3.3,7.8),(.7,-2.0,7.8),(-.7,-2.0,7.8)]]),'MhRoof')
    tube(m,[(0,-2.65,7.8),(0,-2.65,8.0)],.035,'Iron',6)
    m.nodes[m.body].extras['exteriorOnly']=True

@builder('env_mansion_b')
def mansion_gothic(m,s):
    palette(m)
    box(m,(9.6,4.3,.25),(0,0,0),'MhInk')
    box(m,(9.2,4.0,4.7),(0,0,.25),'MhVein')
    box(m,(3.5,7.5,4.9),(0,0,.25),'MhVein')
    add(m,S.prism([(-4.85,0),(4.85,0),(0,2.45)],4.5,.01,1,loc=(0,0,4.95)),'MhRoof')
    add(m,S.prism([(-1.95,0),(1.95,0),(0,2.30)],7.9,.01,1,loc=(0,0,5.15)),'MhRoof')
    windows(m,9.2,4.0,.8,gothic=True)
    for x in (-4.2,4.2):
        cyl(m,.72,6.2,(x,1.65,.25),'MhMarble',8)
        add(m,S.cone(.95,2.45,8,base=(x,1.65,6.45)),'MhRoof')
        ball(m,.08,(x,1.65,8.9),'Brass',n=6)
    box(m,(1.15,.03,2.0),(0,-3.77,.25),'MhWalnut')
    add(m,S.prism([(-.75,0),(.75,0),(0,.8)],.12,.01,1,loc=(0,-3.8,2.25)),'MhMarble')
    cyl(m,.55,.03,(0,-3.78,4.25),'MhWindow',16,'windows',rot=(90,0,0))
    for x in (-1.68,1.68):box(m,(.28,.40,4.6),(x,-3.61,.25),'MhMarble')
    m.nodes[m.body].extras['exteriorOnly']=True
