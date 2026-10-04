import React, { useState } from 'react';
import { ArrowLeft, Minus, Plus, Sparkles, Trash2, RotateCcw, Loader2, Search, X } from 'lucide-react';
import CardPickerModal from './CardPickerModal';
import { CardService } from '../services/CardService';
import { isHorizontalCard } from '../utils/collectionHelpers';
import {
  countByStatus, groupRows, removeRows, resolveManually, setFoil, setGroupQuantity,
} from '../utils/scanDraft';

/**
 * Review screen for a card-scanner batch. Controlled: every edit is a new draft
 * passed to onChange. Collection controls stay inline (house rule) -- quantity
 * and foil are edited on the line itself.
 *
 * @environment:react
 */

const REASON_TEXT = {
  unreadable: "Couldn't read this card",
  'unknown-set': 'Set not recognised',
  'no-such-card': 'No card with that number',
  'name-mismatch': "Name didn't match the number",
  interrupted: 'Scan was interrupted',
  quota: 'Daily scan limit reached',
  network: 'Network error',
  forbidden: 'Scanning not allowed',
  unknown: 'Something went wrong',
};

const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;

const photoSrc = (photo) => `data:image/jpeg;base64,${photo}`;

function Photo({ group, onView }) {
  if (group.photo) {
    return (
      <button type="button" aria-label="View photo" onClick={() => onView(photoSrc(group.photo))} className="flex-shrink-0">
        <img
          src={photoSrc(group.photo)}
          alt="Captured photo"
          className="w-16 h-[88px] object-cover rounded"
        />
      </button>
    );
  }
  return (
    <div className="w-16 h-[88px] rounded bg-gray-800 text-[10px] text-gray-500 flex items-center justify-center text-center flex-shrink-0">
      {group.hadPhoto ? 'Photo lost' : 'No photo'}
    </div>
  );
}

