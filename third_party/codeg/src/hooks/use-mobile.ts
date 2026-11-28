"use client"

import { useMediaQuery } from "./use-media-query"

const MOBILE_BREAKPOINT = "(max-width: 767px)"

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_BREAKPOINT)
}
