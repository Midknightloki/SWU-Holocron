import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { UserAdminService } from '../services/UserAdminService';

/**
 * Admin console: users, their activity, and the Pro / Contributor roles.
 * Everything goes through admin-only Cloud Functions (functions/adminUsers.js);
 * Admin itself is changed only in the Firebase console.
 */
const ROLE_LABEL = { isPro: 'Pro', isContributor: 'Contributor' };
const nameOf = (u) => u.displayName || u.email || u.uid;
const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—');

function ago(ms, now) {
  if (!ms) return '—';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return dateOf(ms);
}

function RoleBadges({ roles }) {
  return (
    <>
      {roles.isAdmin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/30 text-red-300">Admin</span>}
      {roles.isPro && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-600/30 text-yellow-300">Pro</span>}
      {roles.isContributor && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-600/30 text-purple-300">Contributor</span>}
    </>
  );
}

export default function AdminUsers({ now = () => Date.now() }) {
  const [users, setUsers] = useState([]);
  const [includeGuests, setIncludeGuests] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  // { role, value } awaiting Confirm.
  const [confirming, setConfirming] = useState(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);

  const loadUsers = useCallback(async () => {
    const res = await UserAdminService.listUsers({ includeGuests });
    if (res?.error) setError(res.error);
    else { setError(null); setUsers(res.users ?? []); }
  }, [includeGuests]);

  const loadDetail = useCallback(async (uid) => {
    const res = await UserAdminService.getUserDetail(uid);
    if (res?.error) setError(res.error);
    else setDetail(res);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (q && ![u.email, u.displayName, u.uid].some((v) => v?.toLowerCase().includes(q))) return false;
      if (roleFilter === 'pro') return u.roles.isPro;
      if (roleFilter === 'contributor') return u.roles.isContributor;
      if (roleFilter === 'admin') return u.roles.isAdmin;
      return true;
    });
  }, [users, search, roleFilter]);

  const open = (uid) => {
    setSelected(uid);
    setDetail(null);
    setConfirming(null);
    setNote(null);
    loadDetail(uid);
  };

  const save = async () => {
    const { role, value } = confirming;
    setSaving(true);
    const res = await UserAdminService.setRole(selected, role, value);
    setSaving(false);
    setConfirming(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setNote(`${nameOf(detail.user)} sees the change next time they open the app.`);
    await Promise.all([loadDetail(selected), loadUsers()]);
  };

  const t = now();
  const proCount = users.filter((u) => u.roles.isPro).length;
  const contribCount = users.filter((u) => u.roles.isContributor).length;
  const user = detail?.user;
  const guest = user?.provider === 'guest';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" aria-hidden="true" />
          <input
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email, name or uid"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          aria-label="Role filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="pro">Pro</option>
          <option value="contributor">Contributor</option>
          <option value="admin">Admin</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={includeGuests} onChange={(e) => setIncludeGuests(e.target.checked)} />
          Show guests
        </label>
      </div>
      <p className="text-sm text-gray-400">
        {users.length} users · {proCount} Pro · {contribCount} contributors
      </p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <ul className="space-y-1">
          {shown.map((u) => (
            <li key={u.uid}>
              <button
                type="button"
                aria-label={nameOf(u)}
                onClick={() => open(u.uid)}
                className={`w-full text-left rounded-lg px-3 py-2 border ${selected === u.uid ? 'border-yellow-500 bg-gray-800' : 'border-gray-800 bg-gray-900 hover:bg-gray-800'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium text-gray-100 truncate">{nameOf(u)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{u.provider === 'guest' ? 'Guest' : 'Google'}</span>
                  <RoleBadges roles={u.roles} />
                </span>
                <span className="block text-xs text-gray-500">
                  Joined {dateOf(u.createdAt)} · active {ago(u.lastActiveAt, t)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <section role="region" aria-label="User details" className="rounded-xl bg-gray-800 border border-gray-700 p-4 space-y-3 text-sm">
            {!detail ? (
              <p className="text-gray-400">Loading…</p>
            ) : (
              <>
                <div>
                  <p className="text-lg font-bold text-white">{nameOf(user)}</p>
                  <p className="text-xs text-gray-400">{user.email ?? user.uid} · joined {dateOf(user.createdAt)} · active {ago(user.lastActiveAt, t)}</p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-gray-400">Collection</dt>
                  <dd>
                    {detail.collection.unique} unique · {detail.collection.total} cards
                    {' · '}last change {detail.collection.lastChangedAt ? ago(detail.collection.lastChangedAt, t) : '—'}
                  </dd>
                  <dt className="text-gray-400">Batches</dt>
                  <dd>
                    {detail.batches.count}
                    {detail.batches.latest && ` · latest: ${detail.batches.latest.name} (${detail.batches.latest.cards} cards, ${dateOf(detail.batches.latest.createdAt)})`}
                  </dd>
                  <dt className="text-gray-400">Decks</dt>
                  <dd>{detail.decks.count}</dd>
                  <dt className="text-gray-400">Scans</dt>
                  <dd>{detail.scans ? `last scanned ${detail.scans.lastDay} (${detail.scans.count})` : 'never'}</dd>
                </dl>

                <div className="space-y-2">
                  <p className="font-semibold text-white">Roles</p>
                  {Object.entries(ROLE_LABEL).map(([role, label]) => (
                    <label key={role} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={label}
                        checked={user.roles[role]}
                        disabled={guest || saving}
                        onChange={(e) => { setNote(null); setConfirming({ role, value: e.target.checked }); }}
                      />
                      {label}
                    </label>
                  ))}
                  {guest && <p className="text-xs text-gray-400">Guest accounts can&apos;t hold roles.</p>}
                  {user.roles.isAdmin && (
                    <p className="text-xs text-gray-400">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/30 text-red-300 mr-2">Admin</span>
                      Admin is changed in the Firebase console
                    </p>
                  )}
                  {confirming && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-900 p-2">
                      <span>
                        {confirming.value
                          ? `Make ${nameOf(user)} ${ROLE_LABEL[confirming.role]}?`
                          : `Remove ${ROLE_LABEL[confirming.role]} from ${nameOf(user)}?`}
                      </span>
                      <button type="button" disabled={saving} onClick={save} className="px-3 py-1 rounded bg-yellow-500 text-black font-semibold">Confirm</button>
                      <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1 rounded bg-gray-700">Cancel</button>
                    </div>
                  )}
                  {note && <p className="text-xs text-green-400">{note}</p>}
                </div>

                {detail.roleChanges?.length > 0 && (
                  <div>
                    <p className="font-semibold text-white">Recent role changes</p>
                    <ul className="text-xs text-gray-400 space-y-0.5">
                      {detail.roleChanges.map((c) => (
                        <li key={`${c.role}-${c.at}`}>
                          {ROLE_LABEL[c.role] ?? c.role} {c.to ? 'granted' : 'removed'} by {c.byEmail ?? c.byUid} · {dateOf(c.at)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
