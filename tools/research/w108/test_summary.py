"""Adversarial checks of the actual receipt aggregator, using isolated synthetic copies."""
import copy, hashlib, json, pathlib, shutil, subprocess, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]/'docs/research/w108'
PINS = json.loads((HERE/'arms.json').read_text(encoding='utf-8'))

class SummaryGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='astra-w108-guards-')
        self.root = pathlib.Path(self.temp.name)
        shutil.copytree(ROOT/'run3-raw', self.root/'run3-raw')
        (self.root/'arm-a-final').mkdir()
        self.report = json.loads((ROOT/'arm-a-final/evaluation-summary.json').read_text(encoding='utf-8'))
        self.addCleanup(self.temp.cleanup)
    def run_guard(self, passes):
        (self.root/'arm-a-final/evaluation-summary.json').write_text(json.dumps(self.report))
        p = subprocess.run([sys.executable, str(HERE/'summarize.py'), str(self.root)],capture_output=True,text=True)
        self.assertEqual(p.returncode == 0, passes, p.stderr)
    def test_retained_baseline(self): self.run_guard(True)
    def test_missing_sample(self):
        self.report['results'].pop(); self.run_guard(False)
    def test_duplicate_sample(self):
        self.report['results'].append(copy.deepcopy(self.report['results'][0])); self.run_guard(False)
    def test_raw_tamper(self):
        with (self.root/'run3-raw/ancestor-rocker.json').open('a') as f: f.write(' ')
        self.run_guard(False)
    def test_false_success(self):
        self.report['results'][0]['geometryOutcome']='Worked'; self.run_guard(False)
    def test_forged_duration(self):
        self.report['results'][0]['generationSeconds']=.001; self.run_guard(False)
    def test_omitted_gate(self):
        next(r for r in self.report['results'] if 'checks' in r)['checks'].pop('floor'); self.run_guard(False)
    def test_prompt_drift_between_arms(self):
        shutil.copytree(self.root/'run3-raw',self.root/'run4-raw')
        second = copy.deepcopy(self.report)
        for row in second['results']:
            file=self.root/'run4-raw'/(row['id']+'.json')
            raw=json.loads(file.read_text(encoding='utf-8'));raw['model_revision']=PINS['glb']['revision']
            raw['messages'][0]['content'] += ' changed prompt'
            file.write_text(json.dumps(raw));row['sourceResponseSha256']=hashlib.sha256(file.read_bytes()).hexdigest()
        (self.root/'arm-b-final').mkdir()
        (self.root/'arm-b-final/evaluation-summary.json').write_text(json.dumps(second))
        self.run_guard(False)

if __name__=='__main__': unittest.main(verbosity=2)
