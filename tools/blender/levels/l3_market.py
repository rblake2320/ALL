"""Brain Bank pantry and market fixtures: readable silhouettes and original lettering."""
from common import shapes as S
from .kit import builder, add, node
from .l3_common import palette, box, cyl, tube, text, sign, legs, counter, bottle, book, seat, lamp, flower, contacts

@builder('counter_pantry')
def pantry(m,s):
    palette(m); counter(m,2.85,.82,.93)
    sign(m,'BRAIN BANK',1.6,.24,(0,-.43,.59))
    text(m,'TAKE ONE - LEAVE A SMILE',.075,(0,-.447,.35))
    for x in (-.95,-.55,.7,1.0):
        for z in (.93,1.04):
            box(m,(.28,.28,.10),(x,.04,z),'Paper',b=.006)
            box(m,(.1,.29,.012),(x,.04,z+.095),'RRTeal',b=0)
    contacts(m,'serve',[(0,-.62,.93)]); contacts(m,'staff',[(0,.65,0)])

@builder('shelf_pantry','shelf_grocery','shelf_library')
def shelves(m,s):
    palette(m)
    library=s.id=='shelf_library'; grocery=s.id=='shelf_grocery'
    h=s.height; mat='WoodEbony' if library else 'Galvanised'
    for x in (-1.39,1.39): box(m,(.10,.75,h),(x,0,0),mat)
    box(m,(2.8,.06,h),(0,0 if grocery else .33,0),mat)
    levels=(.1,.64,1.18,1.82) if library else (.12,.62,1.12,1.6 if grocery else 1.78)
    for z in levels: box(m,(2.85,.78,.055),(0,0,z),mat)
    for row,z in enumerate(levels[:-1]):
        for col in range(9 if library else 7):
            x=-1.22+col*(.30 if library else .39)
            if library:
                book(m,x,-.02,z+.055,.18,.30+.06*((col+row)%3),('RRBook','RRFabric','RRBlue')[col%3],(-3,0,4)[col%3])
            elif grocery and col%3==0:
                # Twin-lobed brain loaves on a shallow tray.
                box(m,(.31,.27,.015),(x,-.20,z+.055),'WoodLight',b=0)
                for dx in (-.055,.055): add(m,S.sphere(.07,8,4,loc=(x+dx,-.20,z+.12),scale=(.8,1.5,.8)),'RRPink')
            elif (col+row)%3:
                cy=-.20 if grocery else -.08
                cyl(m,.09,.22,(x,cy,z+.055),('TinRed','RRTeal','Brass')[col%3],8)
                box(m,(.13,.01,.09),(x,cy-.095,z+.105),'Paper',b=0)
            else:
                cy=-.20 if grocery else -.04
                box(m,(.23,.26,.29),(x,cy,z+.055),'Paper',b=.005)
                box(m,(.18,.012,.12),(x,cy-.137,z+.14),'RRPink',b=0)
        if grocery:
            for x in (-.92,0,.92):
                box(m,(.60,.25,.09),(x,.20,z+.055),'WoodLight',b=0)
                for dx in (-.17,0,.17): box(m,(.10,.18,.13),(x+dx,.20,z+.13),'LeatherDark',b=0)
    if grocery:
        node(m,'brand','brand',brandSlot='brain_bran',surface='shelfEndcap')
        sign(m,'BRAIN BRAN',.75,.20,(.92,-.405,1.45),node_name='brand')
        contacts(m,'browse_back',[(x,.65,0) for x in (-1,0,1)])
    if library:
        # Fixed rail + rolling ladder; intentionally narrow so browsing slots remain clear.
        tube(m,[(-1.4,-.43,1.78),(1.4,-.43,1.78)],.025,'Brass')
        for x in (.78,1.12): tube(m,[(x,-.49,.03),(x,-.36,1.88)],.025,'WoodLight')
        for k in range(6): box(m,(.38,.07,.035),(.95,-.48+k*.018,.15+k*.27),'WoodLight')
    contacts(m,'browse',[(x,-.65,0) for x in (-1,0,1)])

