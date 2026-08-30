import { Show } from "solid-js";
import type { ParentProps } from "solid-js";
import { useAccordionItem } from "./accordion-context";

export function AccordionContent(props: ParentProps<{ class?: string }>) {
  const item = useAccordionItem();

  return (
    <Show when={!item || item.contentMounted()}>
      <div class={`accordion-content${props.class ? ` ${props.class}` : ""}`}>
        {props.children}
      </div>
    </Show>
  );
}
