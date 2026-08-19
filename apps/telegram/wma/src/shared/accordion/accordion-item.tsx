import type { ParentProps } from "solid-js";
import { useAccordion } from "./accordion-context";

export interface AccordionItemProps extends ParentProps {
  value: string;
  class?: string;
}

export function AccordionItem(props: AccordionItemProps) {
  const accordion = useAccordion();
  const open = () => accordion.isOpen(props.value);

  return (
    <details
      class={props.class}
      name={accordion.controlled ? undefined : accordion.groupName}
      open={open()}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open()) accordion.onToggle(props.value, next);
      }}
    >
      {props.children}
    </details>
  );
}
