import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import * as Accordion from ".";

function StateFixture(props: {
  multiple?: boolean;
  value?: string | readonly string[] | null;
  defaultValue?: string | readonly string[] | null;
  onValueChange?: (value: string | readonly string[] | null) => void;
}) {
  return (
    <Accordion.Root {...props}>
      <Accordion.Item value="first">
        <Accordion.Trigger>First</Accordion.Trigger>
        <Accordion.Content>First content</Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="second">
        <Accordion.Trigger>Second</Accordion.Trigger>
        <Accordion.Content>Second content</Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}

describe("Accordion state parity", () => {
  it("stores one value in single mode", async () => {
    const onValueChange = vi.fn();
    const { container } = render(() => (
      <StateFixture defaultValue="first" onValueChange={onValueChange} />
    ));
    const details = container.querySelectorAll("details");

    fireEvent.click(details[1].querySelector("summary")!);

    await waitFor(() => {
      expect(details[0].open).toBe(false);
      expect(details[1].open).toBe(true);
    });
    expect(onValueChange).toHaveBeenLastCalledWith("second");
  });

  it("stores the exact subset in multiple mode", async () => {
    const onValueChange = vi.fn();
    const { container } = render(() => (
      <StateFixture multiple onValueChange={onValueChange} />
    ));
    const details = container.querySelectorAll("details");

    fireEvent.click(details[0].querySelector("summary")!);
    await waitFor(() => expect(details[0].open).toBe(true));
    fireEvent.click(details[1].querySelector("summary")!);

    await waitFor(() => {
      expect(details[0].open).toBe(true);
      expect(details[1].open).toBe(true);
    });
    await waitFor(() =>
      expect(onValueChange).toHaveBeenLastCalledWith(["first", "second"]),
    );
  });

  it("restores DOM when a controlled owner rejects a native toggle", async () => {
    const onValueChange = vi.fn();
    const { container } = render(() => (
      <StateFixture value={null} onValueChange={onValueChange} />
    ));
    const first = container.querySelector("details")!;

    fireEvent.click(first.querySelector("summary")!);

    await waitFor(() => expect(first.open).toBe(false));
    expect(onValueChange).toHaveBeenCalledWith("first");
  });
});
