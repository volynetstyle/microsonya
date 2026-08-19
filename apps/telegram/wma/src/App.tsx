import { createEffect, Loading } from 'solid-js';
import { Router } from './router';
import { initTelegram } from './telegram/webapp';
import './App.css';

// The app root: the router lives here. A single screen for now (see
// src/routes/index.tsx) — more routes come back once there's a reason to
// navigate away from it.
export default function App() {
  // solid-js 2.0 dropped onMount as a separate export in favor of
  // createEffect's compute/effect split — an empty (non-tracking) compute
  // phase makes the effect phase run exactly once, same as onMount did.
  createEffect(
    () => {},
    () => initTelegram(),
  );

  return (
    <Router>
      {/* No visible fallback: the static #app-skeleton in Document.tsx
          already covers this gap (and started covering it before this
          bundle even loaded), so a second loading state here would just
          flash behind/after it. */}
      {(props) => <Loading fallback={null}>{props.children}</Loading>}
    </Router>
  );
}
