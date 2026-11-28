import type { Locale } from "date-fns"
import { ar, de, enUS, es, fr, ja, ko, ptBR, zhCN, zhTW } from "date-fns/locale"
import type { IntlLocale } from "@/lib/i18n"

/**
 * App locale → date-fns `Locale`, for react-day-picker.
 *
 * The calendar's weekday abbreviations, month captions and — less obviously —
 * which day a week starts on all come from this object. Without it every locale
 * gets en-US, i.e. English day names and Sunday-first weeks.
 *
 * `pt` maps to `ptBR`: our Portuguese messages are Brazilian ("visualização",
 * "arquivos"), so the date names should match rather than read as European
 * Portuguese.
 *
 * Statically imported (~4KB each) rather than loaded on demand: the app is a
 * static export, and a lazily-loaded calendar that pops in English first and
 * re-renders in the user's language is worse than the bytes.
 */
const BY_LOCALE: Record<IntlLocale, Locale> = {
  en: enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
  es,
  de,
  fr,
  pt: ptBR,
  ar,
}

export function dateFnsLocale(locale: string): Locale {
  return BY_LOCALE[locale as IntlLocale] ?? enUS
}
