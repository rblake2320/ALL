"""Rot Row skyline and street furniture; buildings are exterior set dressing."""
from common import shapes as S
from .kit import builder, add, node
from .l3_common import palette, box, cyl, tube, text, sign


def window(m,x,y,z,w=.8,h=1.35,detailed=True):
    box(m,(w+.18,.12,h+.18),(x,y,z-.09),'RRTrim',b=.015 if detailed else 0)
    box(m,(w,.03,h),(x,y-.075,z),'RRInk',b=.008 if detailed else 0)
    box(m,(w-.10,.012,h-.10),(x,y-.094,z+.05),'RRBlue',b=0)
    box(m,(.045,.025,h),(x,y-.11,z),'RRTrim',b=0)
    box(m,(w,.025,.045),(x,y-.11,z+h*.56),'RRTrim',b=0)
    box(m,(w+.23,.25,.09),(x,y-.08,z-.09),'StoneLight',b=.01 if detailed else 0)


@builder('env_shopfront_a','env_shopfront_b','env_brick_block')
def building(m,s):
    palette(m)
    block=s.id=='env_brick_block'; cafe=s.id=='env_shopfront_b'
    w=s.w-.15; d=s.d-.35; h=s.height; front=-d/2
    node(m,'exterior',exteriorOnly=True,interiorPlayable=False)
    box(m,(w,d,h-.16),(0,0,0),'RRBrickDark' if block else 'RRBrick','exterior',b=.045)
    box(m,(w+.12,d+.12,.18),(0,0,h-.18),'RRTrim','exterior',b=.025)
    box(m,(w-.18,d-.18,.025),(0,0,h),'RRInk','exterior',b=0)
    box(m,(w+.08,.16,.30),(0,front-.03,0),'StoneLight','exterior')
    # Brick courses are relief accents; full per-brick geometry would waste the skyline budget.
    for row in range(int(h/.44)):
        z=.35+row*.44
        box(m,(w,.008,.012),(0,front-.009,z),'RRBrickDark',b=0)
        for k in range(0 if block else int(w/.6)):
            x=-w/2+.3+k*.6+(.25 if row%2 else 0)
            if x<w/2-.1: box(m,(.012,.008,.14),(x,front-.012,z+.08),'RRBrickDark',b=0)
    if block:
        for z in (.75,3.05,5.35,7.65):
            for x in (-2.1,-.7,.7,2.1): window(m,x,front-.03,z,.75,1.5,False)
        # Side-wall window rhythm makes the corner block read from isometric views.
        for z in (1.0,3.3,5.6,7.9):
            for y in (-.9,.6): box(m,(.03,.7,1.35),(w/2+.01,y,z),'RRBlue',b=.008)
    else:
        for x in ((-.8,.8) if cafe else (-1.65,0,1.65)):
            window(m,x,front-.04,3.45,.65 if cafe else .90,1.55)
        if cafe:
            window(m,-.61,front-.04,.35,.98,1.6)
            doorx=.65; label='COLD BREW'
        else:
            for x in (-1.53,1.53): window(m,x,front-.04,.35,1.38,1.65)
            doorx=0; label='ROT ROW MARKET'
        box(m,(.85,.10,2.05),(doorx,front-.10,0),'WoodDark',b=.02)
        box(m,(.62,.025,1.25),(doorx,front-.16,.63),'RRBlue',b=.008)
        tube(m,[(doorx+.27,front-.20,.85),(doorx+.27,front-.20,1.12)],.018,'Brass',6)
        sign(m,label,w-.22,.36,(0,front-.14,2.40),'RRTeal' if cafe else 'WoodDark')
        # Sloped striped awning with a scalloped-looking segmented valance.
        span=w-.25; bands=8 if cafe else 12
        for k in range(bands):
            x=-span/2+(k+.5)*span/bands
            box(m,(span/bands,.60,.045),(x,front-.28,2.12),'RRTrim' if k%2 else 'RRFabric',b=.004,rot=(15,0,0))
            box(m,(span/bands,.045,.16),(x,front-.58,2.00),'RRTrim' if k%2 else 'RRFabric',b=.01)
        for x in (-span/2,span/2): tube(m,[(x,front-.05,1.86),(x,front-.57,2.1)],.02,'Iron',6)
        # Parapet panels, cornice and an off-centre rain pipe avoid toy-box silhouettes.
        box(m,(w,.10,.13),(0,front-.08,5.42),'RRTrim')
        for x in (-w*.3,0,w*.3): box(m,(w*.23,.035,.32),(x,front-.07,5.72),'RRBrickDark')
    tube(m,[(w/2-.06,front-.10,.03),(w/2-.06,front-.10,h-.5),(w/2-.22,front-.10,h-.35)],.04,'Iron',8)


