"""Actual loopback/probe boundary test. Static HTTP fixtures are not a game run."""
import hashlib
import runpy
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

wait_preview = runpy.run_path(str(Path(__file__).with_name('sol-a11y-health.py')))['wait_preview']

class PreviewIdentity(unittest.TestCase):
    def test_actual_bytes_required_and_other_server_not_accepted_without_owned_marker(self):
        fixtures = {'/index.html': b'<script src="/assets/fixture.js"></script>', '/assets/fixture.js': b'// static fixture only\n'}
        expected = {name.lstrip('/'): hashlib.sha256(data).hexdigest() for name, data in fixtures.items()}
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0)); port = reserve.getsockname()[1]
        base = Path(tempfile.gettempdir()).resolve()
        with tempfile.TemporaryDirectory(prefix='sol-preview-', dir=base) as raw:
            directory = Path(raw).resolve()
            self.assertEqual(directory.parent, base)
            self.assertTrue(directory.name.startswith('sol-preview-'))
            log = directory / 'preview.log'
            script = 'from http.server import BaseHTTPRequestHandler,HTTPServer\nimport sys\nfiles=' + repr(fixtures) + '''
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  data=files.get(self.path)
  self.send_response(200 if data is not None else 404);self.end_headers()
  self.wfile.write(data or b'not found')
 def log_message(self,*args):pass
server=HTTPServer(('127.0.0.1',int(sys.argv[1])),Handler)
print('http://127.0.0.1:'+sys.argv[1]+'/',flush=True)
server.serve_forever()
'''
            with log.open('w', encoding='utf-8') as output:
                child = subprocess.Popen([sys.executable, '-u', '-c', script, str(port)], stdout=output, stderr=output, cwd=directory)
                try:
                    url = f'http://127.0.0.1:{port}/'
                    self.assertEqual(wait_preview(child, url, log, expected), expected)
                    wrong = dict(expected); wrong['assets/fixture.js'] = '0' * 64
                    with self.assertRaisesRegex(RuntimeError, 'Served code hash differs'):
                        wait_preview(child, url, log, wrong)
                    missing_marker = directory / 'another-preview.log'; missing_marker.write_text('')
                    with self.assertRaisesRegex(TimeoutError, 'listening marker missing'):
                        wait_preview(child, url, missing_marker, expected, timeout=.1)
                finally:
                    if child.poll() is None: child.terminate()
                    child.wait(timeout=5)

if __name__ == '__main__':
    unittest.main()
