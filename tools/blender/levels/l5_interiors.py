"""Gothic instruments and mansion furnishings, with usable contacts and pivots."""
import math
from common import shapes as S
from .kit import builder,add,node
from .l5_common import *

@builder('organ_pipe')
def organ(m,s):
    palette(m)
    box(m,(2.85,.88,.14),(0,0,0),'Paint')
    box(m,(2.72,.18,2.05),(0,.31,.14),'Paint')
    for x,h in ((-1.24,2.2),(0,2.6),(1.24,2.2)):
        box(m,(.2,.76,h-.3),(x,0,.14),'Paint')
        add(m,S.prism([(-.15,0),(.15,0),(0,.28)],.76,.008,1,loc=(x,0,h-.28)),'MhGilt')
    node(m,'speaker','speaker')
    for i in range(15):
        x=(i-7)*.14;h=1.05+.75*(1-abs(i-7)/7)
        cyl(m,.046,h,(x,.13,.61),'Steel',8,'speaker')
        box(m,(.038,.012,.065),(x,.078,.78),'MhInk','speaker',b=0)
    box(m,(2.24,.7,.13),(0,-.05,.65),'Paint')
    for i in range(27):box(m,(.067,.30,.035),((i-13)*.076,-.28,.79),'Teeth',b=0)
    for i in range(26):
        if i%7 not in (2,6):box(m,(.032,.16,.025),((i-12.5)*.076,-.20,.825),'MhInk',b=0)
    for x in (-1.15,1.15):
        tube(m,[(x,-.28,.95),(x,-.40,1.15)],.025)
        candle(m,x,-.40,1.15)
    for x in (-.42,.42):box(m,(.1,.27,.42),(x,-.28,.14),'Paint')
    box(m,(1.05,.35,.075),(0,-.28,.56),'MhWalnut')
    contact(m,'play',(0,-.7,0),pose='playOrgan')

@builder('fireplace_grand')
def fireplace(m,s):
    palette(m)
    box(m,(1.93,.88,.1),(0,0,0),'MhMarble')
    for x in (-.77,.77):
        pedestal(m,.37,.65,1.25,(x,.07,.1))
        for dx in (-.09,.09):box(m,(.025,.018,.83),(x+dx,-.266,.29),'MhVein',b=0)
    box(m,(1.9,.75,.13),(0,0,1.35),'MhMarble')
    box(m,(1.25,.1,1.1),(0,.33,.1),'MhInk')
    for x in (-.32,.32):tube(m,[(x,-.16,.12),(x,.21,.12)],.06,'WoodDark',8)
    for x in (-.5,-.3,-.1,.1,.3,.5):tube(m,[(x,-.34,.12),(x,-.34,.48)],.018,'Iron',6)
    tube(m,[(-.53,-.34,.47),(.53,-.34,.47)],.018,'Iron',6)
    node(m,'flame','flame',transient=True)
    for i,x in enumerate((-.3,0,.3)):add(m,S.flame(.4+(i%2)*.14,.13,(x,-.04,.19),8),'MhFlame','flame')
    box(m,(.34,.17,.2),(0,0,1.48),'MhGilt')
    cyl(m,.08,.015,(0,-.093,1.58),'Paper',12,rot=(90,0,0))
    tube(m,[(0,-.11,1.58),(0,-.11,1.63)],.007,'MhInk',4)
    contact(m,'warm',(0,-.72,0))

@builder('bookshelf_grand')
def bookshelf(m,s):
    palette(m)
    box(m,(1.92,.18,2.43),(0,.34,0))
    for x in (-.91,.91):box(m,(.12,.65,2.5),(x,.04,0))
    for z in (0,.43,.89,1.35,1.81,2.34):
        box(m,(1.85,.68,.07),(0,0,z))
        if z<2.3:
            for i in range(12):
                x=(i-5.5)*.135;h=.26+(i%3)*.035
                mat=('MhPlum','WoodDark','RubberGreen','MhInk')[i%4]
                box(m,(.1,.30,h),(x,-.02,z+.07),mat,b=0,rot=(0,(-4,0,3)[i%3],0))
                box(m,(.07,.008,.012),(x,-.175,z+.12),'MhGilt',b=0)
    tube(m,[(-.83,-.37,2.1),(.83,-.37,2.1)],.018)
    for x in (-.83,.83):tube(m,[(x,-.30,1.95),(x,-.37,2.1)],.018)
    box(m,(1.99,.77,.09),(0,.03,2.41))
    contact(m,'read0',(-.5,-.7,0));contact(m,'read1',(.5,-.7,0))

@builder('table_banquet')
def banquet(m,s):
    palette(m)
    for x in (-1.55,1.55):
        for y in (-.65,.65):leg(m,x,y,.79)
    box(m,(3.86,1.8,.1),(0,0,.79))
    box(m,(3.65,.04,.11),(0,0,.45),'MhGilt')
    cyl(m,.13,.06,(0,0,.89),'Brass')
    cyl(m,.026,.26,(0,0,.95),'Brass')
    for x in (-.28,0,.28):
        tube(m,[(0,0,1.1),(x,0,1.15),(x,0,1.2)],.018)
        candle(m,x,0,1.2,.13)
    for i,(x,y) in enumerate(((-1.25,-.48),(0,-.48),(1.25,-.48),(-1.25,.48),(0,.48),(1.25,.48))):
        surface(m,f'surface_{i}',(x,y,.89),radius=.25)
    for side in (-1,1):
        for i,x in enumerate((-1.4,-.45,.45,1.4)):contact(m,f'seat_{side}_{i}',(x,side*1.25,0),chairRequired=True)

