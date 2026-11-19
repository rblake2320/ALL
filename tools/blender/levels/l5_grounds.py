"""Club grounds and the five additional Gilded Afterlife objects."""
import math
from common import shapes as S
from .kit import builder,add,node
from .l5_common import *

@builder('pool_reflecting')
def reflecting_pool(m,s):
    palette(m)
    box(m,(3.93,1.93,.12),(0,0,0),'MhInk')
    for x in (-1.86,1.86):box(m,(.16,1.93,.16),(x,0,.12),'MhMarble')
    for y in (-.86,.86):box(m,(3.58,.16,.16),(0,y,.12),'MhMarble')
    node(m,'water','water',waterStyle='stillReflecting')
    box(m,(3.56,1.54,.008),(0,0,.19),'MhWater','water',b=0)
    for x,y,r in ((1.22,.46,.17),(1.48,.36,.12),(1.12,.25,.11)):
        cyl(m,r,.008,(x,y,.20),'RubberGreen',10)
    for a in range(0,360,72):
        rad=math.radians(a);ball(m,.045,(1.23+.04*math.cos(rad),.46+.04*math.sin(rad),.24),'Paper',scale=(1,1,.35),n=6)
    contact(m,'admire',(0,-1.25,0))

@builder('lawn_croquet')
def croquet(m,s):
    palette(m)
    for i in range(8):box(m,(.98,5.95,.022),(-3.5+i,0,0),'MhLawn' if i%2 else 'MhLawnLight',b=0)
    for x in (-3.93,3.93):box(m,(.035,5.95,.025),(x,0,0),'Paper',b=0)
    for y in (-2.96,2.96):box(m,(7.85,.035,.025),(0,y,0),'Paper',b=0)
    for x,y in ((-2,-1.8),(2,-1.8),(-2,1.8),(2,1.8),(0,-.7),(0,.7)):
        tube(m,[(x-.17,y,.025),(x-.17,y,.31),(x+.17,y,.31),(x+.17,y,.025)],.015,'Paper',6)
    cyl(m,.035,.32,(0,0,.025),'MhGilt',8)
    for z,mat in ((.10,'MhPlum'),(.17,'MhInk'),(.24,'MhMarble')):cyl(m,.037,.035,(0,0,z),mat,8)
    box(m,(.60,.3,.06),(3.35,2.5,.025))
    for i in range(3):
        x=3.15+i*.18;tube(m,[(x,2.5,.085),(x,2.5,.63)],.014,'WoodLight',6)
        tube(m,[(x-.07,2.5,.12),(x+.07,2.5,.12)],.038,'MhWalnut',8)
    for x,y,mat in ((-1.6,-1.4,'MhPlum'),(.8,.1,'Paper')):ball(m,.06,(x,y,.085),mat,n=8)
    contact(m,'play',(0,-3.35,0));m.nodes[m.body].extras['passable']=True

@builder('green_putting')
def putting(m,s):
    palette(m)
    def height(x,y):return .025+.10*math.exp(-((x-1.3)**2+(y-.9)**2))
    # One closed displaced slab: a second coplanar base top would z-fight after quantization.
    bm=S.slab(5.95,4.95,.025,12,10)
    S.displace(bm,lambda v:(v.x,v.y,height(v.x,v.y) if v.z>.012 else 0))
    add(m,bm,'MhLawn')
    for x,y in ((-1.8,-1.5),(.1,.6),(1.9,1.5)):
        cyl(m,.075,.008,(x,y,height(x,y)+.008),'MhInk',12)
    tube(m,[(.1,.6,.035),(.1,.6,1.25)],.012,'Paper',6)
    node(m,'flag','flag',origin=(.1,.6,1.25))
    add(m,S.prism([(0,0),(.35,-.08),(0,-.22)],.008,0,0,loc=(.1,.6,1.24)),'MhPlum','flag')
    ball(m,.03,(-1.5,-1.4,.065),'Paper',n=8)
    contact(m,'putt',(-2.5,-2.8,0));m.nodes[m.body].extras['passable']=True

@builder('env_topiary')
def topiary(m,s):
    palette(m)
    add(m,S.lathe([(.30,0),(.33,.08),(.25,.32),(.34,.36)],10),'MhMarble')
    cyl(m,.045,1.43,(0,0,.30),'MhWalnut',8)
    for z,r in ((.72,.31),(1.25,.25),(1.72,.22)):
        add(m,S.ico(r,1,loc=(0,0,z),scale=(1,1,1.25)),'MhLawn')

