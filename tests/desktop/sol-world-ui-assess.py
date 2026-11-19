"""S11 UI evidence evaluator. Fixtures test the evaluator, never the game."""
import math


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def control_problem(control, viewport, touch):
    if not isinstance(control, dict) or not isinstance(control.get('name'), str) or not control['name'].strip():
        return 'missing accessible name/control'
    rect = control.get('rect', [])
    if not isinstance(rect, (list, tuple)) or len(rect) != 4 or not all(finite(v) for v in rect):
        return 'invalid geometry'
    x, y, w, h = rect
    if w <= 0 or h <= 0 or not control.get('visible') or control.get('disabled'):
        return 'hidden, disabled or empty control'
    if x < 0 or y < 0 or x + w > viewport[0] + 1 or y + h > viewport[1] + 1:
        return 'control outside viewport'
    if touch and (w < 44 or h < 44):
        return 'touch target below44CSSpx'
    return None


def assess(report, dist_after):
    problems = []
    if not report.get('finished') or report.get('blocker'):
        problems.append('run incomplete')
    if report.get('errors'):
        problems.append('browser errors')
    expected = {'desktop', 'portrait', 'landscape'}
    scenes = report.get('scenes', [])
    if len(scenes) != 3 or {s.get('name') for s in scenes} != expected:
        problems.append('viewport coverage missing')
    if not report.get('distHashes') or report['distHashes'] != dist_after:
        problems.append('built artifact changed or absent')
    served = report.get('servedCodeHashes', {})
    if not served or any(report['distHashes'].get(k) != v for k, v in served.items()) or 'index.html' not in served or not any(k.endswith('.js') for k in served):
        problems.append('served executable identity missing or different')
    health = report.get('health', [])
    if len(health) != 4 or any(h.get('fatal') or h.get('contextLost') or 'AMD Radeon' not in h.get('renderer', '') or len(h.get('buffer', [])) != 2 or any(not finite(v) or v <= 0 for v in h['buffer']) for h in health):
        problems.append('per-scene/final render health missing or invalid')
    findings = []
    for scene in scenes:
        view = scene.get('viewport', [])
        if len(view) != 2 or any(not finite(v) or v <= 0 for v in view):
            problems.append('invalid viewport'); continue
        for action in ['map', 'recentre']:
            error = control_problem(scene.get('controls', {}).get(action), view, scene.get('touch', False))
            if error:
                findings.append(dict(scene=scene['name'], action=action, reason=error))
    return dict(measurementStatus='Blocked' if problems else 'Worked', controlAcceptance='Blocked' if problems else 'Failed' if findings else 'Worked', findings=findings, blockers=problems, scope='Visible map/recentre entry controls only; routes, sign semantics, modal navigation and gestures require their own real journeys.')
