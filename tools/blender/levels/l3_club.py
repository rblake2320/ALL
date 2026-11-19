"""The Rigor Room and Neon Noir: original tonic-bar and music-room dressing."""
import math
from common import shapes as S
from .kit import builder, add, node
from .l3_common import palette, box, cyl, tube, text, sign, counter, bottle, lamp, contacts


def mirror_skull(m,at,scale=1,part=None):
    x,y,z=at
    bone,socket=S.skull(.18*scale,loc=at,segs=8)
    add(m,bone,'Chrome',part); add(m,socket,'RRInk',part)
    # Raised mirror facets catch individual highlights at game camera distance.
    for a in range(0,360,60):
        r=math.radians(a)
        box(m,(.06*scale,.015*scale,.07*scale),(x+.14*scale*math.sin(r),y-.14*scale*math.cos(r),z+.11*scale),
            'Chrome',part,b=0,rot=(0,0,a))


@builder('booth_dj')
def dj(m,s):
    palette(m)
    coffin=[(-.72,-.4),(.72,-.4),(.92,-.23),(.92,.22),(.6,.4),(-.6,.4),(-.92,.22),(-.92,-.23)]
    for z in (0,.34,.68):
        add(m,S.prism(coffin,.30,.015,1,loc=(0,0,z),plane='XY'),'Paint')
        for x in (-.80,.80): box(m,(.1,.02,.10),(x,-.32,z+.11),'Brass')
    box(m,(1.8,.79,.05),(0,0,.98),'WoodEbony')
    for x,n in ((-.53,'platter_L'),(.53,'platter_R')):
        node(m,n,n,origin=(x,0,1.03),spinAxis='Y')
        cyl(m,.235,.025,(x,0,1.03),'Rubber',20,n)
        cyl(m,.07,.008,(x,0,1.055),'RRPink',10,n)
        tube(m,[(x+.22,.2,1.04),(x+.18,.22,1.08),(x+.05,.04,1.08)],.012,'Chrome',5)
    box(m,(.30,.5,.07),(0,0,1.03),'Iron')
    for x in (-.08,0,.08):
        box(m,(.012,.25,.005),(x,0,1.10),'Chrome',b=0)
        box(m,(.04,.04,.02),(x,-.08+x,1.11),'RRTrim')
    for x in (-.88,.88): tube(m,[(x,.25,.98),(x,.25,2.02)],.025,'Chrome',6)
    tube(m,[(-.88,.25,2.02),(.88,.25,2.02)],.025,'Chrome',6)
    tube(m,[(0,.25,2.02),(0,.25,1.78)],.012,'Chrome',5)
    mirror_skull(m,(0,.25,1.53),.85)
    node(m,'glow','glow')
    box(m,(1.35,.012,.04),(0,-.405,.78),'RRNeonPink','glow',b=0)
    text(m,'RIGOR ROOM',.14,(0,-.41,.40),'RRTrim')
    contacts(m,'spin',[(0,.68,0)])


@builder('bar_counter')
def bar(m,s):
    palette(m); counter(m,3.75,.60,.99,'WoodEbony')
    for bm,_ in m.nodes[m.body].parts:
        for v in bm.verts: v.co.y+=.16
    # Stools are inside the declared 4x1 footprint, along the front apron.
    for x in (-1.32,-.44,.44,1.32):
        cyl(m,.16,.035,(x,-.36,0),'Brass',10)
        cyl(m,.025,.61,(x,-.36,.035),'Brass',8)
        cyl(m,.16,.07,(x,-.36,.645),'RRFabric',12)
    for i,x in enumerate((-1.55,-1.22,.98,1.28,1.57)):
        bottle(m,x,.12,.99,('RRTeal','RRPink','RRBlue')[i%3])
    node(m,'menu','menu',surface='tonicMenu')
    sign(m,'TONICS',.75,.25,(0,.17,1.16),'RRInk','menu')
    text(m,'NO BOOZE. ALL BOOS.',.09,(0,-.36,.42),'RRTrim')
    contacts(m,'order',[(x,-.66,0) for x in (-1.4,-.47,.47,1.4)])
    contacts(m,'staff',[(0,.65,0)])


