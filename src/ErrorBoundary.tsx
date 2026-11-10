import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/**
 * Catches errors while rendering the window: shows a short French message with a way to
 * start the interface again instead of a blank window. The error is printed to the console,
 * which the main process copies to the log file (electron/logging.ts).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Interface error: ${error.stack ?? error.message}${info.componentStack ?? ''}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
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
