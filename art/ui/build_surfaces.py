"""Original W-052 in-world ad and newspaper vector art, generated from local brand masters."""
from pathlib import Path
from html import escape
import json

root=Path(__file__).parent
ads=root.parent/'brands'/'ads'
news=root/'daily-grave'
ads.mkdir(parents=True,exist_ok=True)
news.mkdir(parents=True,exist_ok=True)

def brand(name,x,y,w,h):
    text=(root.parent/'brands'/f'{name}.svg').read_text(encoding='utf-8')
    inner=text[text.index('>')+1:text.rindex('</svg>')]
    return f'<svg x="{x}" y="{y}" width="{w}" height="{h}" viewBox="0 0 1024 1024">{inner}</svg>'

def label(x,y,text,size=52,color='#e8e0c8',weight='bold',family='Georgia',spacing=1):
    return f'<text x="{x}" y="{y}" fill="{color}" font-family="{family},serif" font-size="{size}" font-weight="{weight}" letter-spacing="{spacing}">{escape(text)}</text>'

def frame(w,h,body,title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{escape(title)}">{body}</svg>\n'

surfaces=[
 ('tv-grave-cola',1280,720,'Grave-Cola television advertisement',
  '<rect width="1280" height="720" fill="#30243c"/><circle cx="1030" cy="330" r="290" fill="#62506a"/><circle cx="1030" cy="330" r="236" fill="none" stroke="#cab4c7" stroke-width="4" stroke-dasharray="7 18"/>'
  +brand('grave-cola',748,66,535,535)+label(88,196,'A QUIET LITTLE',40,'#d2bfd2','bold','Arial',5)+label(82,300,'FIZZ',124)+label(90,384,'for the after-hours',42,'#d9cfb8','normal')+'<path d="M90 440h480" stroke="#b297b6" stroke-width="7"/>'+label(90,506,'GRAVE-COLA',37,'#e8e0c8','bold','Arial',4)),
 ('billboard-mulch-master',1536,640,'Mulch Master billboard',
  '<rect width="1536" height="640" fill="#293a31"/><path d="M0 500Q240 385 490 505t530-20 516 0v155H0Z" fill="#516c4a"/><path d="M0 570Q270 450 550 570t500-14 486 5v79H0Z" fill="#74865a"/>'
  +brand('mulch-master',10,-90,800,800)+label(740,202,'THE LAWN',78,'#e8e0c8')+label(740,294,'AWAKENS.',84,'#e8e0c8')+label(745,370,'MULCH MASTER',33,'#d8b574','bold','Arial',5)),
 ('magazine-brain-bran',900,1200,'Brain Bran magazine advertisement',
  '<rect width="900" height="1200" fill="#d3a34e"/><path d="M45 45h810v1110H45z" fill="none" stroke="#1d1726" stroke-width="8"/><path d="M74 79h752v1042H74z" fill="#f0d393"/>'
  +label(124,186,'A BRIGHT START',55,'#1d1726','bold','Arial',3)+label(125,243,'for your second life.',37,'#68483b','normal')
  +brand('brain-bran',120,230,660,660)+'<path d="M135 962h630" stroke="#68483b" stroke-width="5"/>'+label(125,1022,'BREAKFAST FOR THINKERS',28,'#1d1726','bold','Arial',2)),
 ('bus-stop-crypt-kicks',900,1400,'Crypt-Kicks bus stop advertisement',
  '<rect width="900" height="1400" fill="#252f3c"/><path d="M0 910 900 460v940H0Z" fill="#527083"/><path d="M0 1080 900 630v60L0 1140Z" fill="#7fb1b7"/>'
  +label(82,152,'MAKE A',65,'#e8e0c8','bold','Arial',3)+label(82,245,'GETAWAY.',98,'#e8e0c8','bold','Arial',2)
  +brand('crypt-kicks',70,275,760,760)+label(82,1205,'CRYPT-KICKS',51,'#e8e0c8','bold','Arial',4)+label(84,1260,'FOR FEET WITH STORIES',24,'#d9cfb8','bold','Arial',3))
]
manifest=[]
for name,w,h,title,body in surfaces:
    (ads/f'{name}.svg').write_text(frame(w,h,body,title),encoding='utf-8')
    manifest.append({'id':name,'file':f'../brands/ads/{name}.svg','width':w,'height':h,'alt':title})

masthead=('<rect width="1600" height="400" fill="#e8e0c8"/><path d="M55 34h1490v332H55z" fill="none" stroke="#352638" stroke-width="8"/>'
 '<path d="M90 105h1420M90 286h1420" stroke="#352638" stroke-width="5"/>'
 +label(93,91,'WORMWOOD HEIGHTS',26,'#352638','bold','Arial',4)+label(1325,91,'EST. EVER',23,'#352638','bold','Arial',2)
 +label(112,244,'THE DAILY GRAVE',119,'#352638','bold','Georgia',1)
 +label(96,335,'GOOD EVENING, NEIGHBOURS',26,'#352638','bold','Arial',3))
(news/'masthead.svg').write_text(frame(1600,400,masthead,'The Daily Grave masthead'),encoding='utf-8')
template=('<rect width="1200" height="1600" fill="#e8e0c8"/><path d="M48 48h1104v1504H48z" fill="none" stroke="#352638" stroke-width="6"/>'
 '<svg x="55" y="65" width="1090" height="272" viewBox="0 0 1600 400">'+masthead+'</svg>'
 +label(85,400,'COMMUNITY EDITION',28,'#352638','bold','Arial',4)
 +'<path d="M85 440h1030M85 1080h1030" stroke="#352638" stroke-width="4"/>'
 +label(85,520,'YOUR HEADLINE HERE',55,'#352638')+
 '<rect x="85" y="565" width="650" height="450" rx="8" fill="#c1b5a2"/><path d="M750 565v450" stroke="#352638" stroke-width="4"/>'
 +label(780,625,'STORY',32,'#352638','bold','Arial',3)
 +'<path d="M780 667h320m-320 45h320m-320 45h320m-320 45h320m-320 45h280M85 1150h460m-460 42h460m-460 42h400M620 1150h480m-480 42h480m-480 42h430" stroke="#827482" stroke-width="9" stroke-linecap="round"/>'
 +label(85,1435,'A PLACE FOR EVERY STORY',26,'#352638','bold','Arial',3))
(news/'edition-template.svg').write_text(frame(1200,1600,template,'Editable Daily Grave edition template'),encoding='utf-8')
(root/'surfaces.json').write_text(json.dumps({'version':1,'ads':manifest,'news':[{'id':'daily-grave-masthead','file':'daily-grave/masthead.svg','width':1600,'height':400},{'id':'daily-grave-edition-template','file':'daily-grave/edition-template.svg','width':1200,'height':1600}]},indent=2)+'\n',encoding='utf-8')
print('generated 4 ad surfaces and 2 newspaper masters')
