interface StateEntry {
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

export class StateStore {
  private readonly store = new Map<string, StateEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  save(state: string, entry: { nonce: string; codeVerifier: string }): void {
    this.store.set(state, { ...entry, expiresAt: this.now() + TTL_MS });
  }

  consume(state: string): { nonce: string; codeVerifier: string } | undefined {
    const entry = this.store.get(state);
    this.store.delete(state);
    if (!entry || entry.expiresAt < this.now()) {
      return undefined;
    }
    return { nonce: entry.nonce, codeVerifier: entry.codeVerifier };
  }
}
