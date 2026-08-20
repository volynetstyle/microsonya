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

export function AccordionRoot(props: AccordionRootProps) {
  const groupName = `accordion-${createUniqueId()}`;

  // X is the only logical state. Single mode stores one value (or none),
  // while multiple mode stores its exact subset. Creating one signal instead
  // of parallel single/multiple signals keeps the runtime model minimal.
  const [nativeValue, setNativeValue] = createSignal<
    string | readonly string[] | null
  >(
    props.multiple
      ? Array.isArray(props.defaultValue)
        ? props.defaultValue
        : typeof props.defaultValue === "string"
          ? [props.defaultValue]
          : EMPTY_VALUES
      : typeof props.defaultValue === "string"
        ? props.defaultValue
        : Array.isArray(props.defaultValue)
          ? (props.defaultValue[0] ?? null)
          : null,
  );

  const isControlled = () => props.value !== undefined;

  const context = {
    get controlled() {
      return isControlled();
    },

    get groupName() {
      return props.multiple ? undefined : groupName;
    },

    isOpen(value: string) {
      if (isControlled()) {
        return hasValue(props.value, value);
      }

      if (props.multiple) {
        const value = nativeValue();
        const values = Array.isArray(value) ? value : EMPTY_VALUES;

        for (let i = 0; i < values.length; i++) {
          if (values[i] === value) return true;
        }

        return false;
      }

      return nativeValue() === value;
    },

    onToggle(value: string, open: boolean) {
      if (!props.multiple) {
        const next = open ? value : null;

        if (!isControlled()) {
          setNativeValue(next);
        }

        props.onValueChange?.(next);
        return;
      }

      const current = isControlled()
        ? Array.isArray(props.value)
          ? props.value
          : typeof props.value === "string"
            ? [props.value]
            : EMPTY_VALUES
        : Array.isArray(nativeValue())
          ? (nativeValue() as readonly string[])
          : EMPTY_VALUES;

      const next = open
        ? appendValue(current, value)
        : removeValue(current, value);

      if (!isControlled() && next !== current) {
        setNativeValue(next);
      }

      props.onValueChange?.(next);
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

const EMPTY_VALUES: readonly string[] = [];

function hasValue(source: AccordionRootProps["value"], value: string): boolean {
  if (typeof source === "string") {
    return source === value;
  }

  if (!Array.isArray(source)) {
    return false;
  }

  for (let i = 0; i < source.length; i++) {
    if (source[i] === value) return true;
  }

  return false;
}

function appendValue(
  values: readonly string[],
  value: string,
): readonly string[] {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === value) return values;
  }

  const next = new Array<string>(values.length + 1);

  for (let i = 0; i < values.length; i++) {
    next[i] = values[i];
  }

  next[values.length] = value;
  return next;
}

function removeValue(
  values: readonly string[],
  value: string,
): readonly string[] {
  let index = -1;

  for (let i = 0; i < values.length; i++) {
    if (values[i] === value) {
      index = i;
      break;
    }
  }

  if (index === -1) return values;
  if (values.length === 1) return EMPTY_VALUES;

  const next = new Array<string>(values.length - 1);

  for (let i = 0; i < index; i++) {
    next[i] = values[i];
  }

  for (let i = index + 1; i < values.length; i++) {
    next[i - 1] = values[i];
  }

  return next;
}
