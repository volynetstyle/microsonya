import { createContext, useContext } from "solid-js";

export type PopoverPlacement =
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

export interface PopoverContextValue {
  contentId: string;
  anchorName: string;
  placement: PopoverPlacement;
  open(): boolean;
  setOpen(next: boolean): void;
  trigger(): HTMLButtonElement | undefined;
  setTrigger(element: HTMLButtonElement): void;
}

export const PopoverContext = createContext<PopoverContextValue>();

export function usePopover(): PopoverContextValue {
  return useContext(PopoverContext);
}
