/**
 * Mirror of NativeBridge from src/persistence/contracts.ts. The electron TypeScript project cannot
 * pull renderer sources into its emit (rootDir), so the shape is repeated here and proven IDENTICAL
 * to the contract at compile time by tests/unit/electron/bridgeTypes.test.ts (root tsconfig) — any
 * drift fails `npm run typecheck`.
 */
export interface NativeBridge {
  platform: string;
  version: string;
  storage: {
    read(key: string): Promise<Uint8Array | null>;
    write(key: string, data: Uint8Array): Promise<void>;
    remove(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
    quota(): Promise<number | null>;
  };
  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  quit(): void;
  openSavesFolder(): Promise<void>;
}
