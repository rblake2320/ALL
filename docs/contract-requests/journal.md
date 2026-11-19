# Contract request — write-ahead command journal / event-driven saves (design §4.1, §4.2, §4.5)

These are additive and optional fields/members, already applied as minimal edits (the task explicitly allowed hub-file
edits). Existing implementations and fakes compile unchanged. Please ratify them, or move them.

1. `src/persistence/contracts.ts`
   - `SaveResult` ok branch: `payloadSha256?: string`. The SHA-256 of the written payload. SaveManagerImpl fills it.
   - `LoadResult` ok branch: `payloadSha256?: string`. The loaded envelope's payload hash.
   Together they anchor a journal epoch to exactly one snapshot. Without them, the journal is simply disabled (fakes).
2. `src/game/contracts.ts` — `GameController.saveSoon?(reason: string): void`. Asks for an event-driven autosave:
   debounced, ≥ 10 s apart, idempotent. **Economy / store code should call this after a purchase or unlock.**
   The conformance test lists it (`saveSoon: 'method'`).
3. `src/game/events.ts` — `RouterHost.onSaveWorthy?(reason)`. `questCompleted` now routes to it.
4. Storage keys: new prefix `journal:<autosaveSlotId>:<epoch16hex>:<seq8>`. This is valid for the Electron key rules
   (`electron/storageKeys.ts`). Each world uses ≤ 16 + 1 keys and 0 after a clean quit. Note: FileStore `maxKeys` is
   512.
5. UI follow-up (not done — `src/ui/**` is owned elsewhere). Toasts have no action button, so the "your browser may
   clear saves" notice (`STORAGE_NOTICE_TITLE`, `src/game/storageGuard.ts`) can only tell the player to use Export
   in the Load menu. An optional `Toast.action?: { label; run }` would allow a real "Export save" button.
