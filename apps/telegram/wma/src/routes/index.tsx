import { createEffect, createSignal, For } from "solid-js";
import { Title } from "@solidjs/meta";
import { mockChat } from "../mock/chat";
import TopicCard from "../components/TopicCard";
import * as Accordion from "../shared/accordion";
import { getTelegramChatTitle } from "../telegram/chat-context";

export default function Home() {
  const [expandedTopicId, setExpandedTopicId] = createSignal<string | null>(
    mockChat.topics[0]?.id ?? null,
  );
  const telegramChatTitle = () =>
    getTelegramChatTitle(
      typeof window === "undefined" ? undefined : window.Telegram?.WebApp,
    );
  const pageTitle = () => telegramChatTitle() ?? "Microsonya";
  const visibleChatTitle = () => telegramChatTitle() ?? mockChat.chatName;

  // Dismiss Document.tsx's static pre-hydration skeleton now that this
  // route's real content has actually rendered — one rAF late, so the
  // browser has painted this content before the overlay covering it
  // disappears (removing it in the same tick risks a blank frame between
  // the two if the paint hasn't happened yet).
  createEffect(
    () => {},
    () => {
      requestAnimationFrame(() => {
        document.getElementById("app-skeleton")?.remove();
      });
    },
  );

  return (
    <main class="screen">
      <Title>{pageTitle()}</Title>
      <header class="chat-header">
        <span class="chat-title">
          {visibleChatTitle()} · {mockChat.date}
        </span>
        <span class="chat-total">{mockChat.totalMessages} повідомлень</span>
      </header>

      <Accordion.Root
        class="topic-list"
        value={expandedTopicId()}
        onValueChange={(value) =>
          setExpandedTopicId(typeof value === "string" ? value : null)
        }
      >
        <For each={mockChat.topics}>
          {(topic) => <TopicCard topic={topic} />}
        </For>
      </Accordion.Root>
    </main>
  );
}
