"""Validate W-052 asset manifests, SVG syntax and self-contained sources."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import hashlib
import struct

root = Path(__file__).resolve().parent
icons = json.loads((root / 'icons.json').read_text(encoding='utf-8'))['icons']
surfaces = json.loads((root / 'surfaces.json').read_text(encoding='utf-8'))
entries = icons + surfaces['ads'] + surfaces['news']
assert len(icons) == 18 and len(surfaces['ads']) == 4 and len(surfaces['news']) == 2
assert len({e['id'] for e in entries}) == len(entries)
for entry in entries:
    file = (root / entry['file']).resolve()
    assert file.is_file(), file
    svg = ET.parse(file).getroot()
    assert svg.tag == '{http://www.w3.org/2000/svg}svg', file
    assert svg.get('viewBox'), file
    assert svg.get('aria-label'), file
    if 'width' in entry:
        assert svg.get('width') == str(entry['width']) and svg.get('height') == str(entry['height']), file
    for node in svg.iter():
        assert not node.tag.endswith(('script', 'foreignObject')), file
        for key, value in node.attrib.items():
            assert not key.lower().startswith('on'), file
            if key.endswith('href'):
                assert value.startswith('#'), (file, value)
loading = json.loads((root / 'loading.json').read_text(encoding='utf-8'))['images']
assert len(loading) == 7 and len({e['id'] for e in loading}) == 7
for entry in loading:
    data = (root / entry['file']).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', data[16:24]) == (entry['width'], entry['height'])
    assert entry['width'] >= 1600 and entry['height'] >= 900
    assert abs(entry['width'] / entry['height'] - 16 / 9) < 0.01
    assert hashlib.sha256(data).hexdigest() == entry['sha256']
print(f'PASS: {len(entries)} self-contained SVG assets and {len(loading)} cataloged PNG illustrations')
