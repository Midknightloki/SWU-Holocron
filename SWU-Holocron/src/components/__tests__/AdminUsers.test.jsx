/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listUsers: vi.fn(), getUserDetail: vi.fn(), setRole: vi.fn() }));
vi.mock('../../services/UserAdminService', () => ({ UserAdminService: m }));

import AdminUsers from '../AdminUsers';

const NOW = Date.UTC(2026, 9, 5, 12);
const U = (uid, o = {}) => ({
  uid, email: `${uid}@x.com`, displayName: o.name ?? uid, provider: o.provider ?? 'google',
  createdAt: Date.UTC(2026, 0, 1), lastSignInAt: NOW - 3600e3, lastActiveAt: o.active ?? NOW - 3600e3,
  roles: { isAdmin: false, isContributor: false, isPro: false, ...o.roles },
});
const USERS = [U('loki', { name: 'Loki', roles: { isAdmin: true, isPro: true } }), U('bob', { name: 'Bob', roles: { isPro: true } }), U('cara', { name: 'Cara' })];
const DETAIL = {
  user: USERS[2],
  collection: { unique: 120, total: 300, lastChangedAt: NOW - 7200e3 },
  batches: { count: 2, latest: { name: 'eBay SOR box', createdAt: NOW - 86400e3, cards: 384 } },
  decks: { count: 3 },
  scans: { lastDay: '2026-10-04', count: 40 },
  roleChanges: [{ role: 'isPro', from: true, to: false, byEmail: 'loki@x.com', at: NOW - 86400e3 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.listUsers.mockResolvedValue({ users: USERS });
  m.getUserDetail.mockResolvedValue(DETAIL);
  m.setRole.mockResolvedValue({ ok: true });
});

const renderTab = () => render(<AdminUsers now={() => NOW} />);

describe('AdminUsers', () => {
  it('lists users with roles and counts, and searches and filters them', async () => {
    renderTab();
    expect(await screen.findByRole('button', { name: /Bob/ })).toBeInTheDocument();
    expect(screen.getByText('3 users · 2 Pro · 0 contributors')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'car' } });
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Role filter'), { target: { value: 'admin' } });
    expect(screen.getByRole('button', { name: /Loki/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cara/ })).not.toBeInTheDocument();
  });

  it('reloads with guests when asked', async () => {
    renderTab();
    await screen.findByRole('button', { name: /Bob/ });
    fireEvent.click(screen.getByLabelText('Show guests'));
    await waitFor(() => expect(m.listUsers).toHaveBeenLastCalledWith({ includeGuests: true }));
  });

  it('shows a user’s activity and role history', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Cara/ }));
    const panel = await screen.findByRole('region', { name: 'User details' });
    await waitFor(() => expect(within(panel).getByText(/120 unique · 300 cards/)).toBeInTheDocument());
    expect(within(panel).getByText(/eBay SOR box \(384 cards/)).toBeInTheDocument();
    expect(within(panel).getByText(/last scanned 2026-10-04 \(40\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/Pro removed by loki@x.com/)).toBeInTheDocument();
    expect(m.getUserDetail).toHaveBeenCalledWith('cara');
  });

  it('confirms before granting Pro, then saves and refreshes', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Cara/ }));
    const panel = await screen.findByRole('region', { name: 'User details' });
    fireEvent.click(await within(panel).findByLabelText('Pro'));
    expect(m.setRole).not.toHaveBeenCalled();
    expect(within(panel).getByText('Make Cara Pro?')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(m.setRole).toHaveBeenCalledWith('cara', 'isPro', true));
    expect(await within(panel).findByText('Cara sees the change next time they open the app.')).toBeInTheDocument();
    expect(m.getUserDetail).toHaveBeenCalledTimes(2);
    expect(m.listUsers).toHaveBeenCalledTimes(2);
  });

  it('keeps Admin read-only and disables roles for guests', async () => {
    const guest = U('g1', { name: 'Guest one', provider: 'guest' });
    m.listUsers.mockResolvedValue({ users: [...USERS, guest] });
    m.getUserDetail.mockResolvedValueOnce({ ...DETAIL, user: USERS[0] });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Loki/ }));
    const panel = await screen.findByRole('region', { name: 'User details' });
    expect(await within(panel).findByText('Admin is changed in the Firebase console')).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Admin')).not.toBeInTheDocument();
    m.getUserDetail.mockResolvedValueOnce({ ...DETAIL, user: guest });
    fireEvent.click(screen.getByRole('button', { name: /Guest one/ }));
    await waitFor(() => expect(within(panel).getByLabelText('Pro')).toBeDisabled());
    expect(within(panel).getByText("Guest accounts can't hold roles.")).toBeInTheDocument();
  });

  it('never lets a late reply for another row replace the user on screen', async () => {
    let lateBob;
    m.getUserDetail.mockImplementation((uid) => (uid === 'bob'
      ? new Promise((r) => { lateBob = () => r({ ...DETAIL, user: USERS[1] }); })
      : Promise.resolve(DETAIL)));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cara/ }));
    const panel = await screen.findByRole('region', { name: 'User details' });
    await within(panel).findByText('Cara');
    lateBob();
    await new Promise((r) => setTimeout(r, 0));
    expect(within(panel).queryByText('Bob')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByLabelText('Pro'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(m.setRole).toHaveBeenCalledWith('cara', 'isPro', true));
  });

  it('stops loading when a user cannot be read, and clears the error after a good load', async () => {
    m.getUserDetail.mockResolvedValueOnce({ error: 'The server hit an error. Check the function logs.' });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Cara/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server hit an error');
    const panel = screen.getByRole('region', { name: 'User details' });
    expect(within(panel).queryByText('Loading…')).not.toBeInTheDocument();
    expect(within(panel).getByText("Couldn't load this user.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cara/ }));
    await within(panel).findByText(/120 unique/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows errors from the server', async () => {
    m.listUsers.mockResolvedValue({ error: 'Admins only.' });
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.');
  });
});
