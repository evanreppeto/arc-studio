"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { isSearchableArcQuery } from "@/domain";
import type { ArcMessageSearchHit } from "@/lib/arc-chat/message-search";
import type { ArcRecentConversationVM } from "@/lib/arc-chat/read-model";
import { RAIL_FOLDER_ROWS, groupRailConversations } from "@/lib/arc-chat/rail-sections";

import {
  archiveArcConversationAction,
  deleteArcConversationAction,
  listArchivedArcConversationsAction,
  pinArcConversationAction,
  renameArcConversationAction,
  searchArcMessagesAction,
  unarchiveArcConversationAction,
  type ArchivedArcConversationVM,
} from "../arc/actions";

/**
 * The conversation sidebar.
 *
 * Campaign folders, the same treatment the /arc conversations drawer used to
 * give them (#987): a campaign is what an operator looks a chat up by, so it is
 * a standing folder rather than a grouping that has to earn its place. Folders
 * collapse, carry a count, and show a dot when Arc is running inside one. Which
 * chats travel is decided on the server (rail-sections.ts); everything here is
 * display state.
 *
 * It is the *only* conversation list now — the drawer held a second, fuller
 * copy of the same threads behind a modal, and that copy is gone. Which is why
 * this grew a search field, an archive, and a scroll region: those were the
 * three things only the drawer could do, and a sidebar you cannot search or
 * un-archive from is a shortcut wearing a sidebar's clothes.
 *
 * Search reaches further than the loaded rows. Titles filter what is here;
 * anything long enough to be worth a round trip also queries message bodies on
 * the server, so a chat past the rail's budget is still findable by something
 * said inside it.
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
  const [query, setQuery] = useState("");

  /**
   * Message hits for the current query.
   *
   * Keyed by the query they answer rather than cleared on every keystroke: an
   * in-flight response for an older query is dropped by the sequence ref below,
   * and a result that no longer matches what is typed simply stops being read.
   * That removes the stale-render case where results from a longer query stay
   * on screen after backspacing.
   */
  const [messageSearch, setMessageSearch] = useState<{ query: string; hits: ArcMessageSearchHit[] } | null>(null);
  const searchSeq = useRef(0);
  const trimmedQuery = query.trim();
  const searchingBodies = isSearchableArcQuery(query);
  const messageHits = searchingBodies && messageSearch?.query === trimmedQuery ? messageSearch.hits : null;
  const messagesPending = searchingBodies && messageHits === null;

  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!isSearchableArcQuery(query)) return;
    const timer = window.setTimeout(() => {
      searchArcMessagesAction(query).then((result) => {
        if (seq !== searchSeq.current) return; // superseded by a newer query
        setMessageSearch({ query: query.trim(), hits: result.ok ? result.hits : [] });
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const visible = conversations.filter((conversation) => !removed.has(conversation.id));
  const needle = trimmedQuery.toLowerCase();
  const matches = needle
    ? visible.filter((conversation) =>
        conversation.title.toLowerCase().includes(needle)
        || (conversation.campaignName ?? "").toLowerCase().includes(needle))
    : visible;

  const remove = (id: string) => setRemoved((prev) => new Set(prev).add(id));
  /* Grouped from the ALREADY-filtered rows, so a folder only exists here because
     it holds a match — there is no collapse state for a search to survive, and
     no folder can show a count with nothing under it. */
  const { folders, loose } = groupRailConversations(matches);

  /* The field stays even with nothing to filter: it reaches message bodies, and
     hiding it would make the archive below the only way back to a conversation
     whose title you cannot recall. */
  const search = visible.length > 0 || query ? (
    <label className="rail-recents-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
      <input
        type="search"
        aria-label="Search conversations"
        placeholder="Search chats"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  ) : null;

  if (visible.length === 0 && !query) {
    return (
      <>
        <p className="rail-recents-empty">Start a chat to keep active work close by.</p>
        <ArchivedChats onRestored={() => setRemoved(new Set())} />
      </>
    );
  }

  return (
    <>
    {search}
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
      {/* Chats whose titles matched nothing, but which said the thing you typed.
          A separate section rather than merged in: "this chat is called X" and
          "this chat says X" are different answers, and folding them together
          loses the quote that explains why a result is here. */}
      {searchingBodies ? (
        <div className="rail-recent-messages">
          <div className="rail-recent-messages-head">
            <span>In messages</span>
            {messagesPending ? <i className="rail-recent-messages-wait" aria-label="Searching" /> : messageHits?.length ? <small>{messageHits.length}</small> : null}
          </div>
          {(messageHits ?? []).map((hit) => (
            <Link
              href={`/arc?c=${encodeURIComponent(hit.conversationId)}`}
              className="rail-message-hit"
              key={hit.messageId}
              prefetch={false}
              onClick={onNavigate}
            >
              <span className="rail-message-hit-title">{hit.conversationTitle}</span>
              <span className="rail-message-hit-snippet">
                {hit.snippet.truncatedStart ? "…" : ""}{hit.snippet.before}
                <mark>{hit.snippet.match}</mark>
                {hit.snippet.after}{hit.snippet.truncatedEnd ? "…" : ""}
              </span>
            </Link>
          ))}
          {!messagesPending && messageHits?.length === 0 ? (
            <p className="rail-recents-empty">No messages contain “{trimmedQuery}”.</p>
          ) : null}
        </div>
      ) : null}
      {folders.length === 0 && loose.length === 0 && !searchingBodies ? (
        <p className="rail-recents-empty">No chat titled “{trimmedQuery}”.</p>
      ) : null}
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
    <ArchivedChats onRestored={() => setRemoved(new Set())} />
    </>
  );
}

/**
 * Archived conversations, and the way back out.
 *
 * The row menu has always offered "Hide from this list", and until now the only
 * place that could undo it was the drawer's conversation tab. An archive you can
 * put things into and not take them out of is a delete with a softer label, so
 * it moves here with the list it belongs to.
 *
 * Loaded on first open, never on mount: this renders on every route in the app,
 * and a list nobody opened is not worth a query on every page view.
 */
function ArchivedChats({ onRestored }: { onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ArchivedArcConversationVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || items !== null) return;
    setError(null);
    listArchivedArcConversationsAction().then((result) => {
      if (result.ok) setItems(result.items);
      else setError(result.error);
    });
  };

  const restore = (id: string) => {
    setItems((current) => current?.filter((item) => item.id !== id) ?? null);
    unarchiveArcConversationAction(id).then((result) => {
      // Whether it worked or not, the truth is on the server: refresh brings the
      // row back into the list above, or back into this one if it refused.
      if (!result.ok) setItems(null);
      onRestored();
      router.refresh();
    });
  };

  return (
    <div className="rail-archived">
      <button type="button" className="rail-archived-toggle" aria-expanded={open} onClick={toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v3H3zM5 10v9h14v-9M10 14h4" /></svg>
        <span>Archived{items?.length ? ` · ${items.length}` : ""}</span>
        <svg className="rail-archived-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open ? (
        error ? <p className="rail-recents-empty" role="alert">{error}</p>
        : items === null ? <p className="rail-recents-empty">Loading…</p>
        : items.length === 0 ? <p className="rail-recents-empty">Nothing archived.</p>
        : (
          <div className="rail-archived-list">
            {items.map((item) => (
              <div className="rail-archived-item" key={item.id}>
                <span className="rail-archived-title" title={item.title}>{item.title}</span>
                <button type="button" onClick={() => restore(item.id)} title={`Restore ${item.title}`}>Restore</button>
              </div>
            ))}
          </div>
        )
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
  /** Renaming in place. Rename and pin lived only in the Arc drawer's copy of
   *  this list; removing that copy would have deleted the only way to do either,
   *  so they come here with the list. */
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
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

  const commitRename = () => {
    const title = draftTitle.trim();
    setRenaming(false);
    if (!title || title === conversation.title) return;
    startTransition(async () => {
      await renameArcConversationAction({ conversationId: conversation.id, title });
      router.refresh();
    });
  };

  const togglePin = () => {
    setMenuOpen(false);
    startTransition(async () => {
      await pinArcConversationAction({ conversationId: conversation.id, pinned: !conversation.pinned });
      router.refresh();
    });
  };

  if (renaming) {
    return (
      <span className="rail-recent-wrap">
        <input
          className="rail-recent-rename"
          value={draftTitle}
          autoFocus
          aria-label={`Rename ${conversation.title}`}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commitRename(); }
            // Escape belongs to the field, not to whatever is listening above it.
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraftTitle(conversation.title); setRenaming(false); }
          }}
        />
      </span>
    );
  }

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
        <span className="rail-recent-title">
          {conversation.pinned ? <i className="rail-recent-pin" aria-label="Pinned" title="Pinned" /> : null}
          {conversation.title}
        </span>
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
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDraftTitle(conversation.title); setRenaming(true); }}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={togglePin}>
            {conversation.pinned ? "Unpin" : "Pin to top"}
          </button>
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
