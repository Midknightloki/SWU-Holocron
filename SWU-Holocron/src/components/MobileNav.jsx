import React, { useState } from 'react';
import { LayoutGrid, BarChart3, Swords, Search, User, FileText, Shield, Ticket, RefreshCw, LogOut, LogIn, Cloud, X } from 'lucide-react';

/**
 * Phone navigation: a bottom tab bar for the main destinations (thumb reach,
 * and the header no longer has to fit them), plus a "Me" sheet for the
 * account, sync status and the less-used views. Hidden from md up, where the
 * header carries all of this.
 */
const TABS = [
  { id: 'binder', label: 'Binder', icon: LayoutGrid },
  { id: 'dashboard', label: 'Command Center', icon: BarChart3 },
  { id: 'decks', label: 'Decks', icon: Swords },
];

const TAB = 'flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium';

export default function MobileNav({
  view, onNavigate, onSearch, onLogout, onRedeem, onForceSync, onUpgrade,
  user, isAdmin = false, isContributor = false, dbLabel, syncing = false,
}) {
  const [meOpen, setMeOpen] = useState(false);
  const go = (id) => { setMeOpen(false); onNavigate(id); };
  const act = (fn) => () => { setMeOpen(false); fn(); };
  const sheetItem = 'w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-200 hover:bg-gray-800 rounded-lg';

  return (
    <>
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-gray-900/95 backdrop-blur-md border-t border-gray-800 flex pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            aria-current={view === id ? 'page' : undefined}
            className={`${TAB} ${view === id ? 'text-yellow-400' : 'text-gray-400'}`}
          >
            <Icon size={20} aria-hidden="true" />
            {label}
          </button>
        ))}
        <button type="button" onClick={() => { setMeOpen(false); onSearch(); }} className={`${TAB} text-gray-400`}>
          <Search size={20} aria-hidden="true" />
          Search
        </button>
        <button
          type="button"
          onClick={() => setMeOpen((o) => !o)}
          aria-expanded={meOpen}
          aria-current={['submit', 'admin'].includes(view) ? 'page' : undefined}
          className={`${TAB} ${meOpen || ['submit', 'admin'].includes(view) ? 'text-yellow-400' : 'text-gray-400'}`}
        >
          <User size={20} aria-hidden="true" />
          Me
        </button>
      </nav>

      {meOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setMeOpen(false)}>
          <div
            role="dialog"
            aria-label="Me"
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border-t border-gray-700 rounded-t-2xl p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] space-y-1"
          >
            <div className="flex items-start justify-between px-4 py-2">
              <div className="min-w-0">
                <p className="font-semibold text-white truncate">{user?.displayName || 'Guest user'}</p>
                <p className="text-xs text-gray-400 truncate">{user?.email || 'Anonymous session'}</p>
                <p className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                  <Cloud size={12} className={user?.isAnonymous ? 'text-yellow-500' : 'text-green-500'} aria-hidden="true" />
                  {user?.isAnonymous ? 'Guest mode' : 'Cloud sync active'} · DB synced {dbLabel}
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setMeOpen(false)} className="p-1 text-gray-400">
                <X size={18} />
              </button>
            </div>
            {user?.isAnonymous && onUpgrade && (
              <button type="button" onClick={act(onUpgrade)} className={sheetItem}>
                <LogIn size={18} aria-hidden="true" /> Sign in with Google
              </button>
            )}
            <button type="button" onClick={() => go('submit')} className={sheetItem}>
              <FileText size={18} aria-hidden="true" /> Submit missing card
            </button>
            {(isAdmin || isContributor) && (
              <button type="button" onClick={() => go('admin')} className={sheetItem}>
                <Shield size={18} aria-hidden="true" /> Admin
              </button>
            )}
            {!isContributor && (
              <button type="button" onClick={act(onRedeem)} className={sheetItem}>
                <Ticket size={18} aria-hidden="true" /> Redeem invite
              </button>
            )}
            <button type="button" onClick={act(onForceSync)} disabled={syncing} className={sheetItem}>
              <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} aria-hidden="true" /> Force sync
            </button>
            <button type="button" onClick={act(onLogout)} className={sheetItem}>
              <LogOut size={18} aria-hidden="true" /> Log out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
