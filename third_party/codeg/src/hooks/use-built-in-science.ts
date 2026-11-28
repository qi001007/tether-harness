"use client"

import { useEffect, useState } from "react"

import { scienceList } from "@/lib/api"
import type { ScienceListItem } from "@/lib/types"

// Module-level cache so every MessageInput/ChatInput instance shares a single
// fetch. Science skills are bundled into the binary and change only when codeg
// is upgraded, so refetching per mount is wasted work. Mirrors
// use-built-in-experts.ts.
let cachedScience: ScienceListItem[] | null = null
let inflight: Promise<ScienceListItem[]> | null = null
const subscribers = new Set<(science: ScienceListItem[]) => void>()

async function loadScience(): Promise<ScienceListItem[]> {
  if (cachedScience) return cachedScience
  if (inflight) return inflight
  inflight = scienceList()
    .then((list) => {
      cachedScience = list
      inflight = null
      for (const subscriber of subscribers) {
        subscriber(list)
      }
      return list
    })
    .catch((err) => {
      inflight = null
      throw err
    })
  return inflight
}

/**
 * Returns the list of built-in scientific-research skills bundled into codeg.
 *
 * The first call triggers a single backend request; subsequent hook instances
 * read from an in-memory cache. Safe to call from many components without
 * causing duplicate fetches.
 */
export function useBuiltInScience(): ScienceListItem[] {
  const [science, setScience] = useState<ScienceListItem[]>(
    () => cachedScience ?? []
  )

  useEffect(() => {
    // If the cache is already populated the useState initializer above already
    // handed us the right value — no follow-up setState needed. Only kick off a
    // fetch when the cache is empty, and always register the subscriber so
    // concurrent consumers pick up the fresh list the moment the first load
    // resolves.
    let cancelled = false
    if (!cachedScience) {
      loadScience()
        .then((list) => {
          if (!cancelled) setScience(list)
        })
        .catch((err) => {
          console.warn(
            "[useBuiltInScience] failed to load science skills:",
            err
          )
        })
    }

    const onUpdate = (next: ScienceListItem[]) => {
      if (!cancelled) setScience(next)
    }
    subscribers.add(onUpdate)

    return () => {
      cancelled = true
      subscribers.delete(onUpdate)
    }
  }, [])

  return science
}
