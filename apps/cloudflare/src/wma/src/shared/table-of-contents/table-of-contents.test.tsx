import { createSignal } from "solid-js";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { TableOfContents } from ".";

const items = [
  { id: "intro", label: "Introduction" },
  {
    id: "motion",
    label: "Motion",
    children: [{ id: "motion-tracking", label: "Tracking" }],
  },
] as const;

const deepItems = [
  {
    id: "a",
    label: "A",
    children: [
      {
        id: "b",
        label: "B",
        children: [
          {
            id: "c",
            label: "C",
            children: [{ id: "d", label: "D" }],
          },
        ],
      },
    ],
  },
] as const;

describe("TableOfContents", () => {
  it("activates the parent rail and reveals its active nested item", async () => {
    let setActive!: (id: string) => void;
    const view = render(() => {
      const [active, updateActive] = createSignal("intro");
      setActive = updateActive;
      return <TableOfContents items={items} activeId={active()} />;
    });

    setActive("motion-tracking");

    await waitFor(() => {
      const parent = view.getByRole("button", { name: "Motion" });
      const child = view.getByRole("button", { name: "Tracking" });
      expect(
        parent.parentElement?.classList.contains("toc__item--active"),
      ).toBe(true);
      expect(child.parentElement?.classList.contains("toc__item--active")).toBe(
        true,
      );
      expect(parent.getAttribute("aria-expanded")).toBe("true");
      expect(child.getAttribute("aria-current")).toBe("location");
    });
  });

  it("selects rows and lets a parent toggle its nested list", async () => {
    const onSelect = vi.fn();
    const view = render(() => (
      <TableOfContents items={items} activeId="intro" onSelect={onSelect} />
    ));
    const parent = view.getByRole("button", { name: "Motion" });

    fireEvent.click(parent);

    expect(onSelect).toHaveBeenCalledWith("motion");
    await waitFor(() =>
      expect(parent.getAttribute("aria-expanded")).toBe("true"),
    );
  });

  it("projects an arbitrary-depth active chain and omits collapsed subtrees", async () => {
    let setActive!: (id: string) => void;
    const view = render(() => {
      const [active, updateActive] = createSignal("missing");
      setActive = updateActive;
      return <TableOfContents items={deepItems} activeId={active()} />;
    });

    expect(view.queryByRole("button", { name: "B" })).toBeNull();

    setActive("d");

    await waitFor(() => {
      expect(view.getAllByRole("button")).toHaveLength(4);
      expect(
        view
          .getByRole("button", { name: "A" })
          .parentElement?.classList.contains("toc__item--active"),
      ).toBe(true);
      expect(
        view.getByRole("button", { name: "D" }).getAttribute("aria-current"),
      ).toBe("location");
      expect(
        view
          .getByRole("button", { name: "D" })
          .parentElement?.style.getPropertyValue("--toc-depth"),
      ).toBe("3");
    });
  });
});
