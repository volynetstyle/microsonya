import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import * as Popover from ".";

describe("Popover", () => {
  it("connects an accessible native invoker to a generic top-layer panel", () => {
    const { getByRole, getByText } = render(() => (
      <Popover.Root placement="bottom-end">
        <Popover.Trigger>Open panel</Popover.Trigger>
        <Popover.Content>
          <Popover.Surface>Panel contents</Popover.Surface>
        </Popover.Content>
      </Popover.Root>
    ));

    const trigger = getByRole("button", { name: "Open panel" });
    const positioner = getByText("Panel contents").parentElement!;

    expect(trigger.getAttribute("popovertarget")).toBe(positioner.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
    expect(positioner.getAttribute("popover")).toBe("auto");
    expect(positioner.getAttribute("data-placement")).toBe("bottom-end");
  });

  it("exposes controlled native state changes to the owner", () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(() => (
      <Popover.Root open={false} onOpenChange={onOpenChange}>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Content>
          <Popover.Surface>Contents</Popover.Surface>
        </Popover.Content>
      </Popover.Root>
    ));

    const positioner = getByText("Contents").parentElement!;
    const event = new Event("beforetoggle", { cancelable: true });
    Object.defineProperty(event, "newState", { value: "open" });
    positioner.dispatchEvent(event);

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not re-enter showPopover from its synchronous beforetoggle", async () => {
    const { getByText } = render(() => (
      <Popover.Root>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Content>
          <Popover.Surface>Reentrant contents</Popover.Surface>
        </Popover.Content>
      </Popover.Root>
    ));

    const positioner = getByText("Reentrant contents").parentElement!;
    const showPopover = vi.fn();
    Object.defineProperty(positioner, "showPopover", {
      configurable: true,
      value: showPopover,
    });

    const beforeToggle = new Event("beforetoggle", { cancelable: true });
    Object.defineProperty(beforeToggle, "newState", { value: "open" });
    positioner.dispatchEvent(beforeToggle);
    await Promise.resolve();

    expect(beforeToggle.defaultPrevented).toBe(false);
    expect(showPopover).not.toHaveBeenCalled();
  });

  it("repositions an open point anchor without another toggle", async () => {
    let movePoint!: (point: { x: number; y: number }) => void;
    const { getByText } = render(() => {
      const [point, setPoint] = createSignal({ x: 40, y: 50 });
      movePoint = setPoint;

      return (
        <Popover.Root
          anchor={() => ({ type: "point", ...point() })}
        >
          <Popover.Content>
            <Popover.Surface>Moving point contents</Popover.Surface>
          </Popover.Content>
        </Popover.Root>
      );
    });

    const positioner = getByText("Moving point contents").parentElement!;
    Object.defineProperty(positioner, "matches", {
      configurable: true,
      value: (selector: string) => selector === ":popover-open",
    });
    vi.spyOn(positioner, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 80,
    } as DOMRect);

    movePoint({ x: 120, y: 90 });
    await Promise.resolve();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(positioner.style.inset).toBe("90px auto auto 123px");
  });
});
