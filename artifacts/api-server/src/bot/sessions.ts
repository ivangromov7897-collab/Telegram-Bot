import type { WatchType } from "./watches";
import type { FragmentStatus } from "./ton";

export type SessionType = "w" | "u" | "n" | "d" | "fl" | "watch" | "unwatch";

export interface Session {
  type: SessionType;
  wallet?: string;
  query?: string;
  nftAddress?: string;
  listTitle?: string;
  listItems?: string[];
  watchType?: WatchType;
  watchQuery?: string;
  displayLabel?: string;
  fragmentStatus?: FragmentStatus;
  minBidTon?: number;
}

const store = new Map<string, Session>();
let counter = 0;

export function saveSession(session: Session): string {
  const id = (counter++).toString(36);
  store.set(id, session);
  return id;
}

export function getSession(id: string): Session | undefined {
  return store.get(id);
}
