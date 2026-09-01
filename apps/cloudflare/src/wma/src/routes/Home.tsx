import {
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  Show,
} from "solid-js";
import { loadChats } from "../api/bootstrap";
import type { WmaChat } from "../api/contracts";
import { fixtureHref } from "../api/fixtures";
import {
  EmptyState,
  ErrorState,
  HomeSkeleton,
} from "../components/AsyncStates";
import "./Home.css";

const initials = (title: string) =>
  title
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("uk-UA");

const summaryLabel = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} підсумок`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${count} підсумки`;
  return `${count} підсумків`;
};

const lastActivity = (timestamp: number | null) => {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(
    "uk-UA",
    isToday
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short" },
  ).format(date);
};

function ChatRow(props: { chat: WmaChat }) {
  return (
    <li class="home-chat-item">
      <a
        class="home-chat-row"
        href={fixtureHref(`/chat?ref=${encodeURIComponent(props.chat.ref)}`)}
        aria-label={`${props.chat.title}, ${summaryLabel(props.chat.summaryCount)}`}
      >
        <span class="home-chat-avatar" aria-hidden="true">
          {initials(props.chat.title)}
        </span>
        <span class="home-chat-content">
          <span class="home-chat-heading">
            <span class="home-chat-name">{props.chat.title}</span>
            <Show when={props.chat.lastSummaryAt}>
              <time
                class="home-chat-time"
                datetime={new Date(props.chat.lastSummaryAt!).toISOString()}
              >
                {lastActivity(props.chat.lastSummaryAt)}
              </time>
            </Show>
          </span>
          <span class="home-chat-preview">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.25 3.75h9.5v6.5h-4.1L5.5 12.5v-2.25H3.25z" />
            </svg>
            {summaryLabel(props.chat.summaryCount)}
          </span>
        </span>
        <svg class="home-chat-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6.25 3.5 4.5 4.5-4.5 4.5" />
        </svg>
      </a>
    </li>
  );
}

export default function Home() {
  const [reloadKey, setReloadKey] = createSignal(0);
  const chats = createMemo(async () => {
    reloadKey();
    return loadChats();
  });

  return (
    <main class="screen home-screen">
      <header class="app-header home-header">
        <span class="home-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M22.9 6.4A10.8 10.8 0 1 0 25.6 21 9 9 0 0 1 22.9 6.4Z" />
            <path d="m15.75 10.5.8 1.85 1.95.8-1.95.8-.8 1.85-.8-1.85-1.95-.8 1.95-.8.8-1.85Z" />
          </svg>
        </span>
        <span class="home-header-copy">
          <span class="home-kicker">MICROSONYA</span>
          <h1>Підсумки</h1>
        </span>
        <span class="home-header-note">Головне з ваших чатів</span>
      </header>

      <section class="home-content" aria-labelledby="home-chats-heading">
        <div class="section-heading home-section-heading">
          <h2 id="home-chats-heading">Ваші розмови</h2>
          <span>Останні спочатку</span>
        </div>
        <Errored
          fallback={(error) => (
            <ErrorState
              error={error()}
              onRetry={() => setReloadKey((key) => key + 1)}
            />
          )}
        >
          <Loading fallback={<HomeSkeleton />}>
            <Show
              when={chats().length > 0}
              fallback={
                <EmptyState
                  title="Підсумків поки немає"
                  description="Додайте Microsonya до групового чату. Щойно з’явиться перший підсумок, він буде тут."
                />
              }
            >
              <ul class="home-chat-list">
                <For each={chats()}>{(chat) => <ChatRow chat={chat} />}</For>
              </ul>
            </Show>
          </Loading>
        </Errored>
      </section>
    </main>
  );
}
