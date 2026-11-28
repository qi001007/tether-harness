"use client"

import { useEffect, useState } from "react"

import { expertsList } from "@/lib/api"
import type { ExpertListItem } from "@/lib/types"

// Module-level cache so every MessageInput/ChatInput instance shares a single
// fetch. Experts are bundled into the binary and change only when codeg is
// upgraded, so refetching per mount is wasted work.
let cachedExperts: ExpertListItem[] | null = null
let inflight: Promise<ExpertListItem[]> | null = null
const subscribers = new Set<(experts: ExpertListItem[]) => void>()

async function loadExperts(): Promise<ExpertListItem[]> {
  if (cachedExperts) return cachedExperts
  if (inflight) return inflight
  inflight = expertsList()
    .then((list) => {
      cachedExperts = list
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
 * Returns the list of built-in expert skills bundled into codeg.
 *
 * The first call triggers a single backend request; subsequent hook
 * instances read from an in-memory cache. Safe to call from many components
 * without causing duplicate fetches.
 */
export function useBuiltInExperts(): ExpertListItem[] {
  const [experts, setExperts] = useState<ExpertListItem[]>(
    () => cachedExperts ?? []
  )

  useEffect(() => {
    // If the cache is already populated the useState initializer above
    // already handed us the right value — no follow-up setState needed.
    // Only kick off a fetch when the cache is empty, and always register
    // the subscriber so concurrent consumers pick up the fresh list the
    // moment the first load resolves.
    let cancelled = false
    if (!cachedExperts) {
      loadExperts()
        .then((list) => {
          if (!cancelled) setExperts(list)
        })
        .catch((err) => {
          console.warn("[useBuiltInExperts] failed to load experts:", err)
        })
    }

    const onUpdate = (next: ExpertListItem[]) => {
      if (!cancelled) setExperts(next)
    }
    subscribers.add(onUpdate)

    return () => {
      cancelled = true
      subscribers.delete(onUpdate)
    }
  }, [])

  return experts
}
