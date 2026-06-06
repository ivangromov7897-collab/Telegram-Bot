import axios, { type AxiosError } from "axios";
import { logger } from "../lib/logger";
import { walletCache, lookupCache, type LookupResult } from "./cache";

const TONAPI_BASE = "https://tonapi.io/v2";

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
  if (status === 404) return new Error(`${context}: не найдено (404)`);
  return new Error(`${context}: ${err?.message ?? String(e)}${status ? ` [HTTP ${status}]` : ""}`);
}

async function tonapiGet(path: string, params: Record<string, string | number | boolean> = {}) {
  const url = `${TONAPI_BASE}${path}`;
  const res = await axios.get(url, {
    headers: { Accept: "application/json" },
    params,
    timeout: 15000,
  });
  return res.data;
}

const SPAM_PATTERNS = [
  /voucher/i, /airdrop/i, /\bwon\b/i, /выиграли/i, /выиграл/i,
  /spindog/i, /blum/i, /tontake/i, /tonbig/i, /toncash/i,
  /\$x\b/i, /\bham\b/i, /bonus/i,
  /https?:\/\//i, /www\./i,
  /[^\x00-\x7F]{3,}/,
];

function isSpamNFT(item: any): boolean {
  const name: string = item.metadata?.name ?? item.dns ?? "";
  const hasCollection = !!(item.collection?.address);
  if (!hasCollection && SPAM_PATTERNS.some(p => p.test(name))) return true;
  if (!hasCollection && /^\s*0x?[0-9a-fA-F]{40,}\s*$/.test(name)) return true;
  return false;
}

function classifyNFT(item: any): "username" | "number" | "domain" | "other" {
  const dns: string = item.dns ?? item.metadata?.name ?? "";
  if (dns.endsWith(".t.me")) return "username";
  if (/^\+888/.test(dns)) return "number";
  if (dns.endsWith(".ton")) return "domain";

  const colName: string = (item.collection?.name ?? "").toLowerCase();
  if (colName.includes("username") || colName.includes("telegram username")) return "username";
  if (colName.includes("anonymous number") || colName.includes("888")) return "number";
  if (colName.includes("ton dns") || colName.includes("dns")) return "domain";

  return "other";
}

function formatNFTLabel(item: any, type: "username" | "number" | "domain" | "other"): string {
  const dns: string = item.dns ?? item.metadata?.name ?? "";
  if (type === "username") {
    const name = dns.endsWith(".t.me") ? dns.slice(0, -4) : dns;
    return "@" + name.replace(/^@/, "");
  }
  if (type === "number" || type === "domain") return dns || item.metadata?.name || item.address;
  return item.metadata?.name || item.address;
}

export async function getWalletAssets(walletAddress: string): Promise<WalletAssets> {
  const cached = walletCache.get(walletAddress);
  if (cached) {
    logger.info({ walletAddress }, "Cache HIT wallet");
    return cached;
  }

  const allItems: any[] = [];
  let offset = 0;
  const limit = 1000;

  try {
    while (true) {
      const data = await tonapiGet(
        `/accounts/${encodeURIComponent(walletAddress)}/nfts`,
        { limit, offset, indirect_ownership: false }
      );
      const items: any[] = data?.nft_items ?? [];
      allItems.push(...items);
      if (items.length < limit) break;
      offset += limit;
      await sleep(300);
    }
  } catch (e) {
    throw apiError("Ошибка получения NFT кошелька", e);
  }

  const usernames: string[] = [];
  const numbers:   string[] = [];
  const domains:   string[] = [];
  const otherNfts: NFTItem[] = [];

  for (const item of allItems) {
    const type = classifyNFT(item);
    if (type === "other") {
      if (isSpamNFT(item)) continue;
      otherNfts.push({
        address: item.address ?? "",
        name: item.metadata?.name ?? "",
        collection: item.collection?.name ?? "",
        collectionAddress: item.collection?.address ?? "",
        owner: walletAddress,
        dns: item.dns ?? "",
      });
    } else {
      const label = formatNFTLabel(item, type);
      if (type === "username") usernames.push(label);
      else if (type === "number") numbers.push(label);
      else if (type === "domain") domains.push(label);
    }
  }

  const assets: WalletAssets = { wallet: walletAddress, usernames, numbers, domains, otherNfts };
  walletCache.set(walletAddress, assets);
  return assets;
}

export function invalidateWalletCache(walletAddress: string) {
  walletCache.delete(walletAddress);
}

export function invalidateLookupCache(key: string) {
  lookupCache.delete(key);
}

async function resolveNFTByDNS(dnsName: string): Promise<{ nftAddress: string; ownerWallet: string } | null> {
  try {
    const data = await tonapiGet(`/dns/${encodeURIComponent(dnsName)}`);
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
    if (!found) { lookupCache.set(cacheKey, null); return null; }
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
    if (!found) { lookupCache.set(cacheKey, null); return null; }
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
    if (!found) { lookupCache.set(cacheKey, null); return null; }
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
