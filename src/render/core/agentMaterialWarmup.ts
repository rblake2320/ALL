/** Tracks whether agent materials need a renderer precompile after a rig change. */
export class AgentMaterialWarmupGate {
  private lastRevision: string | null = null;

  shouldCompile(revision: string): boolean {
    if (!revision) {
      this.lastRevision = null;
      return false;
    }
    if (revision === this.lastRevision) return false;
    this.lastRevision = revision;
    return true;
  }
}
