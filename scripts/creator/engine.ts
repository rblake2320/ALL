// Bundle the game's actual contracts. Do not copy validators into the kit.
export { verifyPack, PackRegistry, validateManifest, PACK_FORMAT, PACK_LIMITS, checkPackPath } from '../../src/packs/index';
export { canonicalJson } from '../../src/persistence/canonicalJson';
export { HOUSE_BRANDS, brandSkinFor } from '../../src/economy/brands';
export { PHYSICAL_SPECS } from '../../src/shared/catalog';
