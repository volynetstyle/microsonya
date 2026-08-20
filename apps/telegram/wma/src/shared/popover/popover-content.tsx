import { createEffect, omit, onSettled } from "solid-js";
import type { ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import { usePopover } from "./popover-context";
import { placementAxes, resolvePopoverPosition } from "./popover-position";

export type PopoverContentProps = ParentProps<
  Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    "children" | "id" | "popover" | "onBeforeToggle" | "onToggle" | "ref"
  > & {
    /** Ref to the top-layer positioner. */
    ref?: (element: HTMLDivElement) => void;
    onBeforeToggle?: (event: ToggleEvent) => void;
    onToggle?: (event: ToggleEvent) => void;
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
  );
  let positioner: HTMLDivElement | undefined;
  let stopFallback: (() => void) | undefined;

  const syncOpen = (open: boolean) => {
    if (!positioner || !("showPopover" in positioner)) return;
    const renderedOpen = positioner.matches(":popover-open");
    if (open === renderedOpen) return;
    open ? positioner.showPopover() : positioner.hidePopover();
  };

  createEffect(
    () => popover.open(),
    (open) => syncOpen(open),
  );

  onSettled(() => {
    syncOpen(popover.open());
    stopFallback = installPositionFallback(positioner!, popover.trigger);
    return () => stopFallback?.();
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
        popover.setOpen(next);

        // A controlled owner is authoritative. Cancel a native invoker state
        // change that it did not accept.
        if (popover.open() !== next) event.preventDefault();
        props.onBeforeToggle?.(event);
      }}
      onToggle={(event) => props.onToggle?.(event)}
    >
      {props.children}
    </div>
  );
}

function installPositionFallback(
  positioner: HTMLDivElement,
  getTrigger: () => HTMLButtonElement | undefined,
): () => void {
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("position-area: bottom") &&
    CSS.supports("container-type: anchored")
  ) {
    positioner.dataset.positioning = "anchor";
    return () => {};
  }

  positioner.dataset.positioning = "fallback";

  const place = () => {
    if (positioner.hidden || !positioner.matches(":popover-open")) return;
    const trigger = getTrigger();
    if (!trigger) return;

    const anchor = trigger.getBoundingClientRect();
    const panel = positioner.getBoundingClientRect();
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

  return () => {
    positioner.removeEventListener("toggle", onToggle);
    removeEventListener("resize", place);
  };
}
