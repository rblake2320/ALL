/**
 * The slice of SimContext the BuildService uses. A full SimContext satisfies it; tests pass a small fake.
 *
 * Assumptions about the engine (documented in docs/contract-requests/sim-spatial.md):
 *  - spend(amount, reason) returns false and changes nothing when funds are insufficient; earn() always succeeds.
 *  - spawnObject() inserts the new object into state.objects (and emits 'objectAdded' itself);
 *    removeObject() deletes it (and emits 'objectRemoved'). The build service tolerates either not happening.
 *  - placeItemNear(defId, near, { data }) creates a NEW loose item (new id) on a nearby free surface or the floor.
 *  - interrupt(agent) gracefully cancels the agent's active interaction.
 */
import type { SimContext } from '../../contracts';

export type BuildContext = Pick<
  SimContext,
  'state' | 'content' | 'spatial' | 'spend' | 'earn' | 'emit' | 'spawnObject' | 'removeObject' | 'interrupt' | 'placeItemNear' | 'markChanged'
>;
