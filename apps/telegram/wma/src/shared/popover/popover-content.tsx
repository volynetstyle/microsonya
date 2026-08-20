import { createEffect, omit, onSettled } from "solid-js";
import type { ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import { usePopover } from "./popover-context";

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
    CSS.supports("position-area: bottom")
  ) {
    return () => {};
  }

  const place = () => {
    if (positioner.hidden || !positioner.matches(":popover-open")) return;
    const trigger = getTrigger();
    if (!trigger) return;

    const anchor = trigger.getBoundingClientRect();
    const panel = positioner.getBoundingClientRect();
    const gap = 7;
    const margin = 6;
    const placement = positioner.dataset.placement ?? "bottom-end";
    const above = placement.startsWith("top");
    const start = placement.endsWith("start");

    let top = above ? anchor.top - panel.height - gap : anchor.bottom + gap;
    let left = start ? anchor.left : anchor.right - panel.width;

    if (top + panel.height > innerHeight - margin) {
      top = anchor.top - panel.height - gap;
    }
    if (top < margin) top = anchor.bottom + gap;

    left = Math.min(innerWidth - panel.width - margin, Math.max(margin, left));

    positioner.style.inset = `${Math.max(margin, top)}px auto auto ${left}px`;
  };

  const onToggle = () => requestAnimationFrame(place);
  positioner.addEventListener("toggle", onToggle);
  addEventListener("resize", place, { passive: true });

  return () => {
    positioner.removeEventListener("toggle", onToggle);
    removeEventListener("resize", place);
  };
}
