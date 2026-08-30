import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type {
  Point,
  PointPositionConfig,
} from "./point-position";

export interface ContextMenuOptions {
  targets?: string;
  longPressMs?: number;
  longPressMoveTolerancePx?: number;
  closeOnScroll?: boolean;
  pointerExit?: {
    enabled?: boolean;
    paddingPx?: number;
    throttleMs?: number;
  };
  shouldDisableOnLink?: boolean;
  pointPosition?: Partial<PointPositionConfig>;
}

export interface ContextMenuController {
  open(): boolean;
  target(): HTMLElement | undefined;
  point(): Point | undefined;
  setTargetRoot(element: HTMLElement): void;
  setMenuElement(element: HTMLElement): void;
  activate(target: HTMLElement, point: Point): void;
  close(): void;
  pointPosition(): Partial<PointPositionConfig>;
  handlers: ContextMenuHandlers;
}

export interface ContextMenuHandlers {
  onContextMenu: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onClick: (event: MouseEvent) => void;
}

const DEFAULT_OPTIONS: Required<
  Pick<
    ContextMenuOptions,
    | "targets"
    | "longPressMs"
    | "longPressMoveTolerancePx"
    | "closeOnScroll"
    | "shouldDisableOnLink"
  >
> = {
  targets: "[data-context-menu]",
  longPressMs: 200,
  longPressMoveTolerancePx: 0,
  closeOnScroll: true,
  shouldDisableOnLink: true,
};

export function createContextMenu(
  input: ContextMenuOptions = {},
): ContextMenuController {
  const options = { ...DEFAULT_OPTIONS, ...input };
  const pointerExit = {
    enabled: true,
    paddingPx: 60,
    throttleMs: 250,
    ...input.pointerExit,
  };
  const [open, setOpen] = createSignal(false);
  const [target, setTarget] = createSignal<HTMLElement>();
  const [point, setPoint] = createSignal<Point>();
  const [activationRevision, setActivationRevision] = createSignal(0);
  let root: HTMLElement | undefined;
  let menu: HTMLElement | undefined;
  let pending: number | undefined;
  let pendingPoint: Point | undefined;
  let pendingTarget: HTMLElement | undefined;
  let suppressClick = false;
  let lastBoundaryCheck = 0;
  let menuBounds: DOMRect | undefined;
  let pendingGlobalListeners = false;
  let measureFrame: number | undefined;
  let settleMeasureFrame: number | undefined;

  const resolveTarget = (raw: EventTarget | null): HTMLElement | undefined => {
    if (!(raw instanceof Element) || !root) return;
    const resolved = raw.closest<HTMLElement>(options.targets);
    return resolved && root.contains(resolved) ? resolved : undefined;
  };

  const disabledByLink = (resolved: HTMLElement) =>
    options.shouldDisableOnLink === true &&
    Boolean(resolved.closest("a[href]") && root?.contains(resolved.closest("a[href]")));

  const cancelPending = () => {
    if (pending !== undefined) window.clearTimeout(pending);
    pending = undefined;
    pendingPoint = undefined;
    pendingTarget = undefined;
    if (pendingGlobalListeners) {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      pendingGlobalListeners = false;
    }
  };

  const activate = (resolved: HTMLElement, nextPoint: Point) => {
    cancelPending();
    menuBounds = undefined;
    lastBoundaryCheck = 0;
    setTarget(resolved);
    setPoint(nextPoint);
    setActivationRevision((revision) => revision + 1);
    setOpen(true);
  };

  const close = () => {
    cancelPending();
    suppressClick = false;
    menuBounds = undefined;
    setOpen(false);
    setTarget(undefined);
    setPoint(undefined);
  };

  const onContextMenu = (event: MouseEvent) => {
    const resolved = resolveTarget(event.target);
    if (!resolved || disabledByLink(resolved)) return;
    event.preventDefault();
    activate(resolved, { x: event.clientX, y: event.clientY });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.shiftKey || event.key !== "F10") return;
    const resolved = resolveTarget(event.target);
    if (!resolved || disabledByLink(resolved)) return;
    const rect = resolved.getBoundingClientRect();
    event.preventDefault();
    activate(resolved, { x: rect.left, y: rect.top });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (event.button !== 0) return;
    const resolved = resolveTarget(event.target);
    if (!resolved || disabledByLink(resolved)) return;
    cancelPending();
    pendingTarget = resolved;
    pendingPoint = { x: event.clientX, y: event.clientY };
    pending = window.setTimeout(() => {
      if (!pendingTarget || !pendingPoint) return;
      suppressClick = true;
      activate(pendingTarget, pendingPoint);
    }, options.longPressMs);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    pendingGlobalListeners = true;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pendingPoint && pendingTarget) {
      const dx = event.clientX - pendingPoint.x;
      const dy = event.clientY - pendingPoint.y;
      const tolerance = options.longPressMoveTolerancePx;
      if (dx * dx + dy * dy > tolerance * tolerance) cancelPending();
    }

    if (!untrack(open) || !menu || event.pointerType !== "mouse") return;
    if (!pointerExit.enabled || !window.matchMedia("(hover: hover)").matches) return;
    const now = performance.now();
    if (now - lastBoundaryCheck < pointerExit.throttleMs) return;
    lastBoundaryCheck = now;
    const bounds = menuBounds;
    if (!bounds) return;
    const padding = pointerExit.paddingPx;
    if (
      event.clientX < bounds.left - padding ||
      event.clientX > bounds.right + padding ||
      event.clientY < bounds.top - padding ||
      event.clientY > bounds.bottom + padding
    ) {
      close();
    }
  };

  const onPointerUp = () => cancelPending();
  const onPointerCancel = () => cancelPending();
  const onClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  };

  let stopOpenListeners = () => {};

  createEffect(
    () => ({ open: open(), revision: activationRevision() }),
    (state) => {
      if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
      if (settleMeasureFrame !== undefined)
        cancelAnimationFrame(settleMeasureFrame);
      measureFrame = undefined;
      settleMeasureFrame = undefined;
      stopOpenListeners();
      stopOpenListeners = () => {};
      if (!state.open) return;
      if (menu) {
        measureFrame = requestAnimationFrame(() => {
          measureFrame = undefined;
          settleMeasureFrame = requestAnimationFrame(() => {
            settleMeasureFrame = undefined;
            if (menu && untrack(open))
              menuBounds = menu.getBoundingClientRect();
          });
        });
      }
      const onScroll = () => options.closeOnScroll && close();
      const onDocumentPointerMove = (event: PointerEvent) =>
        onPointerMove(event);
      if (options.closeOnScroll)
        document.addEventListener("scroll", onScroll, true);
      document.addEventListener("pointermove", onDocumentPointerMove, true);
      stopOpenListeners = () => {
        document.removeEventListener("scroll", onScroll, true);
        document.removeEventListener(
          "pointermove",
          onDocumentPointerMove,
          true,
        );
      };
    },
  );

  onCleanup(() => {
    cancelPending();
    stopOpenListeners();
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    if (settleMeasureFrame !== undefined)
      cancelAnimationFrame(settleMeasureFrame);
  });

  return {
    open,
    target,
    point,
    setTargetRoot: (element) => {
      root = element;
    },
    setMenuElement: (element) => {
      menu = element;
    },
    pointPosition: () => input.pointPosition ?? {},
    activate,
    close,
    handlers: {
      onContextMenu,
      onKeyDown,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClick,
    },
  };
}
