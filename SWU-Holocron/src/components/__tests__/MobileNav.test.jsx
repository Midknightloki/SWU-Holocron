/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import MobileNav from '../MobileNav';

const props = (o = {}) => ({
  view: 'binder',
  onNavigate: vi.fn(),
  onSearch: vi.fn(),
  onLogout: vi.fn(),
  onRedeem: vi.fn(),
  onForceSync: vi.fn(),
  user: { displayName: 'Loki', email: 'loki@x.com', isAnonymous: false },
  isAdmin: false,
  isContributor: false,
  dbLabel: '3 h ago',
  ...o,
});

describe('MobileNav', () => {
  it('has the five destinations and marks the current one', () => {
    render(<MobileNav {...props({ view: 'dashboard' })} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Binder', 'Command Center', 'Decks', 'Search', 'Me']);
    expect(within(nav).getByRole('button', { name: 'Command Center' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Binder' })).not.toHaveAttribute('aria-current');
  });

  it('navigates, and opens search', () => {
    const p = props();
    render(<MobileNav {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decks' }));
    expect(p.onNavigate).toHaveBeenCalledWith('decks');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(p.onSearch).toHaveBeenCalled();
  });

  it('opens Me with the account, sync status and the views that left the header', () => {
    const p = props({ isAdmin: true });
    render(<MobileNav {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    const sheet = screen.getByRole('dialog', { name: 'Me' });
    expect(within(sheet).getByText('loki@x.com')).toBeInTheDocument();
    expect(within(sheet).getByText(/Cloud sync active/)).toBeInTheDocument();
    expect(within(sheet).getByText(/DB synced 3 h ago/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Admin' }));
    expect(p.onNavigate).toHaveBeenCalledWith('admin');
    expect(screen.queryByRole('dialog', { name: 'Me' })).not.toBeInTheDocument();
  });

  it('shows Submit to everyone, Admin only to admins and contributors, Redeem only to non-contributors', () => {
    const p = props();
    render(<MobileNav {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    const sheet = screen.getByRole('dialog', { name: 'Me' });
    expect(within(sheet).queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Submit missing card' }));
    expect(p.onNavigate).toHaveBeenCalledWith('submit');
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redeem invite' }));
    expect(p.onRedeem).toHaveBeenCalled();
  });

  it('logs out and force-syncs from Me', () => {
    const p = props({ user: { isAnonymous: true } });
    render(<MobileNav {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    expect(screen.getByText(/Guest mode/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Force sync' }));
    expect(p.onForceSync).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(p.onLogout).toHaveBeenCalled();
  });

  it('offers guests a Google sign-in that keeps their collection', () => {
    const onUpgrade = vi.fn();
    render(<MobileNav {...props({ user: { isAnonymous: true }, onUpgrade })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it('does not offer it to a Google user', () => {
    render(<MobileNav {...props({ onUpgrade: vi.fn() })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });
});
