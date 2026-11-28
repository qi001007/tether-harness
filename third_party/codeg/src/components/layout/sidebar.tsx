"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Bot,
  Crosshair,
  Eye,
  FolderSync,
  ListChecks,
  ListChevronsDownUp,
  ListChevronsUpDown,
  MessagesSquare,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useFolderTabsStore } from "@/stores/folder-tabs-store"
import {
  SidebarConversationList,
  type SidebarConversationListHandle,
} from "@/components/conversations/sidebar-conversation-list"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePlatform } from "@/hooks/use-platform"
import { useZoomLevel } from "@/hooks/use-appearance"
import { isDesktop } from "@/lib/platform"
import { leftChromeReserve } from "@/lib/window-chrome"
import {
  loadShowCompleted,
  loadShowRecent,
  loadShowWorktrees,
  loadSortMode,
  loadSectionOrder,
  moveSectionInOrder,
  saveShowCompleted,
  saveShowRecent,
  saveShowWorktrees,
  saveSortMode,
  saveSectionOrder,
  DEFAULT_SECTION_ORDER,
  type SidebarSectionId,
  type SidebarSortMode,
  type SidebarSectionOrder,
} from "@/lib/sidebar-view-mode-storage"
import { EMPTY_TAG_FILTER } from "@/lib/conversation-tags"
import { SidebarSectionOrderControl } from "./sidebar-section-order-control"
import { cn } from "@/lib/utils"

// Which sections the order editor should render as switched-off. Module
// constants rather than a per-render `new Set`, so the reference is stable and
// the two states are spelled out once. "Recent" is the only section with a
// visibility toggle today.
const NO_HIDDEN_SECTIONS: ReadonlySet<SidebarSectionId> = new Set()
const RECENT_HIDDEN: ReadonlySet<SidebarSectionId> = new Set(["recent"])

/**
 * A fixed top-of-sidebar action / route row. `active` marks the row as the
 * current workbench route (selected styling); `trailing` carries a shortcut hint
 * or a count badge. Extracting this keeps every fixed nav item — and any future
 * route — on one geometry instead of copy-pasting the className. Each row is a
 * `group` so a `group-hover`-revealed trailing element works.
 */
function SidebarNavButton({
  icon: Icon,
  label,
  onClick,
  active,
  trailing,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  active?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 w-full items-center gap-[0.4375rem] rounded-full pl-[0.4375rem] pr-1.5",
        "text-[0.875rem] text-sidebar-foreground outline-none",
        "transition-colors duration-150 hover:bg-sidebar-accent",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active && "bg-sidebar-primary/8"
      )}
    >
      <Icon className="h-[0.875rem] w-[0.875rem] shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  )
}

