import { omit } from "solid-js";
import type { PopoverSurfaceProps } from "../popover/popover-surface";
import { PopoverSurface } from "../popover/popover-surface";

/** Styled generic panel for notifications, settings or internal navigation. */
export function DropdownPanel(props: PopoverSurfaceProps) {
  const surfaceProps = omit(props, "children", "class");

  return (
    <PopoverSurface
      {...surfaceProps}
      class={`dropdown-panel${props.class ? ` ${props.class}` : ""}`}
    >
      {props.children}
    </PopoverSurface>
  );
}
