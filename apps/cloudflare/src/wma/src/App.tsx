import {
  createMemo,
  Errored,
  Loading,
  Match,
  onSettled,
  Show,
  Switch,
} from "solid-js";
import { loadChats } from "./api/bootstrap";
import Chat from "./routes/chat";
import { initTelegramRuntime } from "./telegram/runtime";
import { useViewTransitionRouter } from "./shared/navigation/view-transition-router";
import "./App.css";
import "./shared/navigation/view-transition.css";

export default function App() {
  const path = useViewTransitionRouter({
    routes: [
      { path: "/", depth: 0 },
      { path: "/chat", depth: 1 },
    ],
  });
  const chats = createMemo(async () => loadChats());

  onSettled(() => initTelegramRuntime());

  const ref = () => new URLSearchParams(location.search).get("ref");

  return (
    <div class="view-transition-viewport">
      <Switch
        fallback={
          <main class="screen">
            <header class="chat-header">
              <span class="chat-title">Ваші чати</span>
            </header>
            <Errored fallback={(e) => <p>{String(e())}</p>}>
              <Loading fallback={<p>Завантаження…</p>}>
                <div class="chat-list">
                  <Show
                    when={chats().length > 0}
                    fallback={
                      <p class="chat-list-empty">
                        Відкрийте застосунок із чату, де є підсумки.
                      </p>
                    }
                  >
                    {chats().map((chat) => (
                      <a
                        class="chat-row"
                        href={`/chat?ref=${encodeURIComponent(chat.ref)}`}
                      >
                        <span>{chat.title}</span>
                        <small>{chat.summaryCount} підсумків</small>
                      </a>
                    ))}
                  </Show>
                </div>
              </Loading>
            </Errored>
          </main>
        }
      >
        <Match when={path() === "/chat" && ref()}>
          {(chatRef) => <Chat chatRef={chatRef()} />}
        </Match>
      </Switch>
    </div>
  );
}