@builder('gramophone_brass')
def gramophone(m,s):
    palette(m)
    pedestal(m,.72,.64,.55,mat='MhWalnut')
    node(m,'record','record',origin=(0,0,.59),spinAxis='Y')
    cyl(m,.25,.018,(0,0,.56),'MhInk',20,'record')
    cyl(m,.065,.008,(0,0,.578),'MhGilt',10,'record')
    tube(m,[(.30,.13,.58),(.30,-.08,.64),(.05,-.12,.61)],.012,'Chrome',6)
    node(m,'speaker','speaker')
    add(m,S.lathe([(.045,0),(.06,.12),(.12,.26),(.30,.48)],12,base=(0,.16,.65),rot=(45,0,0),cap_bottom=False,cap_top=False),'Brass','speaker')
    add(m,S.torus(.30,.015,12,5,loc=(0,-.18,.99),rot=(45,0,0)),'MhGilt','speaker')
    tube(m,[(.36,0,.32),(.46,0,.32),(.46,0,.42)],.012,'Brass',6)
    contact(m,'listen',(0,-.7,0))

@builder('table_billiards')
def billiards(m,s):
    palette(m)
    for x in (-1.14,1.14):
        for y in (-.70,.70):
            leg(m,x,y,.73,'MhMarble')
            skull(m,.065,(x,y,.15),'MhMarble',n=6)
    box(m,(2.84,1.84,.17),(0,0,.73))
    box(m,(2.53,1.53,.026),(0,0,.90),'Paint')
    for x in (-1.38,1.38):box(m,(.16,1.8,.07),(x,0,.88),'MhGilt')
    for y in (-.86,.86):box(m,(2.7,.16,.07),(0,y,.88),'MhGilt')
    for x in (-1.2,0,1.2):
        for y in (-.68,.68):cyl(m,.072,.01,(x,y,.927),'MhInk',10)
    for i,(x,y) in enumerate(((-.56,0),(.38,0),(.47,.07),(.47,-.07))):
        ball(m,.036,(x,y,.963),'MhMarble',n=8)
        if i:box(m,(.023,.01,.012),(x,y-.032,.964),'MhInk',b=0)
    tube(m,[(-1.1,.43,.947),(.8,.53,.947)],.011,'WoodLight',6)
    for i,(x,y) in enumerate(((0,-1.25),(0,1.25),(-1.75,0),(1.75,0))):contact(m,f'play_{i}',(x,y,0))

@builder('armoire_gilded')
def armoire(m,s):
    palette(m)
    box(m,(.90,.78,.1),(0,0,0),'Paint')
    box(m,(.90,.14,1.84),(0,.31,.1),'Paint')
    for x in (-.40,.40):box(m,(.1,.68,1.85),(x,0,.1),'Paint')
    for z in (.11,1.91):box(m,(.93,.80,.09),(0,0,z),'MhGilt')
    add(m,S.prism([(-.46,0),(.46,0),(.3,.12),(0,.20),(-.3,.12)],.73,.01,1,loc=(0,0,1.9)),'MhGilt')
    node(m,'door','door',origin=(-.37,-.36,.12),hingeAxis='Y')
    box(m,(.73,.05,1.75),(0,-.36,.15),'Paint','door')
    box(m,(.57,.008,1.5),(0,-.393,.27),'Chrome','door',b=0)
    frame(m,.61,1.55,(0,-.40,1.03),'MhGilt','door')
    ball(m,.025,(.28,-.43,1.0),'Brass',part='door',n=8)
    contact(m,'change',(0,-.75,0))

@builder('telescope_brass')
def telescope(m,s):
    palette(m)
    for a in (30,150,270):
        r=math.radians(a);x=.40*math.cos(r);y=.40*math.sin(r)
        tube(m,[(x,y,.025),(0,0,1.12)],.033,'MhWalnut',8)
        # Flat brass shoes meet the ground; sloping tube end rings alone float.
        cyl(m,.045,.035,(x,y,0),'Brass',8)
    cyl(m,.07,.15,(0,0,1.08),'Brass',10)
    tube(m,[(-.32,0,1.2),(.35,0,1.55)],.095,'Brass',12)
    tube(m,[(-.44,0,1.14),(-.31,0,1.2)],.035,'MhInk',8)
    ball(m,.10,(.35,0,1.55),'Glass',scale=(.3,1,1),n=10)
    box(m,(.22,.015,.18),(.05,-.06,.86),'Paper',rot=(10,0,0))
    for x,z in ((.02,.9),(.09,.97),(-.02,.99)):ball(m,.01,(x,-.075,z),'MhInk',n=6)
    contact(m,'look',(-.65,0,0))

@builder('table_tea')
def tea(m,s):
    palette(m)
    cyl(m,.24,.08,(0,0,0),'MhWalnut')
    add(m,S.lathe([(.12,0),(.065,.15),(.055,.52),(.12,.65)],10,base=(0,0,.08)),'MhWalnut')
    cyl(m,.46,.06,(0,0,.73),'Paper',20)
    for i in range(16):
        a=math.tau*i/16;cyl(m,.045,.016,(.42*math.cos(a),.42*math.sin(a),.737),'Paper',8)
    cyl(m,.13,.018,(0,0,.79),'Porcelain')
    cyl(m,.012,.22,(0,0,.808),'Brass',8)
    for z,r in ((.93,.11),(1.07,.09)):
        cyl(m,r,.018,(0,0,z),'Porcelain')
        for x in (-.05,.05):box(m,(.055,.05,.04),(x,0,z+.018),'MhPlum',b=.005)
    surface(m,'tea_surface',(.25,0,.79),radius=.16)
