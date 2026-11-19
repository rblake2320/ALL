import { registerStrings, t, type StringParams } from '../../i18n';

const EN = {
  navigation: 'World navigation',
  selected: 'Selected zombie: {name}',
  select: 'Select a zombie to explore.',
  recentre: 'Recentre',
  map: 'World map',
  signs: 'Signs nearby',
  noSigns: 'There are no readable signs nearby.',
  close: 'Close',
  places: 'Places in the world',
  noPlaces: 'No destinations are available yet.',
  walk: 'Walk there',
  walkName: 'Walk to {place}',
  walking: 'Walking to {place}. About {minutes} game minutes.',
  pending: 'Finding a route…',
  noPath: 'There is no walking route there.',
  private: 'That is a private home. You need permission to enter.',
  locked: 'That place is closed or locked. Check its opening conditions.',
  unfinished: 'That area is not open in this version yet.',
  unavailable: 'Walking is unavailable right now. Please try again.',
  cameraUnavailable: 'The selected zombie cannot be centred right now.',
  cameraCentred: 'Camera centred on {name}.',
  invalid: 'Some world information is unavailable.',
  open: 'Open',
  closed: 'Closed',
  statusLocked: 'Locked',
  statusUnfinished: 'Under construction',
} as const;
registerStrings(Object.fromEntries(Object.entries(EN).map(([k,v]) => [`worldUi.${k}`,v])));
export function wt(key: keyof typeof EN, params?: StringParams): string { return t(`worldUi.${key}`,params); }
