import React, { useState } from 'react';
import { KeyRound, Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { GuidedModeService } from '../services/GuidedModeService';

/**
 * Contributor invite redemption.
 *
 * An admin issues a code; the invitee enters it here. The grant itself happens
 * server-side in the redeemInviteCode Cloud Function, because firestore.rules
 * forbids a client from writing the role fields — when the client could write
 * them, any account was able to make itself an administrator.
 *
 * Errors are shown rather than swallowed. The previous flow applied invites
 * silently at login behind a `.catch(() => {})`, so a failed redemption was
 * indistinguishable from never having been invited.
 *
 * @environment:react @environment:firebase
 */
export default function RedeemInviteModal({ onClose, onRedeemed, isAnonymous }) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (status === 'working') return;

    setStatus('working');
    setMessage('');

    try {
      await GuidedModeService.redeemInviteCode(code);
      setStatus('done');
      setMessage('Contributor access granted.');
      onRedeemed?.();
    } catch (error) {
      setStatus('error');
      // The function returns the same message for an unknown code and an
      // already-claimed one, so this cannot be used to probe which codes exist.
      setMessage(error?.message || 'Could not redeem that code.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="redeem-invite-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-yellow-500" />
            <h2 id="redeem-invite-title" className="text-sm font-semibold text-gray-100">
              Redeem contributor invite
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 transition-colors hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {isAnonymous ? (
          <p className="text-xs leading-relaxed text-gray-400">
            Guest sessions cannot become contributors. Sign in with Google first,
            then redeem your code.
          </p>
        ) : status === 'done' ? (
          <div className="flex items-start gap-2 text-xs text-green-400">
            <CheckCircle2 size={16} className="mt-px shrink-0" />
            <p>{message} You may need to reload for new options to appear.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="invite-code" className="mb-1.5 block text-[11px] font-medium text-gray-400">
              Invite code
            </label>
            <input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. HOLOCRON-4F2A"
              autoComplete="off"
              autoFocus
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-500/50 focus:outline-none"
            />

            {status === 'error' && (
              <div className="mt-2 flex items-start gap-2 text-xs text-red-400">
                <AlertCircle size={14} className="mt-px shrink-0" />
                <p>{message}</p>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!code.trim() || status === 'working'}
                className="flex items-center gap-1.5 rounded-lg bg-yellow-600 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === 'working' && <Loader2 size={13} className="animate-spin" />}
                {status === 'working' ? 'Redeeming…' : 'Redeem'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
