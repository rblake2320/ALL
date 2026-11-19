"""Museum exhibits and the dignified, closed-coffin funeral parlour."""
import math
from common import shapes as S
from .kit import builder,add,node
from .l5_common import *

@builder('statue_marble')
def statue(m,s):
    palette(m);pedestal(m,.83,.72,.32)
    for x in (-.13,.13):
        ball(m,.11,(x,-.08,.37),scale=(1,1.4,.5))
        tube(m,[(x,0,.38),(x*.85,.02,.84)],.09,'MhMarble',8)
    add(m,S.lathe([(.27,0),(.28,.1),(.23,.55),(.16,.85)],12,base=(0,0,.74),scale_xy=(1,.70)),'MhMarble')
    ball(m,.26,(0,0,1.39),scale=(1,.64,1.1))
    cyl(m,.09,.13,(0,0,1.61),'MhMarble',10)
    # Closed stone neck: a whimsical detached-head statue, without exposed anatomy.
    for x in (-.24,.24):
        tube(m,[(x,0,1.49),(x*1.15,-.17,1.19),(x*.55,-.29,1.25)],.065,'MhMarble',8)
    skull(m,.17,(0,-.29,1.34),'MhMarble',n=10)
    for i in range(5):
        x=(i-2)*.075;tube(m,[(x,-.17,.80),(x*.7,-.18,1.14),(x*.5,-.15,1.4)],.012,'MhVein',5)
    box(m,(.35,.014,.09),(0,-.37,.14),'MhGilt')
    text(m,'PENSIVE',.055,(0,-.382,.17),'MhInk')
    contact(m,'admire',(0,-.75,0))

@builder('skeleton_display')
def mammoth(m,s):
    palette(m)
    box(m,(3.85,2.55,.14),(0,0,0),'MhInk')
    for x in (-.65,.65):tube(m,[(x,.10,.14),(x,.10,2.1)],.025,'Iron',6)
    node(m,'head','head',origin=(-.95,0,2.10),animationHint='heritageWeekNod')
    spine=[(-.96,0,2.16),(-.7,0,2.37),(-.3,0,2.43),(.15,0,2.36),(.6,0,2.18),(.95,0,2.01)]
    tube(m,spine,.095,'MhMarble',8)
    for i in range(9):
        x=-.65+i*.16;rz=.62-.14*abs(i-3)/6;z=2.2-.08*abs(i-3)
        for side in (-1,1):
            pts=[(x,side*.54*math.sin(a),z-rz*(1-math.cos(a))) for a in [k*math.pi/7 for k in range(7)]]
            tube(m,pts,.035,'MhMarble',6)
        ball(m,.09,(x,0,z+.05),'MhMarble',scale=(.65,1,.7),n=8)
    for x in (-.68,.78):
        for y in (-.43,.43):
            hip=(x,y,1.85 if x<0 else 1.65);knee=(x+(.14 if x<0 else -.1),y,.92)
            ankle=(x-.06,y,.27)
            tube(m,[hip,knee,ankle],.07,'MhMarble',8)
            for p in (hip,knee):ball(m,.10,p,'MhMarble',n=8)
            for dx in (-.09,0,.09):ball(m,.065,(ankle[0]+dx,y-.06,.21),'MhMarble',scale=(.65,1.5,.65),n=6)
    # Broad elephant-like cranium and nasal aperture, not a human skull with a trunk.
    ball(m,.38,(-1.03,0,2.35),'MhMarble',scale=(.84,.85,1.12),part='head',n=12)
    for y in (-.25,.25):
        ball(m,.10,(-1.20,y,2.37),'MhInk',scale=(1,.3,.8),part='head',n=8)
        tube(m,[(-1.13,y,2.16),(-1.40,y*1.5,1.97),(-1.70,y*1.6,1.94),(-1.85,y*1.4,2.15)],.065,'MhMarble',7,'head')
    ball(m,.15,(-1.34,0,2.20),'MhInk',scale=(.3,1,1.2),part='head',n=8)
    tube(m,[(-1.27,-.2,2.0),(-1.43,0,1.94),(-1.27,.2,2.0)],.055,'MhMarble',6,'head')
    tube(m,[(.95,0,2.01),(1.16,.02,1.7),(1.29,.02,1.35)],.045,'MhMarble',6)
    # Visible repair staples are the fictional museum's stitched-together joke.
    for x in (-.55,-.15,.25):tube(m,[(x,-.105,2.30),(x+.05,-.13,2.34),(x+.10,-.105,2.30)],.012,'Brass',4)
    box(m,(1.18,.05,.18),(.15,-1.21,.24),'MhGilt')
    text(m,'GLOAM MAMMOTH',.10,(.15,-1.24,.32),'MhInk')
    contact(m,'admire',(0,-1.65,0))