@builder('bin_donation')
def donation(m,s):
    palette(m)
    box(m,(.78,.72,1),(0,0,0),'Wood',b=.018)
    box(m,(.84,.78,.08),(0,0,1),'WoodDark',b=.02)
    box(m,(.4,.012,.075),(0,-.368,.86),'RRInk',b=0)
    # Stitched heart relief, not a borrowed logo.
    pts=[(0,-.20),(-.18,-.02),(-.20,.1),(-.12,.18),(0,.08),(.12,.18),(.2,.1),(.18,-.02)]
    add(m,S.prism(pts,.012,0,0,plane='XZ',loc=(0,-.37,.49)),'RRPink')
    for k in range(4): tube(m,[(-.025,-.389,.39+k*.045),(.025,-.389,.42+k*.045)],.006,'Paper',3)

@builder('crate_supplies')
def crate(m,s):
    palette(m)
    for x in (-.39,.39):
        for y in (-.39,.39): box(m,(.07,.07,.7),(x,y,0),'WoodDark',b=0)
    for z in (.05,.34,.64):
        for y in (-.4,.4): box(m,(.84,.045,.13),(0,y,z),'WoodLight',b=0)
        for x in (-.4,.4): box(m,(.045,.8,.13),(x,0,z),'Wood',b=0)
    box(m,(.8,.8,.03),(0,0,.01),'Wood',b=0)
    text(m,'PERISHABLE',.075,(0,-.426,.44),'RRInk')
    text(m,'UNLIKE US',.06,(0,-.426,.24),'RRInk')

@builder('counter_checkout','counter_curio','counter_loan','counter_reception')
def desks(m,s):
    palette(m); counter(m,1.84,.82,.93)
    if s.id=='counter_checkout':
        box(m,(.43,.32,.2),(.36,.02,.93),'Brass',b=.025)
        box(m,(.4,.18,.12),(.36,.12,1.1),'Brass',b=.015)
        box(m,(.3,.01,.07),(.36,.025,1.13),'RRInk',b=0)
        text(m,'00.00',.06,(.36,.018,1.15),'Paper')
        for i in range(6): cyl(m,.018,.012,(.21+i*.06,-.08,1.14),'RRTrim',6)
    elif s.id=='counter_curio':
        box(m,(1.65,.65,.19),(0,0,.94),'RRGlass')
        bone,socket=S.skull(.07,loc=(-.5,-.12,1.03),segs=8)
        add(m,bone,'StoneLight'); add(m,socket,'RRInk')
        bottle(m,-.12,-.08,.94,'RRTeal')
        tube(m,[(.57,.05,.94),(.57,.05,1.2)],.018,'Brass')
        tube(m,[(.36,.05,1.16),(.78,.05,1.16)],.012,'Brass')
        for x in (.38,.76): cyl(m,.08,.018,(x,.05,1.02),'Brass',10)
    elif s.id=='counter_loan':
        for z in (.93,1.0,1.07): box(m,(.33,.26,.06),(-.5,.08,z),'RRBook')
        sign(m,'SHHH',.46,.2,(.4,-.02,1.06))
        cyl(m,.035,.13,(.03,-.18,.93),'WoodDark',8)
    else:
        box(m,(.38,.28,.035),(-.3,-.05,.93),'Paper')
        cyl(m,.07,.03,(.55,-.14,.93),'Brass',12)
        add(m,S.sphere(.06,10,5,loc=(.55,-.14,.99),scale=(1,1,.65)),'Brass')
        cyl(m,.012,.035,(.55,-.14,1.02),'Iron',6)
    contacts(m,'counter',[(0,-.65,.93)]); contacts(m,'staff',[(0,.65,0)])

