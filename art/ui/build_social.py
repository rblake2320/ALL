"""Create small, editable original W-052 feed-card and collection art."""
from pathlib import Path
import json

root = Path(__file__).resolve().parent
out = root / 'social'
out.mkdir(exist_ok=True)
cards = [
 ('home', 'A HOME TAKES SHAPE', '#263c3a', '#6f8969', '<path d="M195 145V84l49-39 49 39v61z" fill="#e7d4af"/><path d="m185 88 59-50 59 50" fill="none" stroke="#eabf79" stroke-width="7"/><path d="M233 145v-33h22v33" fill="#34483e"/><path d="M205 92h16v18h-16zm62 0h16v18h-16z" fill="#d19b63"/><path d="M168 155h154" stroke="#cfb38b" stroke-width="4"/>'),
 ('wardrobe', 'A FRESH LOOK', '#413047', '#9b7182', '<path d="M238 65c0-13 20-13 20 0 0 6-6 9-10 12v9l-51 33c-6 4-2 11 5 11h92c7 0 11-7 5-11l-51-33" fill="none" stroke="#efdbba" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="m300 59 3-10 3 10 10 3-10 3-3 10-3-10-10-3z" fill="#e8b773"/>'),
 ('collection', 'A NEW DISCOVERY', '#29394a', '#648494', '<path d="M200 66q24-11 48 0 24-11 48 0v65q-24-10-48 2-24-12-48-2z" fill="#e8d8b7"/><path d="M248 66v67M210 79h25m-25 11h25m26-11h25m-25 11h25" fill="none" stroke="#55727e" stroke-width="3"/><path d="m274 99 4 10 11 1-8 7 2 11-9-5-9 5 2-11-8-7 11-1z" fill="#d09a5d"/>'),
]
manifest=[]
for slug, title, bg, accent, illustration in cards:
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200" role="img" aria-label="{title.title()} feed card illustration"><rect width="360" height="200" rx="12" fill="{bg}"/><path d="M145 0h215v200H145z" fill="{accent}" opacity=".35"/><circle cx="252" cy="90" r="69" fill="{accent}" opacity=".35"/>{illustration}<path d="M22 42h45" stroke="#e4bd84" stroke-width="3"/><text x="22" y="69" fill="#f6e8cf" font-family="Arial,sans-serif" font-size="10" font-weight="bold" letter-spacing="2">THE DAILY GRAVE</text><text x="22" y="164" fill="#fff1d8" font-family="Arial,sans-serif" font-size="11" font-weight="bold" letter-spacing="1">{title}</text><path d="M22 176h90" stroke="#e4bd84" stroke-width="2"/></svg>\n'''
    (out/f'feed-{slug}.svg').write_text(svg,encoding='utf-8')
    manifest.append({'id':f'feed-{slug}','file':f'social/feed-{slug}.svg','width':360,'height':200})
badges=[('founders','#b99362','<path d="M27 62V39l21-17 21 17v23z M21 42l27-22 27 22 M43 62V48h10v14"/>'),
        ('curios','#a388ad','<path d="M35 34q13-6 26 0v28q-13-6-26 0z M48 34v28 M39 40h6m6 0h6 M39 47h6m6 0h6"/>'),
        ('style','#6d9d9a','<path d="M45 29c0-7 10-7 10 0 0 4-3 5-5 7v4L28 55q-4 4 2 4h40q6 0 2-4L50 40"/>')]
for slug,color,body in badges:
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="{slug.title()} collection badge"><circle cx="48" cy="48" r="43" fill="#282333" stroke="{color}" stroke-width="4"/><circle cx="48" cy="48" r="34" fill="none" stroke="{color}" stroke-width="1.5"/><g fill="none" stroke="#f4e4c6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{body}</g><circle cx="48" cy="75" r="2" fill="{color}"/></svg>\n'''
    (out/f'badge-{slug}.svg').write_text(svg,encoding='utf-8')
    manifest.append({'id':f'badge-{slug}','file':f'social/badge-{slug}.svg','width':96,'height':96})
(root/'social.json').write_text(json.dumps({'version':1,'assets':manifest},indent=2)+'\n',encoding='utf-8')
print(f'generated {len(manifest)} feed-card and badge sources')
