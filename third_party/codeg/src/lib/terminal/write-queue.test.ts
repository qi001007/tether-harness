import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWriteQueue } from "./write-queue"

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (err: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A `send` whose every invocation is recorded and whose resolution is driven by
 * the test (`resolveAt`/`rejectAt`), plus a running tally of how many sends are
 * concurrently in flight (to assert the single-flight invariant).
 */
function controllableSend() {
  const batches: string[] = []
  const gates: Deferred[] = []
  let inFlight = 0
  let peak = 0
  const send = async (data: string): Promise<void> => {
    batches.push(data)
    const gate = deferred()
    gates.push(gate)
    inFlight += 1
    peak = Math.max(peak, inFlight)
    try {
      await gate.promise
    } finally {
      inFlight -= 1
    }
  }
  return {
    send,
    batches,
    resolveAt: (i: number) => gates[i].resolve(),
    rejectAt: (i: number, err: unknown) => gates[i].reject(err),
    peakInFlight: () => peak,
  }
}

/** Flush pending microtasks (awaited sends). */
const pump = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("createWriteQueue — ordering & coalescing", () => {
  it("coalesces bytes typed during an in-flight send into the next batch, in order", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("a") // send("a") starts synchronously
    expect(c.batches).toEqual(["a"])
    q.enqueue("b") // in flight → buffered
    q.enqueue("c") // buffered
    expect(c.batches).toEqual(["a"])

    c.resolveAt(0)
    await pump()
    expect(c.batches).toEqual(["a", "bc"]) // b+c coalesced, in order

    q.dispose()
  })

  it("preserves order across sequential sends (idle between keystrokes)", async () => {
    const sent: string[] = []
    const q = createWriteQueue(async (d) => {
      sent.push(d)
    })

    for (const ch of ["h", "e", "l", "l", "o"]) {
      q.enqueue(ch)
      await pump()
    }
    expect(sent.join("")).toBe("hello")

    q.dispose()
  })

  it("never has more than one send in flight (single-flight)", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("a")
    q.enqueue("b")
    q.enqueue("c")
    c.resolveAt(0)
    await pump()
    c.resolveAt(1)
    await pump()

    expect(c.peakInFlight()).toBe(1)
    q.dispose()
  })

  it("delivers a byte enqueued during an in-flight send (no lost wakeup)", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("a")
    q.enqueue("b") // lands while send("a") is still in flight

    c.resolveAt(0)
    await pump()
    expect(c.batches).toEqual(["a", "b"])

    q.dispose()
  })

  it("ignores empty enqueues and enqueues after dispose", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("")
    await pump()
    expect(c.batches).toEqual([]) // empty write is never sent

    q.dispose()
    q.enqueue("z")
    await pump()
    expect(c.batches).toEqual([]) // post-dispose input is ignored
  })
})

describe("createWriteQueue — failure is dropped, never duplicated", () => {
  it("drops a failed batch without retrying or duplicating it", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("x")
    c.rejectAt(0, new Error("blip"))
    await pump()
    expect(c.batches).toEqual(["x"]) // sent once; NOT retried

    q.enqueue("y")
    await pump()
    // "y" delivered; "x" is never re-sent — no duplicate of input that may
    // already have reached the PTY.
    expect(c.batches).toEqual(["x", "y"])

    c.resolveAt(1)
    await pump()
    q.dispose()
  })

  it("keeps bytes typed during a failed send and drops only the failed batch", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("ab") // send("ab") starts
    q.enqueue("c") // typed while "ab" in flight → buffered
    c.rejectAt(0, new Error("blip"))
    await pump()

    // "ab" dropped (no re-prepend → never "abc", never a second "ab");
    // "c" still delivered, in order.
    expect(c.batches).toEqual(["ab", "c"])

    c.resolveAt(1)
    await pump()
    q.dispose()
  })
})

describe("createWriteQueue — dispose", () => {
  it("dispose() during an in-flight send stops the pump and sends no more", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("a")
    q.enqueue("b") // buffered
    q.dispose()
    c.resolveAt(0) // in-flight send resolves after dispose
    await pump()

    expect(c.batches).toEqual(["a"]) // "b" never sent

    q.enqueue("c")
    await pump()
    expect(c.batches).toEqual(["a"]) // post-dispose enqueue is a no-op
  })

  it("dispose() before an in-flight send rejects sends nothing more", async () => {
    const c = controllableSend()
    const q = createWriteQueue(c.send)

    q.enqueue("a")
    q.enqueue("b") // buffered, then dropped by dispose
    q.dispose()
    c.rejectAt(0, new Error("blip")) // in-flight send rejects after dispose
    await pump()

    expect(c.batches).toEqual(["a"]) // catch sees `stopped` → no further send
  })
})
