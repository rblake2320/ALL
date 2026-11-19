"""Build a static inspection gallery from receipts; generated HTML/code is never embedded."""
import html, json, pathlib, sys

root=pathlib.Path(sys.argv[1]);spec=json.loads((pathlib.Path(__file__).with_name('props.json')).read_text(encoding='utf-8'))
esc=lambda s:html.escape(str(s),quote=True)
cards=[]
for label,folder,cleanup in [('A · scene model','arm-a-final','arm-a-cleaned-final-v2'),('B · GLB model','arm-b-final',None)]:
    summary=root/folder/'evaluation-summary.json'
    rows={r['id']:r for r in json.loads(summary.read_text(encoding='utf-8'))['results']} if summary.exists() else {}
    for prop in spec['props']:
        row=rows.get(prop['id']);used=folder;diagnostic=False
        if row and 'base' not in row and cleanup and (root/cleanup/(prop['id']+'.evaluation.json')).exists():
            row=json.loads((root/cleanup/(prop['id']+'.evaluation.json')).read_text(encoding='utf-8'));used=cleanup;diagnostic=True
        preview=root/used/(prop['id']+'.png')
        image=f'<a href="{esc(used)}/{esc(prop["id"])}.png"><img src="{esc(used)}/{esc(prop["id"])}.png" alt="{esc(prop["name"])} evaluation preview"></a>' if preview.exists() else '<div class="empty">No exported preview</div>'
        if not row:details='Awaiting completed evaluation.'
        elif 'base' not in row:details=esc(row.get('error','Rejected before geometry measurement'))
        else:
            base=row['base'];failed=', '.join(k for k,v in row['checks'].items() if not v) or 'No static gate failures'
            details=f'{base["triangles"]:,} / {prop["triangles"]:,} triangles · {base["materials"]} / {prop["materials"]} materials<br>Bounds: '+ ' × '.join(f'{v:.3f}' for v in base['size'])+f' m<br>Failed gates: {esc(failed)}'
        source=f'<a href="{esc(used)}/{esc(prop["id"])}.evaluation.json">Receipt</a>' if row else ''
        phase='After minimal code unblock; raw failure retained' if diagnostic else 'Unmodified response'
        cards.append(f'<article><p class="eyebrow">{esc(label)}</p><h2>{esc(prop["name"])}</h2>{image}<p class="phase">{esc(phase)}</p><p>{details}</p>{source}</article>')
count=len(spec['props'])
cards=[card for pair in zip(cards[:count],cards[count:]) for card in pair]
extra=''
for folder,title in [('native-raw-final','Native workflow: unmodified export'),('native-cleaned-final','Native workflow: measured cleanup')]:
    file=root/folder/'native-report.json'
    if not file.exists():continue
    row=json.loads(file.read_text(encoding='utf-8'));base=row.get('base',{})
    images=''.join(f'<h3>{label}</h3><img src="{folder}/{name}" alt="{label}">' for name,label in [('audit-preview.png','Base GLB'),('lod-preview.png','LOD')] if (root/folder/name).exists())
    stats=f"{base.get('triangles','?')} triangles, {base.get('materials','?')} materials. Static gates: {row['geometryOutcome']}. No production admission."
    extra+=f'<section><h2>{title}</h2><p>One capability probe, excluded from six-prop A/B rates.</p>{images}<p>{esc(stats)}</p><a href="{folder}/native-report.json">Gate receipt</a></section>'
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>W108 asset inspection</title><style>
body{font:16px/1.5 system-ui;background:#17151d;color:#e8e2d6;margin:0;padding:32px}main{max-width:1400px;margin:auto}h1{font-size:32px;margin-bottom:8px}h2{font-size:20px;margin:4px 0 16px}a{color:#abd7f0}.lead{max-width:850px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:28px}article,section{background:#24202c;border:1px solid #534758;border-radius:12px;padding:18px}img{width:100%;height:auto;border-radius:7px}.empty{height:225px;display:grid;place-items:center;background:#1d1726;color:#c7bacb}.eyebrow,.phase{color:#d9b884;font-size:13px}.phase{font-weight:600}article p{overflow-wrap:anywhere}section{margin-top:28px;max-width:700px}footer{margin-top:32px;color:#c7bacb}@media(max-width:700px){.grid{grid-template-columns:1fr}body{padding:16px}}</style><main><h1>W108 · Asset inspection</h1><p class="lead">Research outputs, not shipped game assets. Each card links to measured gates. Code-unblocked derivatives are labelled separately; missing previews are never replaced with mock art. No asset is admitted to the game or Asset Bank by this gallery.</p><p><a href="../asset-gen-bakeoff.md">Method and report</a> · <a href="comparison.json">Controlled comparison data</a></p><div class="grid">'''+''.join(cards)+'</div>'+extra+'<footer>Fixed target descriptions, bounds and budgets: tools/research/w108/props.json. Original rejected responses and earlier diagnostics remain retained.</footer></main></html>'
(root/'index.html').write_text(page,encoding='utf-8',newline='\n')
print(f'Wrote {len(cards)} controlled sample cards; native sections: {bool(extra)}')
