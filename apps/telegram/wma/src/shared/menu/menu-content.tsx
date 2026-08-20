import type { ParentProps } from "solid-js";
import { PopoverContent } from "../popover/popover-content";
import { PopoverSurface } from "../popover/popover-surface";

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
  let search = "";
  let searchTimer: number | undefined;

  const items = () =>
    Array.from(
      menu?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );

  const focusAt = (index: number) => {
    const available = items();
    if (!available.length) return;
    available[(index + available.length) % available.length]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const available = items();
    const activeIndex = available.indexOf(
      document.activeElement as HTMLButtonElement,
    );

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(activeIndex + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(activeIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(available.length - 1);
        return;
      case "Tab":
        menu?.closest<HTMLElement>("[popover]")?.hidePopover?.();
        return;
    }

    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;

    search += event.key.toLocaleLowerCase();
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => (search = ""), 500);

    const match = available.find((item) =>
      item.textContent?.trim().toLocaleLowerCase().startsWith(search),
    );
    if (match) {
      event.preventDefault();
      match.focus();
    }
  };

  return (
    <PopoverContent
      class={`menu-positioner${props.class ? ` ${props.class}` : ""}`}
      onToggle={(event) => {
        if (event.newState === "open") queueMicrotask(() => focusAt(0));
      }}
    >
      <PopoverSurface
        ref={menu}
        class={`menu-surface${props.surfaceClass ? ` ${props.surfaceClass}` : ""}`}
        role="menu"
        aria-label={props["aria-label"]}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </PopoverSurface>
    </PopoverContent>
  );
}