@builder('stall_fish')
def fish_stall(m,s):
    palette(m); legs(m,1.8,.8,.7)
    box(m,(1.85,.85,.20),(0,0,.65),'WoodDark')
    box(m,(1.7,.72,.07),(0,0,.85),'RRIce',b=.015)
    for i,x in enumerate((-.55,0,.55)):
        add(m,S.sphere(.13,8,5,loc=(x,-.05,.98),scale=(1.5,.65,.55)),('RRTeal','RRBlue','Tin')[i])
        add(m,S.prism([(-.06,0),(.06,.10),(.06,-.10)],.025,0,0,plane='XY',loc=(x+.2,-.05,.98)),'RRTeal')
        add(m,S.ico(.012,1,loc=(x-.12,-.12,1.01)),'RRInk')
    sign(m,'TODAY  8 / 12 / 16',1.15,.25,(0,.30,1.2))
    for x in (-.45,.45): tube(m,[(x,.30,.9),(x,.30,1.1)],.013,'WoodDark',5)

@builder('stall_flowers')
def flowers(m,s):
    palette(m); legs(m,1.8,.7,.5)
    box(m,(1.85,.75,.06),(0,0,.47),'WoodLight')
    for i,x in enumerate((-.65,0,.65)):
        add(m,S.cylinder(.15,.3,10,0,r_top=.19,base=(x,0,.53)),'Galvanised')
        for k in range(3): flower(m,x+(k%2-.5)*.16,(k//2-.5)*.15,.7,('RRInk','RRPink','Paper')[i],.45+.05*(k%2))
    sign(m,'FRESHLY WILTED',1.3,.18,(0,-.39,.3))

@builder('display_showroom')
def showroom(m,s):
    palette(m); box(m,(2.8,1.8,.1),(0,0,0),'WoodDark')
    box(m,(1.6,1.2,.015),(-.2,0,.1),'RRFabric',b=0)
    # The display chair is purpose-built showroom dressing, not a new catalogue alias.
    add(m,S.cushion(.75,.65,.22,loc=(-.55,.1,.42),segs=10,rings=5),'RRTeal')
    box(m,(.75,.17,.65),(-.55,.34,.45),'RRTeal',b=.04)
    for x in (-.95,-.15): box(m,(.15,.7,.45),(x,.07,.26),'RRTeal',b=.03)
    cyl(m,.15,.04,(.9,.22,.1),'Brass',12); cyl(m,.025,1.25,(.9,.22,.14),'Brass',8)
    add(m,S.cylinder(.32,.35,12,0,r_top=.18,base=(.9,.22,1.27)),'Paper')
    sign(m,'DELIVERY TO ANY TOMB',1.8,.22,(0,-.83,.26))

@builder('fridge_rotpop')
def fridge(m,s):
    palette(m)
    # Real open cavity: a solid cabinet box would hide bottles behind the glass door.
    box(m,(.82,.08,1.9),(0,.38,0),'Paint',b=0)
    for x in (-.375,.375): box(m,(.07,.70,1.90),(x,.03,0),'Paint',b=.012)
    for z in (0,1.55): box(m,(.70,.70,.16 if z==0 else .35),(0,.03,z),'Paint',b=.012)
    box(m,(.68,.012,1.40),(0,.333,.16),'RRInk',b=0)
    for z in (.26,.88):
        box(m,(.65,.55,.035),(0,-.02,z),'Chrome')
        for i,x in enumerate((-.22,0,.22)): bottle(m,x,-.11,z+.035,('RRTeal','RRPink','RRBlue')[i])
    node(m,'door','door',origin=(-.36,-.35,.2),axis='Y',swingDegrees=100)
    box(m,(.72,.018,1.44),(0,-.35,.16),'RRGlass','door',b=0)
    for x in (-.36,.36): box(m,(.035,.035,1.46),(x,-.37,.15),'Chrome','door')
    tube(m,[(.27,-.405,.68),(.27,-.405,1.18)],.018,'Chrome',6,'door')
    node(m,'glow','glow'); box(m,(.62,.02,.15),(0,-.34,1.64),'RRNeonPink','glow')
    node(m,'brand','brand',brandSlot='rot_pop',surface='fridgeHeader')
    text(m,'ROT-POP',.12,(0,-.358,1.68),'Paper','brand')
