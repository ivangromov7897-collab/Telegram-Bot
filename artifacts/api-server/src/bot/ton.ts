import axios, { type AxiosError } from "axios";
import { logger } from "../lib/logger";
import { walletCache, lookupCache, type LookupResult } from "./cache";

const MARKETAPP_BASE = "https://api.marketapp.ws";
const TONAPI_BASE    = "https://tonapi.io/v2";
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

function apiError(context: string, e: unknown): Error {
  const err = e as AxiosError;
  const status = err?.response?.status;
  const body = JSON.stringify(err?.response?.data ?? "").slice(0, 300);
  logger.error({ context, status, body, msg: err?.message }, "API error");
  if (status === 401) return new Error(`${context}: неверный API ключ (401)`);
  if (status === 404) return new Error(`${context}: не найдено (404)`);
  return new Error(`${context}: ${err?.message ?? String(e)}${status ? ` [HTTP ${status}]` : ""}`);
}

async function marketGet(path: string, params: Record<string, string | number> = {}) {
  const url = `${MARKETAPP_BASE}${path}`;
  logger.debug({ url, params }, "marketapp GET");
  const res = await axios.get(url, {
    headers: {
      Authorization: API_KEY,
      Accept: "application/json",
    },
    params,
    timeout: 15000,
  });
  return res.data;
}

async function tonapiGet(path: string, params: Record<string, string | number> = {}) {
  const url = `${TONAPI_BASE}${path}`;
  logger.debug({ url }, "tonapi GET");
  const res = await axios.get(url, {
    headers: { Accept: "application/json" },
    params,
    timeout: 15000,
  });
  return res.data;
}

function parseNFT(item: any, fallbackOwner?: string): NFTItem {
  const colAddr: string =
    item.collection?.address ?? item.collection_address ?? "";
  const name: string =
    item.dns ??
    item.metadata?.name ??
    item.name ??
    "";
  return {
    address: item.address ?? item.nft_address ?? "",
    name,
    collectionAddress: colAddr,
    collection: item.collection?.name ?? item.collection?.metadata?.name ?? "",
    owner: item.owner?.address ?? item.owner ?? fallbackOwner ?? "",
    dns: item.dns ?? item.metadata?.domain ?? "",
  };
}

export async function getWalletAssets(walletAddress: string): Promise<WalletAssets> {
  const cached = walletCache.get(walletAddress);
  if (cached) {
    logger.info({ walletAddress }, "Cache HIT wallet");
    return cached;
  }

  const allNfts: NFTItem[] = [];
  let cursor: string | undefined;
  const limit = 100;

  try {
    while (true) {
      const params: Record<string, string | number> = { limit };
      if (cursor) params.cursor = cursor;

      const data = await marketGet(`/v1/nfts/owner/${encodeURIComponent(walletAddress)}/`, params);

      const items: any[] = data?.items ?? data?.nfts ?? [];
      allNfts.push(...items.map((item: any) => parseNFT(item, walletAddress)));

      cursor = data?.next_cursor ?? data?.cursor ?? undefined;
      if (!cursor || items.length < limit) break;
      await sleep(200);
    }
  } catch (e) {
    throw apiError("Ошибка получения NFT кошелька", e);
  }

  const assets = categorizeNFTs(allNfts, walletAddress);
  walletCache.set(walletAddress, assets);
  return assets;
}

export function categorizeNFTs(nfts: NFTItem[], wallet: string): WalletAssets {
  const usernames: string[] = [];
  const numbers:   string[] = [];
  const domains:   string[] = [];
  const otherNfts: NFTItem[] = [];

  for (const nft of nfts) {
    const col = (nft.collectionAddress ?? "").toLowerCase();
    const label = nft.name || nft.dns || nft.address;

    if (col === COLLECTION_USERNAMES.toLowerCase()) {
      usernames.push(label);
    } else if (col === COLLECTION_NUMBERS.toLowerCase()) {
      numbers.push(label);
    } else if (col === COLLECTION_DNS.toLowerCase()) {
      domains.push(nft.dns || label);
    } else {
      otherNfts.push(nft);
    }
  }

  return { wallet, usernames, numbers, domains, otherNfts };
}

async function resolveNFTByDNS(dnsName: string): Promise<{ nftAddress: string; ownerWallet: string } | null> {
  try {
    const encoded = encodeURIComponent(dnsName);
    const data = await tonapiGet(`/dns/${encoded}`);
    const item = data?.item;
    if (!item) return null;

    const nftAddress: string = item.address ?? "";
    const ownerWallet: string = item.owner?.address ?? "";
    if (!nftAddress || !ownerWallet) return null;

    return { nftAddress, ownerWallet };
  } catch (e: any) {
    const status = (e as AxiosError)?.response?.status;
    if (status === 404) return null;
    throw e;
  }
}

export async function resolveUsername(username: string): Promise<LookupResult | null> {
  const clean = (username.startsWith("@") ? username.slice(1) : username).toLowerCase();
  const cacheKey = `username:${clean}`;

  if (lookupCache.has(cacheKey)) {
    logger.info({ username: clean }, "Cache HIT username");
    return lookupCache.get(cacheKey) ?? null;
  }

  try {
    const found = await resolveNFTByDNS(`${clean}.t.me`);
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
    const found = await resolveNFTByDNS(clean);
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
    const found = await resolveNFTByDNS(clean);
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
  return /^\+888[\s\d]{5,15}$/.test(text.trim());
}

export function isDomain(text: string): boolean {
  return /^[a-zA-Z0-9-]+\.ton$/i.test(text.trim());
}
