"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { BOARD_COLUMN_IDS, type BoardColumnId } from "./board-columns"
import { TASK_LIST_CELLS, TASK_LIST_LINE } from "./task-row"
import type { TasksViewMode } from "@/lib/tasks-board-filter-storage"

/** The column marker's tone — the same four the real board headers use. */
const COLUMN_TONE: Record<BoardColumnId, string> = {
  todo: "bg-muted-foreground/50",
  inProgress: "bg-primary",
  attention: "bg-amber-500",
  done: "bg-emerald-500",
}

/** Ghost cards per column, and the title width of each — uneven on purpose, so
 *  the placeholder reads as a board being filled rather than a grey grid. */
const GHOST_CARDS: Record<BoardColumnId, string[]> = {
  todo: ["w-4/5", "w-3/5", "w-2/3"],
  inProgress: ["w-3/4", "w-1/2"],
  attention: ["w-2/3"],
  done: ["w-3/5", "w-4/5"],
}

/** Title widths of the list-view ghost rows. */
const GHOST_ROWS = ["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-2/5", "w-1/3"]

/**
 * First-paint placeholder for the tasks page.
 *
 * It mirrors the real layout rather than dropping slabs at the top of the
 * window: the toolbar row is reserved (the live toolbar is withheld until the
 * first task exists, so without this the content would start flush against the
 * chrome strip), and below it the ghosts sit on the board's own insets in
 * whichever mode is about to render.
 */
export function TasksSkeleton({ mode }: { mode: TasksViewMode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-hidden>
      {/* Toolbar: same metrics as the live one (h-8 pills, px-4 pb-2 pt-4) —
          filters on the left, "new task" alone on the right (the view switch
          and the settings entry live in the window's chrome cluster). The
          status select is list-only, exactly as in the live toolbar. */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
        <Skeleton className="h-8 w-36 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        {mode === "list" ? (
          <Skeleton className="h-8 w-28 rounded-full" />
        ) : null}
        <div className="flex-1" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>

      {mode === "list" ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-foreground/15 bg-card ws-msg-card">
            {/* The header is drawn for real, like the board's column headers —
                its labels are what makes the placeholder read as this list. */}
            <div
              className={cn(
                TASK_LIST_LINE,
                "shrink-0 border-b border-border/60 bg-muted/30 py-1.5"
              )}
            >
              <div className={TASK_LIST_CELLS.status}>
                <Skeleton className="h-2.5 w-8 rounded" />
              </div>
              <div className={TASK_LIST_CELLS.title}>
                <Skeleton className="h-2.5 w-8 rounded" />
              </div>
              <div className={TASK_LIST_CELLS.location}>
                <Skeleton className="h-2.5 w-8 rounded" />
              </div>
              <div className={TASK_LIST_CELLS.changes}>
                <Skeleton className="h-2.5 w-8 rounded" />
              </div>
              <div className={TASK_LIST_CELLS.updated}>
                <Skeleton className="h-2.5 w-6 rounded" />
              </div>
              <div className={TASK_LIST_CELLS.actions} />
            </div>
            <div className="divide-y divide-border/50">
              {GHOST_ROWS.map((width, i) => (
                <div
                  key={i}
                  className={cn(TASK_LIST_LINE, "min-h-[2.875rem] py-2")}
                >
                  <div className={TASK_LIST_CELLS.status}>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <div className={TASK_LIST_CELLS.title}>
                    <Skeleton className={cn("h-3.5 rounded", width)} />
                  </div>
                  <div className={TASK_LIST_CELLS.location}>
                    <Skeleton className="h-3 w-24 rounded" />
                  </div>
                  <div className={TASK_LIST_CELLS.changes}>
                    <Skeleton className="h-3 w-12 rounded" />
                  </div>
                  <div className={TASK_LIST_CELLS.updated}>
                    <Skeleton className="h-3 w-6 rounded" />
                  </div>
                  <div className={cn(TASK_LIST_CELLS.actions, "flex gap-1")}>
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="size-6 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-4 px-4 pb-4 pt-2">
          {BOARD_COLUMN_IDS.map((col) => (
            <div key={col} className="flex min-h-0 flex-col gap-2">
              {/* The header is drawn for real — its marker and metrics are
                  what makes the placeholder read as this page. */}
              <div className="flex h-6 shrink-0 items-center gap-2 px-0.5">
                <span
                  className={cn(
                    "h-3.5 w-[3px] shrink-0 rounded-full",
                    COLUMN_TONE[col]
                  )}
                />
                <Skeleton className="h-3 w-12 rounded" />
                <Skeleton className="h-4 w-6 rounded-full" />
              </div>
              <div className="flex flex-col gap-4">
                {GHOST_CARDS[col].map((width, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 rounded-xl border border-foreground/15 bg-card p-3 ws-msg-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Skeleton className={cn("h-3.5 rounded", width)} />
                      <Skeleton className="h-4 w-10 shrink-0 rounded-full" />
                    </div>
                    <Skeleton className="h-2.5 w-2/5 rounded" />
                    <div className="mt-1 border-t border-border/60 pt-3">
                      <Skeleton className="h-5 w-16 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