@builder('stage_small')
def stage(m,s):
    palette(m)
    box(m,(2.85,1.85,.23),(0,0,0),'WoodDark',b=.02)
    for x in [i*.27 for i in range(-5,6)]: box(m,(.008,1.75,.003),(x,0,.232),'RRInk',b=0)
    for x in (-1.32,1.32): tube(m,[(x,.77,.23),(x,.77,2.06)],.035,'Iron',8)
    tube(m,[(-1.35,.77,2.06),(1.35,.77,2.06)],.035,'Iron',8)
    for x in (-1.18,-.98,-.78,.78,.98,1.18):
        # Separate pleats leave the central performer silhouette clear.
        add(m,S.prism([(-.12,.03),(0,0),(.12,.03)],1.62,0,0,loc=(x,.72,.38),plane='XY'),'RRFabric')
        box(m,(.18,.035,.05),(x,.70,.65),'Brass')
    cyl(m,.16,.025,(0,-.25,.23),'Iron',12)
    tube(m,[(0,-.25,.25),(0,-.25,1.55),(.12,-.30,1.62)],.018,'Chrome',6)
    add(m,S.sphere(.045,10,6,loc=(.12,-.30,1.64),scale=(1,1,1.4)),'Iron')
    tube(m,[(.12,-.3,1.62),(.08,-.26,.35),(.45,-.4,.25),(.83,.1,.25)],.008,'Rubber',4)
    sign(m,'OPEN MIC',1.04,.17,(0,-.937,.12))
    contacts(m,'perform',[(0,.08,.24)])


@builder('booth_velvet')
def booth(m,s):
    palette(m)
    box(m,(1.78,.76,.22),(0,0,0),'WoodEbony',b=.03)
    for x in (-.45,.45): add(m,S.cushion(.84,.65,.18,loc=(x,-.04,.36),segs=12,rings=6),'Paint')
    box(m,(1.78,.17,.71),(0,.30,.39),'Paint',b=.06)
    for x in (-.86,.86): box(m,(.14,.75,.40),(x,0,.35),'Paint',b=.05)
    for x in (-.6,-.2,.2,.6):
        for z in (.64,.89): add(m,S.ico(.016,1,loc=(x,.207,z)),'Brass')
    contacts(m,'sit',[(-.43,-.1,.45),(.43,-.1,.45)])


@builder('floor_dance_lit')
def dance_tile(m,s):
    palette(m); box(m,(.99,.99,.028),(0,0,0),'Iron',b=.003)
    node(m,'glow','glow',emissiveAnimation='musicBeat')
    for x in (-.25,.25):
        for y in (-.25,.25): box(m,(.46,.46,.007),(x,y,.028),'RRNeonPink' if x*y>0 else 'RRNeonTeal','glow',b=0)


@builder('sign_neonCustom')
def neon(m,s):
    palette(m); node(m,'sign','sign',curatedText='STILL HERE')
    box(m,(.94,.05,.46),(0,-.025,1.27),'Paint','sign',b=.025)
    box(m,(.87,.012,.38),(0,-.056,1.31),'RRInk','sign',b=.02)
    node(m,'glow','glow'); text(m,'STILL',.14,(0,-.071,1.53),'RRNeonPink','glow')
    text(m,'HERE',.14,(0,-.071,1.39),'RRNeonPink','glow')


@builder('ball_mirrorSkull')
def skull_ball(m,s):
    palette(m)
    mirror_skull(m,(0,0,.277),1.45)
    # Lowest skull/chin meets local zero; ceiling anchor is explicitly at the top.
    cyl(m,.10,.025,(0,0,1.175),'Paint',12)
    tube(m,[(0,0,.67),(0,0,1.18)],.012,'Chrome',6)
    node(m,'ceiling_mount',origin=(0,0,1.2),mount='ceiling')
    node(m,'glow','glow'); cyl(m,.055,.025,(0,0,1.14),'RRNeonPink',10,'glow')


@builder('jukebox_ghoul')
def jukebox(m,s):
    from .l3_meshy_jukebox import build
    build(m,s)


