/** Isolated UI fixture: entitlement data is synthetic, never a real purchase. */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import type { EconomyFacade } from '../../src/economy/facade';
import type { BodyId } from '../../src/shared/cast';
import { PREMIUM_BODY_IDS } from '../../src/shared/premiumBodies';
import { CazBodyPicker } from '../../src/ui/shell/screens/caz/CazBodyPicker';
import '../../src/ui/shell/caz.css';

const query = new URLSearchParams(location.search);
const economy = {
  ready: query.get('ready') !== '0',
  age: { bracket: query.get('age') ?? 'adult' },
  wallet: { entitlements: new Set(query.get('owned') === '1' ? [`body:${PREMIUM_BODY_IDS[0]}`] : []) },
} as unknown as EconomyFacade;

function App() {
  const [selected, setSelected] = useState<BodyId>('classic');
  return <><output id="selected">{selected}</output><CazBodyPicker value={selected} onChange={setSelected} labelledBy="body-label" economy={economy} /></>;
}
render(<App />, document.getElementById('root')!);
