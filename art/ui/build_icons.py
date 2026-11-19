"""Original W-052 UI icon masters; normalized 48px viewport, no embedded third-party art."""
from pathlib import Path
import json

out = Path(__file__).parent / "icons"
out.mkdir(parents=True, exist_ok=True)
icons = {
    "store": ("Store", '<path d="M8 20h32v19H8z M6 20l4-10h28l4 10M15 39V27h9v12M29 27h6v5h-6z"/><path d="M6 20c0 5 6 5 6 0 0 5 6 5 6 0 0 5 6 5 6 0 0 5 6 5 6 0 0 5 6 5 6 0 0 5 6 5 6 0"/>'),
    "quest": ("Quest", '<path d="M14 8h20v32H14z M19 8V6h10v2M19 19l2 2 4-5M28 19h3M19 29l2 2 4-5M28 29h3"/>'),
    "bones": ("Bones currency", '<path d="M12 12c-5-3-8 3-4 6l3 2 13 13-2 3c-3 5 3 8 6 4 3 4 9 1 6-4l-2-3 7-7c3 1 6-1 6-4 0-4-4-6-7-3l-3-2-9 9-10-10 1-3c1-4-3-6-5-3Z"/>'),
    "grave-gold": ("Grave Gold", '<path d="M24 5 39 13v22L24 43 9 35V13Z M24 10l10 6v16l-10 6-10-6V16Z"/><path d="M29 21a6 6 0 1 0 0 7v-4h-5"/>'),
    "collection": ("Collection book", '<path d="M8 11c7-3 13-2 16 1 3-3 9-4 16-1v27c-7-2-13-1-16 2-3-3-9-4-16-2ZM24 12v28M13 18h6M29 18h6M13 23h6M29 23h6"/><path d="m31 27 1 3 3 .2-2.3 2 .7 3-2.4-1.6-2.4 1.6.7-3-2.3-2 3-.2Z"/>'),
    "free-placement": ("Free placement", '<path d="M24 6v36M6 24h36M24 6l-4 4m4-4 4 4M24 42l-4-4m4 4 4-4M6 24l4-4m-4 4 4 4M42 24l-4-4m4 4-4 4"/><circle cx="24" cy="24" r="7" fill="#1d1726"/>'),
    "private-home": ("Private home", '<path d="M6 22 24 7l18 15M11 20v20h26V20M18 40V27h12v13"/><rect x="20" y="15" width="8" height="7" rx="1"/><path d="M22 15v-2a2 2 0 0 1 4 0v2"/>'),
    "invite": ("Home invitation", '<path d="M7 14h34v23H7z M8 15l16 12 16-12M29 31h10M34 26v10"/>'),
    "wardrobe": ("Wardrobe", '<path d="M20 13c0-4 8-4 8 0 0 2-2 3-4 4v3L7 31c-2 1-1 4 2 4h30c3 0 4-3 2-4L24 20"/>'),
    "party": ("Party", '<path d="M11 39 19 13l16 16ZM15 34l6 3m-4-10 11 6m-8-13 12 7M31 9l2-4m5 11 5-2m-8-4 4-4"/><circle cx="39" cy="25" r="1"/>'),
    "social-feed": ("Social feed", '<path d="M8 9h32v25H24l-8 6v-6H8zM14 16h20M14 22h14M14 28h8"/><circle cx="34" cy="27" r="2"/>'),
    "news": ("The Daily Grave", '<path d="M8 9h32v29H8z M13 14h22M13 19h22M13 24h9v9h-9zM27 24h8M27 28h8M27 32h8"/>'),
    "photo": ("Photo mode", '<path d="M7 16h8l3-5h12l3 5h8v21H7z"/><circle cx="24" cy="26" r="7"/><path d="M35 20h2"/>'),
    "vehicles": ("Vehicles", '<path d="M7 30h34l-3-10-6-6H16l-6 6ZM10 30v6m28-6v6M15 30v2m18-2v2M12 21h24M21 15l-2 6m10-6 2 6"/>'),
    "seasons": ("Seasons", '<path d="M24 6v36M10 12l28 24M38 12 10 36M17 9l7 4 7-4M17 39l7-4 7 4M10 19l7 1-1-7M38 29l-7-1 1 7"/><circle cx="24" cy="24" r="4" fill="#1d1726"/>'),
    "construction": ("Construction", '<path d="m10 38 15-15M24 11l5-5 8 8-5 5-3-1-4 4-5-5 4-4Z M7 34l7 7m17-10 8 8M34 28l6 6"/>'),
    "craft": ("Craft", '<path d="M8 38h32M12 38l2-16h20l2 16M18 22v-8h12v8M21 14v-4h6v4M19 29h10M24 25v8"/>'),
    "daily": ("Daily task", '<rect x="8" y="10" width="32" height="30" rx="3"/><path d="M8 19h32M16 7v6M32 7v6M16 27l5 5 10-10"/>'),
}
entries=[]
for name,(label,shape) in icons.items():
    content=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="{label}">'
             f'<g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">{shape}</g></svg>\n')
    (out / f"{name}.svg").write_text(content, encoding="utf-8")
    entries.append({"id":name,"label":label,"file":f"icons/{name}.svg"})
(out.parent / "icons.json").write_text(json.dumps({"version":1,"viewBox":"0 0 48 48","icons":entries},indent=2)+"\n", encoding="utf-8")
print(f"generated {len(entries)} icons")
