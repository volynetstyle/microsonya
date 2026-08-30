import { createSignal, onSettled, Show } from "solid-js";
import { loadBootstrap } from "../api/bootstrap";
import type { WmaBootstrap, WmaChat } from "../api/contracts";
import TopicCard from "../components/TopicCard";
import * as Accordion from "../shared/accordion";
import "./Home.css";

export default function Home(props: { chat: WmaChat; onBack(): void }) {
  const [bootstrap, setBootstrap] = createSignal<WmaBootstrap>();
  onSettled(() => {
    void loadBootstrap(props.chat.id).then(setBootstrap);
  });
  return (
    <main class="screen">
      <header class="chat-header">
        <button class="back-button" onClick={props.onBack}>
          ‹
        </button>
        <span class="chat-title">
          {bootstrap()?.chat.title ?? props.chat.title}
        </span>
        <span class="chat-total">
          {bootstrap()?.totalMessages ?? 0} повідомлень
        </span>
      </header>
      <Show when={bootstrap()}>
        {(data) => (
          <Accordion.Root
            class="topic-list"
            defaultValue={data().topics[0]?.id}
          >
            {data().topics.map((topic) => (
              <TopicCard topic={topic} />
            ))}
          </Accordion.Root>
        )}
      </Show>
    </main>
  );
}
