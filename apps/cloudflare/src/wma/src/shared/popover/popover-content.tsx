import { createEffect, omit, onSettled, untrack } from "solid-js";
import type { ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import { usePopover } from "./popover-context";
import { placementAxes, resolvePopoverPosition } from "./popover-position";
import {
  LEGACY_POINT_POSITION,
  resolvePointPlacement,
  type PointPositionConfig,
} from "../context-menu/point-position";

export type PopoverContentProps = ParentProps<
  Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    "children" | "id" | "popover" | "onBeforeToggle" | "onToggle" | "ref"
  > & {
    /** Ref to the top-layer positioner. */
    ref?: (element: HTMLDivElement) => void;
    onBeforeToggle?: (event: ToggleEvent) => void;
    onToggle?: (event: ToggleEvent) => void;
    pointPosition?: Partial<PointPositionConfig>;
  }
>;

/**
 * Native top-layer positioner. The inner surface is kept separate so entry
 * and exit motion never interferes with anchor layout.
 *
 * @see https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/popover
 * @see https://developer.mozilla.org/docs/Web/CSS/position-area
 */
export function PopoverContent(props: PopoverContentProps) {
  const popover = usePopover();
  const positionerProps = omit(
    props,
    "children",
    "class",
    "onBeforeToggle",
    "onToggle",
    "ref",
    "pointPosition",
  );
  let positioner: HTMLDivElement | undefined;
  let stopFallback: (() => void) | undefined;
  let repositionFallback = () => {};
  let nativeRequest: boolean | undefined;
  let retryFrame: number | undefined;
  let repositionFrame: number | undefined;

  const retrySync = () => {
    if (retryFrame !== undefined) return;
    retryFrame = requestAnimationFrame(() => {
      retryFrame = undefined;
      syncOpen(untrack(popover.open));
    });
  };

  const syncOpen = (open: boolean) => {
    if (
      !positioner ||
      !positioner.isConnected ||
      !("showPopover" in positioner)
    )
      return;
    // `beforetoggle` is dispatched synchronously from showPopover/hidePopover.
    // Updating Solid state there can rerun this effect before the native
    // operation finishes, so regard the in-flight native state as rendered.
    if (nativeRequest === open) return;
    const renderedOpen = positioner.matches(":popover-open");
    if (open === renderedOpen) return;
    nativeRequest = open;

    try {
      open ? positioner.showPopover() : positioner.hidePopover();
    } catch (error) {
      nativeRequest = undefined;
      if (error instanceof DOMException && error.name === "InvalidStateError") {
        retrySync();
        return;
      }
      throw error;
    }
  };

  createEffect(
    () => popover.open(),
    (open) => syncOpen(open),
  );

  createEffect(
    () => {
      const anchor = popover.anchor();
      return anchor?.type === "point" ? `${anchor.x}:${anchor.y}` : undefined;
    },
    (pointKey) => {
      if (pointKey === undefined) return;
      if (repositionFrame !== undefined) cancelAnimationFrame(repositionFrame);
      repositionFrame = requestAnimationFrame(() => {
        repositionFrame = undefined;
        repositionFallback();
      });
    },
  );

  onSettled(() => {
    syncOpen(untrack(popover.open));
    const fallback = installPositionFallback(
      positioner!,
      popover.anchor,
      props.pointPosition,
    );
    stopFallback = fallback.dispose;
    repositionFallback = fallback.place;
    return () => {
      stopFallback?.();
      if (retryFrame !== undefined) cancelAnimationFrame(retryFrame);
      if (repositionFrame !== undefined) cancelAnimationFrame(repositionFrame);
    };
  });

  return (
    <div
      {...positionerProps}
      ref={(element) => {
        positioner = element;
        props.ref?.(element);
      }}
      id={popover.contentId}
      popover="auto"
      class={`popover-positioner${props.class ? ` ${props.class}` : ""}`}
      data-placement={popover.placement}
      onBeforeToggle={(event) => {
        const next = event.newState === "open";
        nativeRequest ??= next;
        const accepted = popover.setOpen(next);

        // A controlled owner is authoritative. Cancel a native invoker state
        // change that it did not accept.
        if (!accepted) {
          event.preventDefault();
        }
        props.onBeforeToggle?.(event);
        if (event.defaultPrevented) nativeRequest = undefined;
      }}
      onToggle={(event) => {
        nativeRequest = undefined;
        props.onToggle?.(event);
        syncOpen(untrack(popover.open));
      }}
    >
      {props.children}
    </div>
  );
}

function installPositionFallback(
  positioner: HTMLDivElement,
  getAnchor: ReturnType<typeof usePopover>["anchor"],
  pointPosition: Partial<PointPositionConfig> | undefined,
): { place(): void; dispose(): void } {
  const anchor = untrack(getAnchor);
  if (
    anchor?.type === "element" &&
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("position-area: bottom") &&
    CSS.supports("container-type: anchored")
  ) {
    positioner.dataset.positioning = "anchor";
    return { place: () => {}, dispose: () => {} };
  }

  positioner.dataset.positioning = "fallback";

  const place = () => {
    if (positioner.hidden || !positioner.matches(":popover-open")) return;
    const panel = positioner.getBoundingClientRect();
    const currentAnchor = untrack(getAnchor);
    if (!currentAnchor) return;

    if (currentAnchor.type === "point") {
      const safeArea = {
        left: readCssPixels("--tg-content-safe-area-inset-left"),
        right: readCssPixels("--tg-content-safe-area-inset-right"),
        top: readCssPixels("--tg-content-safe-area-inset-top"),
        bottom: readCssPixels("--tg-content-safe-area-inset-bottom"),
      };
      const resolved = resolvePointPlacement(
        currentAnchor,
        { width: panel.width, height: panel.height },
        { width: innerWidth, height: innerHeight, safeArea },
        { ...LEGACY_POINT_POSITION, ...pointPosition },
      );
      positioner.dataset.resolvedPlacement = `${resolved.sideY === 1 ? "bottom" : "top"}-${resolved.sideX === 1 ? "start" : "end"}`;
      positioner.style.inset = `${resolved.y}px auto auto ${resolved.x}px`;
      positioner.style.setProperty(
        "--context-menu-max-height",
        `${resolved.maxHeight}px`,
      );
      return;
    }

    const anchor = currentAnchor.element.getBoundingClientRect();
    const gap = 7;
    const margin = 6;
    const placement = positioner.dataset.placement ?? "bottom-end";
    const preferred = placementAxes(
      placement as Parameters<typeof placementAxes>[0],
    );
    const resolved = resolvePopoverPosition(
      anchor,
      panel,
      preferred,
      { width: innerWidth, height: innerHeight },
      gap,
      margin,
    );

    positioner.dataset.resolvedPlacement = `${resolved.axes.above ? "top" : "bottom"}-${resolved.axes.inlineEnd ? "end" : "start"}`;

    positioner.style.inset = `${resolved.top}px auto auto ${resolved.left}px`;
  };

  const onToggle = () => requestAnimationFrame(place);
  positioner.addEventListener("toggle", onToggle);
  addEventListener("resize", place, { passive: true });

  return {
    place,
    dispose() {
      positioner.removeEventListener("toggle", onToggle);
      removeEventListener("resize", place);
    },
  };
}

function readCssPixels(name: string): number {
  if (typeof getComputedStyle !== "function") return 0;
  const pixels = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(pixels) ? pixels : 0;
}
