import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Which window it guards: decides what a crash shows. */
  window: 'control' | 'broadcast';
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * The Broadcast window has no button to try again: it starts its interface again by itself,
 * after this delay, doubled after each crash up to `BROADCAST_RETRY_MAX_MS`, so a crash that
 * keeps coming back does not flood the log.
 */
export const BROADCAST_RETRY_MS = 1000;
const BROADCAST_RETRY_MAX_MS = 60_000;

/**
 * Catches errors while rendering the window. The Control window shows a short French message
 * with a way to start the interface again instead of a blank window. The Broadcast window shows
 * the players nothing but black: no text, no button; it tries again by itself (see
 * `BROADCAST_RETRY_MS`). The error is printed to the console, which the main process copies
 * to the log file (electron/logging.ts).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  private crashes = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Interface error: ${error.stack ?? error.message}${info.componentStack ?? ''}`);
    if (this.props.window !== 'broadcast') return;
    const delay = Math.min(BROADCAST_RETRY_MS * 2 ** this.crashes, BROADCAST_RETRY_MAX_MS);
    this.crashes++;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.setState({ failed: false }), delay);
  }

  componentWillUnmount() {
    clearTimeout(this.retry);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.window === 'broadcast') return null;
    return (
      <main className="error-screen" role="alert">
        <h1>Un problème est survenu dans cette fenêtre.</h1>
        <p>Les détails sont dans le journal de l'application.</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => this.setState({ failed: false })}
        >
          Réessayer
        </button>
      </main>
    );
  }
}
