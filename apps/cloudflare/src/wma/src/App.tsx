import { Match, onSettled, Switch } from "solid-js";
import Chat from "./routes/chat";
import Home from "./routes/Home";
import { useViewTransitionRouter } from "./shared/navigation/view-transition-router";
import { initTelegramRuntime } from "./telegram/runtime";
import "./App.css";
import "./shared/navigation/view-transition.css";

export default function App() {
  const path = useViewTransitionRouter({
    routes: [
      { path: "/", depth: 0 },
      { path: "/chat", depth: 1 },
    ],
  });
  onSettled(() => initTelegramRuntime());
  const ref = () => new URLSearchParams(location.search).get("ref");

  return (
    <div class="view-transition-viewport">
      <Switch fallback={<Home />}>
        <Match when={path() === "/chat" && ref()}>
          {(chatRef) => <Chat chatRef={chatRef()} />}
        </Match>
      </Switch>
    </div>
  );
}