export default function ScanReview({ draft, onChange, onRetry, onBack, onCommit, onDiscard, committing, commitError }) {
  const [pickingFor, setPickingFor] = useState(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [viewing, setViewing] = useState(null);

  const groups = groupRows(draft);
  const counts = countByStatus(draft);
  const attention = counts.unidentified + counts.failed;
  const total = counts.reading + counts.matched + attention;
  const canCommit = counts.matched > 0 && counts.reading === 0 && !committing;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <button
          type="button"
          disabled={committing}
          onClick={onBack}
          aria-label="Back to camera"
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-lg font-bold text-white">Review batch</h2>
        <span className="ml-auto text-sm text-gray-400">{plural(total)}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {groups.length === 0 && (
          <p className="text-center text-gray-500 py-12">Nothing scanned yet.</p>
        )}

        {groups.map((group) => {
          const ids = group.rows.map((r) => r.id);

          if (group.status === 'matched') {
            return (
              <div
                key={group.key}
                data-testid={`group-${group.key}`}
                className="flex items-center gap-3 p-3 bg-gray-900 border border-gray-800 rounded-xl"
              >
                {/* Leaders and bases are landscape (88:63), as everywhere else in the app.
                    Tapping shows the photo actually captured, so a match can be checked
                    against it; the card image stands in if the photo was not kept. */}
                <button
                  type="button"
                  aria-label={`View photo of ${group.name}`}
                  onClick={() => setViewing(group.photo ? photoSrc(group.photo) : CardService.getCardImage(group.set, group.number))}
                  className="flex-shrink-0"
                >
                  <img
                    src={CardService.getCardImage(group.set, group.number)}
                    alt=""
                    data-orientation={isHorizontalCard(group.type) ? 'horizontal' : 'vertical'}
                    className={`${isHorizontalCard(group.type) ? 'w-[88px] h-16' : 'w-16 h-[88px]'} object-cover rounded`}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">{group.name}</p>
                  <p className="text-xs text-gray-500">{group.set} {group.number}</p>
                </div>
                <button
                  type="button"
                  disabled={committing}
                  aria-pressed={group.isFoil}
                  onClick={() => onChange(setFoil(draft, ids, !group.isFoil))}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border ${
                    group.isFoil
                      ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
                      : 'bg-gray-800 border-gray-700 text-gray-400'
                  }`}
                >
                  <Sparkles size={12} aria-hidden="true" />Foil
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={committing}
                    aria-label={`Decrease ${group.name}`}
                    onClick={() => onChange(setGroupQuantity(draft, group.key, group.qty - 1))}
                    className="p-1 rounded bg-gray-800 hover:bg-gray-700"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-8 text-center font-bold">×{group.qty}</span>
                  <button
                    type="button"
                    disabled={committing}
                    aria-label={`Increase ${group.name}`}
                    onClick={() => onChange(setGroupQuantity(draft, group.key, group.qty + 1))}
                    className="p-1 rounded bg-gray-800 hover:bg-gray-700"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            );
          }

          if (group.status === 'reading') {
            return (
              <div key={group.key} className="flex items-center gap-3 p-3 bg-gray-900 border border-gray-800 rounded-xl text-gray-400">
                <Photo group={group} onView={setViewing} />
                <Loader2 size={16} className="animate-spin" />
                <span>Reading…</span>
              </div>
            );
          }

          const read = group.read;
          const detail = read && read.readable
            ? `Read as ${read.set} ${read.number} · ${read.name}`
            : REASON_TEXT[group.reason] ?? REASON_TEXT.unknown;

          return (
            <div key={group.key} className="flex items-center gap-3 p-3 bg-gray-900 border border-red-500/40 rounded-xl">
              <Photo group={group} onView={setViewing} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-red-300">{detail}</p>
                {read && read.readable && (
                  <p className="text-xs text-gray-500">{REASON_TEXT[group.reason] ?? ''}</p>
                )}
              </div>
              {group.status === 'failed' && group.photo && (
                <button
                  type="button"
                  disabled={committing}
                  onClick={() => onRetry(group.rows[0].id)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs"
                >
                  <RotateCcw size={12} aria-hidden="true" />Retry
                </button>
              )}
              <button
                type="button"
                disabled={committing}
                onClick={() => setPickingFor(group.rows[0].id)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
              >
                <Search size={12} aria-hidden="true" />Pick card
              </button>
              <button
                type="button"
                disabled={committing}
                onClick={() => onChange(removeRows(draft, ids))}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs"
              >
                <Trash2 size={12} aria-hidden="true" />Remove
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800 space-y-2">
        {commitError && (
          <p role="alert" className="text-sm text-red-400">{commitError}</p>
        )}
        {attention > 0 && (
          <p className="text-xs text-gray-400">
            {plural(attention)} {attention === 1 ? 'needs' : 'need'} attention and will stay in the batch.
          </p>
        )}
        {confirmingDiscard ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={committing}
              onClick={onDiscard}
              className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold"
            >
              Discard {plural(total)}
            </button>
            <button
              type="button"
              disabled={committing}
              onClick={() => setConfirmingDiscard(false)}
              className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700"
            >
              Keep
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDiscard(true)}
              disabled={total === 0 || committing}
              className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm disabled:opacity-40"
            >
              Discard batch
            </button>
            <button
              type="button"
              onClick={onCommit}
              disabled={!canCommit}
              className="flex-1 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold disabled:opacity-40"
            >
              {committing ? 'Adding…' : `Add ${plural(counts.matched)} to collection`}
            </button>
          </div>
        )}
      </div>

      {viewing && (
        <div
          role="dialog"
          aria-label="Photo"
          onClick={() => setViewing(null)}
          className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center p-4"
        >
          <img src={viewing} alt="Full-size photo" className="max-w-full max-h-full object-contain" />
          <button
            type="button"
            aria-label="Close photo"
            onClick={() => setViewing(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-gray-900/80 text-white"
          >
            <X size={22} />
          </button>
        </div>
      )}

      {pickingFor && (
        <CardPickerModal
          collectionData={{}}
          // Start from the title Gemini read, so confirming the card is one tap.
          initialSearch={draft.rows.find((r) => r.id === pickingFor)?.read?.name ?? ''}
          onSelect={(card) => {
            onChange(resolveManually(draft, pickingFor, card));
            setPickingFor(null);
          }}
          onClose={() => setPickingFor(null)}
        />
      )}
    </div>
  );
}
