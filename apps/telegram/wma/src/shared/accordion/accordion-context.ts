import { createContext, useContext } from "solid-js";

export interface AccordionContextValue {
  controlled: boolean;
  groupName?: string;
  isOpen(value: string): boolean;
  onToggle(value: string, open: boolean): void;
}

export const AccordionContext = createContext<AccordionContextValue>();

export function useAccordion(): AccordionContextValue {
  return useContext(AccordionContext);
}
