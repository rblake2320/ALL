"""Rot Row gym, library, Necro-Tech and salon fixtures."""
import math
from common import shapes as S
from .kit import builder, add, node
from .l3_common import palette, box, cyl, tube, text, sign, legs, seat, lamp, contacts


@builder('treadmill_rattle')
def treadmill(m,s):
    palette(m)
    box(m,(.9,1.82,.15),(0,0,0),'Paint',b=.035)
    node(m,'belt','belt',travelAxis='Z')
    box(m,(.64,1.48,.018),(0,-.02,.15),'Rubber','belt',b=0)
    for y in (-.62,-.38,-.14,.1,.34,.58):
        box(m,(.62,.012,.005),(0,y,.168),'RRInk','belt',b=0)
    for x in (-.40,.40):
        tube(m,[(x,.63,.14),(x,.63,1.13),(x,-.24,.99)],.032,'Chrome',8)
        for y in (-.18,-.12,-.06): box(m,(.08,.035,.075),(x,y,.97),'RRTrim',b=0)
    box(m,(.74,.26,.13),(0,.62,1.08),'Paint',b=.025)
    node(m,'screen','screen')
    box(m,(.34,.014,.085),(-.08,.48,1.12),'RRNeonTeal','screen',b=0)
    text(m,'03:00',.056,(-.08,.469,1.14),'RRInk','screen')
    cyl(m,.037,.018,(.25,.54,1.21),'RRPink',8)
    contacts(m,'run',[(0,-.15,.17)])


@builder('bag_punching')
def punching(m,s):
    palette(m)
    box(m,(.86,.80,.08),(0,0,0),'Iron',b=.02)
    tube(m,[(.31,.29,.08),(.31,.29,2.00),(0,.05,2.00)],.045,'Iron',8)
    tube(m,[(.31,.29,1.7),(0,.05,2.0)],.022,'Chrome',6)
    for x in (-.12,.12): tube(m,[(0,.05,1.98),(x,.01,1.7)],.012,'Chrome',5)
    node(m,'bag','bag',origin=(0,.01,1.75),swingDegrees=12)
    add(m,S.lathe([(0,.62),(.14,.62),(.21,.72),(.21,1.53),(.13,1.68),(0,1.68)],12),'Paint','bag')
    box(m,(.18,.018,.22),(0,-.205,1.03),'LeatherDark','bag',b=.015)
    for z in (1.05,1.12,1.19): tube(m,[(-.07,-.22,z),(.07,-.22,z+.025)],.007,'Paper',4,'bag')
    contacts(m,'hit',[(0,-.55,0)])


@builder('mat_stretch')
def mat(m,s):
    palette(m)
    box(m,(1.75,1.65,.025),(0,-.07,0),'Paint',b=.01)
    # A curled edge has thickness, rather than a flat rectangle pretending to be rolled.
    cyl(m,.042,1.75,(-.875,.75,.045),'Paint',12,rot=(0,90,0))
    for x in (-.67,.67): box(m,(.035,1.45,.003),(x,-.10,.026),'RRTrim',b=0)
    contacts(m,'stretch',[(0,0,.028)])


@builder('bench_locker')
def lockers(m,s):
    palette(m)
    legs(m,1.8,.55,.42)
    for y in (-.29,-.13,.03): box(m,(1.85,.14,.05),(0,y,.42),'Paint',b=.008)
    box(m,(1.86,.28,1.55),(0,.32,0),'RRTeal',b=.01)
    for x in (-.61,0,.61):
        box(m,(.56,.025,1.39),(x,.166,.1),'Galvanised',b=.008)
        box(m,(.035,.025,.13),(x+.19,.142,.77),'Chrome',b=0)
        for z in (1.12,1.19,1.26): box(m,(.28,.008,.016),(x,.148,z),'RRInk',b=0)
    contacts(m,'sit',[(-.5,-.16,.47),(.5,-.16,.47)])


