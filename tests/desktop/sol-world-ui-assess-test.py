"""Deliberate negative controls for S11 evidence; no browser/game execution."""
import copy, runpy, unittest
from pathlib import Path

assess = runpy.run_path(str(Path(__file__).with_name('sol-world-ui-assess.py')))['assess']
HASHES = {'index.html': 'index', 'assets/game.js': 'code'}


def fixture():
    control = dict(name='World map', rect=[10, 10, 48, 48], visible=True, disabled=False)
    return dict(finished=True, errors=[], distHashes=HASHES, servedCodeHashes=HASHES,
                scenes=[dict(name=n, viewport=[390, 844], touch=n != 'desktop', controls={'map':copy.deepcopy(control), 'recentre':copy.deepcopy(control)}) for n in ['desktop','portrait','landscape']],
                health=[dict(renderer='AMD Radeon', fatal=None, contextLost=False, buffer=[390,844]) for _ in range(4)])


class Guards(unittest.TestCase):
    def test_valid_measurement_and_entry_controls(self):
        r=assess(fixture(), HASHES)
        self.assertEqual((r['measurementStatus'],r['controlAcceptance']),('Worked','Worked'))

    def test_bad_controls_are_observed_failures(self):
        for patch in [None,dict(name=''),dict(name=None),dict(rect=None),dict(rect=[0,0,43,44]),dict(rect=[380,0,44,44]),dict(disabled=True),dict(visible=False),dict(rect=[0,0,float('nan'),44])]:
            with self.subTest(patch=patch):
                r=fixture()
                if patch is None:r['scenes'][1]['controls'].pop('map')
                else:r['scenes'][1]['controls']['map'].update(patch)
                v=assess(r,HASHES)
                self.assertEqual(v['measurementStatus'],'Worked')
                self.assertEqual(v['controlAcceptance'],'Failed')

    def test_incomplete_or_invalid_evidence_is_blocked(self):
        for change in [lambda r:r.update(finished=False),lambda r:r['errors'].append('late error'),lambda r:r['scenes'].pop(),lambda r:r['health'][-1].update(contextLost=True),lambda r:r['health'][-1].update(buffer=[0,844]),lambda r:r['health'][-1].update(renderer='NVIDIA'),lambda r:r.update(servedCodeHashes={}),lambda r:r.update(distHashes={})]:
            r=fixture();change(r)
            self.assertEqual(assess(r,HASHES)['controlAcceptance'],'Blocked')
        self.assertEqual(assess(fixture(), {'index.html':'changed'})['controlAcceptance'],'Blocked')


if __name__=='__main__':unittest.main()
