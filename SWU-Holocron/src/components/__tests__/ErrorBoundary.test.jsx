/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from '../ErrorBoundary';

function Boom({ message = 'kaboom' }) {
  throw new Error(message);
}

/**
 * Throws while the test says to, so "Try again" has something to succeed at.
 *
 * The flag is owned by the test rather than by the component: React re-invokes a
 * failing render to rebuild its stack trace, so a fixture that clears its own
 * flag on the way out heals before the boundary ever sees the error.
 */
function BoomWhile({ flag }) {
  if (flag.boom) throw new Error('still broken');
  return <p>recovered</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught errors to console.error itself, and so does the
    // boundary. Neither is a test failure, so keep the output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('all fine')).toBeInTheDocument();
  });

  it('should show the fallback instead of unmounting the tree', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something broke/)).toBeInTheDocument();
  });

  it('should name where it broke when given a label', () => {
    render(
      <ErrorBoundary label="the deck builder">
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something broke in the deck builder')).toBeInTheDocument();
  });

  it('should surface the error message in the details', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Cannot read properties of undefined')).toBeInTheDocument();
  });

  it('should log the error, since nothing else records it', () => {
    render(
      <ErrorBoundary label="the binder">
        <Boom />
      </ErrorBoundary>
    );

    expect(console.error).toHaveBeenCalled();
    const logged = console.error.mock.calls.map(c => String(c[0])).join(' ');
    expect(logged).toContain('the binder');
  });

  it('should call onError so a caller can react', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom message="reported" />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'reported' }),
      expect.anything()
    );
  });

  it('should render a custom fallback when one is given', () => {
    render(
      <ErrorBoundary fallback={<p>custom fallback</p>}>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('custom fallback')).toBeInTheDocument();
    expect(screen.queryByText(/Something broke/)).not.toBeInTheDocument();
  });

  it('should re-render the children when Try again is clicked', async () => {
    const user = userEvent.setup();
    const flag = { boom: true };

    render(
      <ErrorBoundary>
        <BoomWhile flag={flag} />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something broke/)).toBeInTheDocument();

    flag.boom = false;
    await user.click(screen.getByRole('button', { name: /Try again/ }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByText(/Something broke/)).not.toBeInTheDocument();
  });

  it('should offer a reload as the escape hatch', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /Reload the app/ })).toBeInTheDocument();
  });

  // This is how App.jsx clears an error: the boundary is keyed on the current
  // view, so navigating remounts it. Without that, a crashed view stays crashed.
  it('should reset when its key changes', () => {
    const { rerender } = render(
      <ErrorBoundary key="binder">
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something broke/)).toBeInTheDocument();

    rerender(
      <ErrorBoundary key="decks">
        <p>the decks view</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('the decks view')).toBeInTheDocument();
    expect(screen.queryByText(/Something broke/)).not.toBeInTheDocument();
  });
});
