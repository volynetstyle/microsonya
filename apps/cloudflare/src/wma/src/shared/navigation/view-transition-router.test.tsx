import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { useViewTransitionRouter } from "./view-transition-router";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("restores scroll on Back without scheduling work during scrolling", async () => {
  history.replaceState(null, "", "/");
  vi.stubGlobal("scrollX", 0);
  vi.stubGlobal("scrollY", 0);
  const scroll = vi.fn();
  vi.stubGlobal("scrollTo", scroll);
  const view = render(() => {
    const path = useViewTransitionRouter({
      routes: [
        { path: "/", depth: 0 },
        { path: "/chat", depth: 1 },
      ],
    });
    return (
      <>
        <a href="/chat">Chat</a>
        <output>{path()}</output>
      </>
    );
  });
  await waitFor(() => expect(history.state).not.toBeNull());
  const homeState = history.state;
  vi.stubGlobal("scrollY", 375);
  const frame = vi.spyOn(window, "requestAnimationFrame");
  dispatchEvent(new Event("scroll"));
  expect(frame).not.toHaveBeenCalled();
  fireEvent.click(view.getByText("Chat"));
  expect(view.container.querySelector("output")).toHaveTextContent("/chat");
  expect(scroll).toHaveBeenLastCalledWith({
    left: 0,
    top: 0,
    behavior: "instant",
  });

  vi.stubGlobal("scrollY", 80);
  history.replaceState(homeState, "", "/");
  dispatchEvent(new PopStateEvent("popstate", { state: homeState }));
  await waitFor(() =>
    expect(view.container.querySelector("output")?.textContent).toBe("/"),
  );
  expect(scroll).toHaveBeenLastCalledWith({
    left: 0,
    top: 375,
    behavior: "instant",
  });
});
