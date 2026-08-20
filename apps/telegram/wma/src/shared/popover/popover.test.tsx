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
});
