import { createSignal, createUniqueId, untrack } from "solid-js";
import type { ParentProps } from "solid-js";
import {
  PopoverContext,
  type FloatingAnchor,
  type PopoverPlacement,
} from "./popover-context";

export interface PopoverRootProps extends ParentProps {
  /** Preferred placement. CSS flips it when the preferred side has no room. */
  placement?: PopoverPlacement;
  /** Controlled open state. */
  open?: boolean;
  /** Initial state for an uncontrolled popover. */
  defaultOpen?: boolean;
  /** Runs for native trigger, light-dismiss and Escape state changes. */
  onOpenChange?: (open: boolean) => void;
  class?: string;
  anchor?: FloatingAnchor | (() => FloatingAnchor | undefined);
}

/**
 * State and anchor identity for a non-modal floating surface.
 *
 * Dismissal, Escape handling and top-layer stacking are delegated to the
 * native Popover API instead of document listeners or a backdrop.
 *
 * @see https://developer.mozilla.org/docs/Web/API/Popover_API
 */
export function PopoverRoot(props: PopoverRootProps) {
  const id = createUniqueId().replaceAll(":", "-");
  const contentId = `popover-${id}`;
  const anchorName = `--${contentId}-anchor`;
  const [nativeOpen, setNativeOpen] = createSignal(props.defaultOpen ?? false);
  let trigger: HTMLButtonElement | undefined;

  const isControlled = () => props.open !== undefined;
  const open = () => (isControlled() ? props.open! : nativeOpen());

  const context = {
    contentId,
    anchorName,
    get placement() {
      return props.placement ?? "bottom-end";
    },
    open,
    setOpen(next: boolean) {
      if (!untrack(isControlled)) {
        setNativeOpen(next);
        props.onOpenChange?.(next);
        return true;
      }

      if (next !== untrack(open)) props.onOpenChange?.(next);
      return untrack(open) === next;
    },
    trigger: () => trigger,
    setTrigger(element: HTMLButtonElement) {
      trigger = element;
    },
    anchor: () => {
      const configured =
        typeof props.anchor === "function" ? props.anchor() : props.anchor;
      if (configured) return configured;
      return trigger ? { type: "element" as const, element: trigger } : undefined;
    },
  };

  return (
    <PopoverContext value={context}>
      <div
        class={`popover-root${props.class ? ` ${props.class}` : ""}`}
        style={{ "--popover-anchor": anchorName }}
      >
        {props.children}
      </div>
    </PopoverContext>
  );
}
