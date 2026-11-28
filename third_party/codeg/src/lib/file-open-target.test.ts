import { beforeEach, describe, expect, it, vi } from "vitest"

const getHomeDirectoryMock = vi.fn<() => Promise<string>>()

vi.mock("@/lib/api", () => ({
  getHomeDirectory: (...args: []) => getHomeDirectoryMock(...args),
}))

import {
  expandHomePath,
  findOwningFolder,
  isHomeRelativePath,
  isUncPath,
  joinRootRel,
  normalizeAbsPath,
  resetHomeDirCacheForTests,
  splitAbsPath,
} from "@/lib/file-open-target"

describe("normalizeAbsPath", () => {
  it("normalizes slashes and strips trailing slashes", () => {
    expect(normalizeAbsPath("/repo/src/")).toBe("/repo/src")
    expect(normalizeAbsPath("\\repo\\src\\a.ts")).toBe("/repo/src/a.ts")
    expect(normalizeAbsPath("/repo//")).toBe("/repo")
  })

  it("keeps the bare roots", () => {
    expect(normalizeAbsPath("/")).toBe("/")
    expect(normalizeAbsPath("C:/")).toBe("C:/")
    expect(normalizeAbsPath("c:\\")).toBe("C:/")
  })

  it("upper-cases Windows drive letters for one identity", () => {
    expect(normalizeAbsPath("c:/Repo/x.ts")).toBe("C:/Repo/x.ts")
  })

  it("resolves dot segments so aliases collapse to one identity", () => {
    expect(normalizeAbsPath("/repo/src/../a.ts")).toBe("/repo/a.ts")
    expect(normalizeAbsPath("/repo/./a.ts")).toBe("/repo/a.ts")
    expect(normalizeAbsPath("/repo//src///a.ts")).toBe("/repo/src/a.ts")
    expect(normalizeAbsPath("C:/repo/../x.ts")).toBe("C:/x.ts")
  })

  it("floors .. at the root — a lexical escape is classified by its target", () => {
    // "/repo/../etc/passwd" is NOT inside /repo; it must normalize to the
    // path it actually points at so folder matching cannot be fooled.
    expect(normalizeAbsPath("/repo/../etc/passwd")).toBe("/etc/passwd")
    expect(normalizeAbsPath("/a/../../x")).toBe("/x")
  })

  it("preserves the UNC double-slash prefix", () => {
    expect(normalizeAbsPath("//server/share/x.ts")).toBe("//server/share/x.ts")
    expect(normalizeAbsPath("\\\\server\\share\\x.ts")).toBe(
      "//server/share/x.ts"
    )
  })

  it("floors .. at the UNC share root — the designator segments never pop", () => {
    expect(normalizeAbsPath("//server/share/../x")).toBe("//server/share/x")
    expect(normalizeAbsPath("//server/share/sub/../x")).toBe("//server/share/x")
    expect(normalizeAbsPath("//server/share/..")).toBe("//server/share")
  })
})

describe("isUncPath", () => {
  it("detects UNC paths, including backslash form", () => {
    expect(isUncPath("//server/share/x.ts")).toBe(true)
    expect(isUncPath("\\\\server\\share\\x.ts")).toBe(true)
  })

  it("is false for POSIX, drive, and relative paths", () => {
    expect(isUncPath("/repo/a.ts")).toBe(false)
    expect(isUncPath("C:/repo/a.ts")).toBe(false)
    expect(isUncPath("src/a.ts")).toBe(false)
  })
})

describe("splitAbsPath", () => {
  it("splits into (dirname, basename)", () => {
    expect(splitAbsPath("/repo/src/a.ts")).toEqual({
      rootPath: "/repo/src",
      ioPath: "a.ts",
    })
  })

  it("handles root-level files with usable directory roots", () => {
    expect(splitAbsPath("/hosts")).toEqual({ rootPath: "/", ioPath: "hosts" })
    expect(splitAbsPath("C:/x.ts")).toEqual({ rootPath: "C:/", ioPath: "x.ts" })
  })

  it("returns null for non-files and relative paths", () => {
    expect(splitAbsPath("/")).toBeNull()
    expect(splitAbsPath("C:/")).toBeNull()
    expect(splitAbsPath("src/a.ts")).toBeNull()
    expect(splitAbsPath("")).toBeNull()
  })

  it("ignores trailing slashes", () => {
    expect(splitAbsPath("/repo/src/a.ts/")).toEqual({
      rootPath: "/repo/src",
      ioPath: "a.ts",
    })
  })
})

describe("joinRootRel", () => {
  it("joins byte-identically with normalizeAbsPath output", () => {
    const joined = joinRootRel("/repo/", "src/a.ts")
    expect(joined).toBe("/repo/src/a.ts")
    expect(joined).toBe(normalizeAbsPath("/repo/src/a.ts"))
  })

  it("handles the bare roots without doubling slashes", () => {
    expect(joinRootRel("/", "hosts")).toBe("/hosts")
    expect(joinRootRel("C:/", "x.ts")).toBe("C:/x.ts")
  })

  it("strips leading ./ and / from the relative part", () => {
    expect(joinRootRel("/repo", "./src/a.ts")).toBe("/repo/src/a.ts")
    expect(joinRootRel("/repo", "/src/a.ts")).toBe("/repo/src/a.ts")
    expect(joinRootRel("/repo", "src\\a.ts")).toBe("/repo/src/a.ts")
  })

  it("resolves dot segments inside the relative part", () => {
    expect(joinRootRel("/repo", "src/../a.ts")).toBe("/repo/a.ts")
    expect(joinRootRel("/repo", "src/./a.ts")).toBe("/repo/src/a.ts")
  })

  it("returns the root itself for an empty relative part", () => {
    expect(joinRootRel("/repo", "")).toBe("/repo")
  })
})

