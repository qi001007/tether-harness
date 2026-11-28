/**
 * Shared chrome for the aux panel's git headers ("commits" and "changes").
 *
 * Both toolbars sit in the same 40px header band and must read as ONE control
 * system, so the round ghost icon button lives here instead of being retyped per
 * file. `foreground/10` on hover in BOTH themes (overriding the ghost variant's
 * muted default) and `size-8` (not a narrow w-6) keep it a clean circle with the
 * glyph centered — matching the branch/author pills beside it in the commits
 * header. Callers add their own margins (e.g. `-mr-1` on the trailing button, to
 * push its rim out to the header's 8px guide).
 */
export const GIT_TOOLBAR_ICON_BUTTON_CLASS =
  "size-8 shrink-0 rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground dark:hover:bg-foreground/10"
