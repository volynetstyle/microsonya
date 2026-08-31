import { createMemo, Errored, Loading, Show } from "solid-js";
import { loadChats } from "../api/bootstrap";
import type { WmaChat } from "../api/contracts";
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
      : { day: "2-digit", month: "2-digit" },
  ).format(date);
};

function ChatRow(props: { chat: WmaChat }) {
  return (
    <li class="home-chat-item">
      <a
        class="home-chat-row"
        href={`/chat?ref=${encodeURIComponent(props.chat.ref)}`}
        aria-label={`${props.chat.title}, ${summaryLabel(props.chat.summaryCount)}`}
      >
        <span class="home-chat-avatar" aria-hidden="true">
          {initials(props.chat.title)}
        </span>
        <span class="home-chat-content">
          <span class="home-chat-heading">
            <span class="home-chat-name">{props.chat.title}</span>
            <time class="home-chat-time">
              {lastActivity(props.chat.lastSummaryAt)}
            </time>
          </span>
          <span class="home-chat-preview">
            {summaryLabel(props.chat.summaryCount)}
          </span>
        </span>
      </a>
    </li>
  );
}

export default function Home() {
  const chats = createMemo(async () => loadChats());
  return (
    <main class="screen home-screen">
      <header class="home-header">
        <h1>Ваші чати</h1>
      </header>
      <Errored
        fallback={(error) => (
          <p class="home-status home-status-error">{String(error())}</p>
        )}
      >
        <Loading fallback={<p class="home-status">Завантаження…</p>}>
          <Show
            when={chats().length > 0}
            fallback={
              <p class="home-status">
                Відкрийте застосунок із чату, де є підсумки.
              </p>
            }
          >
            <ul class="home-chat-list">
              {chats().map((chat) => (
                <ChatRow chat={chat} />
              ))}
            </ul>
          </Show>
        </Loading>
      </Errored>
    </main>
  );
}
