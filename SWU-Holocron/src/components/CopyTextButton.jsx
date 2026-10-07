import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy } from 'lucide-react';
import { escapeDiscord, splitForDiscord } from '../utils/discordText';

/** Copy a list for Discord: escaped, and in parts when it is over a message's limit. */
export default function CopyTextButton({ text, count, fallbackLabel, disabled = false, className = '' }) {
  const parts = useMemo(() => splitForDiscord(escapeDiscord(text ?? '')), [text]);
  const [index, setIndex] = useState(0);
  // { kind: 'copied', part } | { kind: 'fallback', part } | null
  const [state, setState] = useState(null);

  useEffect(() => { setIndex(0); setState(null); }, [text]);

  const many = parts.length > 1;
  const copy = async () => {
    const part = index;
    try {
      await navigator.clipboard.writeText(parts[part]);
      setState({ kind: 'copied', part });
      setIndex((part + 1) % parts.length);
    } catch {
      setState({ kind: 'fallback', part });
    }
  };

  const label = many ? `Copy part ${index + 1} of ${parts.length}` : 'Copy as text';
  let status = null;
  if (state?.kind === 'copied') {
    if (many) status = `Copied part ${state.part + 1} of ${parts.length}`;
    else status = typeof count === 'number' ? `Copied ${count} cards` : 'Copied';
  }

  return (
    <>
      <button type="button" onClick={copy} disabled={disabled}
        className={className || 'flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm disabled:opacity-40'}>
        <ClipboardCopy className="w-4 h-4" /> {label}
      </button>
      {status && <p role="status" className="basis-full text-sm text-green-400 print:hidden">{status}</p>}
      {state?.kind === 'fallback' && (
        <div className="basis-full space-y-1 print:hidden">
          <p className="text-xs text-gray-400">Select and copy:</p>
          <textarea readOnly aria-label={fallbackLabel} value={parts[state.part]} rows={6} onFocus={(e) => e.target.select()}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono" />
        </div>
      )}
    </>
  );
}
