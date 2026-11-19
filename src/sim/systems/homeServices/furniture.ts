/** Which placed objects are the Hearth and the working furniture of each service (ids from src/shared/homeBuild.ts SERVICE_FURNITURE). */
import { SERVICE_FURNITURE, type ServiceKind } from '../../../shared/homeBuild';

export { HEARTH_OBJECT } from '../../../shared/homeServices';

const KINDS = ['wardrobe', 'embalming', 'vault', 'workbench', 'boneGate', 'sparring'] as const;

export const SERVICE_OBJECTS: Readonly<Record<ServiceKind, readonly string[]>> = Object.freeze(
  Object.fromEntries(KINDS.map((k) => [k, Object.keys(SERVICE_FURNITURE).filter((d) => SERVICE_FURNITURE[d].service === k)])) as unknown as Record<ServiceKind, readonly string[]>,
);
