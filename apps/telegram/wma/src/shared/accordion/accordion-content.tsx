import type { ParentProps } from "solid-js";

export function AccordionContent(props: ParentProps<{ class?: string }>) {
  return (
    <div class={`accordion-content${props.class ? ` ${props.class}` : ""}`}>
      {props.children}
    </div>
  );
}
