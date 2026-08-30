import { omit } from "solid-js";
import type { ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";

export type MenuItemProps = ParentProps<
  Omit<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "role" | "onClick" | "onSelect"
  > & {
    /** Runs before the menu closes. */
    onSelect?: (event: MouseEvent | KeyboardEvent) => void;
    onClick?: (event: MouseEvent) => void;
  }
>;

export function MenuItem(props: MenuItemProps) {
  const buttonProps = omit(props, "children", "class", "onClick", "onSelect");

  const select = (event: MouseEvent | KeyboardEvent) => {
    if (buttonProps.disabled) return;
    props.onSelect?.(event);
    (event.currentTarget as HTMLElement | null)
      ?.closest<HTMLElement>("[popover]")
      ?.hidePopover?.();
  };

  return (
    <button
      {...buttonProps}
      type="button"
      role="menuitem"
      tabindex={-1}
      class={`menu-item${props.class ? ` ${props.class}` : ""}`}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) select(event);
      }}
    >
      {props.children}
    </button>
  );
}
