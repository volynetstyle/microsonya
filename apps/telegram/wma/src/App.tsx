import { Match, onSettled, Switch } from "solid-js";
import Home from "./routes";
import PrimitiveDemo from "./routes/demo";
import { useViewTransitionRouter } from "./shared/navigation/view-transition-router";
import "./App.css";
import "./shared/navigation/view-transition.css";

const routes = [
  { path: "/", depth: 0 },
  { path: "/demo", depth: 1 },
] as const;

function preserveTelegramContext(target: URL): URL {
  const current = new URL(location.href);
  const hash = new URLSearchParams(current.hash.slice(1));
  if ([...hash.keys()].some((key) => key.startsWith("tgWebApp"))) {
    target.hash = current.hash;
  }
  const startParam = current.searchParams.get("tgWebAppStartParam");
  if (startParam && !target.searchParams.has("tgWebAppStartParam")) {
    target.searchParams.set("tgWebAppStartParam", startParam);
  }
  return target;
}

export default function App() {
  const pathname = useViewTransitionRouter({
    routes,
    transformUrl: preserveTelegramContext,
  });

  onSettled(() => {
    document.getElementById("app-skeleton")?.remove();
    let disposed = false;
    let stopTelegram: (() => void) | undefined;

    void import("./api/webapp").then(({ initTelegram }) => {
      if (!disposed) stopTelegram = initTelegram();
    });

    return () => {
      disposed = true;
      stopTelegram?.();
    };
  });

  return (
    <div class="view-transition-viewport">
      <Switch fallback={<Home />}>
        <Match when={pathname() === "/demo"}>
          <PrimitiveDemo />
        </Match>
      </Switch>
    </div>
  );
}
