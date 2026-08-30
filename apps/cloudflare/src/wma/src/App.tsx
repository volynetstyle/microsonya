import { createSignal, Match, onSettled, Switch } from "solid-js";
import { loadChats } from "./api/bootstrap";
import type { WmaChat } from "./api/contracts";
import Home from "./routes";
import { initTelegramRuntime } from "./telegram/runtime";
import { useViewTransitionRouter } from "./shared/navigation/view-transition-router";
import "./App.css";
import "./shared/navigation/view-transition.css";
const routes = [
  { path: "/", depth: 0 },
  { path: "/summary", depth: 1 },
] as const;

export default function App() {
  const pathname = useViewTransitionRouter({ routes });
  const [chats, setChats] = createSignal<readonly WmaChat[]>();

  onSettled(() => {
    void loadChats().then(setChats);
    return initTelegramRuntime();
  });

  const selected = () => {
    try {
      return JSON.parse(
        sessionStorage.getItem("microsonya.wma.selected-chat") ?? "",
      ) as WmaChat;
    } catch {
      return undefined;
    }
  };

  return (
    <div class="view-transition-viewport">
      <Switch
        fallback={
          <main class="screen">
            <header class="chat-header">
              <span class="chat-title">Ваші чати</span>
            </header>
            <div class="chat-list">
              {chats()?.map((chat) => (
                <a
                  class="chat-row"
                  href="/summary"
                  onClick={() =>
                    sessionStorage.setItem(
                      "microsonya.wma.selected-chat",
                      JSON.stringify(chat),
                    )
                  }
                >
                  <span>{chat.title}</span>
                  <small>{chat.summaryCount} підсумків</small>
                </a>
              ))}
            </div>
          </main>
        }
      >
        <Match when={pathname() === "/summary" && selected()}>
          {(chat) => <Home chat={chat()} onBack={() => history.back()} />}
        </Match>
      </Switch>
    </div>
  );
}