def authored_jukebox(m,s):
    """Parked original; retained for review, not used by the published builder."""
    palette(m)
    outline=[(-.41,0),(.41,0),(.41,1.20),(.35,1.43),(.19,1.59),(0,1.65),(-.19,1.59),(-.35,1.43),(-.41,1.20)]
    add(m,S.prism(outline,.48,.015,1,plane='XZ',loc=(0,.24,0)),'Paint')
    box(m,(.64,.025,.74),(0,-.255,.16),'RRInk',b=.025)
    for x in [i*.065 for i in range(-4,5)]: box(m,(.024,.018,.60),(x,-.278,.23),'Brass',b=.005)
    node(m,'glow','glow')
    arc=[(.32*math.cos(a),-.28,1.2+.32*math.sin(a)) for a in [k*math.pi/12 for k in range(13)]]
    tube(m,[(-.32,-.28,.15),(-.32,-.28,1.2)]+list(reversed(arc))+[(.32,-.28,.15)],.022,'RRNeonPink',6,'glow')
    box(m,(.44,.02,.22),(0,-.28,1.01),'RRTrim')
    text(m,'DEAD AIR',.08,(0,-.297,1.1),'RRInk')
    for x in (-.15,-.05,.05,.15): box(m,(.05,.04,.035),(x,-.30,.95),'Chrome')


@builder('lamp_bankerGreen')
def banker(m,s):
    palette(m); lamp(m,0,0,0,1.45,'Paint')


@builder('rug_checkerboard')
def rug(m,s):
    palette(m); box(m,(1.90,2.90,.02),(0,0,0),'Paint',b=.004)
    for x in range(4):
        for y in range(6):
            if (x+y)%2==0: box(m,(.45,.45,.005),(-.675+x*.45,-1.125+y*.45,.02),'RRInk',b=0)


@builder('stool_barChrome')
def stool(m,s):
    palette(m); cyl(m,.27,.035,(0,0,0),'Chrome',16)
    cyl(m,.04,.59,(0,0,.035),'Chrome',10)
    add(m,S.torus(.18,.012,16,5,loc=(0,0,.26)),'Chrome')
    cyl(m,.27,.075,(0,0,.62),'Paint',16)


@builder('poster_gigTattered')
def poster(m,s):
    palette(m)
    outline=[(-.44,1.91),(.44,1.91),(.44,1.18),(.35,1.11),(.29,1.2),(.18,1.12),(-.12,1.14),(-.22,1.11),(-.29,1.2),(-.44,1.16)]
    add(m,S.prism(outline,.008,0,0,plane='XZ',loc=(0,-.003,0)),'Paint')
    text(m,'RIGOR',.16,(0,-.015,1.64),'RRInk')
    text(m,'ROOM',.16,(0,-.015,1.43),'RRFabric')
    text(m,'FRI / SAT',.06,(0,-.015,1.27),'RRInk')
    for x in (-.40,.40): cyl(m,.018,.012,(x,-.013,1.86),'Brass',6,rot=(90,0,0))


@builder('item_mealbox','item_libraryBook','item_bouquet')
def carry(m,s):
    palette(m)
    node(m,'grip',origin=(0,0,.05),attachment='hand')
    if s.id=='item_mealbox':
        box(m,(.24,.17,.09),(0,0,0),'Paper',b=.008)
        box(m,(.25,.18,.025),(0,0,.09),'Paper',b=.004)
        box(m,(.04,.181,.009),(0,0,.112),'RRTeal',b=0)
    elif s.id=='item_libraryBook':
        box(m,(.20,.15,.04),(0,0,0),'RRBook',b=.003)
        box(m,(.18,.145,.024),(.003,-.004,.008),'Paper',b=0)
        box(m,(.018,.15,.04),(-.09,0,0),'RRBook',b=.002)
    else:
        from .l3_common import flower
        add(m,S.cylinder(.018,.23,7,0,r_top=.12,base=(0,0,0)),'Paper')
        for x,y in ((-.06,0),(.04,-.06),(.04,.06)):
            flower(m,x,y,.10,'RRPink' if x<0 else 'Paper',.32)
        tube(m,[(-.035,-.027,.09),(0,-.04,.12),(.035,-.027,.09)],.012,'RRFabric',5)
