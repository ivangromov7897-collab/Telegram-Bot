import { logger } from "../lib/logger";
import {
  checkFragment, resolveUsername, resolveNumber, resolveDomain,
  invalidateLookupCache, type FragmentStatus,
} from "./ton";
import type TelegramBot from "node-telegram-bot-api";

export type WatchType = "username" | "number" | "domain";

export interface WatchEntry {
  chatId: number | string;
  type: WatchType;
  query: string;
  displayLabel: string;
  lastStatus: FragmentStatus | "owned";
  lastMinBid?: number;
  addedAt: number;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000;

const store = new Map<string, WatchEntry[]>();

function key(type: WatchType, query: string) {
  return `${type}:${query}`;
}

export function addWatch(
  chatId: number | string,
  type: WatchType,
  query: string,
  displayLabel: string,
  lastStatus: FragmentStatus | "owned",
  lastMinBid?: number,
): boolean {
  const k = key(type, query);
  const list = store.get(k) ?? [];
  if (list.some(w => String(w.chatId) === String(chatId))) return false;
  list.push({ chatId, type, query, displayLabel, lastStatus, lastMinBid, addedAt: Date.now() });
  store.set(k, list);
  logger.info({ type, query, chatId }, "Watch added");
  return true;
}

export function removeWatch(chatId: number | string, type: WatchType, query: string): boolean {
  const k = key(type, query);
  const list = store.get(k) ?? [];
  const filtered = list.filter(w => String(w.chatId) !== String(chatId));
  if (filtered.length === list.length) return false;
  if (filtered.length === 0) store.delete(k);
  else store.set(k, filtered);
  logger.info({ type, query, chatId }, "Watch removed");
  return true;
}

export function getUserWatches(chatId: number | string): WatchEntry[] {
  const result: WatchEntry[] = [];
  for (const list of store.values()) {
    for (const w of list) {
      if (String(w.chatId) === String(chatId)) result.push(w);
    }
  }
  return result.sort((a, b) => a.addedAt - b.addedAt);
}

export function watchCount(): number {
  let n = 0;
  for (const list of store.values()) n += list.length;
  return n;
}

function typeLabel(type: WatchType): string {
  return type === "username" ? "юзернейм" : type === "number" ? "номер" : "домен";
}

async function checkItem(entry: WatchEntry): Promise<{ status: FragmentStatus | "owned"; minBid?: number }> {
  const { type, query } = entry;

  invalidateLookupCache(`${type}:${query}`);

  let isOwned = false;
  try {
    let resolved: any = null;
    if (type === "username") resolved = await resolveUsername(query);
    else if (type === "number") resolved = await resolveNumber(query);
    else resolved = await resolveDomain(query);
    if (resolved) isOwned = true;
  } catch {}

  if (isOwned) return { status: "owned" };

  const fi = await checkFragment(type, query);
  return { status: fi?.status ?? "not_found", minBid: fi?.minBidTon };
}

export function startWatcher(bot: TelegramBot) {
  async function tick() {
    const allKeys = [...store.keys()];
    for (const k of allKeys) {
      const list = store.get(k);
      if (!list || list.length === 0) { store.delete(k); continue; }

      const entry = list[0];
      try {
        const { status: newStatus, minBid: newMinBid } = await checkItem(entry);

        const toRemove: WatchEntry[] = [];

        for (const watcher of list) {
          const { lastStatus, lastMinBid, displayLabel } = watcher;
          let msg: string | null = null;

          if (lastStatus === "on_auction") {
            if (newStatus === "owned") {
              msg =
                `🎉 Аукцион ${displayLabel} завершён!\n` +
                `${typeLabel(entry.type).charAt(0).toUpperCase() + typeLabel(entry.type).slice(1)} теперь принадлежит владельцу.\n\n` +
                `Используй ${displayLabel} для проверки кошелька.`;
              toRemove.push(watcher);
            } else if (newStatus === "not_found") {
              msg = `🏁 Аукцион ${displayLabel} завершился — ${typeLabel(entry.type)} не куплен.`;
              toRemove.push(watcher);
            } else if (newStatus === "on_auction" && newMinBid != null && lastMinBid != null && newMinBid !== lastMinBid) {
              msg =
                `📈 Изменилась мин. ставка для ${displayLabel}:\n` +
                `${lastMinBid} TON → *${newMinBid} TON*`;
            }
          } else if (lastStatus === "not_found" && newStatus === "on_auction") {
            msg =
              `🔔 ${displayLabel} появился на аукционе Fragment!\n` +
              `Мин. ставка: ${newMinBid ?? "?"} TON`;
          }

          if (msg) {
            try {
              await bot.sendMessage(String(watcher.chatId), msg, {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
              });
            } catch (e: any) {
              logger.warn({ chatId: watcher.chatId, err: e?.message }, "Watch notify failed");
            }
          }

          watcher.lastStatus = newStatus;
          watcher.lastMinBid = newMinBid;
        }

        for (const w of toRemove) {
          removeWatch(w.chatId, entry.type, entry.query);
        }
      } catch (e: any) {
        logger.warn({ k, err: e?.message }, "Watch tick error (skipped)");
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  }

  setInterval(() => { tick().catch(e => logger.error({ err: e?.message }, "Watcher tick failed")); }, POLL_INTERVAL_MS);
  logger.info("Auction watcher started (5 min interval)");
}
