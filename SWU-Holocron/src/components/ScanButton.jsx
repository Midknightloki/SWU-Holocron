import React from 'react';
import { ScanLine, Lock } from 'lucide-react';

/**
 * Header entry point for the card scanner. Guests never see it: scanning needs
 * a durable account, and the server rejects anonymous callers anyway. Signed-in
 * users without Pro see it locked, so the feature is discoverable.
 *
 * @environment:react
 */
export default function ScanButton({ isAnonymous, canScan, onOpen }) {
  if (isAnonymous) return null;
  const label = canScan ? 'Scan cards' : 'Card scanning is a Pro feature';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!canScan}
      aria-label={label}
      title={label}
      className="relative flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all border border-gray-700 hover:border-yellow-500/50 disabled:opacity-50 disabled:hover:bg-gray-800 disabled:hover:border-gray-700 disabled:cursor-not-allowed"
    >
      <ScanLine className="text-yellow-500" size={18} />
      {!canScan && <Lock size={10} className="absolute top-1 right-1 text-gray-400" aria-hidden="true" />}
      <span className="text-sm font-medium hidden lg:inline">Scan</span>
    </button>
  );
}
