import { For, onCleanup, onSettled } from "solid-js";
import type { WmaSummaryDetail } from "../api/contracts";

type SourceMessage = WmaSummaryDetail["moments"][number];
const EDGE_DISTANCE = 50; // единый inset: и для gradient opacity, и для keyboard scroll margin
export const SOURCE_ITEM_MOTION_MS = 200;
const MOTION_FALLBACK_MS = SOURCE_ITEM_MOTION_MS + 50;
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
    top: Math.min(position / EDGE_DISTANCE, 1),
    bottom: Math.min((maxScroll - position) / EDGE_DISTANCE, 1),
  };
}

export function AnimatedSourceList(props: {
  messages: readonly SourceMessage[];
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
  const pendingVisibility = new Map<HTMLElement, boolean>();
  const motionTimeouts = new WeakMap<HTMLElement, number>();

  // scrollHeight читается заново на каждый commit — дешевле, чем держать
  // это в синхронизации с ResizeObserver, который на clientHeight-constant
  // контейнере не гарантирует срабатывание при изменении scrollHeight.
  const commitGradients = () => {
    gradientFrame = undefined;
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const opacity = sourceGradientOpacities(list.scrollTop, maxScroll);
    topGradient.style.opacity = String(opacity.top);
    bottomGradient.style.opacity = String(opacity.bottom);
  };

  const scheduleGradientUpdate = () => {
    if (gradientFrame !== undefined) return;
    gradientFrame = requestAnimationFrame(commitGradients);
  };

  const clearMotionTimeout = (item: HTMLElement) => {
    const timeoutId = motionTimeouts.get(item);
    if (timeoutId === undefined) return;
    clearTimeout(timeoutId);
    motionTimeouts.delete(item);
  };

  const selectItem = (item: HTMLLIElement, index: number) => {
    if (selectedItem === item) return;
    if (selectedItem) {
      selectedItem.removeAttribute("data-selected");
      selectedItem.removeAttribute("aria-selected");
    }
    selectedItem = item;
    selectedIndex = index;
    item.toggleAttribute("data-selected", true);
    item.setAttribute("aria-selected", "true");
    list.setAttribute("aria-activedescendant", item.id);
  };

  const stageVisibility = (item: HTMLElement, inView: boolean) => {
    const current =
      pendingVisibility.get(item) ?? item.hasAttribute("data-in-view");
    if (current === inView) return;

    item.toggleAttribute("data-motion-active", true);
    // transitionend может не прийти вообще (prefers-reduced-motion,
    // display:none во время анимации, свойство не совпало и т.д.) —
    // fallback-таймер гарантирует, что data-motion-active не залипнет
    // навсегда независимо от того, отработал ли переход.
    clearMotionTimeout(item);
    const timeoutId = window.setTimeout(() => {
      motionTimeouts.delete(item);
      item.removeAttribute("data-motion-active");
    }, MOTION_FALLBACK_MS);
    motionTimeouts.set(item, timeoutId);

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
    const visibleTop = list.scrollTop + EDGE_DISTANCE;
    const visibleBottom = list.scrollTop + list.clientHeight - EDGE_DISTANCE;

    if (itemTop < visibleTop) {
      list.scrollTo({ top: itemTop - EDGE_DISTANCE, behavior: "smooth" });
    } else if (itemBottom > visibleBottom) {
      list.scrollTo({
        top: itemBottom - list.clientHeight + EDGE_DISTANCE,
        behavior: "smooth",
      });
    }
  };

  const observer =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              stageVisibility(entry.target as HTMLElement, entry.isIntersecting);
          },
          { root: list, threshold: 0.01, rootMargin: "-24px 0px -24px 0px" },
        );

  const resizeObserver =
    nativeScrollTimeline || typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(scheduleGradientUpdate);

  onSettled(() => {
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
        role="listbox"
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
                id={`source-message-${index()}`}
                role="option"
                class="source-message"
                data-source-index={index()}
                style={{
                  "--source-item-duration": `${SOURCE_ITEM_MOTION_MS}ms`,
                  "--source-item-delay": `${Math.min(index(), 6) * 25}ms`,
                }}
                ref={(element) => {
                  // Подписка на конкретный элемент, а не querySelectorAll-снапшот
                  // после первого рендера: если props.messages дополняется без
                  // remount (пагинация, докачка), новые <li> тоже попадают под
                  // наблюдение. onCleanup здесь выполняется в скоупе конкретного
                  // item внутри <For> — сработает при его удалении из списка.
                  if (!observer) {
                    element.toggleAttribute("data-in-view", true);
                    return;
                  }
                  observer.observe(element);
                  onCleanup(() => {
                    observer.unobserve(element);
                    clearMotionTimeout(element);
                  });
                }}
                onTransitionEnd={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    event.propertyName === "transform"
                  ) {
                    clearMotionTimeout(event.currentTarget);
                    event.currentTarget.removeAttribute("data-motion-active");
                  }
                }}
              >
                <span class="source-avatar" aria-hidden="true">
                  {initials(message.author)}
                </span>
                <span class="source-message-content">
                  <span class="source-message-heading">
                    <strong>{message.author}</strong>
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