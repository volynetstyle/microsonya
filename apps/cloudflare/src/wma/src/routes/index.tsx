import TopicCard from "../components/TopicCard";
import { mockChat } from "../mock/chat";
import * as Accordion from "../shared/accordion";
import { getTelegramChatTitle } from "../api/chat-context";
import "./Home.css";

export default function Home() {
  // Telegram launch data is immutable during a Mini App session. A plain
  // value avoids creating computations for data that can never change.
  const telegramChatTitle = getTelegramChatTitle(
    typeof window === "undefined" ? undefined : window.Telegram?.WebApp,
  );
  const visibleChatTitle = telegramChatTitle ?? mockChat.chatName;

  return (
    <main class="screen">
      <header class="chat-header">
        <a class="demo-link" href="/demo">Primitive demo</a>
        <span class="chat-title">
          {visibleChatTitle} · {mockChat.date}
        </span>
        <span class="chat-total">{mockChat.totalMessages} повідомлень</span>
      </header>

      <Accordion.Root class="topic-list" defaultValue={mockChat.topics[0]?.id}>
        {mockChat.topics.map((topic) => (
          <TopicCard topic={topic} />
        ))}
      </Accordion.Root>
    </main>
  );
}
