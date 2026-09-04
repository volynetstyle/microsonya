import { For, onSettled, Show } from "solid-js";
import type { WmaSummaryDetail } from "../api/contracts";

type SourceMessage = WmaSummaryDetail["moments"][number];
const GRADIENT_DISTANCE = 50;
export const SOURCE_ITEM_MOTION_MS = 200;
const TIME_FORMATTER = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit",
});

export function sourceGradientOpacities(
  scrollTop: number,
  maxScroll: number,
): Readonly<{ top: number; bottom: number }> {
  if (maxScroll <= 0) return { top: 0, bottom: 0 };
  const position = Math.max(0, Math.min(scrollTop, maxScroll));
  return {
    top: Math.min(position / GRADIENT_DISTANCE, 1),
    bottom: Math.min((maxScroll - position) / GRADIENT_DISTANCE, 1),
  };
}

export function AnimatedSourceList(props: {
  messages: readonly SourceMessage[];
  onRenameParticipant?: (message: SourceMessage) => Promise<void>;
}) {
  const nativeScrollTimeline =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("animation-timeline: scroll()") &&
    CSS.supports("animation-range: 0px 50px") &&
    CSS.supports("animation-range: calc(100% - 50px) 100%");
  let list!: HTMLOListElement;
  let topGradient!: HTMLSpanElement;
  let bottomGradient!: HTMLSpanElement;
  let selectedIndex = -1;
  let selectedItem: HTMLLIElement | undefined;
  let gradientFrame: number | undefined;
  let visibilityFrame: number | undefined;
  let maxScroll = 0;
  const pendingVisibility = new Map<HTMLElement, boolean>();

  const commitGradients = () => {
    gradientFrame = undefined;
    const opacity = sourceGradientOpacities(list.scrollTop, maxScroll);
    topGradient.style.opacity = String(opacity.top);
    bottomGradient.style.opacity = String(opacity.bottom);
  };

  const scheduleGradientUpdate = () => {
    if (gradientFrame !== undefined) return;
    gradientFrame = requestAnimationFrame(commitGradients);
  };

  const measureScrollRange = () => {
    maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    commitGradients();
  };

  const selectItem = (item: HTMLLIElement, index: number) => {
    if (selectedItem === item) return;
    selectedItem?.removeAttribute("data-selected");
    selectedItem = item;
    selectedIndex = index;
    item.toggleAttribute("data-selected", true);
  };

  const stageVisibility = (item: HTMLElement, inView: boolean) => {
    const current =
      pendingVisibility.get(item) ?? item.hasAttribute("data-in-view");
    if (current === inView) return;
    item.toggleAttribute("data-motion-active", true);
    pendingVisibility.set(item, inView);
    if (visibilityFrame !== undefined) return;
    visibilityFrame = requestAnimationFrame(() => {
      visibilityFrame = undefined;
      for (const [target, visible] of pendingVisibility)
        target.toggleAttribute("data-in-view", visible);
      pendingVisibility.clear();
    });
  };

  const moveSelection = (direction: -1 | 1) => {
    if (props.messages.length === 0) return;
    const next = Math.max(
      0,
      Math.min(
        props.messages.length - 1,
        selectedIndex < 0 ? 0 : selectedIndex + direction,
      ),
    );
    const item = list.querySelector<HTMLLIElement>(
      `[data-source-index="${next}"]`,
    );
    if (!item) return;
    selectItem(item, next);
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    const viewportTop = list.scrollTop;
    const viewportBottom = viewportTop + list.clientHeight;
    if (itemTop < viewportTop + 50) {
      list.scrollTo({ top: itemTop - 50, behavior: "smooth" });
    } else if (itemBottom > viewportBottom - 50) {
      list.scrollTo({
        top: itemBottom - list.clientHeight + 50,
        behavior: "smooth",
      });
    }
  };

  onSettled(() => {
    const items = list.querySelectorAll<HTMLElement>(".source-message");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries)
                stageVisibility(
                  entry.target as HTMLElement,
                  entry.isIntersecting,
                );
            },
            { root: list, threshold: 0.5 },
          );
    for (const item of items) {
      if (observer) observer.observe(item);
      else item.toggleAttribute("data-in-view", true);
    }
    const resizeObserver =
      nativeScrollTimeline || typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measureScrollRange);
    resizeObserver?.observe(list);
    if (!nativeScrollTimeline && !resizeObserver) scheduleGradientUpdate();
    return () => {
      if (gradientFrame !== undefined) cancelAnimationFrame(gradientFrame);
      if (visibilityFrame !== undefined) cancelAnimationFrame(visibilityFrame);
      observer?.disconnect();
      resizeObserver?.disconnect();
      pendingVisibility.clear();
    };
  });

  return (
    <div class="animated-source-list">
      <ol
        ref={list}
        class="source-message-list"
        tabindex="0"
        aria-label="Повідомлення-джерела"
        onScroll={nativeScrollTimeline ? undefined : scheduleGradientUpdate}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveSelection(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(-1);
          }
        }}
      >
        <For each={props.messages}>
          {(message, index) => {
            const sentAt = new Date(message.sentAt);
            return (
              <li
                class="source-message"
                data-source-index={index()}
                style={{
                  "--source-item-duration": `${SOURCE_ITEM_MOTION_MS}ms`,
                  "--source-item-delay": `${Math.min(index(), 6) * 25}ms`,
                }}
                onPointerEnter={(event) =>
                  selectItem(event.currentTarget, index())
                }
                onTransitionEnd={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    event.propertyName === "transform"
                  )
                    event.currentTarget.removeAttribute("data-motion-active");
                }}
              >
                <span class="source-avatar" aria-hidden="true">
                  {initials(message.author)}
                </span>
                <span class="source-message-content">
                  <span class="source-message-heading">
                    <strong>{message.author}</strong>
                    <Show when={props.onRenameParticipant !== undefined}>
                      <button
                        type="button"
                        class="source-participant-rename"
                        onClick={() =>
                          void props.onRenameParticipant?.(message)
                        }
                      >
                        Перейменувати
                      </button>
                    </Show>
                    <time datetime={sentAt.toISOString()}>
                      {TIME_FORMATTER.format(sentAt)}
                    </time>
                  </span>
                  <span class="source-message-body">{message.body}</span>
                </span>
              </li>
            );
          }}
        </For>
      </ol>
      <span
        ref={topGradient}
        class="source-list-gradient source-list-gradient-top"
        style={{ opacity: 0 }}
        aria-hidden="true"
      />
      <span
        ref={bottomGradient}
        class="source-list-gradient source-list-gradient-bottom"
        style={{ opacity: 0 }}
        aria-hidden="true"
      />
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toLocaleUpperCase("uk-UA") || "?"
  );
}
