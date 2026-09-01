import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import Chat from "./chat";
import Home from "./Home";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("WMA visual state stories", () => {
  it("renders the production-shaped home fixture", async () => {
    history.replaceState(null, "", "/?fixture=demo");
    const view = render(() => <Home />);

    await waitFor(() =>
      expect(view.getByText("Команда продукту")).toBeInTheDocument(),
    );
    expect(view.getByText("8 підсумків")).toBeInTheDocument();
    expect(
      view.getByRole("link", { name: /Команда продукту, 8 підсумків/u }),
    ).toHaveAttribute("href", "/chat?ref=product-team&fixture=demo");
  });

  it("keeps a shape-accurate chat list while home is loading", () => {
    history.replaceState(null, "", "/?fixture=loading");
    const view = render(() => <Home />);

    expect(
      view.getByRole("status", { name: "Завантаження чатів" }),
    ).toBeInTheDocument();
    expect(view.container.querySelectorAll(".skeleton-chat-row")).toHaveLength(
      5,
    );
  });

  it("shows a purposeful empty home state", async () => {
    history.replaceState(null, "", "/?fixture=empty");
    const view = render(() => <Home />);

    await waitFor(() =>
      expect(view.getByText("Підсумків поки немає")).toBeInTheDocument(),
    );
  });

  it("covers the summary-to-source hot path", async () => {
    history.replaceState(null, "", "/chat?ref=product-team&fixture=demo");
    const view = render(() => <Chat chatRef="product-team" />);

    await waitFor(() =>
      expect(
        view.getByRole("heading", { name: "Команда продукту" }),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        view.getByText(/Команда зафіксувала фінальний scope релізу/u),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      view.getByRole("button", { name: /Повідомлення-джерела/u }),
    );

    await waitFor(() =>
      expect(
        view.getByText(/Фіксуємо scope: polishing hot path/u),
      ).toBeInTheDocument(),
    );
    expect(
      view.getByRole("button", { name: "Повернутися до підсумку" }),
    ).toBeInTheDocument();
  });

  it("exposes a retry action in the error story", async () => {
    history.replaceState(null, "", "/?fixture=error");
    const view = render(() => <Home />);

    await waitFor(() =>
      expect(view.getByText("Не вдалося завантажити")).toBeInTheDocument(),
    );
    expect(
      view.getByRole("button", { name: "Спробувати ще раз" }),
    ).toBeInTheDocument();
  });
});
