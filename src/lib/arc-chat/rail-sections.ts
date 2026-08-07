/**
 * What the rail's recent-chat list is made of.
 *
 * The rail used to be "the 5 most recent chats, and group any two that happen to
 * share a campaign". On prod that grouping had never once rendered: the 5 newest
 * chats all carry no campaign, and the two campaign-bearing ones sit at
 * positions 7 and 8 — past the cap, forever. A rule that only fires when a
 * campaign wins a recency race is not a folder; it is a coincidence.
 *
 * So the budget is split the way the /arc drawer splits it. Campaigns are
 * STANDING folders — a campaign is what an operator looks a chat up by, so it
 * earns a place whether or not its chats are the newest thing in the workspace —
 * and unattached chats fill the rest by recency. A folder holding one chat is
 * still a folder here, unlike the old two-or-more rule: with folders reserved
 * their own budget, a header of one costs a row that nothing else was going to
 * use, and hiding it would put that chat back in the flat list it belongs out of.
 *
 * Both halves are pure and live here rather than in the component so the server
 * (which decides WHICH chats travel) and the rail (which decides HOW they look)
 * are reading the same rules. The two disagreeing is what a folder with a count
 * of 4 and one row under it looks like.
 */

/** Campaign folders the rail carries. Three headers is the most that can sit
 *  above the unattached chats without the folders becoming the whole list. */
export const RAIL_FOLDER_LIMIT = 3;
/** Chats kept per folder. More than a folder shows collapsed, so "Show N more"
 *  has something to reveal without a second server round-trip. */
export const RAIL_FOLDER_CHATS = 6;
/** Chats rendered inside an OPEN folder before it offers "Show N more". */
export const RAIL_FOLDER_ROWS = 3;
/** Unattached chats below the folders — the old flat list, unchanged in size. */
export const RAIL_LOOSE_LIMIT = 5;

type RailConversation = {
  id: string;
  campaignId?: string | null;
  campaignName?: string | null;
};

export type RailFolder<T> = {
  campaignId: string;
  /** Falls back to "Campaign" only when the name lookup failed — a chat whose
   *  campaign we cannot name still belongs in that campaign's folder. */
  campaignName: string;
  items: T[];
};

export type RailSections<T> = { folders: RailFolder<T>[]; loose: T[] };

/**
 * Choose the chats the rail carries, newest-activity first within each part.
 *
 * `conversations` must already be sorted newest-first; folder order is taken
 * from where each campaign first appears, which on a sorted list is the campaign
 * with the most recent activity.
 *
 * `pinnedIds` survive the budget wherever they land. The rail marks the chat
 * `/arc` currently has open the same way it marks the current page, and a chat
 * that fell off the end could not be marked — which made /arc the one
 * destination whose own rail entry could vanish while you were reading it.
 */
export function selectRailConversations<T extends RailConversation>(
  conversations: T[],
  {
    folderLimit = RAIL_FOLDER_LIMIT,
    folderChats = RAIL_FOLDER_CHATS,
    looseLimit = RAIL_LOOSE_LIMIT,
    pinnedIds = [],
  }: {
    folderLimit?: number;
    folderChats?: number;
    looseLimit?: number;
    pinnedIds?: readonly (string | null | undefined)[];
  } = {},
): T[] {
  const pinned = new Set(pinnedIds.filter((id): id is string => Boolean(id)));
  const { folders, loose } = groupRailConversations(conversations);

  const keptFolders = folders.slice(0, folderLimit).map((folder) => ({
    ...folder,
    items: capKeeping(folder.items, folderChats, pinned),
  }));

  // A pinned chat inside a folder that missed the cut keeps its folder — losing
  // the header would file it under unattached chats, which is a different claim
  // about where it lives.
  for (const folder of folders.slice(folderLimit)) {
    if (!folder.items.some((item) => pinned.has(item.id))) continue;
    keptFolders.push({ ...folder, items: folder.items.filter((item) => pinned.has(item.id)) });
  }

  return [...keptFolders.flatMap((folder) => folder.items), ...capKeeping(loose, looseLimit, pinned)];
}

/** First `limit` items, plus any pinned item the cap would have dropped. Order
 *  is preserved so the caller's recency sort survives. */
function capKeeping<T extends RailConversation>(items: T[], limit: number, pinned: Set<string>): T[] {
  const head = new Set(items.slice(0, Math.max(0, limit)).map((item) => item.id));
  return items.filter((item) => head.has(item.id) || pinned.has(item.id));
}

/**
 * Split a chat list into campaign folders and unattached chats.
 *
 * Pure grouping only — no caps. The server has already decided what travels;
 * re-budgeting here is how the two ends drift apart.
 */
export function groupRailConversations<T extends RailConversation>(conversations: T[]): RailSections<T> {
  const byCampaign = new Map<string, RailFolder<T>>();
  const loose: T[] = [];

  for (const conversation of conversations) {
    const campaignId = conversation.campaignId;
    if (!campaignId) {
      loose.push(conversation);
      continue;
    }
    const folder = byCampaign.get(campaignId);
    if (folder) {
      folder.items.push(conversation);
      // A later row may carry the name when the first one's lookup came back
      // empty; take the first real one rather than freezing "Campaign" in.
      if (folder.campaignName === FALLBACK_NAME && conversation.campaignName) {
        folder.campaignName = conversation.campaignName;
      }
      continue;
    }
    byCampaign.set(campaignId, {
      campaignId,
      campaignName: conversation.campaignName || FALLBACK_NAME,
      items: [conversation],
    });
  }

  return { folders: [...byCampaign.values()], loose };
}

const FALLBACK_NAME = "Campaign";
