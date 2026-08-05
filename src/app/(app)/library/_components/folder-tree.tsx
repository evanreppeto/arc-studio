"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OverlayPortal } from "../../_components/overlay-portal";

export type Folder = {
  f: string;
  name: string;
  color: string;
  icon: string;
  /** The folder's own note, stored on `media_folders.description`. Shown on hover. */
  description?: string | null;
  children?: Folder[];
};

/** The root row's id. Not a stored folder — it means "no folder filter". */
export const ROOT_FOLDER = "all";

/**
 * Drag payload types.
 *
 * Custom MIME types rather than `text/plain`, because `dataTransfer.getData()`
 * is deliberately unreadable during `dragover` (only `types` is exposed) — so
 * deciding whether a row can accept the drop has to be answerable from the type
 * alone. Reading the ids happens on `drop`, where the data is available.
 */
export const DRAG_ASSETS = "application/x-arc-library-assets";
export const DRAG_FOLDER = "application/x-arc-library-folder";

export const FOLDER_ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shield: '<path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z"/>',
  mark: '<path d="M12 3l2.2 6L20 11l-5.8 2L12 19l-2.2-6L4 11l5.8-2z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M3 17l5-4 4 3 3-2 6 4"/>',
  sparkle: '<path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6z"/><path d="M18.5 13l.6 1.8 1.9.7-1.9.7-.6 1.8-.6-1.8-1.9-.7 1.9-.7z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  import: '<path d="M12 3v11M8 10l4 4 4-4"/><path d="M5 20h14"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  folder: '<path d="M4 7h6l2 2h8v10H4z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
};

function Glyph({ d, width = 1.7 }: { d: string; width?: number }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} dangerouslySetInnerHTML={{ __html: d }} />;
}

/** Depth-first list of every folder in the tree, root row excluded. */
export function flattenFolders(nodes: Folder[], depth = 0): { node: Folder; depth: number }[] {
  const out: { node: Folder; depth: number }[] = [];
  for (const node of nodes) {
    if (node.f !== ROOT_FOLDER) out.push({ node, depth });
    if (node.children?.length) out.push(...flattenFolders(node.children, node.f === ROOT_FOLDER ? depth : depth + 1));
  }
  return out;
}

/** Every id inside `id`, inclusive — what a folder may not be dropped into. */
export function subtreeIds(nodes: Folder[], id: string): Set<string> {
  const found = new Set<string>();
  const collect = (node: Folder) => {
    found.add(node.f);
    node.children?.forEach(collect);
  };
  const walk = (list: Folder[]): boolean => {
    for (const node of list) {
      if (node.f === id) {
        collect(node);
        return true;
      }
      if (node.children && walk(node.children)) return true;
    }
    return false;
  };
  walk(nodes);
  return found;
}

type Row = { node: Folder; depth: number; hasKids: boolean; open: boolean };

/** The rows a keyboard arrow actually lands on — collapsed subtrees excluded. */
function visibleRows(nodes: Folder[], expanded: Record<string, boolean>, depth = 0): Row[] {
  const out: Row[] = [];
  for (const node of nodes) {
    const hasKids = !!node.children?.length;
    const open = hasKids && !!expanded[node.f];
    out.push({ node, depth, hasKids, open });
    if (open) out.push(...visibleRows(node.children!, expanded, depth + 1));
  }
  return out;
}

type MenuState = { id: string; name: string; x: number; y: number } | null;

export type FolderTreeProps = {
  tree: Folder[];
  current: string;
  onSelect: (id: string) => void;
  /** Live count for a folder, including its descendants. */
  countOf: (id: string) => number;
  expanded: Record<string, boolean>;
  onToggleExpanded: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Open the new-folder modal, filed under `parentId` (null = root). */
  onNewFolder: (parentId: string | null) => void;
  onMoveFolder: (id: string, parentId: string | null) => void;
  /** Assets were dropped on a folder row. `null` is the root. */
  onDropAssets: (assetIds: number[], folderId: string | null) => void;
  /** True while a drag is in flight, so every row can advertise itself as a target. */
  dragging: boolean;
};

