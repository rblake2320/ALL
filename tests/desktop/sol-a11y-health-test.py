"""Boundary probes of the assessor. No browser, game, GPU or fabricated gameplay result."""
import copy
import runpy
import unittest
from pathlib import Path

assess = runpy.run_path(str(Path(__file__).with_name('sol-a11y-health.py')))['assess']
assess_zoom = runpy.run_path(str(Path(__file__).with_name('sol-a11y-health.py')))['assess_zoom']

class VerdictBoundaries(unittest.TestCase):
    def fixture(self):
        health = dict(renderer='AMD Radeon test fixture', fatal=None, contextLost=False, buffer=[1, 1])
        hashes = {'index.html': 'synthetic-index', 'assets/fixture.js': 'synthetic-code'}
        return dict(finished='synthetic', distHashes=hashes, servedCodeHashes=dict(hashes),
                    checks=[dict(name='synthetic interaction', status='Worked')],
                    screens=[dict(name='synthetic-scene', violations=[])], health=[health, copy.deepcopy(health)],
                    errors=[], consoleErrors=[])

    def test_control_and_failures(self):
        r = self.fixture()
        self.assertEqual(assess(r, r['distHashes'], ['synthetic-scene'])['productAcceptance'], 'Worked')
        for mutate in [lambda x: x.update(errors=['late pageerror']),
                       lambda x: x.update(consoleErrors=['late console error']),
                       lambda x: x['health'][-1].update(fatal='late fatal'),
                       lambda x: x['health'][-1].update(renderer='different adapter'),
                       lambda x: x['health'][-1].update(contextLost=True),
                       lambda x: x['health'][-1].update(buffer=[0, 1]),
                       lambda x: x.update(health=[]),
                       lambda x: x.update(checks=[]),
                       lambda x: x.update(screens=[]),
                       lambda x: x.update(servedCodeHashes={}),
                       lambda x: x.pop('finished'),
                       lambda x: x.update(blocker='interrupted')]:
            with self.subTest(mutate=mutate):
                candidate = copy.deepcopy(r); mutate(candidate)
                self.assertEqual(assess(candidate, r['distHashes'], ['synthetic-scene'])['measurementStatus'], 'Blocked')
        self.assertEqual(assess(r, {'index.html': 'changed'}, ['synthetic-scene'])['productAcceptance'], 'Blocked')

    def test_completed_failed_and_blocked_interactions_remain_distinct(self):
        for status, outcome in [('Failed', 'Failed'), ('Blocked', 'Blocked')]:
            r = self.fixture(); r['checks'][0]['status'] = status
            verdict = assess(r, r['distHashes'], ['synthetic-scene'])
            self.assertEqual(verdict['measurementStatus'], 'Worked')
            self.assertEqual(verdict['productAcceptance'], outcome)
        r = self.fixture(); r['screens'][0]['violations'] = [dict(id='aria-orientation')]
        self.assertEqual(assess(r, r['distHashes'], ['synthetic-scene'])['productAcceptance'], 'Failed')
        r['screens'][0]['controlledTextFixture'] = True
        verdict = assess(r, r['distHashes'], ['synthetic-scene'])
        self.assertEqual(verdict['axeViolatedRuleOccurrences'], 1)
        self.assertEqual(verdict['productAxeViolatedRuleOccurrences'], 0)
        self.assertEqual(verdict['productAcceptance'], 'Worked')

    def test_native_zoom_caps_and_wrong_zoom_evidence_cannot_pass(self):
        def fixture(fonts):
            hashes = {'index.html': 'synthetic-index', 'assets/fixture.js': 'synthetic-code'}
            return dict(finished='synthetic', errors=[], distHashes=hashes, servedCodeHashes=dict(hashes),
                        samples=[dict(label=label, dpr=dpr, width=width, visualScale=1, heading=dict(text='Settings', font=font))
                                 for label, dpr, width, font in zip(['100', '200', '400'], [1, 2, 4], [1280, 640, 320], fonts)])
        old = fixture([28, 21, 10.5])  # Reproduces the historical 150% cap numerically.
        self.assertEqual(assess_zoom(old, old['distHashes'])['headingMagnification'], 'Failed')
        good = fixture([28, 28, 28])
        self.assertEqual(assess_zoom(good, good['distHashes'])['headingMagnification'], 'Worked')
        for mutate in [lambda r: r['samples'][-1].update(dpr=1),
                       lambda r: r['samples'][-1].update(visualScale=4),
                       lambda r: r['samples'][-1].update(width=480),
                       lambda r: r['samples'][-1].update(heading={}),
                       lambda r: r['samples'][-1].update(heading=None),
                       lambda r: r['samples'][0].update(dpr=0),
                       lambda r: r['samples'][-1].update(dpr=None),
                       lambda r: r.update(errors=['late error']),
                       lambda r: r.update(samples=[]),
                       lambda r: r.update(servedCodeHashes={}),
                       lambda r: r.pop('finished')]:
            candidate = copy.deepcopy(good); mutate(candidate)
            self.assertEqual(assess_zoom(candidate, good['distHashes'])['measurementStatus'], 'Blocked')

if __name__ == '__main__':
    unittest.main()
