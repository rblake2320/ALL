export function validateInputs(commit: string, host: string): void;
export function parseArguments(args: string[]): { commit: string; host: string; nightly: boolean };
export function bundleHead(output: string): string;
export function requireAncestor(commit: string, tip: string, cwd: string): void;
export function run(args: string[]): void;