export function Sidebar() {
  const t = useTranslations("Folder.sidebar")
  const tSettings = useTranslations("SettingsShell.nav")
  const { isOpen, toggle } = useSidebarContext()
  const { setRoute, routeId } = useWorkbenchRoute()
  const { isMac: platformIsMac } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  const isMobile = useIsMobile()
  const listRef = useRef<SidebarConversationListHandle>(null)
  // On desktop the header's top-left is owned by the fixed window-chrome overlay
  // (sidebar toggle + remote); reserve exactly its width so the view controls
  // and drag region clear it. The reserve scales with the app zoom to track the
  // rem-sized overlay buttons. Mobile has no overlay (the sidebar is a Drawer).
  const leftReserve = leftChromeReserve(platformIsMac && isDesktop(), zoomLevel)

  // `showCompleted` defaults OFF; `showWorktrees` and `showRecent` default ON
  // (the mount effect below reconciles a persisted override). Each initial
  // value matches its own default so the pre-hydration render doesn't flash as
  // the stored preference is applied.
  const [showCompleted, setShowCompleted] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(true)
  const [showRecent, setShowRecent] = useState(true)
  const [sortMode, setSortMode] = useState<SidebarSortMode>("created")
  const [sectionOrder, setSectionOrder] = useState<SidebarSectionOrder>(
    DEFAULT_SECTION_ORDER
  )
  const [allExpanded, setAllExpanded] = useState(true)
  // Not a list preference like the rows above: it decides which conversation
  // and file tabs the window shows. Its store owns the stored value (hydrated
  // with the tab set, see `TabProvider`), so this reads it live.
  const tabsFollowFolder = useFolderTabsStore((s) => s.enabled)
  const setTabsFollowFolder = useFolderTabsStore((s) => s.setEnabled)
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  // General umbrella name for the eye menu (tag filter + list toggles + nav
  // rows + sort + section order). Kept generic so the accessible name / tooltip
  // stays accurate as the menu gains options.
  const viewOptionsLabel = t("viewOptions")
  const toggleExpandLabel = allExpanded
    ? t("collapseAllGroups")
    : t("expandAllGroups")
  const hiddenSections = showRecent ? NO_HIDDEN_SECTIONS : RECENT_HIDDEN

  useEffect(() => {
    // Hydrate from localStorage after mount to keep SSR/CSR markup consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowCompleted(loadShowCompleted())
    setShowWorktrees(loadShowWorktrees())
    setShowRecent(loadShowRecent())
    setSortMode(loadSortMode())
    setSectionOrder(loadSectionOrder())
  }, [])

  const handleSetShowCompleted = useCallback((value: boolean) => {
    setShowCompleted(value)
    saveShowCompleted(value)
  }, [])

  const handleSetShowWorktrees = useCallback((value: boolean) => {
    setShowWorktrees(value)
    saveShowWorktrees(value)
  }, [])

  const handleSetShowRecent = useCallback((value: boolean) => {
    setShowRecent(value)
    saveShowRecent(value)
  }, [])

  
  const handleSetSortMode = useCallback((value: string) => {
    const mode: SidebarSortMode = value === "updated" ? "updated" : "created"
    setSortMode(mode)
    saveSortMode(mode)
  }, [])

  // Nudge one section up/down a slot. `moveSectionInOrder` returns the SAME
  // array when the move would fall off an end, so a clamped nudge neither
  // re-renders the list nor rewrites localStorage.
  const handleMoveSection = useCallback(
    (id: SidebarSectionId, delta: number) => {
      setSectionOrder((prev) => {
        const next = moveSectionInOrder(prev, id, delta)
        if (next !== prev) saveSectionOrder(next)
        return next
      })
    },
    []
  )

  const handleToggleExpandAll = useCallback(() => {
    if (allExpanded) {
      listRef.current?.collapseAll()
      setAllExpanded(false)
    } else {
      listRef.current?.expandAll()
      setAllExpanded(true)
    }
  }, [allExpanded])

  if (!isOpen) return null

  return (
    <aside className="@container/sidebar flex h-full min-h-0 flex-col overflow-hidden text-sidebar-foreground select-none">
      <div
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 pr-2",
          // Desktop: the fixed left window-chrome overlay (reserved below) owns
          // the top-left, so drop the header's own left padding. Off-image the
          // divider is border-border/50, matching the conversation / file detail
          // headers. But the sidebar sits on a FROSTED surface (ws-surface-sidebar)
          // while those headers sit on the transparent canvas: with a workspace
          // background image on, a border-border/50 hairline washes out against the
          // frosted shade, so it takes the boosted `ws-chrome-border` (like the
          // frosted status bar) to stay legible. Mobile (Drawer): keep the original
          // title padding + a full-strength divider — mobile is unchanged.
          isMobile
            ? "border-b border-border pl-4"
            : "border-b border-border/50 ws-chrome-border pl-0"
        )}
      >
        {isMobile ? (
          <div className="flex min-w-0 items-center gap-4">
            <h2 className="truncate text-[0.875rem] font-bold tracking-[-0.00625rem] text-sidebar-foreground">
              {t("title")}
            </h2>
          </div>
        ) : (
          // Reserve exactly the fixed left overlay's width so the view controls
          // clear it; the empty reserved space is a window-drag region.
          <div
            data-tauri-drag-region
            className="h-full shrink-0"
            style={{ width: leftReserve }}
          />
        )}
        {/* Draggable filler between the two clusters — the header is the
            window's top edge, so its empty space must move the window. */}
        <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
        <div className="flex items-center gap-0.5">
          {/* Locate the active conversation in the list below (moved here from
              the conversation detail header). Always shown, leading the header
              cluster. The sidebar is unmounted while collapsed, so `listRef` is
              live whenever this button is visible. */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-6 w-6 shrink-0 text-muted-foreground"
            onClick={() => listRef.current?.scrollToActive()}
            title={t("locateActiveConversation")}
            aria-label={t("locateActiveConversation")}
          >
            <Crosshair aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
          {/* Expand/collapse-all is an icon-only header button on every
              viewport (it used to be a labelled row inside the view-options
              menu on desktop): it acts on the list right now instead of storing
              a display preference, so it does not belong among that menu's
              settings rows — and it took two clicks there. The icon itself
              states the direction, hence label-free with a tooltip. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground"
            onClick={handleToggleExpandAll}
            title={toggleExpandLabel}
            aria-label={toggleExpandLabel}
          >
            {allExpanded ? (
              <ListChevronsDownUp aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <ListChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </Button>
          <DropdownMenu
            open={viewOptionsOpen}
            onOpenChange={setViewOptionsOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden h-6 w-6 shrink-0 text-muted-foreground"
                title={viewOptionsLabel}
                aria-label={viewOptionsLabel}
              >
                {/* An eye, not a funnel: the menu as a whole decides what the
                    list shows and in what order. Its one filter, by tags, wears
                    the funnel on its own row, and a filter that is on announces
                    itself in the strip above the list. */}
                <Eye aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            {/* Wider than the shared `min-w-48`: the section-order rows carry a
                position chip and two move buttons beside the name, and the menu
                clips overflow-x — 48 would start truncating longer localized
                section names. */}
            <DropdownMenuContent align="end" className="min-w-56">
              {/* Five groups: what the list shows → which nav rows exist →
                  which tabs the window shows → how the list is sorted → how its
                  sections are stacked. The first group is the tag filter plus
                  the list toggles, and those and the nav rows are hover-opened
                  submenus rather than inline blocks. The two inventories are
                  set-and-forget on/off sets, six checkboxes between them, and
                  inlining all six left a fifteen-row menu with Sort by /
                  Section order — the two settings people actually come back for
                  — stranded at the bottom of it. The tag filter, which people
                  come back for too, leads the menu instead: it is a whole panel
                  (search, match mode, tag list) that only a submenu has room
                  for. Sort by and Section order stay inline: a pair of radios
                  and a ranked list read wrong behind another hop, and the order
                  rows need this menu's width. Tabs-follow-folder is one inline
                  checkbox: a single switch, and the sidebar is where it is used
                  (clicking a folder header then selects that folder's tabs).
                  Every option keeps the menu open on select (the default is to
                  close): this menu is a settings panel, not a command list, and
                  flipping two of them used to cost two round trips through the
                  trigger. The one action it used to carry — expand/collapse
                  all — is now a header button of its own. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <MessagesSquare className="text-muted-foreground" />
                  {t("listOptions")}
                </DropdownMenuSubTrigger>
                {/* No width override: unlike the root content — held at exactly
                    `min-w-56` and clipping overflow-x — the sub-content grows to
                    fit its rows, which is the headroom these three (the longest
                    labels in the menu) want. */}
                <DropdownMenuSubContent>
                  <DropdownMenuCheckboxItem
                    checked={showCompleted}
                    onCheckedChange={handleSetShowCompleted}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("showCompleted")}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showWorktrees}
                    onCheckedChange={handleSetShowWorktrees}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("showWorktrees")}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showRecent}
                    onCheckedChange={handleSetShowRecent}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t("showRecent")}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
                            <DropdownMenuCheckboxItem
                checked={tabsFollowFolder}
                onCheckedChange={setTabsFollowFolder}
                onSelect={(event) => event.preventDefault()}
                title={t("tabsFollowFolderHint")}
              >
                <FolderSync className="text-muted-foreground" />
                {t("tabsFollowFolder")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortMode}
                onValueChange={handleSetSortMode}
              >
                <DropdownMenuRadioItem
                  value="created"
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("sortByCreatedAt")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="updated"
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("sortByUpdatedAt")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("sectionOrder")}</DropdownMenuLabel>
              <SidebarSectionOrderControl
                order={sectionOrder}
                onMove={handleMoveSection}
                hiddenSections={hiddenSections}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Fixed navigation above the scrollable list. `shrink-0` keeps it pinned —
          it never scrolls with the conversation list. Rows are `rounded-full`
          like the conversation pills, and the icon/text geometry matches the
          folder header: a 0.875rem icon + 0.875rem label at a 0.4375rem gap, with
          the row's pl-[0.4375rem] (atop the container's px-1.5) placing the icon
          center on the same 0.875rem rail axis as the folder/conversation icons in
          the list below. Each row is a `group` so trailing badges reveal on
          hover / keyboard focus. */}
      <div className="flex shrink-0 flex-col gap-0.5 px-1.5 pt-1.5">
        <SidebarNavButton
          icon={Bot}
          label={tSettings("agents")}
          active={routeId === "agents"}
          onClick={() => {
            if (isMobile) toggle()
            setRoute("agents")
          }}
        />
        <SidebarNavButton
          icon={Workflow}
          label={t("automations")}
          active={routeId === "automations"}
          onClick={() => {
            if (isMobile) toggle()
            setRoute("automations")
          }}
        />
        <SidebarNavButton
          icon={ListChecks}
          label={t("tasks")}
          active={routeId === "tasks"}
          onClick={() => {
            if (isMobile) toggle()
            setRoute("tasks")
          }}
        />
        {/* Search is deliberately NOT a row here: it moved to the fixed top-left
            window chrome (`LeftEdgeChrome`, plus the mobile `FolderTitleBar`),
            which — unlike this sidebar — never unmounts, so the button survives
            a collapse. ⌘K still works from anywhere. */}
        </div>

      {/* On mobile, clicking a conversation card auto-closes the Drawer */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-hidden pt-1.5"
        onClick={
          isMobile
            ? (e) => {
                const target = e.target as HTMLElement
                if (target.closest("[data-conversation-id]")) {
                  toggle()
                }
              }
            : undefined
        }
      >
        <SidebarConversationList
          ref={listRef}
          showCompleted={showCompleted}
          showWorktrees={showWorktrees}
          showRecent={showRecent}
          sortMode={sortMode}
          sectionOrder={sectionOrder}
          tagFilter={EMPTY_TAG_FILTER}
        />
      </div>
    </aside>
  )
}
