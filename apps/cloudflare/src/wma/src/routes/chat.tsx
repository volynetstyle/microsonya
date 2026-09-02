import {
  createEffect,
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  onCleanup,
  Show,
} from "solid-js";
import type { ParentProps } from "solid-js";
import {
  fixtureHref,
  loadChatOverview,
  loadSummaryDetail,
  peekChatOverview,
} from "../api/bootstrap";
import type { WmaSummaryCard } from "../api/contracts";
import {
  ChatSkeleton,
  EmptyState,
  ErrorState,
  MessagesSkeleton,
} from "../components/AsyncStates";
import { AnimatedSourceList } from "../components/AnimatedSourceList";
import { useMeasuredSourceWindow } from "../components/source-window";
import * as Accordion from "../shared/accordion";
import "../components/TopicCard.css";
import "./Chat.css";

const SUMMARY_DAY_FORMATTER = new Intl.DateTimeFormat("uk-UA", {
  day: "numeric",
  month: "short",
});
const SUMMARY_TIME_FORMATTER = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit",
});

const messageLabel = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} повідомлення`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${count} повідомлення`;
  return `${count} повідомлень`;
};

const summaryLabel = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} підсумок`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${count} підсумки`;
  return `${count} підсумків`;
};

function summaryMoment(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const day = date.toDateString();
  const prefix =
    day === today.toDateString()
      ? "Сьогодні"
      : day === yesterday.toDateString()
        ? "Учора"
        : SUMMARY_DAY_FORMATTER.format(date);
  const time = SUMMARY_TIME_FORMATTER.format(date);
  return { label: `${prefix}, ${time}`, datetime: date.toISOString() };
}

