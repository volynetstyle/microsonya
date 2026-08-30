import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import * as Accordion from ".";

describe("Accordion.Content", () => {
  it("materializes closed content only after its first opening", async () => {
    const { container, queryByTestId } = render(() => (
      <Accordion.Root defaultValue="first">
        <Accordion.Item value="first">
          <Accordion.Trigger>First</Accordion.Trigger>
          <Accordion.Content>
            <span data-testid="first-content" />
          </Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="second">
          <Accordion.Trigger>Second</Accordion.Trigger>
          <Accordion.Content>
            <span data-testid="second-content" />
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    ));

    expect(queryByTestId("first-content")).not.toBeNull();
    expect(queryByTestId("second-content")).toBeNull();

    const second = container.querySelectorAll("details")[1];
    fireEvent.click(second.querySelector("summary")!);

    await waitFor(() => expect(queryByTestId("second-content")).not.toBeNull());

    fireEvent.click(second.querySelector("summary")!);

    // Preserve state and DOM after the first opening; only initial work is
    // deferred, so closing animations and interactive children still work.
    expect(queryByTestId("second-content")).not.toBeNull();
  });
});
