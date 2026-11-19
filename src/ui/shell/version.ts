/** App version for footers / diagnostics (named JSON import: Vite tree-shakes the rest of package.json). */
import { version } from '../../../package.json';

export const APP_VERSION: string = typeof version === 'string' && version ? version : '1.0.0';