/**
 * The Library's folder rail.
 *
 * Split out of `library-view.tsx` because it stopped being a list of links: it
 * is a real tree now — nested creation, re-parenting, drag-and-drop filing,
 * keyboard navigation — and none of that reads well interleaved with the
 * gallery, the inspector and eight kinds of optimistic state.
 *
 * Two things it deliberately does NOT own: the folder data (the parent holds
 * `tree` so an optimistic rename shows in the move-picker too) and the rail's
 * width (a grid column of the parent's layout). It reports intent; the parent
 * persists it.
 */
export function FolderTree({
  tree,
  current,
  onSelect,
  countOf,
  expanded,
  onToggleExpanded,
  onRename,
  onDelete,
  onNewFolder,
  onMoveFolder,
  onDropAssets,
  dragging,
}: FolderTreeProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** The folder being dragged, so its own subtree can refuse the drop on sight. */
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  const forbidden = useMemo(
    () => (draggingFolder ? subtreeIds(tree, draggingFolder) : new Set<string>()),
    [tree, draggingFolder],
  );

  // A folder can vanish under us (deleted, or the refetch dropped it). Roving
  // tabindex needs a row that exists, or the rail becomes untabbable.
  const focused = focusId && rows.some((r) => r.node.f === focusId) ? focusId : rows[0]?.node.f ?? null;

  const focusRow = useCallback((id: string) => {
    setFocusId(id);
    const find = () => treeRef.current?.querySelector<HTMLElement>(`[data-folder="${CSS.escape(id)}"]`);
    // Focus now when the row is already on screen — which is every arrow key.
    // Only a row revealed by an expand needs the extra frame, and the wait is
    // NOT unconditional on purpose: `requestAnimationFrame` does not run in a
    // background tab, so a deferred focus is a focus that sometimes never
    // happens, which is worse than a rare frame of lag.
    const now = find();
    if (now) {
      now.focus();
      return;
    }
    requestAnimationFrame(() => find()?.focus());
  }, []);

  // The row menu is portaled and fixed-positioned, so anything that moves the
  // rail underneath it (a scroll, a resize) leaves it pointing at nothing.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  /**
   * Anchor the menu to the ROW, not to the trigger, so it reads as belonging to
   * the folder rather than floating off a 20px button. No `transform` in the
   * inline style: `.fmenu`'s entrance animation animates transform, and a CSS
   * animation beats an inline declaration — a translate here would be silently
   * discarded the moment the menu finished opening.
   */
  const anchorOf = (el: HTMLElement) => (el.closest(".folder") ?? el).getBoundingClientRect();

  const openMenu = (e: React.MouseEvent, node: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = anchorOf(e.currentTarget as HTMLElement);
    setConfirmDelete(null);
    setMenu((open) => (open?.id === node.f ? null : { id: node.f, name: node.name, x: rect.left, y: rect.bottom + 4 }));
  };

  function onKeyDown(e: React.KeyboardEvent, row: Row) {
    const index = rows.findIndex((r) => r.node.f === row.node.f);
    const move = (next: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (target) focusRow(target.node.f);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(index - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row.hasKids && !row.open) onToggleExpanded(row.node.f);
        else if (row.open) move(index + 1);
        break;
      case "ArrowLeft": {
        e.preventDefault();
        if (row.open) {
          onToggleExpanded(row.node.f);
          break;
        }
        // Collapsed or a leaf: step out to the parent, which is the nearest row
        // above at a shallower depth.
        for (let i = index - 1; i >= 0; i -= 1) {
          if (rows[i].depth < row.depth) {
            focusRow(rows[i].node.f);
            break;
          }
        }
        break;
      }
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(rows.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(row.node.f);
        break;
      case "F2":
        if (row.node.f !== ROOT_FOLDER) {
          e.preventDefault();
          setRenaming(row.node.f);
        }
        break;
      case "Delete":
      case "Backspace": {
        if (row.node.f === ROOT_FOLDER) break;
        e.preventDefault();
        // Same confirm step the pointer gets, anchored to the row — a delete
        // that skipped the confirm because it arrived by keyboard would be a
        // strictly more dangerous control for the people who rely on it most.
        const rect = e.currentTarget.getBoundingClientRect();
        setConfirmDelete(row.node.f);
        setMenu({ id: row.node.f, name: row.node.name, x: rect.left, y: rect.bottom + 4 });
        break;
      }
      default:
        break;
    }
  }

  const acceptsDrop = (types: readonly string[], id: string) => {
    if (types.includes(DRAG_ASSETS)) return true;
    if (types.includes(DRAG_FOLDER)) return !forbidden.has(id);
    return false;
  };

  function handleDrop(e: React.DragEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const destination = id === ROOT_FOLDER ? null : id;
    const folderId = e.dataTransfer.getData(DRAG_FOLDER);
    if (folderId) {
      setDraggingFolder(null);
      if (folderId !== id && !subtreeIds(tree, folderId).has(id)) onMoveFolder(folderId, destination);
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_ASSETS);
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as number[];
      if (Array.isArray(ids) && ids.length) onDropAssets(ids, destination);
    } catch {
      // A malformed payload is not worth a message — nothing was promised yet.
    }
  }

  const renderRow = (row: Row) => {
    const { node, depth, hasKids, open } = row;
    const isRoot = node.f === ROOT_FOLDER;
    const selected = node.f === current;
    const count = countOf(node.f);
    const isDropTarget = dropTarget === node.f;
    // A folder drag deserves the same "these rows will take it" hint an asset
    // drag gets — minus the rows that would close a loop.
    const droppable = (dragging || !!draggingFolder) && !forbidden.has(node.f);

    return (
      <div
        key={node.f}
        data-folder={node.f}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selected}
        aria-expanded={hasKids ? open : undefined}
        aria-label={node.name}
        tabIndex={focused === node.f ? 0 : -1}
        title={node.description || node.name}
        className={`folder${selected ? " on" : ""}${isDropTarget ? " dropinto" : ""}${droppable ? " droppable" : ""}${draggingFolder === node.f ? " lifted" : ""}`}
        style={{ paddingLeft: 9 + depth * 14 }}
        draggable={!isRoot && !renaming}
        onClick={() => onSelect(node.f)}
        onKeyDown={(e) => onKeyDown(e, row)}
        onFocus={() => setFocusId(node.f)}
        onContextMenu={(e) => (isRoot ? undefined : openMenu(e, node))}
        onDragStart={(e) => {
          if (isRoot) return;
          e.dataTransfer.setData(DRAG_FOLDER, node.f);
          e.dataTransfer.effectAllowed = "move";
          setDraggingFolder(node.f);
        }}
        onDragEnd={() => {
          setDraggingFolder(null);
          setDropTarget(null);
        }}
        onDragOver={(e) => {
          if (!acceptsDrop(e.dataTransfer.types, node.f)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropTarget !== node.f) setDropTarget(node.f);
        }}
        onDragLeave={(e) => {
          // Ignore the leave fired when the pointer crosses onto a child element.
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDropTarget((t) => (t === node.f ? null : t));
        }}
        onDrop={(e) => handleDrop(e, node.f)}
      >
        <span
          className={`tchev${hasKids ? (open ? " open" : "") : " leaf"}`}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            if (hasKids) onToggleExpanded(node.f);
          }}
        >
          <Glyph d={FOLDER_ICONS.chev} width={2.4} />
        </span>
        <span className="ficon" style={{ background: `${node.color}1f`, border: `1px solid ${node.color}4d`, color: node.color }}>
          <Glyph d={FOLDER_ICONS[node.icon] ?? FOLDER_ICONS.folder} />
        </span>
        {renaming === node.f ? (
          <input
            className="fn-edit"
            autoFocus
            defaultValue={node.name}
            aria-label="Folder name"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                setRenaming(null);
                onRename(node.f, e.currentTarget.value);
              }
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={(e) => {
              setRenaming(null);
              onRename(node.f, e.currentTarget.value);
            }}
          />
        ) : (
          <span className="fn">{node.name}</span>
        )}
        {/* The count stays put on hover. It used to be swapped out for the
            manage buttons, so the number an operator was reading disappeared
            under their own pointer; the menu trigger has its own reserved slot
            instead. */}
        <span className="fc">{count}</span>
        {!isRoot && renaming !== node.f && (
          <button
            type="button"
            className="frowbtn"
            aria-label={`Manage ${node.name}`}
            aria-haspopup="menu"
            aria-expanded={menu?.id === node.f}
            // The document-level dismiss listener fires on mousedown, which
            // would close the menu a beat before this button's click reopened
            // it — so the trigger would never toggle shut.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => openMenu(e, node)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          </button>
        )}
      </div>
    );
  };

  const renderBranch = (nodes: Folder[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const hasKids = !!node.children?.length;
      const open = hasKids && !!expanded[node.f];
      return (
        <div key={`${node.f}-branch`} role="none">
          {renderRow({ node, depth, hasKids, open })}
          {open && (
            <div role="group" className="tchildren">
              {renderBranch(node.children!, depth + 1)}
            </div>
          )}
        </div>
      );
    });

  const root = tree.find((n) => n.f === ROOT_FOLDER);
  const rest = tree.filter((n) => n.f !== ROOT_FOLDER);
  const menuNodeIsDeleting = confirmDelete && menu?.id === confirmDelete;

  return (
    <>
      <div className="treeh">
        <span>Folders</span>
        <button type="button" className="treeadd" aria-label="New folder" title="New folder" onClick={() => onNewFolder(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      <div
        className={`treescroll${dragging || draggingFolder ? " dragging" : ""}`}
        ref={treeRef}
        role="tree"
        aria-label="Media folders"
      >
        {root ? renderRow({ node: root, depth: 0, hasKids: false, open: false }) : null}
        <div className="treesec" role="none" />
        {renderBranch(rest, 0)}
      </div>
      <button type="button" className="newfolder" onClick={() => onNewFolder(null)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        New folder
      </button>

      {/* Portaled and fixed-positioned: `.tree` scrolls and clips, so a menu
          rendered inside the rail is cut off at its edge — and inside a page
          under `(app)`, `position: fixed` is relative to the content pane
          (see overlay-portal.tsx), which is what makes the measured
          coordinates land where the row actually is. */}
      {menu && (
        <OverlayPortal>
          <div
            className="fmenu"
            role="menu"
            aria-label={`${menu.name} actions`}
            style={{ position: "fixed", top: menu.y, left: menu.x, maxWidth: "min(300px, 80vw)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {menuNodeIsDeleting ? (
              <>
                <span className="fmenu-warn">Delete “{menu.name}”? Its media moves to All assets.</span>
                <div className="fmenu-confirm">
                  <button type="button" className="gbtn" onClick={() => setConfirmDelete(null)}>Cancel</button>
                  <button
                    type="button"
                    className="gbtn danger"
                    onClick={() => {
                      onDelete(menu.id);
                      setConfirmDelete(null);
                      setMenu(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="fmenu-hd">{menu.name}</span>
                <button
                  type="button"
                  role="menuitem"
                  className="fmenu-item"
                  onClick={() => {
                    setMenu(null);
                    setRenaming(menu.id);
                    focusRow(menu.id);
                  }}
                >
                  Rename
                  <kbd>F2</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="fmenu-item"
                  onClick={() => {
                    setMenu(null);
                    onNewFolder(menu.id);
                  }}
                >
                  New subfolder
                </button>
                {/* Every destination except the folder itself and its own
                    descendants — the same rule the server enforces, offered
                    here so a keyboard user gets the move drag-and-drop gives
                    a mouse. */}
                <div className="fmenu-sub">
                  <span className="fmenu-hd">Move into</span>
                  <button type="button" role="menuitem" className="fmenu-item" onClick={() => { onMoveFolder(menu.id, null); setMenu(null); }}>
                    Top level
                  </button>
                  {flattenFolders(tree)
                    .filter(({ node }) => !subtreeIds(tree, menu.id).has(node.f))
                    .map(({ node, depth }) => (
                      <button
                        key={node.f}
                        type="button"
                        role="menuitem"
                        className="fmenu-item"
                        onClick={() => { onMoveFolder(menu.id, node.f); setMenu(null); }}
                      >
                        {"— ".repeat(depth)}{node.name}
                      </button>
                    ))}
                </div>
                <button type="button" role="menuitem" className="fmenu-item danger" onClick={() => setConfirmDelete(menu.id)}>
                  Delete folder
                </button>
              </>
            )}
          </div>
        </OverlayPortal>
      )}
    </>
  );
}
