import { onSettled } from "solid-js";
import Home from "./routes";
import "./App.css";

export default function App() {
  /**
   * Solid 2 runs `onSettled` after initial reactive activity completes. The
   * real screen is then in the DOM, so the prepaint skeleton can be removed
   * without waiting another frame. Telegram integration is loaded afterwards
   * and cannot delay the first useful content.
   *
   * @see https://github.com/solidjs/solid/discussions/2596
   */
  onSettled(() => {
    document.getElementById("app-skeleton")?.remove();

    let disposed = false;
    let stopTelegram: (() => void) | undefined;

    void import("./api/webapp").then(({ initTelegram }) => {
      if (disposed) return;
      stopTelegram = initTelegram();
    });

    return () => {
      disposed = true;
      stopTelegram?.();
    };
  });

  return <Home />;
}
