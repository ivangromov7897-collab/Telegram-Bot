import type { WalletAssets } from "./ton";

export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function shortAddr(addr: string): string {
  if (addr.length > 12) return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
  return addr;
}

export function formatWalletAssets(assets: WalletAssets, title: string): string {
  const lines: string[] = [];

  lines.push(`*${escapeMarkdown(title)}*`);
  lines.push(`💼 \`${assets.wallet}\``);
  lines.push("");

  if (assets.usernames.length > 0) {
    lines.push(`👤 *Юзернеймы \\(${assets.usernames.length}\\):*`);
    assets.usernames.forEach(u => lines.push(`  • ${escapeMarkdown(u)}`));
    lines.push("");
  } else {
    lines.push("👤 _Юзернеймов нет_");
    lines.push("");
  }

  if (assets.numbers.length > 0) {
    lines.push(`📞 *Номера \\+888 \\(${assets.numbers.length}\\):*`);
    assets.numbers.forEach(n => lines.push(`  • ${escapeMarkdown(n)}`));
    lines.push("");
  } else {
    lines.push("📞 _Номеров нет_");
    lines.push("");
  }

  if (assets.domains.length > 0) {
    lines.push(`🌐 *\\.ton домены \\(${assets.domains.length}\\):*`);
    assets.domains.forEach(d => lines.push(`  • ${escapeMarkdown(d)}`));
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

  return lines.join("\n");
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
    assets.usernames.forEach(u => lines.push(`  • ${escapeMarkdown(u)}`));
    lines.push("");
  }

  if (assets.numbers.length > 0) {
    lines.push(`📞 *Номера \\+888 \\(${assets.numbers.length}\\):*`);
    assets.numbers.forEach(n => lines.push(`  • ${escapeMarkdown(n)}`));
    lines.push("");
  }

  if (assets.domains.length > 0) {
    lines.push(`🌐 *\\.ton домены \\(${assets.domains.length}\\):*`);
    assets.domains.forEach(d => lines.push(`  • ${escapeMarkdown(d)}`));
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

  return lines.join("\n");
}

export function formatOtherNfts(assets: WalletAssets): string {
  const lines: string[] = [];
  lines.push(`*🖼 Другие NFT \\(${assets.otherNfts.length}\\)*`);
  lines.push(`💼 \`${assets.wallet}\``);
  lines.push("");

  assets.otherNfts.forEach(nft => {
    const name = nft.name
      ? escapeMarkdown(nft.name)
      : escapeMarkdown(shortAddr(nft.address));
    const col = nft.collection ? ` _${escapeMarkdown(nft.collection)}_` : "";
    lines.push(`• ${name}${col}`);
  });

  return lines.join("\n");
}
