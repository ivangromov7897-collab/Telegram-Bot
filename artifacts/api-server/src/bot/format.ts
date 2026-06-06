import type { WalletAssets } from "./ton";

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function shortAddr(addr: string): string {
  if (addr.length > 12) {
    return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
  }
  return addr;
}

export function formatWalletAssets(assets: WalletAssets, title: string): string {
  const lines: string[] = [];

  lines.push(`*${escapeMarkdown(title)}*`);
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

  if (assets.otherNfts.length > 0) {
    lines.push(`🖼️ *Другие NFT \\(${assets.otherNfts.length}\\):*`);
    const show = assets.otherNfts.slice(0, 10);
    show.forEach(nft => {
      const name = nft.name ? escapeMarkdown(nft.name) : escapeMarkdown(shortAddr(nft.address));
      const col = nft.collection ? ` \\(${escapeMarkdown(nft.collection)}\\)` : "";
      lines.push(`  • ${name}${col}`);
    });
    if (assets.otherNfts.length > 10) {
      lines.push(`  _\\.\\.\\. и ещё ${assets.otherNfts.length - 10}_`);
    }
    lines.push("");
  }

  const total = assets.usernames.length + assets.numbers.length + assets.domains.length + assets.otherNfts.length;
  if (total === 0) {
    lines.push("_NFT активов не найдено_");
  } else {
    lines.push(`📊 Всего NFT: *${total}*`);
  }

  return lines.join("\n");
}

export function formatNFTSearchResult(
  type: "username" | "number" | "domain",
  query: string,
  nftAddress: string,
  assets: WalletAssets,
): string {
  const typeLabels = {
    username: "👤 Юзернейм",
    number: "📞 Номер",
    domain: "🌐 Домен",
  };

  const lines: string[] = [];
  const label = typeLabels[type];

  lines.push(`${label}: *${escapeMarkdown(query)}*`);
  lines.push(`🔑 NFT адрес: \`${nftAddress}\``);
  lines.push(`💼 Кошелёк владельца: \`${assets.wallet}\``);
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

  if (assets.otherNfts.length > 0) {
    lines.push(`🖼️ *Другие NFT \\(${assets.otherNfts.length}\\):*`);
    const show = assets.otherNfts.slice(0, 10);
    show.forEach(nft => {
      const name = nft.name ? escapeMarkdown(nft.name) : `${nft.address.slice(0, 6)}\\.\\.\\.${ nft.address.slice(-6)}`;
      const col = nft.collection ? ` \\(${escapeMarkdown(nft.collection)}\\)` : "";
      lines.push(`  • ${name}${col}`);
    });
    if (assets.otherNfts.length > 10) {
      lines.push(`  _\\.\\.\\. и ещё ${assets.otherNfts.length - 10}_`);
    }
    lines.push("");
  }

  const total = assets.usernames.length + assets.numbers.length + assets.domains.length + assets.otherNfts.length;
  lines.push(`📊 Всего активов на кошельке: *${total}*`);

  return lines.join("\n");
}