@builder('pool_plunge')
def plunge(m,s):
    palette(m)
    box(m,(2.85,1.85,.08),(0,0,0),'StoneLight')
    for x in (-1.32,1.32): box(m,(.22,1.85,.42),(x,0,.08),'RRTeal',b=.02)
    for y in (-.82,.82): box(m,(2.85,.22,.42),(0,y,.08),'RRTeal',b=.02)
    for x in (-1.32,1.32): box(m,(.26,1.9,.05),(x,0,.45),'Paper',b=.012)
    for y in (-.82,.82): box(m,(2.85,.26,.05),(0,y,.45),'Paper',b=.012)
    for x in [i*.26 for i in range(-5,6)]:
        for y in (-.936,.936): box(m,(.012,.008,.31),(x,y,.10),'RRTrim',b=0)
    node(m,'water','water'); box(m,(2.38,1.38,.02),(0,0,.27),'RRWater','water',b=0)
    node(m,'frost','frost',state='frost',defaultVisible=False)
    for x in (-1.08,1.08): box(m,(.12,1.30,.014),(x,0,.31),'RRIce','frost')
    for x in (-.52,.52): tube(m,[(x,-.82,.12),(x,-.82,.55),(x,-.53,.55),(x,-.53,.23)],.025,'Chrome',8)
    contacts(m,'plunge',[(-.6,0,.20),(.6,0,.20)])


@builder('table_reading')
def reading(m,s):
    palette(m); legs(m,2.7,.75,.72,'WoodDark')
    box(m,(2.85,.85,.07),(0,0,.72),'Paint',b=.018)
    for x in (-.85,.85): lamp(m,x,.17,.79,.95,'RRTeal')
    for x in (-.45,.45):
        box(m,(.32,.29,.035),(x,-.10,.79),'RRBook')
        box(m,(.26,.24,.008),(x,-.10,.824),'Paper',b=0)
    contacts(m,'study',[(-.8,-.65,0),(.8,-.65,0)])


@builder('catalog_cards')
def cards(m,s):
    palette(m); box(m,(.78,.65,1.46),(0,0,0),'WoodDark',b=.012)
    box(m,(.84,.7,.06),(0,0,1.46),'WoodLight')
    for x in (-.19,.19):
        for row in range(6):
            z=.13+row*.215
            box(m,(.35,.035,.19),(x,-.338,z),'Wood',b=0)
            box(m,(.14,.008,.045),(x,-.36,z+.10),'Paper',b=0)
            tube(m,[(x-.05,-.365,z+.055),(x-.05,-.39,z+.055),(x+.05,-.39,z+.055),(x+.05,-.365,z+.055)],.007,'Brass',4)
    contacts(m,'catalog',[(0,-.6,0)])


@builder('bench_lab')
def lab(m,s):
    palette(m); legs(m,1.8,.75,.9,'Galvanised')
    box(m,(1.88,.82,.07),(0,0,.86),'Chrome',b=.02)
    box(m,(1.8,.06,.3),(0,.35,.92),'Galvanised')
    node(m,'glow','glow')
    for x,h in ((-.6,.34),(-.20,.48)):
        add(m,S.lathe([(0,0),(.13,0),(.14,.04),(.07,h*.65),(.04,h*.72),(.04,h),(0,h)],12,base=(x,0,.93)),'RRGlass')
        add(m,S.sphere(.09,10,6,loc=(x,0,1.04),scale=(1,1,.8)),'RRNeonTeal','glow')
        for k in range(3): add(m,S.ico(.015,1,loc=(x+.02*(-1)**k,0,1.12+k*.055)),'RRNeonTeal','glow')
    cyl(m,.19,.48,(.56,0,.93),'RRGlass',12)
    for x in (.49,.62): add(m,S.sphere(.09,10,6,loc=(x,0,1.17),scale=(.85,1.25,1)),'RRPink')
    for z in (.93,1.41): cyl(m,.20,.035,(.56,0,z),'Chrome',12)
    sign(m,'GARY',.28,.12,(.56,-.20,1.13))
    tube(m,[(-.2,.12,1.4),(-.2,.19,1.53),(.18,.19,1.53),(.18,.03,1.2)],.014,'Chrome',6)
    contacts(m,'lab',[(-.55,-.65,0),(.55,-.65,0)])


