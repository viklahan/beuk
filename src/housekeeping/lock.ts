/**
 * The Housekeeping lock: ONE global lock for mutating actions (spec).
 * A second mutating action attempted while one is running is refused
 * with 409 — actions never interleave against live state.
 */
export class HousekeepingLock {
  private holder: string | null = null;

  /** Returns false (without waiting) when the lock is already held. */
  tryAcquire(action: string): boolean {
    if (this.holder !== null) return false;
    this.holder = action;
    return true;
  }

  release(): void {
    this.holder = null;
  }

  get heldBy(): string | null {
    return this.holder;
  }
}
