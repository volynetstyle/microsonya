import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createContextMenu } from "./create-context-menu";

describe("context-menu activation", () => {
  it("delegates desktop contextmenu activation to the closest target", async () => {
    let dispose: (() => void) | undefined;
    let controller!: ReturnType<typeof createContextMenu>;

    createRoot((cleanup) => {
      dispose = cleanup;
      controller = createContextMenu({ targets: "[data-context-menu]" });
    });

    const root = document.createElement("div");
    const target = document.createElement("article");
    const child = document.createElement("span");
    target.dataset.contextMenu = "true";
    target.append(child);
    root.append(target);
    document.body.append(root);
    controller.setTargetRoot(root);
    root.addEventListener("contextmenu", controller.handlers.onContextMenu);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
    });
    child.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(controller.open()).toBe(true);
    expect(controller.target()).toBe(target);
    expect(controller.point()).toEqual({ x: 120, y: 80 });

    controller.close();
    dispose?.();
    root.remove();
  });

  it("keeps links available to the browser when the legacy policy is enabled", () => {
    let controller!: ReturnType<typeof createContextMenu>;
    createRoot(() => {
      controller = createContextMenu();
    });

    const root = document.createElement("div");
    const target = document.createElement("div");
    const link = document.createElement("a");
    link.href = "/thread";
    target.dataset.contextMenu = "true";
    target.append(link);
    root.append(target);
    document.body.append(root);
    controller.setTargetRoot(root);
    root.addEventListener("contextmenu", controller.handlers.onContextMenu);

    link.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );

    expect(controller.open()).toBe(false);
    root.remove();
  });
});
