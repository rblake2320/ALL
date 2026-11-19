"""Rot Row forms/palette. Small authored details share the established exporter."""
import math
from common import shapes as S
from common.materials import MatSpec
from .kit import add, node, flat_text, quad

LOOKS={
 'RRBrick':MatSpec('#784d45',roughness=.9), 'RRBrickDark':MatSpec('#513b3b',roughness=.92),
 'RRTrim':MatSpec('#c6b69a',roughness=.8), 'RRInk':MatSpec('#242331',roughness=.78),
 'RRTeal':MatSpec('#448e85',roughness=.55), 'RRPink':MatSpec('#b35b80',roughness=.6),
 'RRGlass':MatSpec('#8aabb0',roughness=.14,alpha=.3,double_sided=True),
 'RRNeonPink':MatSpec('#c25a8a',roughness=.35,emission='#c25a8a',strength=4.5),
 'RRNeonTeal':MatSpec('#55d6be',roughness=.35,emission='#55d6be',strength=3),
 'RRNeonWarm':MatSpec('#ffb35a',roughness=.35,emission='#ffb35a',strength=3),
 'RRWater':MatSpec('#4d9185',roughness=.12,alpha=.75,double_sided=True),
 'RRWax':MatSpec('#d6c39d',roughness=.45,emission='#ffb35a',strength=2.2),
 'RRFabric':MatSpec('#6d2d45',roughness=.94), 'RRBook':MatSpec('#566b65',roughness=.82),
 'RRBlue':MatSpec('#586d8c',roughness=.8), 'RRIce':MatSpec('#adc9ce',roughness=.22),
}

def palette(m):
    for n,s in LOOKS.items(): m.mats.custom(n,s)

def box(m,size,base,mat='WoodDark',node_name=None,b=.008,rot=(0,0,0)):
    add(m,S.box(*size,b,1,base=base,rot=rot),mat,node_name)

def cyl(m,r,h,base,mat='Chrome',n=10,node_name=None,rot=(0,0,0)):
    add(m,S.cylinder(r,h,n,0,base=base,rot=rot),mat,node_name)

def tube(m,pts,r=.015,mat='Iron',n=5,node_name=None):
    add(m,S.tube(pts,r,n),mat,node_name)

def text(m,label,size,at,mat='RRTrim',node_name=None):
    add(m,flat_text(label,size,at),mat,node_name)

def sign(m,label,w,h,at,mat='RRInk',node_name=None):
    x,y,z=at
    box(m,(w,.025,h),(x,y,z-h/2),mat,node_name)
    text(m,label,min(h*.35,w/max(1,len(label)) *1.3),(x,y-.014,z-.045),'RRTrim',node_name)

def legs(m,w,d,height,mat='Iron'):
    for x in (-w/2+.07,w/2-.07):
        for y in (-d/2+.07,d/2-.07): box(m,(.07,.07,height),(x,y,0),mat)

def counter(m,w=1.8,d=.8,h=.9,mat='WoodDark'):
    box(m,(w-.06,d-.06,h-.08),(0,0,0),mat)
    box(m,(w,d,.08),(0,0,h-.08),'WoodLight')
    for x in (-w*.3,0,w*.3):
        box(m,(w*.24,.015,h*.5),(x,-d/2-.005,.15),'Wood')
    box(m,(w-.1,.025,.04),(0,-d/2-.02,.08),'Brass')

def bottle(m,x,y,z,color='RRTeal',scale=1):
    add(m,S.lathe([(0,0),(.045,0),(.05,.03),(.05,.16),(.025,.19),(.02,.25),(0,.25)],8,
                  base=(x,y,z),scale_xy=(scale,scale)),color)
    box(m,(.055*scale,.008,.06),(x,y-.05*scale,z+.07),'Paper',b=0)

def book(m,x,y,z,w=.1,h=.28,color='RRBook',lean=0):
    box(m,(w,.24,h),(x,y,z),color,rot=(0,lean,0))
    box(m,(w*.65,.01,.02),(x,y-.125,z+h*.7),'RRTrim',b=0)

def seat(m,w=.48,d=.44,z=.46,mat='RRFabric',back=.95):
    add(m,S.cushion(w,d,.10,sag=.01,loc=(0,0,z-.05),segs=10,rings=5),mat)
    box(m,(w,.10,back-z),(0,d/2-.04,z),mat,b=.03)

def lamp(m,x,y,z,scale=1,mat='Paint',part='bulb'):
    cyl(m,.12*scale,.025*scale,(x,y,z),'Brass',12)
    tube(m,[(x,y,z),(x,y,z+.23*scale),(x,y-.06*scale,z+.28*scale)],.015*scale,'Brass',6)
    add(m,S.sphere(.12*scale,10,5,loc=(x,y-.06*scale,z+.29*scale),scale=(1.35,.75,.55)),mat)
    node(m,part,part)
    box(m,(.20*scale,.10*scale,.012),(x,y-.06*scale,z+.24*scale),'RRNeonWarm',part,b=0)

def flower(m,x,y,z,color='RRPink',height=.4):
    tube(m,[(x,y,z),(x+.025,y,z+height)],.009,'RRTeal',4)
    for side in (-1,1):
        add(m,S.prism([(0,0),(side*.07,.035),(side*.045,.11)],.004,0,0,
                       plane='XZ',loc=(x+.01,y,z+height*.4)),'RRTeal')
    for k in range(5):
        a=k*math.tau/5
        add(m,S.ico(.035,1,loc=(x+.025+math.cos(a)*.025,y+math.sin(a)*.025,z+height),scale=(1,.6,.7)),color)

def contacts(m,kind,points):
    for i,p in enumerate(points): node(m,f'contact_{kind}_{i}',origin=p,contact=kind,units='metres')
