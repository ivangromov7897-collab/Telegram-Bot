import type { WalletAssets, NFTItem } from "./ton";

export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

const MAX_PER_SECTION = 20;
const MAX_MSG_LEN = 3800;

function shortAddr(addr: string): string {
  if (addr.length > 12) return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
  return addr;
}

function renderList(items: string[], limit = MAX_PER_SECTION): string[] {
  const lines: string[] = [];
  const show = items.slice(0, limit);
  show.forEach(item => lines.push(`  • ${escapeMarkdown(item)}`));
  if (items.length > limit) {
    lines.push(`  _\\.\\.\\.и ещё ${items.length - limit}_`);
  }
  return lines;
}

function safeTruncate(text: string): string {
  if (text.length <= MAX_MSG_LEN) return text;
  const cut = text.slice(0, MAX_MSG_LEN);
  const lastNewline = cut.lastIndexOf("\n");
  return cut.slice(0, lastNewline > 0 ? lastNewline : MAX_MSG_LEN) + "\n_\\.\\.\\. \\(сообщение обрезано\\)_";
}

export function formatWalletAssets(assets: WalletAssets, title: string): string {
  const lines: string[] = [];

  lines.push(`*${escapeMarkdown(title)}*`);
  lines.push(`💼 \`${assets.wallet}\``);
  lines.push("");

  if (assets.usernames.length > 0) {
    lines.push(`👤 *Юзернеймы \\(${assets.usernames.length}\\):*`);
    lines.push(...renderList(assets.usernames));
    lines.push("");
  } else {
    lines.push("👤 _Юзернеймов нет_");
    lines.push("");
  }

  if (assets.numbers.length > 0) {
    lines.push(`📞 *Номера \\+888 \\(${assets.numbers.length}\\):*`);
    lines.push(...renderList(assets.numbers));
    lines.push("");
  } else {
    lines.push("📞 _Номеров нет_");
    lines.push("");
  }

  if (assets.domains.length > 0) {
    lines.push(`🌐 *\\.ton домены \\(${assets.domains.length}\\):*`);
    lines.push(...renderList(assets.domains));
    lines.push("");
  } else {
    lines.push("🌐 _Доменов нет_");
    lines.push("");
  }

  const mainTotal = assets.usernames.length + assets.numbers.length + assets.domains.length;
  lines.push(`📊 Итого: *${mainTotal}* основных активов`);
  if (assets.otherNfts.length > 0) {
    lines.push(`🖼 Других NFT: *${assets.otherNfts.length}*`);
  }

  return safeTruncate(lines.join("\n"));
}

export function formatNFTSearchResult(
  type: "username" | "number" | "domain",
  query: string,
  nftAddress: string,
  assets: WalletAssets,
): string {
  const typeLabels = { username: "👤 Юзернейм", number: "📞 Номер", domain: "🌐 Домен" };
  const lines: string[] = [];

  lines.push(`${typeLabels[type]}: *${escapeMarkdown(query)}*`);
  lines.push(`🔑 NFT: \`${nftAddress}\``);
  lines.push(`💼 Кошелёк: \`${assets.wallet}\``);
  lines.push("");

  if (assets.usernames.length > 0) {
    lines.push(`👤 *Юзернеймы \\(${assets.usernames.length}\\):*`);
    lines.push(...renderList(assets.usernames));
    lines.push("");
  }

  if (assets.numbers.length > 0) {
    lines.push(`📞 *Номера \\+888 \\(${assets.numbers.length}\\):*`);
    lines.push(...renderList(assets.numbers));
    lines.push("");
  }

  if (assets.domains.length > 0) {
    lines.push(`🌐 *\\.ton домены \\(${assets.domains.length}\\):*`);
    lines.push(...renderList(assets.domains));
    lines.push("");
  }

  const mainTotal = assets.usernames.length + assets.numbers.length + assets.domains.length;
  if (mainTotal === 0) {
    lines.push("_Основных активов не найдено_");
  } else {
    lines.push(`📊 Итого: *${mainTotal}* основных активов`);
  }
  if (assets.otherNfts.length > 0) {
    lines.push(`🖼 Других NFT: *${assets.otherNfts.length}*`);
  }

  return safeTruncate(lines.join("\n"));
}

export function formatOtherNfts(assets: WalletAssets): string {
  const lines: string[] = [];
  lines.push(`*🖼 Другие NFT \\(${assets.otherNfts.length}\\)*`);
  lines.push(`💼 \`${assets.wallet}\``);
  lines.push("");

  const show = assets.otherNfts.slice(0, 30);
  show.forEach(nft => {
    const name = nft.name
      ? escapeMarkdown(nft.name)
      : escapeMarkdown(shortAddr(nft.address));
    const col = nft.collection ? ` _${escapeMarkdown(nft.collection)}_` : "";
    lines.push(`• ${name}${col}`);
  });
  if (assets.otherNfts.length > 30) {
    lines.push(`_\\.\\.\\. и ещё ${assets.otherNfts.length - 30}_`);
  }

  return safeTruncate(lines.join("\n"));
}

export function formatFullList(
  title: string,
  wallet: string,
  items: string[],
): string {
  const lines: string[] = [];
  lines.push(`*${escapeMarkdown(title)} \\(${items.length}\\)*`);
  lines.push(`💼 \`${wallet}\``);
  lines.push("");
  items.forEach(item => lines.push(`• ${escapeMarkdown(item)}`));
  return safeTruncate(lines.join("\n"));
}
