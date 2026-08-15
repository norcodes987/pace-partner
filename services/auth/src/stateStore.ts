interface StateEntry {
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

export class StateStore {
  private readonly store = new Map<string, StateEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Number of entries currently held, including any not yet swept. Exposed for tests. */
  get size(): number {
    return this.store.size;
  }

  save(state: string, entry: { nonce: string; codeVerifier: string }): void {
    this.evictExpired();
    this.store.set(state, { ...entry, expiresAt: this.now() + TTL_MS });
  }

  private evictExpired(): void {
    const now = this.now();
    for (const [key, value] of this.store) {
      if (value.expiresAt < now) {
        this.store.delete(key);
      }
    }
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
