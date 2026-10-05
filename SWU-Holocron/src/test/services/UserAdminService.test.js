import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ calls: {}, impl: {} }));
vi.mock('../../firebase', () => ({ isConfigured: true }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: (f, name) => async (data) => { m.calls[name] = data; return m.impl[name](data); },
}));

import { UserAdminService } from '../../services/UserAdminService';

beforeEach(() => { m.calls = {}; m.impl = {}; });

describe('UserAdminService', () => {
  it('calls each function and returns its data', async () => {
    m.impl.adminListUsers = async () => ({ data: { users: [{ uid: 'a' }] } });
    m.impl.adminGetUserDetail = async () => ({ data: { user: { uid: 'a' } } });
    m.impl.adminSetRole = async () => ({ data: { ok: true } });
    expect(await UserAdminService.listUsers({ includeGuests: true })).toEqual({ users: [{ uid: 'a' }] });
    expect(m.calls.adminListUsers).toEqual({ includeGuests: true });
    expect(await UserAdminService.getUserDetail('a')).toEqual({ user: { uid: 'a' } });
    expect(m.calls.adminGetUserDetail).toEqual({ uid: 'a' });
    expect(await UserAdminService.setRole('a', 'isPro', true)).toEqual({ ok: true });
    expect(m.calls.adminSetRole).toEqual({ uid: 'a', role: 'isPro', value: true });
  });

  it('maps errors and never throws', async () => {
    const fail = (code, message = 'x') => async () => { throw Object.assign(new Error(message), { code }); };
    m.impl.adminListUsers = fail('functions/permission-denied');
    expect(await UserAdminService.listUsers()).toEqual({ error: 'Admins only.' });
    m.impl.adminListUsers = fail('functions/not-found');
    expect((await UserAdminService.listUsers()).error).toMatch(/isn't deployed yet/);
    m.impl.adminSetRole = fail('functions/failed-precondition', "Guest accounts can't hold roles.");
    expect(await UserAdminService.setRole('g', 'isPro', true)).toEqual({ error: "Guest accounts can't hold roles." });
    m.impl.adminGetUserDetail = fail('functions/unavailable');
    expect(await UserAdminService.getUserDetail('a')).toEqual({ error: "Couldn't reach the server. Try again." });
  });
});
