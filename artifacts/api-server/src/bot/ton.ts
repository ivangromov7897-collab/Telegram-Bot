import axios from "axios";

const MARKETAPP_BASE = "https://api.marketapp.ws/v1";
const API_KEY = process.env["MARKETAPP_API_KEY"] ?? "";

const COLLECTION_USERNAMES = "EQAOAdfM7qFfuAXSx0t1eLx0yLZxRfZSYKEpQ4tA2kVqkruL";
const COLLECTION_NUMBERS = "EQC6H40h4CQj32FZQj4WMlK9EL0xVVmT5H5OJxU1x5sNm4Xv";
const COLLECTION_DNS = "EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz";

const headers = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

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

async function apiGet(path: string, params: Record<string, string | number> = {}) {
  const url = `${MARKETAPP_BASE}${path}`;
  const res = await axios.get(url, { headers, params, timeout: 15000 });
  return res.data;
}

async function apiPost(path: string, body: unknown) {
  const url = `${MARKETAPP_BASE}${path}`;
  const res = await axios.post(url, body, { headers, timeout: 15000 });
  return res.data;
}

export async function getNFTsByOwner(walletAddress: string): Promise<NFTItem[]> {
  try {
    const items: NFTItem[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const data = await apiGet("/nfts", {
        owner: walletAddress,
        limit,
        offset,
      });

      const nfts: NFTItem[] = (data?.items ?? data?.nfts ?? []).map((item: any) => ({
        address: item.address ?? item.nft_address ?? "",
        name: item.name ?? item.metadata?.name ?? "",
        collectionAddress: item.collection?.address ?? item.collection_address ?? "",
        collection: item.collection?.name ?? item.collection?.metadata?.name ?? "",
        owner: item.owner?.address ?? walletAddress,
        dns: item.dns ?? item.metadata?.domain ?? "",
      }));

      items.push(...nfts);

      if (nfts.length < limit) break;
      offset += limit;
      await sleep(200);
    }

    return items;
  } catch (e: any) {
    throw new Error(`Ошибка получения NFT: ${e?.message ?? e}`);
  }
}

export function categorizeNFTs(nfts: NFTItem[], wallet: string): WalletAssets {
  const usernames: string[] = [];
  const numbers: string[] = [];
  const domains: string[] = [];
  const otherNfts: NFTItem[] = [];

  for (const nft of nfts) {
    const col = (nft.collectionAddress ?? "").toLowerCase();
    const name = nft.name ?? "";

    if (col === COLLECTION_USERNAMES.toLowerCase()) {
      usernames.push(name || nft.address);
    } else if (col === COLLECTION_NUMBERS.toLowerCase()) {
      numbers.push(name || nft.address);
    } else if (col === COLLECTION_DNS.toLowerCase()) {
      domains.push(nft.dns || name || nft.address);
    } else {
      otherNfts.push(nft);
    }
  }

  return { wallet, usernames, numbers, domains, otherNfts };
}

export async function getWalletAssets(walletAddress: string): Promise<WalletAssets> {
  const nfts = await getNFTsByOwner(walletAddress);
  return categorizeNFTs(nfts, walletAddress);
}

export async function resolveUsername(username: string): Promise<{ nftAddress: string; ownerWallet: string; assets: WalletAssets } | null> {
  try {
    const clean = username.startsWith("@") ? username.slice(1) : username;
    const data = await apiGet("/nfts/find", {
      collection: COLLECTION_USERNAMES,
      name: clean,
    });

    const item = data?.item ?? data?.nft ?? data?.items?.[0];
    if (!item) return null;

    const nftAddress = item.address ?? item.nft_address ?? "";
    const ownerWallet = item.owner?.address ?? item.owner ?? "";
    if (!ownerWallet) return null;

    const assets = await getWalletAssets(ownerWallet);
    return { nftAddress, ownerWallet, assets };
  } catch (e: any) {
    throw new Error(`Ошибка поиска юзернейма: ${e?.message ?? e}`);
  }
}

export async function resolveNumber(number: string): Promise<{ nftAddress: string; ownerWallet: string; assets: WalletAssets } | null> {
  try {
    const clean = number.replace(/\s/g, "");
    const data = await apiGet("/nfts/find", {
      collection: COLLECTION_NUMBERS,
      name: clean,
    });

    const item = data?.item ?? data?.nft ?? data?.items?.[0];
    if (!item) return null;

    const nftAddress = item.address ?? item.nft_address ?? "";
    const ownerWallet = item.owner?.address ?? item.owner ?? "";
    if (!ownerWallet) return null;

    const assets = await getWalletAssets(ownerWallet);
    return { nftAddress, ownerWallet, assets };
  } catch (e: any) {
    throw new Error(`Ошибка поиска номера: ${e?.message ?? e}`);
  }
}

export async function resolveDomain(domain: string): Promise<{ nftAddress: string; ownerWallet: string; assets: WalletAssets } | null> {
  try {
    const clean = domain.endsWith(".ton") ? domain : `${domain}.ton`;
    const data = await apiGet("/nfts/find", {
      collection: COLLECTION_DNS,
      dns: clean,
    });

    const item = data?.item ?? data?.nft ?? data?.items?.[0];
    if (!item) {
      const data2 = await apiGet("/nfts/find", {
        collection: COLLECTION_DNS,
        name: clean,
      });
      const item2 = data2?.item ?? data2?.nft ?? data2?.items?.[0];
      if (!item2) return null;
      const nftAddress = item2.address ?? item2.nft_address ?? "";
      const ownerWallet = item2.owner?.address ?? item2.owner ?? "";
      if (!ownerWallet) return null;
      const assets = await getWalletAssets(ownerWallet);
      return { nftAddress, ownerWallet, assets };
    }

    const nftAddress = item.address ?? item.nft_address ?? "";
    const ownerWallet = item.owner?.address ?? item.owner ?? "";
    if (!ownerWallet) return null;

    const assets = await getWalletAssets(ownerWallet);
    return { nftAddress, ownerWallet, assets };
  } catch (e: any) {
    throw new Error(`Ошибка поиска домена: ${e?.message ?? e}`);
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
