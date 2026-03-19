type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type TTLCacheOptions = {
  ttl: number;
  now?: () => number;
};

export class TTLCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly ttl: number;
  private readonly now: () => number;

  constructor({ ttl, now = () => Date.now() }: TTLCacheOptions) {
    this.ttl = ttl;
    this.now = now;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: K, value: V, ttl = this.ttl): void {
    this.entries.set(key, {
      value,
      expiresAt: this.now() + ttl,
    });
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    return entry.expiresAt <= this.now();
  }
}
