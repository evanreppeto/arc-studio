"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { ArcRecentConversationVM } from "@/lib/arc-chat/read-model";

import { archiveArcConversationAction, deleteArcConversationAction } from "../arc/actions";

/**
 * Recent chats in the rail.
 *
 * Was a flat list of five links with no affordances: no way to clear one, and no
 * sign of what a chat belonged to. The Arc Chat page has had all of this for a
 * while — a recent/campaign grouping toggle, campaign labels, and a per-thread
 * menu — so this is the rail catching up to the surface beside it rather than
 * anything new being invented.
 *
 * Grouping is conditional on purpose. The rail shows five chats and only 5 of
 * prod's 25 carry a campaign, so grouping unconditionally would wrap most rows
 * in a header of one. A group appears only where two or more chats share a
 * campaign, which is the case worth collapsing.
 */

type Props = {
  conversations: ArcRecentConversationVM[];
  /** The chat `/arc` currently has open, so the rail marks it like any other
   *  active destination. */
  openConversationId: string | null;
  onNavigate: () => void;
};

type Group = { campaignId: string; campaignName: string; items: ArcRecentConversationVM[] };

function partition(conversations: ArcRecentConversationVM[]): { groups: Group[]; loose: ArcRecentConversationVM[] } {
  const byCampaign = new Map<string, ArcRecentConversationVM[]>();
  const loose: ArcRecentConversationVM[] = [];

  for (const conversation of conversations) {
    if (!conversation.campaignId) {
      loose.push(conversation);
      continue;
    }
    const bucket = byCampaign.get(conversation.campaignId) ?? [];
    bucket.push(conversation);
    byCampaign.set(conversation.campaignId, bucket);
  }

  const groups: Group[] = [];
  for (const [campaignId, items] of byCampaign) {
    // One chat is not a group. It keeps its campaign label inline instead, so a
    // single item never costs a header and a disclosure triangle.
    if (items.length < 2) {
      loose.push(...items);
      continue;
    }
    groups.push({ campaignId, campaignName: items[0]?.campaignName || "Campaign", items });
  }

  // Recency order is what the list is sorted by; keep it after regrouping.
  loose.sort((a, b) => conversations.indexOf(a) - conversations.indexOf(b));
  return { groups, loose };
}

export function RailRecents({ conversations, openConversationId, onNavigate }: Props) {
  // Removed rows disappear immediately. The server action revalidates, but the
  // rail is on every screen and waiting for a round-trip to un-render something
  // the operator just dismissed reads as a dead click.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const visible = conversations.filter((conversation) => !removed.has(conversation.id));

  if (visible.length === 0) {
    return <p className="rail-recents-empty">Start a chat to keep active work close by.</p>;
  }

  const { groups, loose } = partition(visible);
  const remove = (id: string) => setRemoved((prev) => new Set(prev).add(id));

  return (
    <div className="rail-recents-list">
      {groups.map((group) => (
        <details key={group.campaignId} className="rail-recent-group" open>
          <summary>
            <span className="rail-recent-campaign">{group.campaignName}</span>
            <span className="rail-recent-count">{group.items.length}</span>
          </summary>
          {group.items.map((conversation) => (
            <RecentRow
              key={conversation.id}
              conversation={conversation}
              showCampaign={false}
              open={conversation.id === openConversationId}
              onNavigate={onNavigate}
              onRemoved={remove}
            />
          ))}
        </details>
      ))}
      {loose.map((conversation) => (
        <RecentRow
          key={conversation.id}
          conversation={conversation}
          showCampaign
          open={conversation.id === openConversationId}
          onNavigate={onNavigate}
          onRemoved={remove}
        />
      ))}
    </div>
  );
}

function RecentRow({
  conversation,
  showCampaign,
  open,
  onNavigate,
  onRemoved,
}: {
  conversation: ArcRecentConversationVM;
  showCampaign: boolean;
  open: boolean;
  onNavigate: () => void;
  onRemoved: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const run = (action: () => Promise<{ ok: boolean }>) => {
    setMenuOpen(false);
    onRemoved(conversation.id);
    startTransition(async () => {
      const result = await action();
      // Put it back if the server refused — a row that vanishes on a failed
      // delete is a lie about what happened.
      if (!result.ok) router.refresh();
    });
  };

  return (
    <span className="rail-recent-wrap" ref={ref}>
      <Link
        href={`/arc?c=${encodeURIComponent(conversation.id)}`}
        className={`rail-recent${open ? " on" : ""}${conversation.running ? " working" : ""}`}
        aria-current={open ? "page" : undefined}
        // Rail titles ellipsize at this width; the tooltip is the only way to
        // read a long one without opening the chat.
        title={conversation.title}
        prefetch={false}
        onClick={() => onNavigate()}
      >
        <span className="rail-recent-dot" aria-hidden="true" />
        <span className="rail-recent-body">
          <span className="rail-recent-title">{conversation.title}</span>
          {showCampaign && conversation.campaignName ? (
            <span className="rail-recent-campaign">{conversation.campaignName}</span>
          ) : null}
        </span>
        {conversation.running ? <span className="rail-recent-working">Working</span> : <time>{conversation.when}</time>}
      </Link>
      <button
        type="button"
        className="rail-recent-more"
        aria-label={`Options for ${conversation.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={pending}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>
      {menuOpen && (
        <div className="rail-recent-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => run(() => archiveArcConversationAction(conversation.id))}>
            Hide from this list
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => run(() => deleteArcConversationAction(conversation.id))}
          >
            Delete chat
          </button>
        </div>
      )}
    </span>
  );
}
