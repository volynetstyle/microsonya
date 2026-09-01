import {
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  Show,
} from "solid-js";
import {
  fixtureHref,
  loadChatOverview,
  loadSummaryDetail,
} from "../api/bootstrap";
import type { WmaSummaryCard } from "../api/contracts";
import {
  ChatSkeleton,
  EmptyState,
  ErrorState,
  MessagesSkeleton,
} from "../components/AsyncStates";
import * as Accordion from "../shared/accordion";
import "../components/TopicCard.css";
import "./Chat.css";

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
        : new Intl.DateTimeFormat("uk-UA", {
            day: "numeric",
            month: "short",
          }).format(date);
  const time = new Intl.DateTimeFormat("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return { label: `${prefix}, ${time}`, datetime: date.toISOString() };
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

export default function Chat(props: { chatRef: string }) {
  const [reloadKey, setReloadKey] = createSignal(0);
  const overview = createMemo(async () => {
    reloadKey();
    return loadChatOverview(props.chatRef);
  });

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
              <h1 class="chat-title">{overview().chat.title}</h1>
              <span class="chat-subtitle">
                {summaryLabel(overview().stats.summaryCount)} ·{" "}
                {messageLabel(overview().stats.messageCount)}
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
                {overview().summaries.length} у стрічці
              </span>
            </div>

            <Show
              when={overview().summaries.length > 0}
              fallback={
                <EmptyState
                  title="Тут ще тихо"
                  description="Коли в чаті накопичиться достатньо нових повідомлень, Microsonya додасть перший підсумок."
                />
              }
            >
              <Accordion.Root
                class="topic-list"
                defaultValue={overview().summaries[0]?.id}
              >
                <For each={overview().summaries}>
                  {(summary) => (
                    <SummaryCard chatRef={props.chatRef} summary={summary} />
                  )}
                </For>
              </Accordion.Root>
            </Show>
          </section>
        </Loading>
      </Errored>
    </main>
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
          <section class="summary-screen summary-messages-screen">
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
                  <ol class="source-message-list">
                    <For each={detail()!.moments}>
                      {(message) => (
                        <li class="source-message">
                          <span class="source-avatar" aria-hidden="true">
                            {initials(message.author)}
                          </span>
                          <span class="source-message-content">
                            <span class="source-message-heading">
                              <strong>{message.author}</strong>
                              <time
                                datetime={new Date(
                                  message.sentAt,
                                ).toISOString()}
                              >
                                {new Intl.DateTimeFormat("uk-UA", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }).format(new Date(message.sentAt))}
                              </time>
                            </span>
                            <span class="source-message-body">
                              {message.body}
                            </span>
                          </span>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              </Loading>
            </Errored>
          </section>
        </Show>
      </Accordion.Content>
    </Accordion.Item>
  );
}
