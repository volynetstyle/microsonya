import type { ParentProps } from "solid-js";
import { PopoverContent } from "../popover/popover-content";
import { PopoverRoot } from "../popover/popover-root";
import { PopoverSurface } from "../popover/popover-surface";
import type { ContextMenuController } from "./create-context-menu";
import { createMenuNavigation } from "./create-menu-navigation";

export interface ContextMenuContentProps extends ParentProps {
  controller: ContextMenuController;
  class?: string;
  surfaceClass?: string;
  "aria-label"?: string;
}

/** Point-anchored menu surface; lifecycle comes from native Popover. */
export function ContextMenuContent(props: ContextMenuContentProps) {
  let menu: HTMLDivElement | undefined;
  const navigation = createMenuNavigation(() => menu);

  return (
    <PopoverRoot
      open={props.controller.open()}
      anchor={() => {
        const point = props.controller.point();
        return point ? { type: "point", x: point.x, y: point.y } : undefined;
      }}
      onOpenChange={(open) => {
        if (!open) props.controller.close();
      }}
    >
      <PopoverContent
        class={`context-menu-positioner${props.class ? ` ${props.class}` : ""}`}
        pointPosition={props.controller.pointPosition()}
        ref={(element) => {
          props.controller.setMenuElement(element);
        }}
        onToggle={(event) => {
          if (event.newState === "open") queueMicrotask(navigation.focusFirst);
        }}
      >
        <PopoverSurface
          ref={menu}
          class={`context-menu-surface${props.surfaceClass ? ` ${props.surfaceClass}` : ""}`}
          role="menu"
          aria-label={props["aria-label"]}
          onKeyDown={navigation.onKeyDown}
        >
          {props.children}
        </PopoverSurface>
      </PopoverContent>
    </PopoverRoot>
  );
}
