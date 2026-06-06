import TelegramBot, { type InlineKeyboardMarkup } from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import {
  isTonAddress, isUsername, isNumber, isDomain,
  getWalletAssets, resolveUsername, resolveNumber, resolveDomain,
  invalidateWalletCache, invalidateLookupCache,
  checkFragment,
  type WalletAssets, type FragmentInfo,
} from "./ton";
import { formatWalletAssets, formatNFTSearchResult, paginateFullList } from "./format";
import { saveSession, getSession } from "./sessions";

const TELEGRAM_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const MAX_SHOWN = 20;

function fragmentText(fi: FragmentInfo | null): string {
  if (!fi) return "";
  const price = fi.priceTon != null ? ` — мин. ставка ${fi.priceTon} TON` : "";
  switch (fi.status) {
    case "on_auction":
      return `\n\n🔨 Идёт аукцион на Fragment${price}\n🔗 ${fi.url}`;
    case "on_sale":
      return `\n\n💎 Продаётся на Fragment${fi.priceTon != null ? ` за ${fi.priceTon} TON` : ""}\n🔗 ${fi.url}`;
    case "sold":
      return `\n\n✅ Был продан на Fragment (сейчас у владельца)\n🔗 ${fi.url}`;
    case "not_found":
    default:
      return `\n\n🔍 Не найден на Fragment — не является NFT`;
  }
}

function fragmentButton(fi: FragmentInfo | null): { text: string; url: string } | null {
  if (!fi) return null;
  switch (fi.status) {
    case "on_auction":
      return { text: `🔨 Аукцион${fi.priceTon != null ? ` — ${fi.priceTon} TON` : ""}`, url: fi.url };
    case "on_sale":
      return { text: `💎 Fragment${fi.priceTon != null ? ` — ${fi.priceTon} TON` : ""}`, url: fi.url };
    case "sold":
      return { text: "✅ Fragment (продан)", url: fi.url };
    default:
      return null;
  }
}

function tvWallet(addr: string) { return `https://tonviewer.com/${addr}`; }
function tvNFT(addr: string)    { return `https://tonviewer.com/${addr}`; }

function extraListButtons(wallet: string, assets: WalletAssets): { text: string; callback_data: string }[] {
  const extras: { text: string; callback_data: string }[] = [];
  if (assets.usernames.length > MAX_SHOWN) {
    const fid = saveSession({ type: "fl", wallet, listTitle: "👤 Все юзернеймы", listItems: assets.usernames });
    extras.push({ text: `👤 Все юзернеймы (${assets.usernames.length})`, callback_data: `f:${fid}` });
  }
  if (assets.numbers.length > MAX_SHOWN) {
    const fid = saveSession({ type: "fl", wallet, listTitle: "📞 Все номера +888", listItems: assets.numbers });
    extras.push({ text: `📞 Все номера (${assets.numbers.length})`, callback_data: `f:${fid}` });
  }
  if (assets.domains.length > MAX_SHOWN) {
    const fid = saveSession({ type: "fl", wallet, listTitle: "🌐 Все домены .ton", listItems: assets.domains });
    extras.push({ text: `🌐 Все домены (${assets.domains.length})`, callback_data: `f:${fid}` });
  }
  return extras;
}

function walletKeyboard(wallet: string, assets: WalletAssets): InlineKeyboardMarkup {
  const rid = saveSession({ type: "w", wallet });
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  rows.push([
    { text: "🔄 Обновить",  callback_data: `r:${rid}` },
    { text: "🌐 Tonviewer", url: tvWallet(wallet) },
  ]);
  const extras = extraListButtons(wallet, assets);
  for (let i = 0; i < extras.length; i += 2) rows.push(extras.slice(i, i + 2));
  return { inline_keyboard: rows };
}

function lookupKeyboard(
  type: "u" | "n" | "d",
  query: string,
  ownerWallet: string,
  nftAddress: string,
  assets: WalletAssets,
  fi: FragmentInfo | null = null,
): InlineKeyboardMarkup {
  const rid = saveSession({ type, query, wallet: ownerWallet, nftAddress });
  const wid = saveSession({ type: "w", wallet: ownerWallet });

  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];

  const firstRow: any[] = [
    { text: "🔄 Обновить", callback_data: `r:${rid}` },
    { text: "🌐 NFT",      url: tvNFT(nftAddress) },
  ];
  const fragBtn = fragmentButton(fi);
  if (fragBtn) firstRow.push(fragBtn);
  rows.push(firstRow);

  rows.push([
    { text: "💼 Кошелёк владельца", callback_data: `w:${wid}` },
    { text: "👁 Tonviewer",         url: tvWallet(ownerWallet) },
  ]);
  const extras = extraListButtons(ownerWallet, assets);
  for (let i = 0; i < extras.length; i += 2) rows.push(extras.slice(i, i + 2));
  return { inline_keyboard: rows };
}

