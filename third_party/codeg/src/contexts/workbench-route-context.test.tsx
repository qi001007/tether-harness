import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  WorkbenchRouteProvider,
  useWorkbenchRoute,
} from "./workbench-route-context"

function Probe() {
  const {
    routeId,
    isConversations,
    requestedProjectId,
    setRoute,
    openAgentsHome,
    openConversations,
  } =
    useWorkbenchRoute()
  return (
    <div>
      <span data-testid="route">{routeId}</span>
      <span data-testid="isConv">{String(isConversations)}</span>
      <span data-testid="project">{requestedProjectId ?? "none"}</span>
      <button onClick={() => setRoute("automations")}>go</button>
      <button onClick={() => setRoute("agents")}>agents</button>
      <button onClick={() => openAgentsHome({ projectId: 2 })}>select B</button>
      <button
        onClick={() =>
          window.dispatchEvent(
            new MessageEvent("message", { data: { type: "tether:show-home" } })
          )
        }
      >
        show home
      </button>
      <button onClick={() => openAgentsHome({ projectId: 1 })}>select A</button>
      <button onClick={openConversations}>back</button>
    </div>
  )
}

describe("WorkbenchRouteProvider", () => {
  it("keeps the native home marker through hydration and mirrors home/conversation routes", () => {
    const originalUrl = window.location.pathname + window.location.search + window.location.hash
    window.history.replaceState({}, "", "/workspace?keep=1&tether_home=1#panel")
    const { getByTestId, getByText, unmount } = render(
      <WorkbenchRouteProvider>
        <Probe />
      </WorkbenchRouteProvider>
    )

    expect(getByTestId("route").textContent).toBe("agents")
    expect(new URLSearchParams(window.location.search).getAll("tether_home")).toEqual(["1"])
    expect(window.location.search).toContain("keep=1")
    expect(window.location.hash).toBe("#panel")

    fireEvent.click(getByText("back"))
    expect(getByTestId("route").textContent).toBe("conversations")
    expect(new URLSearchParams(window.location.search).getAll("tether_home")).toEqual([])
    expect(window.location.search).toContain("keep=1")
    expect(window.location.hash).toBe("#panel")

    fireEvent.click(getByText("agents"))
    expect(new URLSearchParams(window.location.search).getAll("tether_home")).toEqual(["1"])
    unmount()
    window.history.replaceState({}, "", originalUrl)
  })

  it("defaults to the conversation workspace and switches routes", () => {
    const { getByTestId, getByText } = render(
      <WorkbenchRouteProvider>
        <Probe />
      </WorkbenchRouteProvider>
    )
    expect(getByTestId("route").textContent).toBe("conversations")
    expect(getByTestId("isConv").textContent).toBe("true")

    fireEvent.click(getByText("go"))
    expect(getByTestId("route").textContent).toBe("automations")
    expect(getByTestId("isConv").textContent).toBe("false")

    fireEvent.click(getByText("back"))
    expect(getByTestId("route").textContent).toBe("conversations")
    expect(getByTestId("isConv").textContent).toBe("true")
  })

  it("throws when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/WorkbenchRouteProvider/)
    spy.mockRestore()
  })

  it("keeps the native sidebar project while returning to Agent Home, then clears it for conversations", () => {
    const { getByTestId, getByText, getByRole } = render(
      <WorkbenchRouteProvider>
        <Probe />
      </WorkbenchRouteProvider>
    )

    fireEvent.click(getByText("select B"))
    fireEvent.click(getByRole("button", { name: "agents" }))
    expect(getByTestId("project").textContent).toBe("2")

    fireEvent.click(getByText("go"))
    expect(getByTestId("route").textContent).toBe("automations")
    expect(getByTestId("project").textContent).toBe("2")
    fireEvent.click(getByText("show home"))
    expect(getByTestId("route").textContent).toBe("agents")
    expect(getByTestId("project").textContent).toBe("2")

    fireEvent.click(getByText("back"))
    expect(getByTestId("route").textContent).toBe("conversations")
    expect(getByTestId("project").textContent).toBe("none")

    fireEvent.click(getByText("select A"))
    expect(getByTestId("project").textContent).toBe("1")
  })
})
