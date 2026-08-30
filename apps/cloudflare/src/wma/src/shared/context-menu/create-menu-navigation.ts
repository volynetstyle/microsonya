export function createMenuNavigation(getMenu: () => HTMLElement | undefined) {
  let search = "";
  let searchTimer: number | undefined;

  const items = () =>
    Array.from(
      getMenu()?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );

  const focusAt = (index: number) => {
    const available = items();
    if (!available.length) return;
    available[(index + available.length) % available.length]?.focus();
  };

  const focusFirst = () => focusAt(0);

  const onKeyDown = (event: KeyboardEvent) => {
    const available = items();
    const activeIndex = available.indexOf(
      document.activeElement as HTMLButtonElement,
    );

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(activeIndex + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(activeIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(available.length - 1);
        return;
      case "Tab":
        getMenu()?.closest<HTMLElement>("[popover]")?.hidePopover?.();
        return;
    }

    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;

    search += event.key.toLocaleLowerCase();
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => (search = ""), 500);
    const match = available.find((item) =>
      item.textContent?.trim().toLocaleLowerCase().startsWith(search),
    );
    if (match) {
      event.preventDefault();
      match.focus();
    }
  };

  return { onKeyDown, focusFirst };
}
