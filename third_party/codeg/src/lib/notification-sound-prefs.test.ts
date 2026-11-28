import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_NOTIFICATION_SOUND_PREFS,
  getNotificationSoundPrefs,
  loadNotificationSoundPrefs,
  parseNotificationSoundPrefs,
  resetNotificationSoundPrefsCacheForTests,
  saveNotificationSoundPrefs,
  subscribeNotificationSoundPrefs,
} from "./notification-sound-prefs"

describe("notification sound preferences", () => {
  beforeEach(() => {
    localStorage.clear()
    resetNotificationSoundPrefsCacheForTests()
  })

  it("defaults to silent until the user opts in", () => {
    // The master switch must stay off across an upgrade: an install that never
    // asked for audio may not start beeping on its own.
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS.enabled).toBe(false)
    expect(loadNotificationSoundPrefs()).toEqual(
      DEFAULT_NOTIFICATION_SOUND_PREFS
    )
  })

  it("never hands out the shared default object", () => {
    // A caller mutating what it loaded must not rewrite the defaults for
    // everyone else in the process.
    const loaded = loadNotificationSoundPrefs()
    loaded.tones.turn_complete = "pop"
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS.tones.turn_complete).toBe("chime")
  })

  it("round-trips a full preference set", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      enabled: true,
      volume: 0.25,
      onlyWhenUnfocused: true,
      tones: {
        ...DEFAULT_NOTIFICATION_SOUND_PREFS.tones,
        error: "alert" as const,
      },
    }
    saveNotificationSoundPrefs(prefs)
    expect(loadNotificationSoundPrefs()).toEqual(prefs)
  })

  it("fills each missing or invalid field from the defaults independently", () => {
    // A partial blob from an older build must not discard the fields it does
    // carry, nor the defaults for the ones it doesn't.
    const parsed = parseNotificationSoundPrefs({
      enabled: true,
      volume: "loud",
      tones: { turn_complete: "pop", error: "not-a-tone" },
    })
    expect(parsed.enabled).toBe(true)
    expect(parsed.volume).toBe(DEFAULT_NOTIFICATION_SOUND_PREFS.volume)
    expect(parsed.onlyWhenUnfocused).toBe(
      DEFAULT_NOTIFICATION_SOUND_PREFS.onlyWhenUnfocused
    )
    expect(parsed.tones.turn_complete).toBe("pop")
    expect(parsed.tones.error).toBe(
      DEFAULT_NOTIFICATION_SOUND_PREFS.tones.error
    )
  })

  it("clamps an out-of-range volume instead of rejecting it", () => {
    expect(parseNotificationSoundPrefs({ volume: 1.8 }).volume).toBe(1)
    expect(parseNotificationSoundPrefs({ volume: -3 }).volume).toBe(0)
  })

  it("falls back to the defaults on a corrupt stored value", () => {
    localStorage.setItem("settings:notification-sound:v1", "{not json")
    expect(loadNotificationSoundPrefs()).toEqual(
      DEFAULT_NOTIFICATION_SOUND_PREFS
    )
  })

  it("notifies same-window subscribers and refreshes the snapshot on save", () => {
    // The snapshot is shared with the player; without the invalidation the
    // workspace window would keep the old settings until it reloaded.
    const seen: boolean[] = []
    const unsubscribe = subscribeNotificationSoundPrefs(() =>
      seen.push(getNotificationSoundPrefs().enabled)
    )
    saveNotificationSoundPrefs({
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      enabled: true,
    })
    unsubscribe()
    saveNotificationSoundPrefs(DEFAULT_NOTIFICATION_SOUND_PREFS)

    expect(seen).toEqual([true])
  })

  it("keeps a stable snapshot identity until something writes", () => {
    // `useSyncExternalStore` re-renders forever if the snapshot is a fresh
    // object on every read.
    const first = getNotificationSoundPrefs()
    expect(getNotificationSoundPrefs()).toBe(first)

    saveNotificationSoundPrefs({
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      enabled: true,
    })
    const second = getNotificationSoundPrefs()
    expect(second).not.toBe(first)
    expect(second.enabled).toBe(true)
  })
})
