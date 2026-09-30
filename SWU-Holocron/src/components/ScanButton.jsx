import React from 'react';
import { ScanLine } from 'lucide-react';

/**
 * Entry point for the card scanner.
 *
 * Only rendered for users who can scan (Pro or admin): the parent passes an
 * onScan handler only then, and renders nothing otherwise. A greyed-out
 * "advertisement" version waits on a real unlock path (Patreon).
 *
 * - variant="inline": compact button beside a search box or the CSV actions.
 * - variant="fab":    floating action button, phone-width only, for one-thumb
 *                     reach while the phone sits in a stand.
 *
 * @environment:react
 */
export default function ScanButton({ onOpen, variant = 'inline', className = '' }) {
  if (variant === 'fab') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Scan cards"
        title="Scan cards"
        data-variant="fab"
        className="md:hidden fixed bottom-4 right-4 z-30 w-14 h-14 rounded-full bg-yellow-500 hover:bg-yellow-400 text-black shadow-lg shadow-yellow-500/30 flex items-center justify-center transition-colors"
      >
        <ScanLine size={26} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Scan cards"
      title="Scan cards"
      data-variant="inline"
      className={`shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 hover:border-yellow-500/50 transition-colors ${className}`}
    >
      <ScanLine className="text-yellow-500" size={18} />
      <span className="text-sm font-medium">Scan</span>
    </button>
  );
}
