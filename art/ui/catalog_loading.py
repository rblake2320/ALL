"""Catalog the selected generated PNG originals without modifying pixels."""
import hashlib
import json
import struct
from pathlib import Path

root = Path(__file__).resolve().parent
scenes = [
 ('l1-wormwood','Wormwood Heights','A lived-in suburban street with modest starter homes, gardens, a porch and a distant town center at twilight.'),
 ('l2-graveyard','Old Graveyard','A winding garden cemetery with weathered monuments, iron gates, mist, old trees and a warm caretaker cottage at twilight.'),
 ('l3-rotrow','Downtown Rot Row','A compact downtown with quirky storefronts, neon, streetcar tracks and apartments at blue hour.'),
 ('l4-bayou','Swampside Bayou','Wooden homes on stilts, cypress knees, hanging moss, water reflections and a boardwalk at twilight.'),
 ('l5-mausoleum','Mausoleum Hills','Stone mausoleums on rolling hills with stairs, ironwork, lanterns and sunset clouds.'),
 ('l6-underneath','The Underneath','An underground network of tunnels, crypt arches, supports, lanterns and a basement workshop.'),
 ('l7-necropolis','The Necropolis','A growing town seen from a hill, with varied homes, a plaza, paths and warm windows at dusk.'),
]
entries = []
for slug, title, prompt in scenes:
    file = root / 'loading' / (slug + '.png')
    data = file.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    w, h = struct.unpack('>II', data[16:24])
    entries.append({'id':slug, 'title':title, 'file':f'loading/{slug}.png', 'width':w, 'height':h,
                    'sha256':hashlib.sha256(data).hexdigest(), 'scene_brief':prompt})
doc = {'version':1, 'medium':'OpenAI image generation; raster PNG originals',
       'direction':'Original whimsical family-friendly painterly zombie life-simulation environment art, without intended text, logos, UI or watermark.',
       'process':'L2 generated from text. L1 and L3-L7 generated using L2 as a visual style reference. L3 subsequently edited to remove illegible storefront lettering; its initial output is retained in parked/loading-vector-study/l3-uncorrected.png.',
       'images':entries}
(root / 'loading.json').write_text(json.dumps(doc, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
print(f'cataloged {len(entries)} PNG originals')
