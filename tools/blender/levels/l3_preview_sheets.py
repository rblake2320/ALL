"""Make labelled contact sheets from actual Cycles previews (ordinary Python + Pillow)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from levels.l3_specs import ROWS

root=Path(__file__).resolve().parents[3]
src=root/'tools/blender/out/levels/rotrow'
out=root/'tools/blender/levels/l3_evidence'
out.mkdir(parents=True,exist_ok=True)
font=ImageFont.load_default(size=18)
for page in range(7):
    selected=ROWS[page*7:(page+1)*7]
    canvas=Image.new('RGB',(4*384,2*422),(31,30,36))
    draw=ImageDraw.Draw(canvas)
    for i,(sid,*_) in enumerate(selected):
        p=src/(sid+'.png')
        if not p.is_file(): raise FileNotFoundError(p)
        with Image.open(p) as im:
            im=im.convert('RGB'); im.thumbnail((384,384))
            canvas.paste(im,((i%4)*384,(i//4)*422))
        draw.text(((i%4)*384+8,(i//4)*422+390),sid,font=font,fill=(235,231,216))
    canvas.save(out/f'preview-{page+1}.webp',quality=90)
print('Wrote seven labelled sheets from 49 rendered model previews.')
