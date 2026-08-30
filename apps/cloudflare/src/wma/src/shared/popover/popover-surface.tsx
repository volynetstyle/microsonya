import { omit } from "solid-js";
import type { ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";

export type PopoverSurfaceProps = ParentProps<
  Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">
>;

/** Visual dropdown surface; contains no menu or dialog semantics. */
export function PopoverSurface(props: PopoverSurfaceProps) {
  const surfaceProps = omit(props, "children", "class");

  return (
    <div
      {...surfaceProps}
      class={`popover-surface${props.class ? ` ${props.class}` : ""}`}
    >
      {props.children}
    </div>
  );
}
