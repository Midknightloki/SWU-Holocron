import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

/**
 * ErrorBoundary — keeps one broken component from blanking the whole app.
 *
 * Without this, any render error anywhere unmounts the entire tree and the user
 * gets a white page with no way out but a manual reload. React only surfaces
 * render errors through the class lifecycle, so this cannot be a hook.
 *
 * What it does NOT catch, by design, because React does not route them here:
 * errors thrown in event handlers, in promises, in `setTimeout`, or during
 * server-side rendering. Those need their own try/catch at the call site.
 *
 * Give it a `key` that changes when the user navigates. React then remounts it,
 * which clears the error without any reset plumbing — see `App.jsx`, where the
 * key is the current view.
 *
 * @environment:react
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The only record of what happened: there is no error reporting service.
    console.error(
      `ErrorBoundary caught an error${this.props.label ? ` in ${this.props.label}` : ''}:`,
      error,
      info?.componentStack
    );
    this.props.onError?.(error, info);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    // @environment:web
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const where = this.props.label ? ` in ${this.props.label}` : '';

    return (
      <div className="flex items-center justify-center p-6 min-h-[50vh]">
        <div className="w-full max-w-lg bg-gray-900 border border-red-500/40 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-red-400 flex-shrink-0" size={22} />
            <h2 className="text-lg font-bold text-white">Something broke{where}</h2>
          </div>

          <p className="text-sm text-gray-400">
            The rest of the app is still running. Try again, or reload if it keeps
            happening — your collection is stored server-side and is not affected.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg text-sm"
            >
              <RotateCcw size={14} /> Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 rounded-lg text-sm"
            >
              <RefreshCw size={14} /> Reload the app
            </button>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-300">
              Technical details
            </summary>
            <pre className="mt-2 p-3 bg-gray-950 border border-gray-800 rounded-lg text-red-300 overflow-x-auto whitespace-pre-wrap">
              {error.message || String(error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
