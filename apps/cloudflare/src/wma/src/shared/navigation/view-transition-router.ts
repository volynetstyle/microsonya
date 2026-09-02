import { createSignal, flush, onSettled, type Accessor } from "solid-js";

export type RouteDefinition = Readonly<{ path: string; depth: number }>;
type Options = Readonly<{
  routes: readonly RouteDefinition[];
  transformUrl?: (url: URL) => URL;
}>;
type Motion = "push" | "pop";
type ScrollPosition = Readonly<{ left: number; top: number }>;

const STATE_KEY = "__microsonyaRoute";
const ZERO_SCROLL: ScrollPosition = { left: 0, top: 0 };

function historyIndex(state: unknown): number | undefined {
  if (typeof state !== "object" || state === null) return;
  const meta = (state as Record<string, unknown>)[STATE_KEY];
  if (typeof meta !== "object" || meta === null) return;
  const index = (meta as Record<string, unknown>).index;
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0
    ? index
    : undefined;
}

function indexedState(state: unknown, index: number): Record<string, unknown> {
  const base =
    typeof state === "object" && state !== null && !Array.isArray(state)
      ? state
      : {};
  return { ...base, [STATE_KEY]: { index } };
}

function interceptableLink(event: MouseEvent): HTMLAnchorElement | undefined {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  )
    return;

  const anchor = event.target.closest("a[href]");
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    (anchor.target && anchor.target !== "_self") ||
    anchor.hasAttribute("download") ||
    anchor.hasAttribute("data-native-navigation") ||
    anchor.relList.contains("external")
  )
    return;
  return anchor;
}

export function useViewTransitionRouter(options: Options): Accessor<string> {
  const [pathname, setPathname] = createSignal(
    typeof window === "undefined"
      ? (options.routes[0]?.path ?? "/")
      : location.pathname,
  );
  const depths = new Map(
    options.routes.map(({ path, depth }) => [path, depth]),
  );

  onSettled(() => {
    const root = document.documentElement;
    const history = window.history;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const previousRestoration = history.scrollRestoration;
    const scrollPositions = new Map<number, ScrollPosition>();
    let index = historyIndex(history.state) ?? 0;
    let scrollFrame = 0;
    let disposed = false;
    let activeTransition: ViewTransition | undefined;

    if (historyIndex(history.state) === undefined) {
      history.replaceState(
        indexedState(history.state, index),
        "",
        location.href,
      );
    }
    history.scrollRestoration = "manual";

    const rememberScroll = () =>
      scrollPositions.set(index, { left: scrollX, top: scrollY });
    const restoreScroll = ({ left, top }: ScrollPosition) =>
      scrollTo({ left, top, behavior: "instant" });
    const handleScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        rememberScroll();
      });
    };

    const navigate = (
      nextPath: string,
      motion: Motion,
      scroll: ScrollPosition,
    ) => {
      if (disposed) return;
      if (nextPath === pathname()) {
        restoreScroll(scroll);
        return;
      }
      const update = () => {
        if (disposed) return;
        setPathname(nextPath);
        /*
         * Solid 2 batches reactive propagation. ViewTransition needs the route DOM
         * synchronously updated before it captures the new snapshot.
         */
        flush();
        /**
         * end
         */
        restoreScroll(scroll);
      };
      const canAnimate =
        typeof document.startViewTransition === "function" &&
        root.dataset.motion !== "reduced" &&
        !reducedMotion.matches;

      activeTransition?.skipTransition();
      activeTransition = undefined;
      delete root.dataset.navigationMotion;
      if (!canAnimate) {
        update();
        return;
      }

      root.dataset.navigationMotion = motion;
      let transition: ViewTransition;
      try {
        transition = document.startViewTransition(update);
      } catch (error) {
        delete root.dataset.navigationMotion;
        console.error("Failed to start route ViewTransition", error);
        update();
        return;
      }
      activeTransition = transition;
      const cleanup = () => {
        if (activeTransition !== transition) return;
        activeTransition = undefined;
        delete root.dataset.navigationMotion;
      };
      void transition.finished.then(cleanup, (error: unknown) => {
        cleanup();
        console.error("Route ViewTransition failed", error);
      });
      if (import.meta.env.DEV) {
        void transition.ready.catch((error: unknown) =>
          console.warn("Route ViewTransition was skipped", error),
        );
      }
    };

    const handleClick = (event: MouseEvent) => {
      const anchor = interceptableLink(event);
      if (!anchor) return;
      let url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || !depths.has(url.pathname)) return;
      url = options.transformUrl?.(url) ?? url;
      if (url.pathname === pathname()) {
        if (url.href === location.href) event.preventDefault();
        return;
      }

      event.preventDefault();
      rememberScroll();
      index += 1;
      scrollPositions.set(index, ZERO_SCROLL);
      history.pushState(indexedState(null, index), "", url);
      const motion =
        (depths.get(url.pathname) ?? 0) < (depths.get(pathname()) ?? 0)
          ? "pop"
          : "push";
      navigate(url.pathname, motion, ZERO_SCROLL);
    };

    const handlePopState = (event: PopStateEvent) => {
      rememberScroll();
      if (!depths.has(location.pathname)) {
        location.reload();
        return;
      }
      const nextIndex = historyIndex(event.state);
      const motion =
        nextIndex === undefined || nextIndex < index ? "pop" : "push";
      if (nextIndex !== undefined) index = nextIndex;
      navigate(
        location.pathname,
        motion,
        nextIndex === undefined
          ? ZERO_SCROLL
          : (scrollPositions.get(nextIndex) ?? ZERO_SCROLL),
      );
    };

    scrollPositions.set(index, ZERO_SCROLL);
    document.addEventListener("click", handleClick);
    addEventListener("popstate", handlePopState);
    addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      disposed = true;
      document.removeEventListener("click", handleClick);
      removeEventListener("popstate", handlePopState);
      removeEventListener("scroll", handleScroll);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      activeTransition?.skipTransition();
      delete root.dataset.navigationMotion;
      history.scrollRestoration = previousRestoration;
    };
  });
  return pathname;
}
