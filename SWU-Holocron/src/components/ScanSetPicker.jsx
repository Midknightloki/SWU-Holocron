import React from 'react';
import { Check } from 'lucide-react';

/**
 * Sets the user expects to be scanning, e.g. "SHD" for a Shadows booster box.
 *
 * A hint, not a filter: the scanner still matches whatever set is printed on a
 * card, and falls back to these sets (and their promo sets) only when the
 * printed set code was misread or illegible. "Any set" means no hints.
 *
 * @environment:react
 */
export default function ScanSetPicker({ options, selected, onChange, onClose }) {
  const toggle = (code) => {
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  };
  // Base sets first: that is what a booster box or a binder page is.
  const ordered = [...options].sort((a, b) => Number(Boolean(b.isBaseSet)) - Number(Boolean(a.isBaseSet)));

  return (
    <div
      role="dialog"
      aria-label="Choose sets"
      className="absolute inset-0 z-20 flex flex-col bg-gray-950 text-gray-100"
    >
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-lg font-bold text-white">Which sets are you scanning?</h2>
        <p className="text-sm text-gray-400">
          Used when a card&apos;s set code is misread. Cards from other sets still match.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        <button
          type="button"
          aria-pressed={selected.length === 0}
          onClick={() => onChange([])}
          className={`w-full flex items-center justify-between px-3 py-3 rounded-lg border text-left ${
            selected.length === 0 ? 'bg-yellow-500/20 border-yellow-500 text-yellow-300' : 'bg-gray-900 border-gray-800'
          }`}
        >
          Any set
          {selected.length === 0 && <Check size={16} aria-hidden="true" />}
        </button>
        {ordered.map(({ code, name }) => {
          const on = selected.includes(code);
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(code)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-left ${
                on ? 'bg-yellow-500/20 border-yellow-500' : 'bg-gray-900 border-gray-800'
              }`}
            >
              <span className="w-16 font-bold text-yellow-400">{code}</span>
              <span className="flex-1 text-sm text-gray-200">{name}</span>
              {on && <Check size={16} aria-hidden="true" className="text-yellow-300" />}
            </button>
          );
        })}
      </div>

      <div className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gray-900 border-t border-gray-800">
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
        >
          Done
        </button>
      </div>
    </div>
  );
}