describe("findOwningFolder", () => {
  const folders = [
    { id: 1, path: "/repo" },
    { id: 2, path: "/repo/packages/core" },
    { id: 3, path: "/other/" },
  ]

  it("matches on path boundaries only", () => {
    expect(findOwningFolder("/repo/src/a.ts", folders)).toMatchObject({
      folderId: 1,
      relPath: "src/a.ts",
    })
    // `/repo` must never claim `/repo-sibling/…`.
    expect(findOwningFolder("/repo-sibling/a.ts", folders)).toBeNull()
  })

  it("prefers the deepest containing root", () => {
    expect(
      findOwningFolder("/repo/packages/core/src/i.ts", folders)
    ).toMatchObject({
      folderId: 2,
      rootPath: "/repo/packages/core",
      relPath: "src/i.ts",
    })
  })

  it("does not match the folder root itself", () => {
    expect(findOwningFolder("/repo", folders)).toBeNull()
    expect(findOwningFolder("/repo/", folders)).toBeNull()
  })

  it("handles trailing-slash roots", () => {
    expect(findOwningFolder("/other/x.md", folders)).toMatchObject({
      folderId: 3,
      rootPath: "/other",
      relPath: "x.md",
    })
  })

  it("compares Windows drive paths case-insensitively, keeping casing", () => {
    const winFolders = [{ id: 9, path: "C:/Repo" }]
    expect(findOwningFolder("c:/repo/Src/App.ts", winFolders)).toMatchObject({
      folderId: 9,
      relPath: "Src/App.ts",
    })
  })

  it("stays case-sensitive on POSIX paths", () => {
    expect(findOwningFolder("/Repo/src/a.ts", folders)).toBeNull()
  })

  it("returns null for relative input or when nothing contains the path", () => {
    expect(findOwningFolder("src/a.ts", folders)).toBeNull()
    expect(findOwningFolder("/elsewhere/a.ts", folders)).toBeNull()
  })

  it("is not fooled by dot-segment escapes out of a root", () => {
    expect(findOwningFolder("/repo/../outside/x.ts", folders)).toBeNull()
    // …and an escape that lands back inside is fine.
    expect(findOwningFolder("/repo/sub/../src/a.ts", folders)).toMatchObject({
      folderId: 1,
      relPath: "src/a.ts",
    })
  })

  it("matches UNC share roots case-insensitively", () => {
    const uncFolders = [{ id: 7, path: "//server/share" }]
    expect(
      findOwningFolder("//Server/Share/Dir/x.ts", uncFolders)
    ).toMatchObject({
      folderId: 7,
      relPath: "Dir/x.ts",
    })
  })
})

describe("expandHomePath", () => {
  beforeEach(() => {
    getHomeDirectoryMock.mockReset()
    resetHomeDirCacheForTests()
  })

  it("detects home-relative paths", () => {
    expect(isHomeRelativePath("~/notes.md")).toBe(true)
    expect(isHomeRelativePath("~")).toBe(true)
    expect(isHomeRelativePath("~user/x")).toBe(false)
    expect(isHomeRelativePath("/repo/~x")).toBe(false)
  })

  it("expands ~/ against the backend home directory", async () => {
    getHomeDirectoryMock.mockResolvedValue("/Users/me")
    await expect(expandHomePath("~/.claude/plans/x.md")).resolves.toBe(
      "/Users/me/.claude/plans/x.md"
    )
  })

  it("is lazy for non-home paths", async () => {
    await expect(expandHomePath("/abs/x.md")).resolves.toBe("/abs/x.md")
    await expect(expandHomePath("rel/x.md")).resolves.toBe("rel/x.md")
    expect(getHomeDirectoryMock).not.toHaveBeenCalled()
  })

  it("caches the home lookup across calls and dedupes concurrency", async () => {
    getHomeDirectoryMock.mockResolvedValue("/Users/me")
    const [a, b] = await Promise.all([
      expandHomePath("~/a.md"),
      expandHomePath("~/b.md"),
    ])
    await expandHomePath("~/c.md")
    expect(a).toBe("/Users/me/a.md")
    expect(b).toBe("/Users/me/b.md")
    expect(getHomeDirectoryMock).toHaveBeenCalledTimes(1)
  })

  it("passes through unchanged on failure and retries next call", async () => {
    getHomeDirectoryMock.mockRejectedValueOnce(new Error("nope"))
    await expect(expandHomePath("~/a.md")).resolves.toBe("~/a.md")
    getHomeDirectoryMock.mockResolvedValue("/Users/me")
    await expect(expandHomePath("~/a.md")).resolves.toBe("/Users/me/a.md")
  })
})
