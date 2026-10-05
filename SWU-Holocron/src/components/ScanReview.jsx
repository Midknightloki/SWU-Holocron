import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, Sparkles, Trash2, RotateCcw, Loader2, Search, X } from 'lucide-react';
import CardPickerModal from './CardPickerModal';
import { CardService } from '../services/CardService';
import { PhotoStore } from '../services/photoStore';
import { getCardQuantities, isHorizontalCard } from '../utils/collectionHelpers';
import {
  countByStatus, groupRows, parsePricePaid, removeRows, resolveManually, setFoil, setGroupQuantity,
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
  'no-number': 'No card number read — check the name',
  'name-mismatch': "Name didn't match the number",
  interrupted: 'Scan was interrupted',
  quota: 'Waiting: daily limit',
  offline: 'Waiting: offline',
  network: 'Network error',
  forbidden: 'Scanning not allowed',
  unknown: 'Something went wrong',
};

const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;

const photoSrc = (photo) => `data:image/jpeg;base64,${photo}`;

// Load only once the row is on screen: a whole box can leave hundreds of
// unread or unidentified rows, and every photo at once could exhaust memory.
// Without IntersectionObserver, load straight away.
function useOnScreen(ref) {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

// A row's photo from the photo store: undefined while loading, null if none.
function useStoredPhoto(id, hasPhoto, getPhoto, visible) {
  const [photo, setPhoto] = useState(hasPhoto ? undefined : null);
  useEffect(() => {
    if (!visible) return undefined;
    if (!hasPhoto) {
      setPhoto(null);
      return undefined;
    }
    let cancelled = false;
    Promise.resolve(getPhoto(id))
      .then((value) => { if (!cancelled) setPhoto(value ?? null); })
      .catch(() => { if (!cancelled) setPhoto(null); });
    return () => { cancelled = true; };
  }, [id, hasPhoto, getPhoto, visible]);
  return photo;
}

function Photo({ id, hasPhoto, getPhoto, onView }) {
  const boxRef = useRef(null);
  const visible = useOnScreen(boxRef);
  const photo = useStoredPhoto(id, hasPhoto, getPhoto, visible);
  if (photo) {
    return (
      <button type="button" aria-label="View photo" onClick={() => onView(photoSrc(photo))} className="flex-shrink-0">
        <img
          src={photoSrc(photo)}
          alt="Captured photo"
          className="w-16 h-[88px] object-cover rounded"
        />
      </button>
    );
  }
  return (
    <div ref={boxRef} className="w-16 h-[88px] rounded bg-gray-800 text-[10px] text-gray-500 flex items-center justify-center text-center flex-shrink-0">
      {photo === undefined ? '' : 'No photo'}
    </div>
  );
}

export default function ScanReview({
  draft, onChange, onRetry, onBack, onCommit, onDiscard, committing, commitError,
  collectionData = {}, getPhoto = PhotoStore.get, batch = null, onBatchChange = () => {}, onRetryReport = () => {}, onFinish = () => {},
}) {
  const [pickingFor, setPickingFor] = useState(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [priceInvalid, setPriceInvalid] = useState(false);

  const groups = groupRows(draft);
  const counts = countByStatus(draft);
  const attention = counts.unidentified + counts.failed + counts.waiting;
  const total = counts.reading + counts.matched + attention;
  // Cards still reading (or waiting on the daily limit) don't block Add: it
  // commits the matched ones and leaves the rest in the batch.
  const canCommit = counts.matched > 0 && !committing;

  const viewMatched = async (group) => {
    const photo = group.hasPhoto ? await getPhoto(group.rows[0].id) : null;
    setViewing(photo ? photoSrc(photo) : CardService.getCardImage(group.set, group.number));
  };

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
      {batch && (
        <div className="flex gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800">
          <input
            aria-label="Batch name"
            value={batch.name}
            onChange={(e) => onBatchChange({ name: e.target.value })}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
          />
          {/* Uncontrolled: a half-typed "12." must stay on screen while the batch holds 12. */}
          <input
            key={batch.id}
            aria-label="Price paid"
            aria-invalid={priceInvalid}
            inputMode="decimal"
            placeholder="Price paid"
            defaultValue={batch.pricePaid ?? ''}
            onChange={(e) => {
              const v = parsePricePaid(e.target.value);
              setPriceInvalid(v === undefined);
              onBatchChange({ pricePaid: v ?? null });
            }}
            className={`w-28 bg-gray-800 border rounded-lg px-3 py-1.5 text-sm ${priceInvalid ? 'border-red-500' : 'border-gray-700'}`}
          />
        </div>
      )}

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
                  onClick={() => viewMatched(group)}
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
                  <p className="font-bold text-white truncate">
                    {group.name}
                    {/* Not owned in any finish: this batch closes a gap. */}
                    {getCardQuantities(collectionData, group.set, group.number).total === 0 && (
                      <span className="ml-2 align-middle px-1.5 py-0.5 rounded bg-green-500 text-black text-[10px] font-black">NEW</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{group.set} {group.number}</p>
                  {group.via === 'name' && (
                    <p className="text-xs text-amber-300">Matched by name — check it&apos;s this printing, not a variant</p>
                  )}
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
                <Photo id={group.rows[0].id} hasPhoto={group.hasPhoto} getPhoto={getPhoto} onView={setViewing} />
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
              <Photo id={group.rows[0].id} hasPhoto={group.hasPhoto} getPhoto={getPhoto} onView={setViewing} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-red-300">{detail}</p>
                {read && read.readable && (
                  <p className="text-xs text-gray-500">{REASON_TEXT[group.reason] ?? ''}</p>
                )}
              </div>
              {/* Retry re-reads the stored photo: without one there is nothing to retry. */}
              {(group.status === 'failed' || group.status === 'waiting') && group.hasPhoto && (
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
        {batch?.pending?.length > 0 && (
          <button
            type="button"
            disabled={committing}
            onClick={onRetryReport}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
          >
            <RotateCcw size={14} aria-hidden="true" />Retry batch report
          </button>
        )}
        {attention > 0 && (
          <p className="text-xs text-gray-400">
            {plural(attention)} {attention === 1 ? 'needs' : 'need'} attention and will stay in the batch.
          </p>
        )}
        {counts.reading > 0 && (
          <p className="text-xs text-gray-400">{counts.reading} still reading will stay in the batch.</p>
        )}
        {batch && (batch.appended || counts.matched > 0) && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={committing}
              onClick={onFinish}
              className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-40"
            >
              Finish batch
            </button>
            <p className="text-xs text-gray-400">
              {counts.matched > 0 && `Adds the ${counts.matched} matched ${counts.matched === 1 ? 'card' : 'cards'} first. `}
              {total - counts.matched > 0
                && `${plural(total - counts.matched)} left here ${total - counts.matched === 1 ? 'goes' : 'go'} into the next batch.`}
            </p>
          </div>
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
