import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewTransition } from "./view-transition";

const controllers: ReturnType<typeof createViewTransition>[] = [];
function controller() {
  const value = createViewTransition();
  controllers.push(value);
  return value;
}

function mockTransitions() {
  const pending: {
    update: () => void;
    finish: () => void;
    skip: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: vi.fn((update: () => void) => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const skip = vi.fn();
      pending.push({ update, finish, skip });
      return { ready: Promise.resolve(), finished, skipTransition: skip };
    }),
  });
  return pending;
}

afterEach(() => {
  controllers.splice(0).forEach((value) => value.dispose());
  Reflect.deleteProperty(document, "startViewTransition");
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("view transition coordination", () => {
  it("commits immediately without API support", () => {
    const update = vi.fn();
    const after = vi.fn();
    const ready = vi.fn();
    controller().run("push", update, undefined, after, ready);
    expect(update).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
  });

  it("honors reduced motion without starting a snapshot", () => {
    mockTransitions();
    document.documentElement.dataset.motion = "reduced";
    const update = vi.fn();
    controller().run("push", update);
    expect(update).toHaveBeenCalledOnce();
    expect(document.startViewTransition).not.toHaveBeenCalled();
  });

  it("suppresses stale callbacks across local and route transitions", async () => {
    const pending = mockTransitions();
    const surface = document.createElement("div");
    const stale = vi.fn();
    const current = vi.fn();
    controller().run("push", stale, surface);
    expect(surface.style.viewTransitionName).toBe("route");
    expect(document.documentElement.style.viewTransitionName).toBe("none");
    controller().run("pop", current);
    expect(pending[0]!.skip).toHaveBeenCalledOnce();
    expect(surface.style.viewTransitionName).toBe("");
    pending[0]!.update();
    pending[0]!.finish();
    await Promise.resolve();
    expect(document.documentElement.dataset.navigationMotion).toBe("pop");
    pending[1]!.update();
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    pending[1]!.finish();
    await Promise.resolve();
    expect(document.documentElement.dataset.navigationMotion).toBeUndefined();
    expect(document.documentElement.style.viewTransitionName).toBe("");
  });

  it("does not update an unmounted owner", () => {
    const pending = mockTransitions();
    const transition = controller();
    const update = vi.fn();
    transition.run("push", update);
    transition.dispose();
    pending[0]!.update();
    expect(update).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.navigationMotion).toBeUndefined();
  });

  it("falls back if starting a transition throws", () => {
    mockTransitions();
    vi.mocked(document.startViewTransition).mockImplementation(() => {
      throw new Error("unavailable");
    });
    const update = vi.fn();
    controller().run("push", update);
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.navigationMotion).toBeUndefined();
  });
});
