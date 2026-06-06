interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

import type { WalletAssets } from "./ton";

const WALLET_TTL  = 5 * 60 * 1000;
const LOOKUP_TTL  = 10 * 60 * 1000;

export const walletCache = new TTLCache<WalletAssets>(WALLET_TTL);

export interface LookupResult {
  nftAddress: string;
  ownerWallet: string;
  assets: WalletAssets;
}

export const lookupCache = new TTLCache<LookupResult | null>(LOOKUP_TTL);
