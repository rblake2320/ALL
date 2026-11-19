/**
 * CI entry for the balance harness: `npm test` only collects tests/unit/**, so this file registers the FAST subset
 * of tests/balance/balance.test.ts (≈ 30 game days, ≤ 60 s). The full sweep runs with `npm run balance`
 * (BALANCE_FULL=1) and is skipped here.
 */
import '../../balance/balance.test';
