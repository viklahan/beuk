export interface ArisStatus {
  enabled: boolean;
  optedIn: boolean;
  voice: string;
  keys: unknown[];
}

let status: ArisStatus | null = null;
let asked: Promise<ArisStatus | null> | null = null;

/** The session's status: null when absent, unreachable, or not enabled. */
export const arisStatus = (): ArisStatus | null => status;
export const setArisStatus = (s: ArisStatus | null): void => {
  status = s;
};
/** The one status request of the session (cached; never retried). */
export const askOnce = (make: () => Promise<ArisStatus | null>): Promise<ArisStatus | null> => (asked ??= make());
/** Tests: forget the session. */
export function resetArisState(): void {
  status = null;
  asked = null;
}
