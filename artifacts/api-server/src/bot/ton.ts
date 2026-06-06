import axios, { type AxiosError } from "axios";
import { logger } from "../lib/logger";
import { walletCache, lookupCache, type LookupResult } from "./cache";

const MARKETAPP_BASE = "https://api.marketapp.ws";
const API_KEY = process.env["MARKETAPP_API_KEY"] ?? "";

export const COLLECTION_USERNAMES = "EQAOAdfM7qFfuAXSx0t1eLx0yLZxRfZSYKEpQ4tA2kVqkruL";
export const COLLECTION_NUMBERS   = "EQC6H40h4CQj32FZQj4WMlK9EL0xVVmT5H5OJxU1x5sNm4Xv";
export const COLLECTION_DNS       = "EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz";

export interface NFTItem {
  address: string;
  name?: string;
  collection?: string;
  collectionAddress?: string;
  owner?: string;
  dns?: string;
}

export interface WalletAssets {
  wallet: string;
  usernames: string[];
  numbers: string[];
  domains: string[];
  otherNfts: NFTItem[];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildHeaders() {
  return {
    "X-Api-Key": API_KEY,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
}

function apiError(context: string, e: unknown): Error {
  const err = e as AxiosError;
  const status = err?.response?.status;
  const body = JSON.stringify(err?.response?.data ?? "").slice(0, 300);
  const msg = err?.message ?? String(e);
  logger.error({ context, status, body, msg }, "API error");
  if (status === 401) {
    return new Error(`${context}: неверный API ключ (401)`);
  }
  if (status === 404) {
    return new Error(`${context}: не найдено (404)`);
  }
  return new Error(`${context}: ${msg}${status ? ` [HTTP ${status}]` : ""}`);
}

async function apiGet(path: string, params: Record<string, string | number> = {}) {
  const url = `${MARKETAPP_BASE}${path}`;
  const allParams = { ...params, api_key: API_KEY };
  logger.debug({ url, params: allParams }, "API GET");
  const res = await axios.get(url, {
    headers: buildHeaders(),
    params: allParams,
    timeout: 15000,
  });
  return res.data;
}

function parseNFT(item: any, fallbackOwner?: string): NFTItem {
  return {
    address: item.address ?? item.nft_address ?? "",
    name: item.name ?? item.metadata?.name ?? item.dns ?? "",
    collectionAddress: item.collection?.address ?? item.collection_address ?? "",
    collection: item.collection?.name ?? item.collection?.metadata?.name ?? "",
    owner: item.owner?.address ?? item.owner ?? fallbackOwner ?? "",
    dns: item.dns ?? item.metadata?.domain ?? item.metadata?.name ?? "",
  };
}

export async function getNFTsByOwner(walletAddress: string): Promise<NFTItem[]> {
  const cacheKey = `nfts:${walletAddress}`;
  const cached = walletCache.get(walletAddress);
  if (cached) {
    logger.info({ walletAddress }, "Cache HIT wallet assets");
    return [
      ...cached.usernames.map(n => ({ address: "", name: n, collectionAddress: COLLECTION_USERNAMES })),
      ...cached.numbers.map(n => ({ address: "", name: n, collectionAddress: COLLECTION_NUMBERS })),
      ...cached.domains.map(n => ({ address: "", name: n, collectionAddress: COLLECTION_DNS, dns: n })),
      ...cached.otherNfts,
    ];
  }

  try {
    const items: NFTItem[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const data = await apiGet("/v1/nfts", { owner: walletAddress, limit, offset });
      const raw: any[] = data?.items ?? data?.nfts ?? data?.data ?? [];
      const nfts = raw.map(item => parseNFT(item, walletAddress));
      items.push(...nfts);
      if (nfts.length < limit) break;
      offset += limit;
      await sleep(300);
    }

    return items;
  } catch (e) {
    throw apiError("Ошибка получения NFT", e);
  }
}

export function categorizeNFTs(nfts: NFTItem[], wallet: string): WalletAssets {
  const usernames: string[] = [];
  const numbers: string[] = [];
  const domains: string[] = [];
  const otherNfts: NFTItem[] = [];

  for (const nft of nfts) {
    const col = (nft.collectionAddress ?? "").toLowerCase();
    if (col === COLLECTION_USERNAMES.toLowerCase()) {
      usernames.push(nft.name || nft.address);
    } else if (col === COLLECTION_NUMBERS.toLowerCase()) {
      numbers.push(nft.name || nft.address);
    } else if (col === COLLECTION_DNS.toLowerCase()) {
      domains.push(nft.dns || nft.name || nft.address);
    } else {
      otherNfts.push(nft);
    }
  }

  return { wallet, usernames, numbers, domains, otherNfts };
}

export async function getWalletAssets(walletAddress: string): Promise<WalletAssets> {
  const cached = walletCache.get(walletAddress);
  if (cached) {
    logger.info({ walletAddress }, "Cache HIT wallet");
    return cached;
  }

  const nfts = await getNFTsByOwner(walletAddress);
  const assets = categorizeNFTs(nfts, walletAddress);
  walletCache.set(walletAddress, assets);
  return assets;
}

async function findNFTInCollection(
  collection: string,
  searchParams: Record<string, string>,
): Promise<{ nftAddress: string; ownerWallet: string } | null> {
  const endpoints = [
    "/v1/nfts/search",
    "/v1/nfts/find",
    "/v1/nfts",
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await apiGet(endpoint, { collection, ...searchParams });
      const item = data?.item ?? data?.nft ?? data?.items?.[0] ?? data?.data?.[0];
      if (!item) continue;
      const nftAddress = item.address ?? item.nft_address ?? "";
      const ownerWallet = item.owner?.address ?? item.owner ?? "";
      if (nftAddress && ownerWallet) {
        return { nftAddress, ownerWallet };
      }
    } catch (e: any) {
      const status = (e as AxiosError)?.response?.status;
      if (status === 404) continue;
      if (status === 401) throw apiError("API ключ", e);
      logger.warn({ endpoint, err: e?.message }, "Endpoint failed, trying next");
    }
  }
  return null;
}

export async function resolveUsername(username: string): Promise<LookupResult | null> {
  const clean = username.startsWith("@") ? username.slice(1) : username;
  const cacheKey = `username:${clean.toLowerCase()}`;
  if (lookupCache.has(cacheKey)) {
    logger.info({ username: clean }, "Cache HIT username");
    return lookupCache.get(cacheKey) ?? null;
  }

  try {
    const found = await findNFTInCollection(COLLECTION_USERNAMES, { name: clean });
    if (!found) {
      lookupCache.set(cacheKey, null);
      return null;
    }
    const assets = await getWalletAssets(found.ownerWallet);
    const result: LookupResult = { nftAddress: found.nftAddress, ownerWallet: found.ownerWallet, assets };
    lookupCache.set(cacheKey, result);
    return result;
  } catch (e) {
    throw apiError("Ошибка поиска юзернейма", e);
  }
}

export async function resolveNumber(number: string): Promise<LookupResult | null> {
  const clean = number.replace(/\s/g, "");
  const cacheKey = `number:${clean}`;
  if (lookupCache.has(cacheKey)) {
    logger.info({ number: clean }, "Cache HIT number");
    return lookupCache.get(cacheKey) ?? null;
  }

  try {
    const found = await findNFTInCollection(COLLECTION_NUMBERS, { name: clean });
    if (!found) {
      lookupCache.set(cacheKey, null);
      return null;
    }
    const assets = await getWalletAssets(found.ownerWallet);
    const result: LookupResult = { nftAddress: found.nftAddress, ownerWallet: found.ownerWallet, assets };
    lookupCache.set(cacheKey, result);
    return result;
  } catch (e) {
    throw apiError("Ошибка поиска номера", e);
  }
}

export async function resolveDomain(domain: string): Promise<LookupResult | null> {
  const clean = domain.toLowerCase().endsWith(".ton") ? domain.toLowerCase() : `${domain.toLowerCase()}.ton`;
  const cacheKey = `domain:${clean}`;
  if (lookupCache.has(cacheKey)) {
    logger.info({ domain: clean }, "Cache HIT domain");
    return lookupCache.get(cacheKey) ?? null;
  }

  try {
    const found = await findNFTInCollection(COLLECTION_DNS, { dns: clean })
      ?? await findNFTInCollection(COLLECTION_DNS, { name: clean });

    if (!found) {
      lookupCache.set(cacheKey, null);
      return null;
    }
    const assets = await getWalletAssets(found.ownerWallet);
    const result: LookupResult = { nftAddress: found.nftAddress, ownerWallet: found.ownerWallet, assets };
    lookupCache.set(cacheKey, result);
    return result;
  } catch (e) {
    throw apiError("Ошибка поиска домена", e);
  }
}

export function isTonAddress(text: string): boolean {
  return /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(text.trim());
}

export function isUsername(text: string): boolean {
  return /^@[a-zA-Z0-9_]{3,32}$/.test(text.trim());
}

export function isNumber(text: string): boolean {
  return /^\+888[\s\d]{5,20}$/.test(text.trim());
}

export function isDomain(text: string): boolean {
  return /^[a-zA-Z0-9-]+\.ton$/i.test(text.trim());
}
