type CacheEntry<T> = {
	value: T;
	expiresAt: number;
};

type TTLCacheOptions = {
	ttl: number;
	maxSize?: number;
	now?: () => number;
};

export class TTLCache<K, V> {
	private readonly entries = new Map<K, CacheEntry<V>>();
	private readonly ttl: number;
	private readonly maxSize: number;
	private readonly now: () => number;

	constructor({
		ttl,
		maxSize = Infinity,
		now = () => Date.now(),
	}: TTLCacheOptions) {
		this.ttl = ttl;
		this.maxSize = maxSize;
		this.now = now;
	}

	get size(): number {
		return this.entries.size;
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

		this.entries.delete(key);
		this.entries.set(key, entry);

		return entry.value;
	}

	set(key: K, value: V, ttl = this.ttl): void {
		this.entries.delete(key);
		this.purgeExpired();

		this.entries.set(key, {
			value,
			expiresAt: this.now() + ttl,
		});

		this.evictOverflow();
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

	private purgeExpired(): void {
		for (const [key, entry] of this.entries) {
			if (this.isExpired(entry)) {
				this.entries.delete(key);
			}
		}
	}

	private evictOverflow(): void {
		while (this.entries.size > this.maxSize) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}
}

export class BoundedMap<K, V> {
	private readonly store = new Map<K, V>();
	private readonly maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	get size(): number {
		return this.store.size;
	}

	get(key: K): V | undefined {
		const value = this.store.get(key);
		if (value === undefined) return undefined;

		this.store.delete(key);
		this.store.set(key, value);
		return value;
	}

	set(key: K, value: V): void {
		this.store.delete(key);
		this.store.set(key, value);

		while (this.store.size > this.maxSize) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}

	has(key: K): boolean {
		return this.store.has(key);
	}

	delete(key: K): boolean {
		return this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}

	entries(): IterableIterator<[K, V]> {
		return this.store.entries();
	}
}