@builder('chandelier_candle')
def chandelier(m,s):
    palette(m)
    add(m,S.lathe([(.28,0),(.30,.06),(.12,.15),(.05,.5),(.035,1.8),(.1,1.88)],12),'Paint')
    for i in range(5):
        a=math.tau*i/5;x=.34*math.cos(a);y=.34*math.sin(a)
        tube(m,[(0,0,1.65),(x*.6,y*.6,1.62),(x,y,1.81),(x,y,1.95)],.02,'Paint',6)
        candle(m,x,y,1.95,.21)
        ball(m,.045,(x*.72,y*.72,1.62),'Glass',scale=(.6,.6,1.8),n=8)

@builder('rug_gilded')
def rug(m,s):
    palette(m)
    box(m,(1.95,2.94,.018),(0,0,0),'Paint',b=0)
    for x in (-.88,.88):box(m,(.04,2.75,.004),(x,0,.018),'MhGilt',b=0)
    for y in (-1.36,1.36):box(m,(1.76,.04,.004),(0,y,.018),'MhGilt',b=0)
    for y in (-.72,0,.72):
        add(m,S.prism([(-.24,0),(0,-.35),(.24,0),(0,.35)],.004,0,0,plane='XY',loc=(0,y,.018)),'MhGilt')
    for x in (-.72,-.48,-.24,0,.24,.48,.72):
        for y in (-1.46,1.46):box(m,(.025,.10,.014),(x,y,0),'MhGilt',b=0)

@builder('vase_urnGilded')
def urn(m,s):
    palette(m)
    add(m,S.lathe([(0,0),(.20,0),(.21,.05),(.11,.09),(.12,.2),(.26,.4),(.25,.52),(.12,.60),(.14,.66),(.19,.69),(.17,.73),(0,.75)],16),'Paint')
    for side in (-1,1):tube(m,[(side*.18,0,.56),(side*.35,0,.59),(side*.33,0,.35),(side*.21,0,.31)],.025,'MhGilt',6)
    for z,r in ((.06,.18),(.2,.13),(.60,.13)):
        add(m,S.torus(r,.012,16,4,loc=(0,0,z)),'MhInk')

@builder('portrait_largeOval')
def portrait(m,s):
    palette(m)
    bm=S.torus(.5,.035,20,6,loc=(0,-.045,1.5),rot=(90,0,0));S.xf(bm,scale=(.70,1,1));add(m,bm,'MhGilt')
    ball(m,.48,(0,-.025,1.5),'MhPlum',scale=(.70,.03,1),n=16)
    ball(m,.19,(0,-.05,1.30),'MhInk',scale=(1,.1,1.3),n=10)
    ball(m,.11,(0,-.06,1.63),'MhMarble',scale=(.85,.1,1.1),n=10)
    # A tiny monocle makes the house portrait legible without a texture map.
    add(m,S.torus(.027,.006,8,4,loc=(.035,-.078,1.65),rot=(90,0,0)),'Brass')

@builder('clock_grandfather')
def clock(m,s):
    palette(m)
    box(m,(.62,.46,.12),(0,0,0),'Paint')
    box(m,(.50,.13,1.91),(0,.16,.12),'Paint')
    for x in (-.23,.23):box(m,(.065,.40,1.82),(x,0,.12),'Paint')
    box(m,(.55,.41,.43),(0,0,1.51),'Paint')
    add(m,S.prism([(-.33,0),(.33,0),(.22,.15),(0,.2),(-.22,.15)],.45,.008,1,loc=(0,0,1.9)),'MhGilt')
    cyl(m,.19,.015,(0,-.217,1.74),'Paper',20,rot=(90,0,0))
    for i in range(12):
        a=math.tau*i/12;ball(m,.009,(.16*math.sin(a),-.237,1.74+.16*math.cos(a)),'MhInk',n=6)
    tube(m,[(0,-.24,1.74),(0,-.24,1.87)],.009,'MhInk',4)
    tube(m,[(0,-.245,1.74),(.10,-.245,1.70)],.011,'MhInk',4)
    node(m,'pendulum','pendulum',origin=(0,0,1.51),swingAxis='Z')
    tube(m,[(0,0,1.5),(0,0,.53)],.012,'Brass',6,'pendulum')
    cyl(m,.13,.025,(0,-.016,.53),'Brass',16,'pendulum',rot=(90,0,0))
    # Open carved pendulum bay keeps the moving brass bob legible at game scale.
    frame(m,.38,1.23,(0,-.21,.845),'MhGilt')
