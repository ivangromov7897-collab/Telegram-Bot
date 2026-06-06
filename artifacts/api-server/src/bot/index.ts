import TelegramBot, { type InlineKeyboardMarkup } from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import {
  isTonAddress, isUsername, isNumber, isDomain,
  getWalletAssets, resolveUsername, resolveNumber, resolveDomain,
  invalidateWalletCache, invalidateLookupCache,
} from "./ton";
import {
  formatWalletAssets, formatNFTSearchResult, formatOtherNfts,
} from "./format";

const TELEGRAM_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";

function tonviewerWallet(addr: string) {
  return `https://tonviewer.com/${addr}`;
}
function tonviewerNFT(addr: string) {
  return `https://tonviewer.com/${addr}`;
}

function walletKeyboard(wallet: string, otherCount: number): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  rows.push([
    { text: "🔄 Обновить", callback_data: `r:w:${wallet}` },
    { text: "🌐 Tonviewer", url: tonviewerWallet(wallet) },
  ]);
  if (otherCount > 0) {
    rows.push([
      { text: `🖼 Другие NFT (${otherCount})`, callback_data: `on:w:${wallet}` },
    ]);
  }
  return { inline_keyboard: rows };
}

function lookupKeyboard(
  type: "u" | "n" | "d",
  query: string,
  ownerWallet: string,
  nftAddress: string,
  otherCount: number,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  rows.push([
    { text: "🔄 Обновить", callback_data: `r:${type}:${query}` },
    { text: "🌐 NFT", url: tonviewerNFT(nftAddress) },
  ]);
  rows.push([
    { text: "💼 Открыть кошелёк", callback_data: `r:w:${ownerWallet}` },
    { text: "👁 Tonviewer", url: tonviewerWallet(ownerWallet) },
  ]);
  if (otherCount > 0) {
    rows.push([
      { text: `🖼 Другие NFT (${otherCount})`, callback_data: `on:w:${ownerWallet}` },
    ]);
  }
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

  async function replyMD(
    chatId: number | string,
    text: string,
    keyboard?: InlineKeyboardMarkup,
  ) {
    await bot.sendMessage(chatId, text, {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  async function editMD(
    chatId: number | string,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboardMarkup,
  ) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  async function replyPlain(chatId: number | string, text: string) {
    await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  }

  bot.onText(/\/start/, async (msg) => {
    await replyPlain(
      msg.chat.id,
      "👋 Привет\\! Я анализирую TON кошельки и NFT активы\\.\n\n" +
      "Отправь мне:\n" +
      "• Адрес кошелька EQ\\.\\.\\. / UQ\\.\\.\\. → все юзернеймы, номера и домены\n" +
      "• @username → владелец и все его активы\n" +
      "• \\+888\\.\\.\\. → владелец и все его активы\n" +
      "• example\\.ton → владелец и все его активы",
    );
  });

  bot.onText(/\/help/, async (msg) => {
    await replyPlain(
      msg.chat.id,
      "📖 Форматы запросов:\n\n" +
      "🔹 Адрес кошелька — EQAbc... или UQAbc...\n" +
      "🔹 Юзернейм — @example\n" +
      "🔹 Номер — +888 1234 5678\n" +
      "🔹 Домен — example.ton\n\n" +
      "⚡ Кэш: кошелёк 5 мин, поиск 10 мин.\n" +
      "🔄 Кнопка «Обновить» сбрасывает кэш.\n" +
      "🖼 Кнопка «Другие NFT» показывает SBT и коллекции без спама.",
    );
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text ?? "").trim();
    if (!text || text.startsWith("/")) return;

    await sendTyping(chatId);

    try {
      if (isTonAddress(text)) {
        await replyPlain(chatId, "🔍 Анализирую кошелёк...");
        await sendTyping(chatId);
        const assets = await getWalletAssets(text);
        await replyMD(
          chatId,
          formatWalletAssets(assets, "Активы кошелька"),
          walletKeyboard(text, assets.otherNfts.length),
        );
        return;
      }

      if (isUsername(text)) {
        await replyPlain(chatId, `🔍 Ищу ${text}...`);
        await sendTyping(chatId);
        const result = await resolveUsername(text);
        if (!result) { await replyPlain(chatId, `❌ Юзернейм ${text} не найден.`); return; }
        const clean = text.startsWith("@") ? text.slice(1).toLowerCase() : text.toLowerCase();
        await replyMD(
          chatId,
          formatNFTSearchResult("username", text, result.nftAddress, result.assets),
          lookupKeyboard("u", clean, result.ownerWallet, result.nftAddress, result.assets.otherNfts.length),
        );
        return;
      }

      if (isNumber(text)) {
        await replyPlain(chatId, `🔍 Ищу ${text}...`);
        await sendTyping(chatId);
        const result = await resolveNumber(text);
        if (!result) { await replyPlain(chatId, `❌ Номер ${text} не найден.`); return; }
        const clean = text.replace(/\s/g, "");
        await replyMD(
          chatId,
          formatNFTSearchResult("number", text, result.nftAddress, result.assets),
          lookupKeyboard("n", clean, result.ownerWallet, result.nftAddress, result.assets.otherNfts.length),
        );
        return;
      }

      if (isDomain(text)) {
        await replyPlain(chatId, `🔍 Резолвлю ${text}...`);
        await sendTyping(chatId);
        const result = await resolveDomain(text);
        if (!result) { await replyPlain(chatId, `❌ Домен ${text} не найден.`); return; }
        const clean = text.toLowerCase().endsWith(".ton") ? text.toLowerCase() : `${text.toLowerCase()}.ton`;
        await replyMD(
          chatId,
          formatNFTSearchResult("domain", text, result.nftAddress, result.assets),
          lookupKeyboard("d", clean, result.ownerWallet, result.nftAddress, result.assets.otherNfts.length),
        );
        return;
      }

      await replyPlain(chatId,
        "❓ Не распознал формат. Отправь:\n" +
        "• EQ... / UQ... — адрес кошелька\n" +
        "• @username\n" +
        "• +888 1234 5678\n" +
        "• example.ton",
      );
    } catch (err: any) {
      logger.error({ err: err?.message, chatId, text }, "Bot handler error");
      await replyPlain(chatId, `⚠️ ${err?.message ?? "Неизвестная ошибка"}. Попробуй позже.`);
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const data = query.data ?? "";

    await bot.answerCallbackQuery(query.id);

    if (!chatId || !messageId) return;

    try {
      const [action, type, ...rest] = data.split(":");
      const payload = rest.join(":");

      if (action === "on" && type === "w") {
        const assets = await getWalletAssets(payload);
        if (assets.otherNfts.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: "Других NFT нет." });
          return;
        }
        await replyMD(chatId, formatOtherNfts(assets));
        return;
      }

      if (action === "r") {
        await sendTyping(chatId);

        if (type === "w") {
          invalidateWalletCache(payload);
          const assets = await getWalletAssets(payload);
          await editMD(
            chatId, messageId,
            formatWalletAssets(assets, "Активы кошелька"),
            walletKeyboard(payload, assets.otherNfts.length),
          );
          return;
        }

        if (type === "u") {
          const query_key = `username:${payload}`;
          invalidateLookupCache(query_key);
          const result = await resolveUsername(payload);
          if (!result) {
            await bot.answerCallbackQuery(query.id, { text: "Юзернейм не найден." });
            return;
          }
          invalidateWalletCache(result.ownerWallet);
          const fresh = await resolveUsername(payload);
          if (!fresh) return;
          await editMD(
            chatId, messageId,
            formatNFTSearchResult("username", `@${payload}`, fresh.nftAddress, fresh.assets),
            lookupKeyboard("u", payload, fresh.ownerWallet, fresh.nftAddress, fresh.assets.otherNfts.length),
          );
          return;
        }

        if (type === "n") {
          invalidateLookupCache(`number:${payload}`);
          const result = await resolveNumber(payload);
          if (!result) {
            await bot.answerCallbackQuery(query.id, { text: "Номер не найден." });
            return;
          }
          invalidateWalletCache(result.ownerWallet);
          const fresh = await resolveNumber(payload);
          if (!fresh) return;
          await editMD(
            chatId, messageId,
            formatNFTSearchResult("number", payload, fresh.nftAddress, fresh.assets),
            lookupKeyboard("n", payload, fresh.ownerWallet, fresh.nftAddress, fresh.assets.otherNfts.length),
          );
          return;
        }

        if (type === "d") {
          invalidateLookupCache(`domain:${payload}`);
          const result = await resolveDomain(payload);
          if (!result) {
            await bot.answerCallbackQuery(query.id, { text: "Домен не найден." });
            return;
          }
          invalidateWalletCache(result.ownerWallet);
          const fresh = await resolveDomain(payload);
          if (!fresh) return;
          await editMD(
            chatId, messageId,
            formatNFTSearchResult("domain", payload, fresh.nftAddress, fresh.assets),
            lookupKeyboard("d", payload, fresh.ownerWallet, fresh.nftAddress, fresh.assets.otherNfts.length),
          );
          return;
        }
      }
    } catch (err: any) {
      logger.error({ err: err?.message, data }, "Callback handler error");
      await replyPlain(chatId, `⚠️ ${err?.message ?? "Ошибка"}. Попробуй позже.`);
    }
  });

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling error");
  });

  return bot;
}