@builder('server_rack')
def server(m,s):
    palette(m); box(m,(.78,.72,1.95),(0,0,0),'Iron',b=.025)
    node(m,'glow','glow')
    for k in range(7):
        z=.12+k*.25
        box(m,(.67,.022,.20),(0,-.37,z),'Galvanised',b=.004)
        for x in (-.22,-.10,.02): box(m,(.04,.012,.10),(x,-.387,z+.05),'RRInk',b=0)
        for x in (.19,.25): box(m,(.025,.014,.025),(x,-.39,z+.09),'RRNeonTeal','glow',b=0)
    tube(m,[(.30,.37,.2),(.36,.42,.4),(.36,.42,1.65),(.22,.37,1.8)],.024,'Rubber',6)


@builder('pod_nap')
def nap(m,s):
    palette(m)
    outline=[(-.24,-.94),(.24,-.94),(.44,-.45),(.44,.63),(.25,.94),(-.25,.94),(-.44,.63),(-.44,-.45)]
    add(m,S.prism(outline,.45,.018,1,plane='XY'),'Paint')
    box(m,(.63,1.55,.09),(0,0,.45),'RRFabric',b=.035)
    add(m,S.cushion(.55,.35,.12,loc=(0,.57,.56),segs=10,rings=5),'RRTrim')
    # Retracted lid occupies head end; stored travel is along the pod length.
    node(m,'door','door',origin=(0,.7,.6),slideAxis='Z',slideDistance=1.2)
    box(m,(.84,.51,.11),(0,.65,.83),'Paint','door',b=.035)
    for x in (-.4,.4): box(m,(.06,1.75,.42),(x,0,.45),'Paint',b=.02)
    node(m,'glow','glow')
    for x in (-.36,.36): box(m,(.015,1.58,.018),(x,0,.85),'RRNeonTeal','glow',b=0)
    sign(m,'NECRO-NAP',.65,.12,(0,-.94,.29))
    contacts(m,'lie',[(0,0,.55)])


@builder('chair_salon','dryer_hood')
def salon_seat(m,s):
    palette(m); dryer=s.id=='dryer_hood'
    cyl(m,.34,.065,(0,0,0),'Chrome',16); cyl(m,.075,.36,(0,0,.06),'Chrome',10)
    seat(m,.58,.55,.47,'Paint' if dryer else 'LeatherDark',1.0)
    for x in (-.33,.33): tube(m,[(x,-.22,.45),(x,-.22,.69),(x,.22,.69),(x,.22,.46)],.025,'Chrome',8)
    box(m,(.48,.26,.035),(0,-.36,.19),'Rubber')
    tube(m,[(.07,0,.13),(.30,-.26,.13),(.35,-.32,.20)],.018,'Chrome',6)
    if dryer:
        tube(m,[(0,.26,.15),(0,.36,1.47),(0,.12,1.47)],.03,'Chrome',8)
        # Hollow bonnet: two joined rings, open toward the seated head.
        add(m,S.lathe([(.30,0),(.30,.10),(.26,.27),(.14,.36),(0,.37),(0,.34),(.12,.33),(.23,.25),(.27,.09),(.27,0)],16,base=(0,.08,1.24)),'Paint')
    else:
        box(m,(.32,.12,.16),(0,.23,1.0),'LeatherDark',b=.035)
    contacts(m,'sit',[(0,0,.52)]); contacts(m,'stylist',[(.65,0,0)])


@builder('station_waxpreserve')
def wax(m,s):
    palette(m); legs(m,.65,1.65,.68,'Chrome')
    add(m,S.cushion(.75,1.68,.16,loc=(0,0,.72),segs=12,rings=6),'RRTrim')
    box(m,(.28,.36,.045),(.29,.65,.61),'Chrome')
    cyl(m,.12,.17,(.29,.65,.65),'Brass',12)
    node(m,'glow','glow'); cyl(m,.10,.014,(.29,.65,.82),'RRWax',12,'glow')
    for z in (.80,.85): box(m,(.48,.27,.04),(0,-.57,z),'Paper',b=.014)
    contacts(m,'lie',[(0,0,.79)]); contacts(m,'work',[(.7,0,0)])