export default function Chat(props: { chatRef: string }) {
  const cachedOverview = peekChatOverview(props.chatRef);
  const [reloadKey, setReloadKey] = createSignal(0);
  const [overviewPage, setOverviewPage] = createSignal(cachedOverview);
  const [summaries, setSummaries] = createSignal<readonly WmaSummaryCard[]>(
    cachedOverview?.summaries ?? [],
  );
  const [nextCursor, setNextCursor] = createSignal<string | null>(
    cachedOverview?.nextCursor ?? null,
  );
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [loadMoreError, setLoadMoreError] = createSignal<unknown>();
  const overview = createMemo(async () => {
    reloadKey();
    return loadChatOverview(props.chatRef);
  });
  createEffect(
    () => overview(),
    (page) => {
      setOverviewPage(page);
      setSummaries(page.summaries);
      setNextCursor(page.nextCursor);
      setLoadMoreError(undefined);
    },
  );
  const visibleOverview = () => overviewPage() ?? overview();

  const loadMore = async () => {
    const cursor = nextCursor();
    if (cursor === null || loadingMore()) return;
    setLoadingMore(true);
    setLoadMoreError(undefined);
    try {
      const page = await loadChatOverview(props.chatRef, cursor);
      setSummaries((current) => {
        const known = new Set(current.map(({ id }) => id));
        return [
          ...current,
          ...page.summaries.filter(({ id }) => !known.has(id)),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <main class="screen chat-screen">
      <header class="app-header chat-header">
        <a
          class="chat-back"
          href={fixtureHref("/")}
          aria-label="До списку чатів"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 5-7 7 7 7" />
          </svg>
        </a>
        <span class="chat-header-copy">
          <Errored fallback={<span class="chat-title">Підсумки</span>}>
            <Loading
              fallback={
                <>
                  <span class="skeleton-block chat-title-skeleton" />
                  <span class="skeleton-block chat-subtitle-skeleton" />
                </>
              }
            >
              <h1 class="chat-title">{visibleOverview().chat.title}</h1>
              <span class="chat-subtitle">
                {summaryLabel(visibleOverview().stats.summaryCount)} ·{" "}
                {messageLabel(visibleOverview().stats.messageCount)}
              </span>
            </Loading>
          </Errored>
        </span>
      </header>

      <Errored
        fallback={(error) => (
          <ErrorState
            error={error()}
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        )}
      >
        <Loading fallback={<ChatSkeleton />}>
          <section
            class="chat-content"
            aria-labelledby="chat-summaries-heading"
          >
            <div class="section-heading chat-section-heading">
              <span>
                <span class="chat-section-kicker">ІСТОРІЯ</span>
                <h2 id="chat-summaries-heading">Останні підсумки</h2>
              </span>
              <span class="chat-count-badge">
                {summaries().length} / {visibleOverview().stats.summaryCount}
              </span>
            </div>

            <Show
              when={summaries().length > 0}
              fallback={
                <EmptyState
                  title="Тут ще тихо"
                  description="Коли в чаті накопичиться достатньо нових повідомлень, Microsonya додасть перший підсумок."
                />
              }
            >
              <Accordion.Root
                class="topic-list"
                defaultValue={summaries()[0]?.id}
              >
                <For each={summaries()}>
                  {(summary) => (
                    <SummaryCard chatRef={props.chatRef} summary={summary} />
                  )}
                </For>
              </Accordion.Root>
              <Show
                when={nextCursor() !== null || loadMoreError() !== undefined}
              >
                <ProgressiveLoader
                  loading={loadingMore()}
                  error={loadMoreError()}
                  onLoad={loadMore}
                />
              </Show>
            </Show>
          </section>
        </Loading>
      </Errored>
    </main>
  );
}

function ProgressiveLoader(props: {
  loading: boolean;
  error: unknown;
  onLoad: () => Promise<void>;
}) {
  let sentinel!: HTMLDivElement;
  createEffect(
    () => ({ loading: props.loading, error: props.error }),
    ({ loading, error }) => {
      if (loading || error !== undefined) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some(({ isIntersecting }) => isIntersecting))
            void props.onLoad();
        },
        { rootMargin: "240px 0px" },
      );
      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    },
  );
  return (
    <div ref={sentinel} class="chat-progressive-loader" aria-live="polite">
      <Show
        when={props.error === undefined}
        fallback={
          <button type="button" onClick={() => void props.onLoad()}>
            Повторити завантаження
          </button>
        }
      >
        <span>{props.loading ? "Завантажуємо ще…" : "Прокрутіть далі"}</span>
      </Show>
    </div>
  );
}

/** Source messages are fetched only when the reader explicitly opens them. */
function SummaryCard(props: { chatRef: string; summary: WmaSummaryCard }) {
  const [showMessages, setShowMessages] = createSignal(false);
  const [detailReloadKey, setDetailReloadKey] = createSignal(0);
  const detail = createMemo(async () => {
    detailReloadKey();
    return showMessages()
      ? loadSummaryDetail(props.chatRef, props.summary.id)
      : undefined;
  });
  const moment = () => summaryMoment(props.summary.createdAt);

  return (
    <Accordion.Item value={props.summary.id} class="topic-card">
      <Accordion.Trigger class="topic-trigger">
        <span class="topic-header">
          <span class="topic-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M7 4.75h10A2.25 2.25 0 0 1 19.25 7v7A2.25 2.25 0 0 1 17 16.25h-4.3L8 19.5v-3.25H7A2.25 2.25 0 0 1 4.75 14V7A2.25 2.25 0 0 1 7 4.75Z" />
              <path d="M8.5 9h7M8.5 12h4.5" />
            </svg>
          </span>
          <span class="topic-heading">
            <span class="topic-title">Підсумок розмови</span>
            <time class="topic-time" datetime={moment().datetime}>
              {moment().label}
            </time>
          </span>
          <svg class="topic-chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m5.75 3.5 4.5 4.5-4.5 4.5" />
          </svg>
        </span>
        <span class="topic-summary">
          <span class="topic-preview">{props.summary.preview}</span>
          <span class="topic-meta">
            <span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.25 3.75h9.5v6.5h-4.1L5.5 12.5v-2.25H3.25z" />
              </svg>
              {messageLabel(props.summary.messageCount)}
            </span>
            <span>Розгорнути</span>
          </span>
        </span>
      </Accordion.Trigger>

      <Accordion.Content>
        <Show
          when={showMessages()}
          fallback={
            <section class="summary-screen">
              <span class="summary-label">ГОЛОВНЕ</span>
              <p class="summary-text">{props.summary.summary}</p>
              <button
                type="button"
                class="summary-messages-link"
                onClick={() => setShowMessages(true)}
              >
                <span class="summary-link-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <path d="M5.25 4.5h9.5A1.75 1.75 0 0 1 16.5 6.25v6.25a1.75 1.75 0 0 1-1.75 1.75H10l-3.5 2.5v-2.5H5.25A1.75 1.75 0 0 1 3.5 12.5V6.25A1.75 1.75 0 0 1 5.25 4.5Z" />
                  </svg>
                </span>
                <span>
                  <strong>Повідомлення-джерела</strong>
                  <small>{messageLabel(props.summary.messageCount)}</small>
                </span>
                <svg
                  class="summary-link-chevron"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path d="m6 3.5 4.5 4.5L6 12.5" />
                </svg>
              </button>
            </section>
          }
        >
          <MeasuredSourceScreen>
            <header class="source-header">
              <button
                type="button"
                class="summary-messages-back"
                onClick={() => setShowMessages(false)}
                aria-label="Повернутися до підсумку"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m12 4.5-5.5 5.5 5.5 5.5" />
                </svg>
              </button>
              <span>
                <strong>Повідомлення-джерела</strong>
                <small>Фрагменти, на яких побудовано підсумок</small>
              </span>
            </header>
            <div class="source-list-window">
              <Errored
                fallback={(error) => (
                  <ErrorState
                    compact
                    error={error()}
                    onRetry={() => setDetailReloadKey((key) => key + 1)}
                  />
                )}
              >
                <Loading fallback={<MessagesSkeleton />}>
                  <Show
                    when={(detail()?.moments.length ?? 0) > 0}
                    fallback={
                      <EmptyState
                        compact
                        title="Джерел не знайдено"
                        description="Повідомлення могли бути видалені після створення підсумку."
                      />
                    }
                  >
                    <AnimatedSourceList messages={detail()!.moments} />
                  </Show>
                </Loading>
              </Errored>
            </div>
          </MeasuredSourceScreen>
        </Show>
      </Accordion.Content>
    </Accordion.Item>
  );
}

function MeasuredSourceScreen(props: ParentProps) {
  let element!: HTMLElement;
  useMeasuredSourceWindow(() => element);
  return (
    <section
      ref={element}
      class="summary-screen summary-messages-screen"
    >
      {props.children}
    </section>
  );
}
