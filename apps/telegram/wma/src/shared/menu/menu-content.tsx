import type { ParentProps } from "solid-js";
import { PopoverContent } from "../popover/popover-content";
import { PopoverSurface } from "../popover/popover-surface";
import { createMenuNavigation } from "../context-menu/create-menu-navigation";

export interface MenuContentProps extends ParentProps {
  class?: string;
  surfaceClass?: string;
  "aria-label"?: string;
}

/**
 * Action-menu keyboard model: arrows, Home/End, activation, typeahead and Tab
 * dismissal. Focus is not trapped; Tab continues normal document navigation.
 */
export function MenuContent(props: MenuContentProps) {
  let menu: HTMLDivElement | undefined;
  const navigation = createMenuNavigation(() => menu);

  return (
    <PopoverContent
      class={`menu-positioner${props.class ? ` ${props.class}` : ""}`}
      onToggle={(event) => {
        if (event.newState === "open") queueMicrotask(navigation.focusFirst);
      }}
    >
      <PopoverSurface
        ref={menu}
        class={`menu-surface${props.surfaceClass ? ` ${props.surfaceClass}` : ""}`}
        role="menu"
        aria-label={props["aria-label"]}
        onKeyDown={navigation.onKeyDown}
      >
        {props.children}
      </PopoverSurface>
    </PopoverContent>
  );
}
