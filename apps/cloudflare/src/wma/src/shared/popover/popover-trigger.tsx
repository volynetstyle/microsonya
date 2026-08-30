import { omit } from "solid-js";
import type { ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import { usePopover } from "./popover-context";

export type PopoverTriggerProps = ParentProps<
  Omit<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "id" | "type"
  > & {
    type?: "button" | "submit" | "reset";
  }
>;

/** Native popover invoker that remains in normal keyboard tab order. */
export function PopoverTrigger(props: PopoverTriggerProps) {
  const popover = usePopover();
  const buttonProps = omit(props, "children", "type");

  return (
    <button
      {...buttonProps}
      ref={(element) => popover.setTrigger(element)}
      type={props.type ?? "button"}
      popovertarget={popover.contentId}
      popovertargetaction="toggle"
      aria-expanded={popover.open() ? "true" : "false"}
    >
      {props.children}
    </button>
  );
}
