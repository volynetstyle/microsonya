import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import * as Menu from ".";

describe("Menu", () => {
  it("adds menu semantics only to action menus", () => {
    const { getByRole } = render(() => (
      <Menu.Root>
        <Menu.Trigger>Actions</Menu.Trigger>
        <Menu.Content aria-label="Actions">
          <Menu.Item>Profile</Menu.Item>
          <Menu.Separator />
          <Menu.Item>Settings</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    ));

    expect(
      getByRole("button", { name: "Actions" }).getAttribute("aria-haspopup"),
    ).toBe("menu");
    expect(getByRole("menu", { name: "Actions", hidden: true })).not.toBeNull();
    expect(getByRole("separator", { hidden: true })).not.toBeNull();
  });

  it("supports arrows, Home/End and selection without trapping Tab", () => {
    const onSelect = vi.fn();
    const { getByRole, getAllByRole } = render(() => (
      <Menu.Root>
        <Menu.Trigger>Actions</Menu.Trigger>
        <Menu.Content aria-label="Actions">
          <Menu.Item>Alpha</Menu.Item>
          <Menu.Item>Beta</Menu.Item>
          <Menu.Item onSelect={onSelect}>Gamma</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    ));

    const menu = getByRole("menu", { hidden: true });
    const items = getAllByRole("menuitem", { hidden: true });

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "g" });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.click(items[2]);
    expect(onSelect).toHaveBeenCalledOnce();

    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    menu.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });
});