export function startBot() {
  if (!TELEGRAM_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot not started");
    return;
  }

  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  logger.info("Telegram bot started (polling)");

  async function sendTyping(chatId: number | string) {
    try { await bot.sendChatAction(chatId, "typing"); } catch {}
  }

  async function replyMD(chatId: number | string, text: string, kb?: InlineKeyboardMarkup) {
    await bot.sendMessage(chatId, text, {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      ...(kb ? { reply_markup: kb } : {}),
    });
  }

  async function editMD(chatId: number | string, msgId: number, text: string, kb?: InlineKeyboardMarkup) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
        ...(kb ? { reply_markup: kb } : {}),
      });
    } catch (e: any) {
      if (!e?.message?.includes("message is not modified")) throw e;
    }
  }

  async function plain(chatId: number | string, text: string) {
    await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  }

  bot.onText(/\/start/, async (msg) => {
    await plain(msg.chat.id,
      "👋 Привет! Я анализирую TON кошельки и NFT активы.\n\n" +
      "Отправь мне:\n" +
      "• EQ... / UQ... — адрес кошелька\n" +
      "• @username — юзернейм\n" +
      "• +888... — анонимный номер\n" +
      "• example.ton — домен TON",
    );
  });

  bot.onText(/\/help/, async (msg) => {
    await plain(msg.chat.id,
      "📖 Форматы запросов:\n\n" +
      "🔹 EQAbc... или UQAbc... — кошелёк\n" +
      "🔹 @example — юзернейм\n" +
      "🔹 +888 1234 5678 — номер\n" +
      "🔹 example.ton — домен\n\n" +
      "⚡ Кэш: кошелёк 5 мин, поиск 10 мин.\n" +
      "🔄 «Обновить» — сброс кэша и свежие данные.\n" +
      "📋 «Все юзернеймы/номера/домены» — полный список (если > 20).",
    );
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text ?? "").trim();
    if (!text || text.startsWith("/")) return;
    await sendTyping(chatId);

    try {
      if (isTonAddress(text)) {
        await plain(chatId, "🔍 Анализирую кошелёк...");
        await sendTyping(chatId);
        const assets = await getWalletAssets(text);
        await replyMD(chatId, formatWalletAssets(assets, "Активы кошелька"), walletKeyboard(text, assets));
        return;
      }

      if (isUsername(text)) {
        await plain(chatId, `🔍 Ищу ${text}...`);
        await sendTyping(chatId);
        const clean = (text.startsWith("@") ? text.slice(1) : text).toLowerCase();
        const [result, fi] = await Promise.all([
          resolveUsername(text),
          checkFragment("username", clean),
        ]);
        if (!result) {
          await plain(chatId,
            `❌ Юзернейм @${clean} не найден в TON — не является Fragment NFT.` +
            fragmentText(fi),
          );
          return;
        }
        await replyMD(
          chatId,
          formatNFTSearchResult("username", text, result.nftAddress, result.assets),
          lookupKeyboard("u", clean, result.ownerWallet, result.nftAddress, result.assets, fi),
        );
        return;
      }

      if (isNumber(text)) {
        await plain(chatId, `🔍 Ищу ${text}...`);
        await sendTyping(chatId);
        const clean = text.replace(/\s/g, "");
        const [result, fi] = await Promise.all([
          resolveNumber(text),
          checkFragment("number", clean),
        ]);
        if (!result) {
          await plain(chatId,
            `❌ Номер ${clean} не найден в TON.` +
            fragmentText(fi),
          );
          return;
        }
        await replyMD(
          chatId,
          formatNFTSearchResult("number", text, result.nftAddress, result.assets),
          lookupKeyboard("n", clean, result.ownerWallet, result.nftAddress, result.assets, fi),
        );
        return;
      }

      if (isDomain(text)) {
        await plain(chatId, `🔍 Резолвлю ${text}...`);
        await sendTyping(chatId);
        const clean = text.toLowerCase().endsWith(".ton") ? text.toLowerCase() : `${text.toLowerCase()}.ton`;
        const domainName = clean.replace(/\.ton$/, "");
        const [result, fi] = await Promise.all([
          resolveDomain(text),
          checkFragment("domain", domainName),
        ]);
        if (!result) {
          await plain(chatId,
            `❌ Домен ${clean} не найден в TON DNS.` +
            fragmentText(fi),
          );
          return;
        }
        await replyMD(
          chatId,
          formatNFTSearchResult("domain", text, result.nftAddress, result.assets),
          lookupKeyboard("d", clean, result.ownerWallet, result.nftAddress, result.assets, fi),
        );
        return;
      }

      await plain(chatId,
        "❓ Не распознал. Отправь:\n• EQ... — кошелёк\n• @username\n• +888...\n• example.ton",
      );
    } catch (err: any) {
      logger.error({ err: err?.message, chatId, text }, "Message handler error");
      await plain(chatId, `⚠️ ${err?.message ?? "Неизвестная ошибка"}. Попробуй позже.`);
    }
  });

  bot.on("callback_query", async (cbq) => {
    const chatId = cbq.message?.chat.id;
    const msgId  = cbq.message?.message_id;
    const data   = cbq.data ?? "";

    try { await bot.answerCallbackQuery(cbq.id); } catch {}
    if (!chatId || !msgId) return;

    try {
      const colon   = data.indexOf(":");
      const action  = data.slice(0, colon);
      const sid     = data.slice(colon + 1);
      const session = getSession(sid);

      if (!session) {
        await plain(chatId, "⚠️ Сессия устарела. Отправь запрос заново.");
        return;
      }

      // Show full list in separate messages
      if (action === "f") {
        await sendTyping(chatId);
        const pages = paginateFullList(
          session.listTitle ?? "Список",
          session.wallet ?? "",
          session.listItems ?? [],
        );
        for (const page of pages) await replyMD(chatId, page);
        return;
      }

      // Open wallet as NEW message (not edit)
      if (action === "w") {
        await sendTyping(chatId);
        const assets = await getWalletAssets(session.wallet!);
        await replyMD(chatId, formatWalletAssets(assets, "Активы кошелька"), walletKeyboard(session.wallet!, assets));
        return;
      }

      // Refresh (edit current message)
      if (action === "r") {
        await sendTyping(chatId);
        const { type, wallet, query, nftAddress } = session;

        if (type === "w") {
          invalidateWalletCache(wallet!);
          const assets = await getWalletAssets(wallet!);
          await editMD(chatId, msgId,
            formatWalletAssets(assets, "Активы кошелька"),
            walletKeyboard(wallet!, assets),
          );
          return;
        }

        if (type === "u") {
          invalidateLookupCache(`username:${query}`);
          invalidateWalletCache(wallet!);
          const result = await resolveUsername(query!);
          if (!result) { await plain(chatId, "❌ Юзернейм не найден."); return; }
          await editMD(chatId, msgId,
            formatNFTSearchResult("username", `@${query}`, result.nftAddress, result.assets),
            lookupKeyboard("u", query!, result.ownerWallet, result.nftAddress, result.assets),
          );
          return;
        }

        if (type === "n") {
          invalidateLookupCache(`number:${query}`);
          invalidateWalletCache(wallet!);
          const result = await resolveNumber(query!);
          if (!result) { await plain(chatId, "❌ Номер не найден."); return; }
          await editMD(chatId, msgId,
            formatNFTSearchResult("number", query!, result.nftAddress, result.assets),
            lookupKeyboard("n", query!, result.ownerWallet, result.nftAddress, result.assets),
          );
          return;
        }

        if (type === "d") {
          invalidateLookupCache(`domain:${query}`);
          invalidateWalletCache(wallet!);
          const result = await resolveDomain(query!);
          if (!result) { await plain(chatId, "❌ Домен не найден."); return; }
          await editMD(chatId, msgId,
            formatNFTSearchResult("domain", query!, result.nftAddress, result.assets),
            lookupKeyboard("d", query!, result.ownerWallet, result.nftAddress, result.assets),
          );
          return;
        }
      }
    } catch (err: any) {
      logger.error({ err: err?.message, data }, "Callback handler error");
      await plain(chatId, `⚠️ ${err?.message ?? "Ошибка"}. Попробуй позже.`);
    }
  });

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling error");
  });

  return bot;
}
