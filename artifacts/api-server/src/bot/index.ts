import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import {
  isTonAddress,
  isUsername,
  isNumber,
  isDomain,
  getWalletAssets,
  resolveUsername,
  resolveNumber,
  resolveDomain,
} from "./ton";
import { formatWalletAssets, formatNFTSearchResult } from "./format";

const TELEGRAM_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";

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

  async function reply(chatId: number | string, text: string) {
    await bot.sendMessage(chatId, text, {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    });
  }

  async function replyPlain(chatId: number | string, text: string) {
    await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await replyPlain(
      chatId,
      "👋 Привет! Я анализирую TON кошельки и NFT активы.\n\n" +
      "Отправь мне:\n" +
      "• Адрес кошелька TON (EQ... / UQ...) — покажу все юзернеймы, +888 номера и .ton домены\n" +
      "• @username — найду NFT юзернейма и все активы владельца\n" +
      "• +888... номер — найду NFT номера и активы владельца\n" +
      "• example.ton — резолвну домен и покажу все активы владельца"
    );
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await replyPlain(
      chatId,
      "📖 Как пользоваться:\n\n" +
      "🔹 Адрес кошелька — EQAbc... или UQAbc...\n" +
      "🔹 Юзернейм — @example\n" +
      "🔹 Номер — +888 1234 5678\n" +
      "🔹 Домен — example.ton\n\n" +
      "Бот покажет все NFT активы: юзернеймы, +888 номера, .ton домены и другие NFT.\n\n" +
      "⚡ Повторные запросы отвечают из кэша мгновенно (кэш 5–10 мин)."
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
        const formatted = formatWalletAssets(assets, "Активы кошелька");
        await reply(chatId, formatted);
        return;
      }

      if (isUsername(text)) {
        await replyPlain(chatId, `🔍 Ищу юзернейм ${text}...`);
        await sendTyping(chatId);
        const result = await resolveUsername(text);
        if (!result) {
          await replyPlain(chatId, `❌ Юзернейм ${text} не найден.`);
          return;
        }
        const formatted = formatNFTSearchResult("username", text, result.nftAddress, result.assets);
        await reply(chatId, formatted);
        return;
      }

      if (isNumber(text)) {
        await replyPlain(chatId, `🔍 Ищу номер ${text}...`);
        await sendTyping(chatId);
        const result = await resolveNumber(text);
        if (!result) {
          await replyPlain(chatId, `❌ Номер ${text} не найден.`);
          return;
        }
        const formatted = formatNFTSearchResult("number", text, result.nftAddress, result.assets);
        await reply(chatId, formatted);
        return;
      }

      if (isDomain(text)) {
        await replyPlain(chatId, `🔍 Резолвлю домен ${text}...`);
        await sendTyping(chatId);
        const result = await resolveDomain(text);
        if (!result) {
          await replyPlain(chatId, `❌ Домен ${text} не найден.`);
          return;
        }
        const formatted = formatNFTSearchResult("domain", text, result.nftAddress, result.assets);
        await reply(chatId, formatted);
        return;
      }

      await replyPlain(
        chatId,
        "❓ Не распознал формат. Отправь:\n" +
        "• Адрес кошелька: EQ... или UQ...\n" +
        "• Юзернейм: @example\n" +
        "• Номер: +888 1234 5678\n" +
        "• Домен: example.ton"
      );
    } catch (err: any) {
      logger.error({ err: err?.message, chatId, text }, "Bot handler error");
      await replyPlain(chatId, `⚠️ ${err?.message ?? "Неизвестная ошибка"}. Попробуй позже.`);
    }
  });

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling error");
  });

  return bot;
}
