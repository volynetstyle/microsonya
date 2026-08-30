import type { ParentProps } from "solid-js";
import type { PopoverRootProps } from "../popover/popover-root";
import { PopoverRoot } from "../popover/popover-root";

export type MenuRootProps = ParentProps<PopoverRootProps>;

/** Action-menu state. Menu semantics are supplied by its child primitives. */
export function MenuRoot(props: MenuRootProps) {
  return <PopoverRoot {...props}>{props.children}</PopoverRoot>;
}
