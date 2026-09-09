import { flush } from "solid-js";

type Motion = "push" | "pop";
let active: { cancel: () => void } | undefined;

/** One document transition at a time, including transitions inside a route. */
export function createViewTransition() {
  let owned: typeof active;
  let disposed = false;
  let reducedMotion: MediaQueryList | undefined;

  const run = (
    motion: Motion,
    update: () => void,
    target?: HTMLElement,
    afterCommit?: () => void,
    afterReady?: () => void,
  ) => {
    if (disposed) return;
    active?.cancel();
    const root = document.documentElement;
    const commit = () => {
      update();
      // Solid 2 must commit the DOM before the browser captures the new view.
      flush();
      afterCommit?.();
    };
    const prefersReducedMotion =
      typeof matchMedia === "function" &&
      (reducedMotion ??= matchMedia("(prefers-reduced-motion: reduce)"))
        .matches;
    if (
      root.dataset.motion === "reduced" ||
      prefersReducedMotion ||
      document.visibilityState === "hidden"
    ) {
      commit();
      return;
    }
    if (typeof document.startViewTransition !== "function") {
      commit();
      afterReady?.();
      return;
    }

    const surface = target ?? root;
    const previousName = surface.style.viewTransitionName;
    const previousRootName = root.style.viewTransitionName;
    let cancelled = false;
    let transition: ViewTransition | undefined;
    const cleanup = () => {
      if (active !== entry) return;
      surface.style.viewTransitionName = previousName;
      root.style.viewTransitionName = previousRootName;
      delete root.dataset.navigationMotion;
      active = undefined;
      owned = undefined;
    };
    const entry = {
      cancel: () => {
        cancelled = true;
        transition?.skipTransition();
        cleanup();
      },
    };
    active = owned = entry;
    // Root snapshots are viewport-sized. Local transitions capture only their
    // surface, without an additional full-page crossfade or route snapshot.
    root.style.viewTransitionName = "none";
    surface.style.viewTransitionName = "route";
    root.dataset.navigationMotion = motion;
    try {
      transition = document.startViewTransition(() => {
        if (!cancelled && !disposed) commit();
      });
    } catch {
      cleanup();
      commit();
      return;
    }
    // `ready` runs after the new snapshot, so layout animation started here
    // cannot change what the transition captured.
    void transition.ready.then(
      () => {
        if (!cancelled && !disposed && active === entry) afterReady?.();
      },
      () => {},
    );
    void transition.finished.then(cleanup, (error: unknown) => {
      cleanup();
      if (!cancelled) console.error("ViewTransition failed", error);
    });
  };

  return {
    run,
    cancel: () => owned?.cancel(),
    dispose: () => {
      disposed = true;
      owned?.cancel();
    },
  };
}
