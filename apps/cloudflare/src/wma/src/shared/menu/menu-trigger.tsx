import type { PopoverTriggerProps } from "../popover/popover-trigger";
import { PopoverTrigger } from "../popover/popover-trigger";

/** Accessible menu trigger. Generic popovers intentionally omit this role. */
export function MenuTrigger(props: PopoverTriggerProps) {
  return (
    <PopoverTrigger {...props} aria-haspopup="menu">
      {props.children}
    </PopoverTrigger>
  );
}
