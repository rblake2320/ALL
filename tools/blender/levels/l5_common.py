"""Mausoleum palette and small geometry helpers; shared bmesh/export engine reused."""
import math
from common import shapes as S
from common.materials import MatSpec
from .kit import add,node,flat_text

def palette(m):
    for name,spec in {
      'MhMarble':MatSpec('#d6d2c4',roughness=.65),
      'MhVein':MatSpec('#a9a69e',roughness=.8),
      'MhWalnut':MatSpec('#51352d',roughness=.72),
      'MhGilt':MatSpec('#baa069',roughness=.55),
      'MhInk':MatSpec('#292a35',roughness=.8),
      'MhLawn':MatSpec('#75915d',roughness=.95),
      'MhLawnLight':MatSpec('#8da672',roughness=.95),
      'MhRoof':MatSpec('#3b404d',roughness=.8),
      'MhPlum':MatSpec('#63485f',roughness=.9),
      'MhWater':MatSpec('#708d94',roughness=.1,metallic=.6),
      'MhFlame':MatSpec('#e9c98e',emission='#ffb35a',strength=3),
      'MhWindow':MatSpec('#b39b7b',emission='#ffb35a',strength=2.5),
    }.items():m.mats.custom(name,spec)

def box(m,size,at,mat='MhWalnut',part=None,b=.012,rot=(0,0,0)):
    add(m,S.box(*size,b,1,base=at,rot=rot),mat,part)
def cyl(m,r,h,at,mat='Brass',n=12,part=None,rot=(0,0,0)):
    add(m,S.cylinder(r,h,n,0,base=at,rot=rot),mat,part)
def tube(m,pts,r=.02,mat='Brass',n=6,part=None):add(m,S.tube(pts,r,n),mat,part)
def ball(m,r,at,mat='MhMarble',scale=(1,1,1),part=None,n=10):
    add(m,S.sphere(r,n,6,loc=at,scale=scale),mat,part)
def text(m,s,size,at,mat='MhGilt',part=None):add(m,flat_text(s,size,at),mat,part)
def candle(m,x,y,z,h=.17,part='flame'):
    cyl(m,.045,.025,(x,y,z),'Brass',8)
    cyl(m,.024,h,(x,y,z+.025),'Wax',8)
    node(m,part,part,transient=True)
    add(m,S.flame(.07,.022,(x,y,z+.025+h),6),'MhFlame',part)
def pedestal(m,w,d,h,at=(0,0,0),mat='MhMarble'):
    x,y,z=at
    box(m,(w,d,.08),(x,y,z),mat)
    box(m,(w*.78,d*.78,h-.16),(x,y,z+.08),mat)
    box(m,(w,d,.08),(x,y,z+h-.08),mat)
def leg(m,x,y,h,mat='MhWalnut'):
    add(m,S.lathe([(.07,0),(.085,.07),(.045,h*.4),(.07,h*.8),(.08,h)],8,base=(x,y,0)),mat)
def frame(m,w,h,at,mat='MhGilt',part=None):
    x,y,z=at
    for xx in (-w/2,w/2):box(m,(.055,.05,h),(x+xx,y,z-h/2),mat,part)
    for zz in (-h/2,h/2):box(m,(w,.05,.055),(x,y,z+zz),mat,part)
def contact(m,name,at,**data):node(m,'contact_'+name,origin=at,role=name,**data)
def surface(m,name,at,**data):node(m,name,origin=at,role='surface',**data)
def skull(m,r,at,mat='MhMarble',part=None,n=8):
    bone,dark=S.skull(r,loc=at,segs=n);add(m,bone,mat,part);add(m,dark,'MhInk',part)
