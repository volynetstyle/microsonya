import { createContext, useContext } from "solid-js";

export type PopoverPlacement =
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

export type FloatingAnchor =
  | { type: "element"; element: HTMLElement }
  | { type: "point"; x: number; y: number };

export interface PopoverContextValue {
  contentId: string;
  anchorName: string;
  placement: PopoverPlacement;
  open(): boolean;
  setOpen(next: boolean): boolean;
  trigger(): HTMLButtonElement | undefined;
  setTrigger(element: HTMLButtonElement): void;
  anchor(): FloatingAnchor | undefined;
}

export const PopoverContext = createContext<PopoverContextValue>();

export function usePopover(): PopoverContextValue {
  return useContext(PopoverContext);
}