@builder('env_tram_stop')
def tram(m,s):
    palette(m)
    for x in (-1.32,1.32):
        for y in (-.64,.64): cyl(m,.035,2.43,(x,y,0),'Iron',8)
    box(m,(2.88,1.62,.14),(0,0,2.43),'RRTeal',b=.06)
    box(m,(2.8,.02,1.86),(0,.65,.42),'RRGlass',b=0)
    for y in (-.5,.5): tube(m,[(-1.3,y,2.42),(1.3,y,2.42)],.025,'Chrome',6)
    for x in (-.9,.1):
        for y in (.05,.45): box(m,(.05,.05,.44),(x,y,0),'Iron')
    for y in (.06,.22,.38): box(m,(1.55,.14,.045),(-.4,y,.44),'WoodLight')
    node(m,'ad_panel','ad_panel',brandSlot='rot_pop',surface='tramStop',replaceable=True)
    box(m,(.63,.08,1.50),(.90,.55,.60),'RRInk','ad_panel',b=.015)
    text(m,'ROT-POP',.09,(.9,.502,1.75),'RRTrim','ad_panel')
    text(m,'STAY',.11,(.9,.502,1.47),'RRTeal','ad_panel')
    text(m,'FIZZY',.11,(.9,.502,1.28),'RRPink','ad_panel')
    sign(m,'ROT ROW / 03',1.3,.14,(-.5,-.82,2.47),'RRInk')


@builder('env_neon_sign')
def street_neon(m,s):
    palette(m)
    box(m,(1.40,.12,.62),(0,0,0),'Iron',b=.025)
    node(m,'glow','glow'); text(m,'ROT ROW',.20,(0,-.068,.23),'RRNeonPink','glow')
    for x in (-.65,.65): tube(m,[(x,.06,.12),(x,.13,.12),(x,.13,.57)],.012,'Chrome',5)


@builder('display_cryptkicks')
def kicks(m,s):
    palette(m)
    box(m,(.92,.045,1.2),(0,-.0225,.9),'WoodEbony',b=.012)
    for z in (1.02,1.39,1.76):
        box(m,(.86,.23,.035),(0,-.115,z),'Chrome',b=.005)
        for x in (-.22,.22):
            box(m,(.15,.19,.035),(x,-.13,z+.035),'RRTrim',b=.012)
            box(m,(.13,.15,.075),(x,-.115,z+.065),'RRFabric' if z<1.5 else 'RRTeal',b=.025)
            for y in (-.13,-.09): box(m,(.08,.014,.006),(x,y,z+.141),'Paper',b=0)
    node(m,'brand','brand',brandSlot='cryptkicks',surface='shoeDisplay')
    text(m,'CRYPTKICKS',.074,(0,-.057,1.99),'RRTrim','brand')


@builder('env_rooftop_billboard')
def billboard(m,s):
    palette(m)
    for x in (-1.5,1.5):
        box(m,(.14,.60,.10),(x,0,0),'Iron')
        tube(m,[(x,.20,.05),(x,.20,2.86)],.045,'Iron',8)
        tube(m,[(x,.28,.05),(x,-.20,1.16)],.027,'Iron',6)
    box(m,(3.85,.15,1.80),(0,0,1.15),'Chrome',b=.02)
    node(m,'ad_panel','ad_panel',brandSlot='rot_pop',surface='roofBillboard',replaceable=True)
    box(m,(3.66,.018,1.62),(0,-.086,1.24),'RRTeal','ad_panel',b=0)
    text(m,'ROT-POP',.50,(0,-.103,2.13),'RRTrim','ad_panel')
    text(m,'A LITTLE LIFE IN EVERY SIP',.14,(0,-.103,1.63),'RRTrim','ad_panel')
    for x in (-1.1,1.1):
        tube(m,[(x,.04,2.94),(x,-.32,2.94),(x,-.39,2.83)],.016,'Iron',6)
        box(m,(.20,.10,.06),(x,-.39,2.78),'RRTrim',b=.01)
