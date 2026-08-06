"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { ArcRecentConversationVM } from "@/lib/arc-chat/read-model";
import { RAIL_FOLDER_ROWS, groupRailConversations } from "@/lib/arc-chat/rail-sections";

import { archiveArcConversationAction, deleteArcConversationAction } from "../arc/actions";

/**
 * Recent chats in the rail.
 *
 * Campaign folders, the same treatment the /arc conversations drawer gives them
 * (#987): a campaign is what an operator looks a chat up by, so it is a standing
 * folder rather than a grouping that has to earn its place. Folders collapse,
 * carry a count, and show a dot when Arc is running inside one.
 *
 * This replaces a conditional grouping that had never once rendered on prod —
 * two chats had to share a campaign AND both land in the newest five, and the
 * campaign-bearing chats are older than that. The budget fix is in
 * rail-sections.ts; this file is only the shape.
 *
 * Which chats travel is decided on the server. Everything here is display state.
 */

type Props = {
  conversations: ArcRecentConversationVM[];
  /** The chat `/arc` currently has open, so the rail marks it like any other
   *  active destination. */
  openConversationId: string | null;
  onNavigate: () => void;
};

type HoverCard = { conversation: ArcRecentConversationVM; top: number; left: number };

export function RailRecents({ conversations, openConversationId, onNavigate }: Props) {
  // ONE card, owned here rather than per row. Per-row state let two sit on
  // screen at once the moment a row missed its mouseleave — and the card is
  // pointer-events:none, so a stranded one cannot even be clicked away.
  // Hovering another row replaces this; there is nowhere for a second to live.
  const [card, setCard] = useState<HoverCard | null>(null);
  const hoverTimer = useRef<number | null>(null);

  const showCard = (conversation: ArcRecentConversationVM, rect: DOMRect) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    // A beat's delay, so running the pointer down the rail does not strobe a
    // card over every row on the way past.
    hoverTimer.current = window.setTimeout(() => setCard({ conversation, top: rect.top, left: rect.right + 8 }), 320);
  };
  const hideCard = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setCard(null);
  };

  useEffect(() => {
    // Scroll moves the row out from under a stationary pointer without firing
    // mouseleave, and a blurred window never fires one at all. Both would leave
    // the card behind.
    const drop = () => hideCard();
    window.addEventListener("scroll", drop, true);
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("scroll", drop, true);
      window.removeEventListener("blur", drop);
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    };
  }, []);

  // Removed rows disappear immediately. The server action revalidates, but the
  // rail is on every screen and waiting for a round-trip to un-render something
  // the operator just dismissed reads as a dead click.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // Folders the operator has explicitly opened or closed. Anything untouched
  // falls back to the heuristic below, so the rail opens where the work is
  // without ever overriding a deliberate collapse.
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const [folderShowAll, setFolderShowAll] = useState<Record<string, boolean>>({});
  const visible = conversations.filter((conversation) => !removed.has(conversation.id));

  if (visible.length === 0) {
    return <p className="rail-recents-empty">Start a chat to keep active work close by.</p>;
  }

  const { folders, loose } = groupRailConversations(visible);
  const remove = (id: string) => setRemoved((prev) => new Set(prev).add(id));

  return (
    <div className="rail-recents-list">
      {folders.map((folder, index) => {
        /* Open where the work is: the campaign holding the chat you have open,
           anything Arc is running, and the most recent folder. The rail is 252px
           of persistent chrome — opening all three would push the unattached
           chats out of sight to show work nobody asked about. */
        const running = folder.items.some((conversation) => conversation.running);
        const holdsOpen = folder.items.some((conversation) => conversation.id === openConversationId);
        const open = folderOpen[folder.campaignId] ?? (holdsOpen || running || index === 0);
        const capped = !folderShowAll[folder.campaignId] && folder.items.length > RAIL_FOLDER_ROWS;
        const shown = capped ? folder.items.slice(0, RAIL_FOLDER_ROWS) : folder.items;
        return (
          <div className="rail-folder" key={folder.campaignId} data-open={open ? "true" : "false"}>
            <button
              type="button"
              className="rail-folder-head"
              aria-expanded={open}
              onClick={() => setFolderOpen((current) => ({ ...current, [folder.campaignId]: !open }))}
            >
              <svg className="rail-folder-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              <span className="rail-folder-name">{folder.campaignName}</span>
              {/* Only while shut. Open, the row Arc is working in shows its own
                  spinner, and two live marks for one run reads as two runs. */}
              {running && !open ? <i className="rail-folder-dot" aria-label="Arc is working in this campaign" /> : null}
              <span className="rail-folder-count">{folder.items.length}</span>
            </button>
            {open ? (
              <div className="rail-folder-body">
                {shown.map((conversation) => (
                  <RecentRow
                    key={conversation.id}
                    conversation={conversation}
                    open={conversation.id === openConversationId}
                    onNavigate={onNavigate}
                    onRemoved={remove}
                    onHover={showCard}
                    onUnhover={hideCard}
                  />
                ))}
                {capped ? (
                  <button
                    type="button"
                    className="rail-folder-more"
                    onClick={() => setFolderShowAll((current) => ({ ...current, [folder.campaignId]: true }))}
                  >
                    Show {folder.items.length - shown.length} more
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {loose.map((conversation) => (
        <RecentRow
          key={conversation.id}
          conversation={conversation}
          open={conversation.id === openConversationId}
          onNavigate={onNavigate}
          onRemoved={remove}
          onHover={showCard}
          onUnhover={hideCard}
        />
      ))}
      {card ? (
        <div className="rail-recent-card" style={{ top: card.top, left: card.left }} role="tooltip">
          <b>{card.conversation.title}</b>
          {card.conversation.campaignName ? (
            <span className="rail-recent-card-campaign">{card.conversation.campaignName}</span>
          ) : null}
          <span className="rail-recent-card-meta">
            {card.conversation.running ? "Arc is working on this now" : `Last active ${card.conversation.when}`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Arc is working on this thread.
 *
 * A rotating arc rather than the breathing dot the rail used to carry: DESIGN.md
 * allows one arcBreathe per view and the rail is on every screen, so it competed
 * with whatever live dot the page itself had. Rotation is a different motion and does
 * not compete. Under prefers-reduced-motion it stops turning and the label
 * returns, because "working" still has to be legible without animation.
 */
function WorkingSpinner() {
  return (
    <>
      <svg className="rail-working-spinner" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" className="rail-working-track" />
        <path d="M8 2a6 6 0 0 1 6 6" className="rail-working-arc" />
      </svg>
      <span className="rail-working-word">Working</span>
    </>
  );
}

/**
 * One chat. Single-line by design: a row inside a folder already knows its
 * campaign from the folder it sits in, and a loose row has none to show — the
 * campaign subtitle this used to carry could only ever render as a repeat or as
 * nothing.
 */
function RecentRow({
  conversation,
  open,
  onNavigate,
  onRemoved,
  onHover,
  onUnhover,
}: {
  conversation: ArcRecentConversationVM;
  open: boolean;
  onNavigate: () => void;
  onRemoved: (id: string) => void;
  onHover: (conversation: ArcRecentConversationVM, rect: DOMRect) => void;
  onUnhover: () => void;
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
    <span
      className="rail-recent-wrap"
      ref={ref}
      onMouseEnter={() => { const rect = ref.current?.getBoundingClientRect(); if (rect) onHover(conversation, rect); }}
      onMouseLeave={onUnhover}
    >
      <Link
        href={`/arc?c=${encodeURIComponent(conversation.id)}`}
        className={`rail-recent${open ? " on" : ""}${conversation.running ? " working" : ""}`}
        aria-current={open ? "page" : undefined}
        prefetch={false}
        onClick={() => { onUnhover(); onNavigate(); }}
        onFocus={() => { const rect = ref.current?.getBoundingClientRect(); if (rect) onHover(conversation, rect); }}
        onBlur={onUnhover}
      >
        <span className="rail-recent-dot" aria-hidden="true" />
        <span className="rail-recent-title">{conversation.title}</span>
        {conversation.running ? (
          <span className="rail-recent-working" role="status" aria-label="Arc is working on this chat">
            <WorkingSpinner />
          </span>
        ) : (
          <time>{conversation.when}</time>
        )}
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
