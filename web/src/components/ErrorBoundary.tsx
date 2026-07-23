import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error('Render error caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-slate-300">
          <p className="text-lg font-semibold text-red-400">Something went wrong</p>
          <p className="max-w-sm text-sm text-slate-400">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
