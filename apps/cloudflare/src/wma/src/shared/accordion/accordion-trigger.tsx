import type { ParentProps } from "solid-js";

export function AccordionTrigger(props: ParentProps<{ class?: string }>) {
  return (
    <summary class={`accordion-trigger${props.class ? ` ${props.class}` : ""}`}>
      {props.children}
    </summary>
  );
}
