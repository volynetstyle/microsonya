import { For, Show } from "solid-js";
import { WmaApiError } from "../api/http";
import "./AsyncStates.css";

const HOME_ROWS = Array.from({ length: 5 });
const SUMMARY_ROWS = Array.from({ length: 3 });
const MESSAGE_ROWS = Array.from({ length: 3 });

export function HomeSkeleton() {
  return (
    <div class="skeleton-state" role="status" aria-label="Завантаження чатів">
      <span class="sr-only">Завантажуємо чати…</span>
      <div class="home-chat-list skeleton-list" aria-hidden="true">
        <For each={HOME_ROWS}>
          {(_, index) => (
            <div class="skeleton-chat-row">
              <span class="skeleton-block skeleton-avatar" />
              <span class="skeleton-chat-copy">
                <span
                  class="skeleton-block skeleton-line skeleton-line-title"
                  style={{ width: `${58 + (index() % 3) * 9}%` }}
                />
                <span
                  class="skeleton-block skeleton-line skeleton-line-caption"
                  style={{ width: `${31 + (index() % 2) * 12}%` }}
                />
              </span>
              <span class="skeleton-block skeleton-time" />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div
      class="skeleton-state"
      role="status"
      aria-label="Завантаження підсумків"
    >
      <span class="sr-only">Завантажуємо підсумки…</span>
      <div class="chat-content skeleton-summary-list" aria-hidden="true">
        <div class="section-heading skeleton-section-heading">
          <span class="skeleton-block skeleton-line skeleton-section-title" />
          <span class="skeleton-block skeleton-pill" />
        </div>
        <div class="skeleton-summary-group">
          <For each={SUMMARY_ROWS}>
            {(_, index) => (
              <article class="skeleton-summary-card">
                <div class="skeleton-summary-heading">
                  <span class="skeleton-block skeleton-summary-icon" />
                  <span class="skeleton-summary-copy">
                    <span class="skeleton-block skeleton-line skeleton-line-title" />
                    <span class="skeleton-block skeleton-line skeleton-line-caption" />
                  </span>
                </div>
                <span
                  class="skeleton-block skeleton-line skeleton-line-body"
                  style={{ width: `${88 - index() * 7}%` }}
                />
                <span class="skeleton-block skeleton-line skeleton-line-body-short" />
              </article>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export function MessagesSkeleton() {
  return (
    <div
      class="skeleton-messages"
      role="status"
      aria-label="Завантаження повідомлень"
    >
      <span class="sr-only">Завантажуємо джерельні повідомлення…</span>
      <For each={MESSAGE_ROWS}>
        {(_, index) => (
          <div class="skeleton-message" aria-hidden="true">
            <span class="skeleton-block skeleton-message-avatar" />
            <span class="skeleton-message-copy">
              <span
                class="skeleton-block skeleton-line skeleton-line-caption"
                style={{ width: `${35 + index() * 8}%` }}
              />
              <span class="skeleton-block skeleton-line skeleton-line-body" />
              <span
                class="skeleton-block skeleton-line skeleton-line-body-short"
                style={{ width: `${56 + index() * 5}%` }}
              />
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

type EmptyStateProps = Readonly<{
  title: string;
  description: string;
  compact?: boolean;
}>;

export function EmptyState(props: EmptyStateProps) {
  return (
    <section
      class={`feedback-state${props.compact ? " feedback-state-compact" : ""}`}
    >
      <span
        class="feedback-illustration feedback-illustration-empty"
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32">
          <path d="M8.25 6.75h15.5A3.25 3.25 0 0 1 27 10v9.5a3.25 3.25 0 0 1-3.25 3.25h-7.1l-4.9 3.5v-3.5h-3.5A3.25 3.25 0 0 1 5 19.5V10a3.25 3.25 0 0 1 3.25-3.25Z" />
          <path d="M10 12h12M10 16h8" />
        </svg>
      </span>
      <h2>{props.title}</h2>
      <p>{props.description}</p>
    </section>
  );
}

type ErrorStateProps = Readonly<{
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}>;

function errorCopy(error: unknown) {
  if (error instanceof WmaApiError) {
    if (error.status === 401)
      return {
        title: "Потрібен Telegram",
        description:
          "Відкрийте Microsonya безпосередньо з Telegram і спробуйте ще раз.",
      };
    if (error.status === 403)
      return {
        title: "Немає доступу",
        description: "Цей чат недоступний для поточного Telegram-акаунта.",
      };
    if (error.status === 404)
      return {
        title: "Дані не знайдено",
        description: "Схоже, цей підсумок уже недоступний або був оновлений.",
      };
  }
  return {
    title: "Не вдалося завантажити",
    description:
      "Перевірте з’єднання і повторіть спробу. Ваші дані залишилися в безпеці.",
  };
}

export function ErrorState(props: ErrorStateProps) {
  const copy = () => errorCopy(props.error);
  return (
    <section
      class={`feedback-state feedback-state-error${props.compact ? " feedback-state-compact" : ""}`}
      role="alert"
    >
      <span
        class="feedback-illustration feedback-illustration-error"
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32">
          <path d="M16 4.75a11.25 11.25 0 1 1 0 22.5 11.25 11.25 0 0 1 0-22.5Z" />
          <path d="M16 10.25v7.25M16 22h.01" />
        </svg>
      </span>
      <h2>{copy().title}</h2>
      <p>{copy().description}</p>
      <Show when={props.onRetry}>
        {(retry) => (
          <button class="feedback-retry" type="button" onClick={retry()}>
            Спробувати ще раз
          </button>
        )}
      </Show>
    </section>
  );
}
