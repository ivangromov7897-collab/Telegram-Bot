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
import {
  addWatch, removeWatch, getUserWatches, startWatcher,
  type WatchType,
} from "./watches";

const TELEGRAM_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const MAX_SHOWN = 20;

function fragmentText(fi: FragmentInfo | null): string {
  if (!fi) return "";
  switch (fi.status) {
    case "on_auction": {
      const bid = fi.minBidTon != null ? ` — мин. ставка ${fi.minBidTon} TON` : "";
      return `\n\n🔨 Идёт аукцион на Fragment${bid}\n🔗 ${fi.url}`;
    }
    case "on_sale": {
      const price = fi.minBidTon != null ? ` за ${fi.minBidTon} TON` : "";
      return `\n\n💎 Продаётся на Fragment${price}\n🔗 ${fi.url}`;
    }
    default:
      return `\n\n🔍 Не найден на Fragment — не является NFT`;
  }
}

function fragmentButton(fi: FragmentInfo | null): { text: string; url: string } | null {
  if (!fi) return null;
  switch (fi.status) {
    case "on_auction":
      return { text: `🔨 Аукцион${fi.minBidTon != null ? ` — ${fi.minBidTon} TON` : ""}`, url: fi.url };
    case "on_sale":
      return { text: `💎 Купить${fi.minBidTon != null ? ` — ${fi.minBidTon} TON` : ""}`, url: fi.url };
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

  if (fi?.status === "on_auction") {
    const wType: WatchType = type === "u" ? "username" : type === "n" ? "number" : "domain";
    const displayLabel = wType === "username" ? `@${query}` : query;
    const sid = saveSession({
      type: "watch",
      watchType: wType,
      watchQuery: query,
      displayLabel,
      fragmentStatus: fi.status,
      minBidTon: fi.minBidTon,
    });
    rows.push([{ text: "🔔 Следить за аукционом", callback_data: `watch:${sid}` }]);
  }

  const extras = extraListButtons(ownerWallet, assets);
  for (let i = 0; i < extras.length; i += 2) rows.push(extras.slice(i, i + 2));
  return { inline_keyboard: rows };
}

function auctionNotFoundKeyboard(
  wType: WatchType,
  query: string,
  displayLabel: string,
  fi: FragmentInfo,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  const fragBtn = fragmentButton(fi);
  const row1: any[] = [];
  if (fragBtn) row1.push(fragBtn);

  const sid = saveSession({
    type: "watch",
    watchType: wType,
    watchQuery: query,
    displayLabel,
    fragmentStatus: fi.status,
    minBidTon: fi.minBidTon,
  });
  row1.push({ text: "🔔 Следить", callback_data: `watch:${sid}` });
  rows.push(row1);
  return { inline_keyboard: rows };
}

export function startBot() {
  if (!TELEGRAM_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot not started");
    return;
  }

  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  logger.info("Telegram bot started (polling)");
  startWatcher(bot);

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

  async function plain(chatId: number | string, text: string, kb?: InlineKeyboardMarkup) {
    await bot.sendMessage(chatId, text, {
      disable_web_page_preview: true,
      ...(kb ? { reply_markup: kb } : {}),
    });
  }

  bot.onText(/\/start/, async (msg) => {
    await plain(msg.chat.id,
      "👋 Привет! Я анализирую TON кошельки и NFT активы.\n\n" +
      "Отправь мне:\n" +
      "• EQ... / UQ... — адрес кошелька\n" +
      "• @username — юзернейм\n" +
      "• +888... — анонимный номер\n" +
      "• example.ton — домен TON\n\n" +
      "📡 /watches — мои активные подписки на аукционы",
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
      "📋 «Все юзернеймы/номера/домены» — полный список (если > 20).\n" +
      "🔔 «Следить» — уведомление об окончании аукциона.\n" +
      "📡 /watches — список активных подписок.",
    );
  });

  bot.onText(/\/watches/, async (msg) => {
    const chatId = msg.chat.id;
    const watches = getUserWatches(chatId);
    if (watches.length === 0) {
      await plain(chatId, "📭 У тебя нет активных подписок на аукционы.\n\nНайди юзернейм/номер/домен с активным аукционом и нажми 🔔 Следить.");
      return;
    }

    const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
    const lines = ["📡 *Активные подписки:*\n"];
    watches.forEach((w, i) => {
      const typeIcon = w.type === "username" ? "👤" : w.type === "number" ? "📞" : "🌐";
      const bid = w.lastMinBid != null ? ` — мин. ставка ${w.lastMinBid} TON` : "";
      lines.push(`${i + 1}. ${typeIcon} ${w.displayLabel}${bid}`);
      const sid = saveSession({ type: "unwatch", watchType: w.type, watchQuery: w.query, displayLabel: w.displayLabel });
      rows.push([{ text: `❌ ${w.displayLabel}`, callback_data: `unwatch:${sid}` }]);
    });

    await bot.sendMessage(chatId, lines.join("\n"), {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: rows },
    });
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
          const msg2 = `❌ Юзернейм @${clean} не найден в TON — не является Fragment NFT.` + fragmentText(fi);
          const kb = fi?.status === "on_auction"
            ? auctionNotFoundKeyboard("username", clean, `@${clean}`, fi)
            : undefined;
          await plain(chatId, msg2, kb);
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
          const msg2 = `❌ Номер ${clean} не найден в TON.` + fragmentText(fi);
          const kb = fi?.status === "on_auction"
            ? auctionNotFoundKeyboard("number", clean, clean, fi)
            : undefined;
          await plain(chatId, msg2, kb);
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
          const msg2 = `❌ Домен ${clean} не найден в TON DNS.` + fragmentText(fi);
          const kb = fi?.status === "on_auction"
            ? auctionNotFoundKeyboard("domain", clean, clean, fi)
            : undefined;
          await plain(chatId, msg2, kb);
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
      const colon  = data.indexOf(":");
      const action = data.slice(0, colon);
      const sid    = data.slice(colon + 1);
      const session = getSession(sid);

      if (!session) {
        await plain(chatId, "⚠️ Сессия устарела. Отправь запрос заново.");
        return;
      }

      if (action === "watch") {
        const { watchType, watchQuery, displayLabel, fragmentStatus, minBidTon } = session;
        if (!watchType || !watchQuery || !displayLabel || !fragmentStatus) return;
        const added = addWatch(chatId, watchType, watchQuery, displayLabel, fragmentStatus, minBidTon);
        if (added) {
          const bid = minBidTon != null ? ` (мин. ставка: ${minBidTon} TON)` : "";
          await plain(chatId,
            `🔔 Подписка оформлена!\n\nБуду следить за аукционом ${displayLabel}${bid}.\n` +
            `Уведомлю когда:\n• Аукцион завершится\n• Изменится минимальная ставка\n\n` +
            `📡 /watches — управление подписками`
          );
        } else {
          await plain(chatId, `ℹ️ Ты уже следишь за ${displayLabel}.`);
        }
        return;
      }

      if (action === "unwatch") {
        const { watchType, watchQuery, displayLabel } = session;
        if (!watchType || !watchQuery || !displayLabel) return;
        const removed = removeWatch(chatId, watchType, watchQuery);
        await plain(chatId, removed
          ? `✅ Подписка на ${displayLabel} отменена.`
          : `ℹ️ Подписка не найдена.`
        );
        return;
      }

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

      if (action === "w") {
        await sendTyping(chatId);
        const assets = await getWalletAssets(session.wallet!);
        await replyMD(chatId, formatWalletAssets(assets, "Активы кошелька"), walletKeyboard(session.wallet!, assets));
        return;
      }

      if (action === "r") {
        await sendTyping(chatId);
        const { type, wallet, query, nftAddress } = session;

        if (type === "w") {
          invalidateWalletCache(wallet!);
          const assets = await getWalletAssets(wallet!);
          await editMD(chatId, msgId, formatWalletAssets(assets, "Активы кошелька"), walletKeyboard(wallet!, assets));
          return;
        }

        if (type === "u") {
          invalidateLookupCache(`username:${query}`);
          invalidateWalletCache(wallet!);
          const [result, fi] = await Promise.all([resolveUsername(query!), checkFragment("username", query!)]);
          if (!result) { await plain(chatId, "❌ Юзернейм не найден." + fragmentText(fi)); return; }
          await editMD(chatId, msgId,
            formatNFTSearchResult("username", `@${query}`, result.nftAddress, result.assets),
            lookupKeyboard("u", query!, result.ownerWallet, result.nftAddress, result.assets, fi),
          );
          return;
        }

        if (type === "n") {
          invalidateLookupCache(`number:${query}`);
          invalidateWalletCache(wallet!);
          const [result, fi] = await Promise.all([resolveNumber(query!), checkFragment("number", query!)]);
          if (!result) { await plain(chatId, "❌ Номер не найден." + fragmentText(fi)); return; }
          await editMD(chatId, msgId,
            formatNFTSearchResult("number", query!, result.nftAddress, result.assets),
            lookupKeyboard("n", query!, result.ownerWallet, result.nftAddress, result.assets, fi),
          );
          return;
        }

        if (type === "d") {
          invalidateLookupCache(`domain:${query}`);
          invalidateWalletCache(wallet!);
          const domainName = (query ?? "").replace(/\.ton$/, "");
          const [result, fi] = await Promise.all([resolveDomain(query!), checkFragment("domain", domainName)]);
          if (!result) { await plain(chatId, "❌ Домен не найден." + fragmentText(fi)); return; }
          await editMD(chatId, msgId,
            formatNFTSearchResult("domain", query!, result.nftAddress, result.assets),
            lookupKeyboard("d", query!, result.ownerWallet, result.nftAddress, result.assets, fi),
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
