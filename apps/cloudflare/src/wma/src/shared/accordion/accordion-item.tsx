import { createSignal } from "solid-js";
import type { ParentProps } from "solid-js";
import { AccordionItemContext, useAccordion } from "./accordion-context";

export interface AccordionItemProps extends ParentProps {
  value: string;
  class?: string;
}

export function AccordionItem(props: AccordionItemProps) {
  const accordion = useAccordion();
  const open = () => accordion.isOpen(props.value);
  const [contentWasMounted, setContentWasMounted] = createSignal(false);
  const contentMounted = () => contentWasMounted() || open();

  return (
    <AccordionItemContext value={{ contentMounted }}>
      <details
        class={`accordion-item${props.class ? ` ${props.class}` : ""}`}
        name={accordion.controlled ? undefined : accordion.groupName}
        open={open()}
        onToggle={(event) => {
          const details = event.currentTarget;
          const next = details.open;
          if (next) setContentWasMounted(true);
          if (next !== open()) {
            accordion.onToggle(props.value, next);

            // Native <details> toggles itself before firing this event. A
            // controlled owner may reject that proposal, in which case DOM
            // must be restored to the authoritative Solid value.
            if (accordion.controlled && details.open !== open()) {
              details.open = open();
            }
          }
        }}
      >
        {props.children}
      </details>
    </AccordionItemContext>
  );
}