@builder('counter_museum')
def counter(m,s):
    palette(m)
    box(m,(2.8,.75,.94),(0,0,0))
    box(m,(2.94,.90,.08),(0,0,.94),'MhGilt')
    for x in (-.9,0,.9):frame(m,.74,.60,(x,-.386,.50),'MhGilt')
    box(m,(.36,.3,.17),(.89,0,1.02),'MhGilt')
    box(m,(.17,.015,.004),(.89,0,1.195),'MhInk',b=0)
    for i in range(3):box(m,(.17,.035,.13),(-1.03+i*.18,.03,1.02),'Paper',b=0,rot=(-10,0,0))
    text(m,'HILLTOP MUSEUM',.12,(0,-.40,.53))
    contact(m,'donate',(0,-.7,0));contact(m,'staff',(0,.7,0))

@builder('case_curio')
def case(m,s):
    palette(m);pedestal(m,1.87,.83,.70,mat='MhWalnut')
    for x in (-.86,.86):
        for y in (-.35,.35):tube(m,[(x,y,.70),(x,y,1.51)],.018)
    box(m,(1.85,.82,.04),(0,0,1.51),'MhGilt')
    node(m,'Glass','Glass')
    for x in (-.85,.85):box(m,(.007,.70,.76),(x,0,.74),'Glass','Glass',b=0)
    for y in (-.35,.35):box(m,(1.70,.007,.76),(0,y,.74),'Glass','Glass',b=0)
    for i,(x,y) in enumerate(((-.45,-.15),(.45,-.15),(-.45,.15),(.45,.15))):
        surface(m,f'display_{i}',(x,y,.76),radius=.15)
        cyl(m,.16,.04,(x,y,.70),'MhMarble',10)
    box(m,(.7,.018,.1),(0,-.425,.4),'MhGilt')
    contact(m,'view0',(-.5,-.70,0));contact(m,'view1',(.5,-.70,0))

@builder('wall_painting_frame')
def gallery_frame(m,s):
    palette(m)
    for x in (-.26,.26):
        tube(m,[(x,-.30,.025),(x,.10,1.55)],.027,'MhWalnut',6)
        tube(m,[(x,.30,.025),(x,.10,1.2)],.027,'MhWalnut',6)
        for y in (-.30,.30):cyl(m,.035,.03,(x,y,0),'Brass',6)
    frame(m,.75,1.1,(0,0,1.20))
    node(m,'canvas','canvas',replaceable='lentPainting')
    box(m,(.70,.012,1.04),(0,.018,.68),'MhPlum','canvas',b=0)
    # Stock house portrait remains visible until a painting is lent.
    ball(m,.16,(0,-.005,1.02),'MhInk',scale=(1,.08,1.4),part='canvas',n=8)
    ball(m,.095,(0,-.012,1.35),'MhMarble',scale=(1,.1,1.2),part='canvas',n=8)
    contact(m,'admire',(0,-.65,0))

@builder('dais_viewing')
def dais(m,s):
    palette(m)
    box(m,(2.75,1.7,.24),(0,0,0),'Paint')
    for x in [i*.22 for i in range(-5,6)]:box(m,(.06,.025,.17),(x,-.86,.04),'MhGilt',b=0)
    outline=S.coffin_outline(2.2,.65,.88,.48)
    # Horizontal coffin; the lid is opaque, closed and part of the static mesh.
    add(m,S.prism(outline,.37,.025,1,plane='XY',loc=(0,0,.24),rot=(0,0,90)),'MhWalnut')
    add(m,S.prism(outline,.09,.02,1,plane='XY',loc=(0,0,.61),rot=(0,0,90)),'MhGilt')
    for x in (-.72,0,.72):
        for y in (-.44,.44):tube(m,[(x-.1,y,.45),(x-.1,y*1.15,.40),(x+.1,y*1.15,.40),(x+.1,y,.45)],.018,'Brass',6)
    for x in (-1.19,1.19):
        cyl(m,.09,.32,(x,.43,.24),'MhGilt',8)
        for i in range(5):
            a=math.tau*i/5;px=x+.15*math.cos(a);py=.43+.15*math.sin(a)
            tube(m,[(x,.43,.54),(px,py,.95)],.009,'RubberGreen',4)
            ball(m,.075,(px,py,.95),'Paper',scale=(1,1,.65),n=6)
    for i,x in enumerate((-.8,0,.8)):contact(m,f'respect_{i}',(x,-1.15,0))

@builder('platter_catered')
def platter(m,s):
    palette(m)
    add(m,S.lathe([(0,0),(.15,0),(.20,.02),(.19,.035),(0,.035)],16,scale_xy=(1.45,1)),'Chrome')
    for y in (-.075,.075):
        for x in (-.18,-.06,.06,.18):
            box(m,(.09,.075,.025),(x,y,.035),'Paper',b=0)
            add(m,S.sphere(.035,6,4,loc=(x,y,.08),scale=(1,1,.65)),'Brain')
            tube(m,[(x,y-.025,.10),(x+.005,y+.025,.10)],.004,'BrainDark',4)
    node(m,'grip',origin=(0,0,.02),role='carry')
