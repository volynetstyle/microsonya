import { createContext, useContext } from "solid-js";

export interface AccordionContextValue {
  controlled: boolean;
  groupName?: string;
  isOpen(value: string): boolean;
  onToggle(value: string, open: boolean): void;
}

export const AccordionContext = createContext<AccordionContextValue>();

export interface AccordionItemContextValue {
  /** Whether this item's content has been materialized at least once. */
  contentMounted(): boolean;
}

export const AccordionItemContext = createContext<AccordionItemContextValue>();

export function useAccordion(): AccordionContextValue {
  return useContext(AccordionContext);
}

export function useAccordionItem(): AccordionItemContextValue | undefined {
  return useContext(AccordionItemContext);
}
