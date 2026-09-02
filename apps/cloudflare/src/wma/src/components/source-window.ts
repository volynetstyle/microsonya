import { onSettled } from "solid-js";

type SourceWindowGeometry = Readonly<{
  viewportHeight: number;
  windowTop: number;
  screenPaddingBottom: number;
  screenMarginBottom: number;
}>;

export function availableSourceWindowHeight({
  viewportHeight,
  windowTop,
  screenPaddingBottom,
  screenMarginBottom,
}: SourceWindowGeometry): number {
  return Math.max(
    0,
    Math.floor(
      viewportHeight - windowTop - screenPaddingBottom - screenMarginBottom,
    ),
  );
}

export function useMeasuredSourceWindow(
  source: () => HTMLElement,
): void {
  onSettled(() => {
    const element = source();
    const screen = element.closest<HTMLElement>(".screen");
    const visualViewport = window.visualViewport;
    const webApp = window.Telegram?.WebApp;
    let frame: number | undefined;
    let needsInsets = true;
    let screenPaddingBottom = 0;
    let screenMarginBottom = 0;
    let lastHeight = -1;
    const update = () => {
      frame = undefined;
      const telegramViewportHeight = webApp?.viewportHeight;
      const viewportHeight =
        typeof telegramViewportHeight === "number" &&
        Number.isFinite(telegramViewportHeight) &&
        telegramViewportHeight > 0
          ? telegramViewportHeight
          : (visualViewport?.height ?? window.innerHeight);
      if (needsInsets) {
        needsInsets = false;
        const screenStyle = screen
          ? getComputedStyle(screen)
          : getComputedStyle(document.documentElement);
        screenPaddingBottom = Number.parseFloat(screenStyle.paddingBottom) || 0;
        screenMarginBottom = Number.parseFloat(screenStyle.marginBottom) || 0;
      }
      const height = availableSourceWindowHeight({
        viewportHeight,
        windowTop: element.getBoundingClientRect().top,
        screenPaddingBottom,
        screenMarginBottom,
      });
      if (height === lastHeight) return;
      lastHeight = height;
      element.style.setProperty("--source-window-block-size", `${height}px`);
    };
    const schedule = (remeasureInsets: boolean) => {
      needsInsets ||= remeasureInsets;
      if (frame !== undefined) return;
      frame = requestAnimationFrame(update);
    };
    const scheduleGeometry = () => schedule(true);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(scheduleGeometry);
    for (const target of [
      screen,
      element.closest(".topic-card")?.querySelector(".topic-trigger"),
      document.querySelector(".chat-header"),
      document.querySelector(".chat-section-heading"),
    ]) {
      if (target instanceof Element) resizeObserver?.observe(target);
    }
    window.addEventListener("resize", scheduleGeometry);
    visualViewport?.addEventListener("resize", scheduleGeometry);
    const handleTelegramViewport = (event: { isStateStable: boolean }) => {
      if (event.isStateStable) scheduleGeometry();
    };
    webApp?.onEvent("viewportChanged", handleTelegramViewport);
    scheduleGeometry();

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleGeometry);
      visualViewport?.removeEventListener("resize", scheduleGeometry);
      webApp?.offEvent("viewportChanged", handleTelegramViewport);
    };
  });
}
