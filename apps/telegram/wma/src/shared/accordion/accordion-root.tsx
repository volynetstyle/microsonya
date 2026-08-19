import { createSignal, createUniqueId } from "solid-js";
import type { ParentProps } from "solid-js";
import { AccordionContext } from "./accordion-context";

export interface AccordionRootProps extends ParentProps {
  class?: string;
  multiple?: boolean;
  value?: string | readonly string[] | null;
  defaultValue?: string | readonly string[] | null;
  onValueChange?: (value: string | readonly string[] | null) => void;
}

function toValues(value: AccordionRootProps["value"]): readonly string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

export function AccordionRoot(props: AccordionRootProps) {
  const groupName = `accordion-${createUniqueId()}`;
  const controlled = () => props.value !== undefined;
  const [nativeValues, setNativeValues] = createSignal(
    toValues(props.defaultValue),
  );
  const values = () => (controlled() ? toValues(props.value) : nativeValues());

  const context = {
    get controlled() {
      return controlled();
    },
    get groupName() {
      return props.multiple ? undefined : groupName;
    },
    isOpen(value: string) {
      return values().includes(value);
    },
    onToggle(value: string, open: boolean) {
      const current = values();
      const next = props.multiple
        ? open
          ? [...new Set([...current, value])]
          : current.filter((item) => item !== value)
        : open
          ? [value]
          : [];

      if (!controlled()) setNativeValues(next);
      props.onValueChange?.(props.multiple ? next : (next[0] ?? null));
    },
  };

  return (
    <AccordionContext value={context}>
      <div
        class={`accordion accordion-root${props.class ? ` ${props.class}` : ""}`}
      >
        {props.children}
      </div>
    </AccordionContext>
  );
}
