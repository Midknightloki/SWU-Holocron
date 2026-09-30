import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { ScanService } from '../services/ScanService';
import { captureFrame } from '../utils/frameCapture';
import {
  addCapture, applyResult, clearDraft, countByStatus, emptyDraft, loadDraft, markReading, saveDraft,
} from '../utils/scanDraft';
import ScanReview from './ScanReview';

/**
 * Card scanner overlay: camera preview, capture on tap / Space / Enter, a
 * foil-stack switch, and the review screen. Captures are sent without waiting
 * for the previous one, so a stack can be passed through at hand speed.
 *
 * @environment:web-media @environment:web-localstorage @environment:react
 */

// Bare `localStorage`, not `window.localStorage`: identical in a browser, and
// it resolves to the global the test setup stubs. The accessor itself can
// throw (blocked site data), hence the try.
const getStorage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

// crypto.randomUUID is missing on older iOS Safari; the id only has to be
// unique within one batch.
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const CAPTURE_KEYS = new Set(['Space', 'Enter']);

const formatReset = (iso) => {
  if (!iso) return 'midnight UTC';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function CardScanner({ uid, collectionRef, setCodes, onClose }) {
  const [draft, setDraft] = useState(() => loadDraft(getStorage(), uid));
  const [mode, setMode] = useState('camera');
  const [foilStack, setFoilStack] = useState(false);
  const [flash, setFlash] = useState(false);
  const [quota, setQuota] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState(null);
  const [owner, setOwner] = useState(uid);

  // A different account signed in while the overlay was open. Swap to that
  // account's own batch during render, before any effect can save the old
  // account's rows under the new uid (or commit them to its collection).
  if (owner !== uid) {
    setOwner(uid);
    setDraft(loadDraft(getStorage(), uid));
    setMode('camera');
    setQuota(null);
    setCommitError(null);
  }

  const videoRef = useRef(null);
  const mountedRef = useRef(false);
  const flashTimer = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(flashTimer.current);
    };
  }, []);

  useEffect(() => {
    saveDraft(getStorage(), uid, draft);
  }, [uid, draft]);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    let stream = null;
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser cannot use a camera.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraError(null);
      } catch (err) {
        if (cancelled) return;
        setCameraError(err?.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your browser settings to scan cards.'
          : 'No camera is available on this device.');
      }
    };

    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode]);

  const signalProblem = useCallback(() => {
    setFlash(true);
    navigator.vibrate?.(150);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      if (mountedRef.current) setFlash(false);
    }, 600);
  }, []);

  const runScan = useCallback(async (id, image) => {
    const result = await ScanService.scan(image, setCodes);
    if (!mountedRef.current) return;
    if (result.status !== 'matched') signalProblem();
    if (result.error === 'quota') setQuota({ limit: result.limit, resetsAt: result.resetsAt });
    setDraft((d) => applyResult(d, id, result));
  }, [setCodes, signalProblem]);

  const capture = useCallback(() => {
    if (quota || cameraError) return;
    let image = null;
    try {
      image = captureFrame(videoRef.current);
    } catch {
      image = null;
    }
    if (!image) {
      signalProblem();
      return;
    }
    const id = newId();
    setDraft((d) => addCapture(d, { id, isFoil: foilStack, photo: image }));
    runScan(id, image);
  }, [quota, cameraError, foilStack, runScan, signalProblem]);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    const onKey = (e) => {
      if (!CAPTURE_KEYS.has(e.code) && e.key !== ' ' && e.key !== 'Enter') return;
      // Always swallow the key: Space on a focused button would otherwise
      // also toggle it, and a held key would fire a capture per repeat.
      e.preventDefault();
      if (e.repeat) return;
      capture();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, capture]);

  const retry = useCallback((id) => {
    const row = draft.rows.find((r) => r.id === id);
    if (!row?.photo || quota) return;
    setDraft((d) => markReading(d, id));
    runScan(id, row.photo);
  }, [draft, quota, runScan]);

  const commit = useCallback(async () => {
    if (!collectionRef) {
      setCommitError('Not connected to cloud storage.');
      return;
    }
    setCommitting(true);
    setCommitError(null);
    try {
      const rest = await ScanService.commitDraft(draft, collectionRef, {
        onProgress: (next) => {
          // Persist synchronously: if the overlay closes mid-commit, the saved
          // batch must not still hold rows that were already added.
          saveDraft(getStorage(), uid, next);
          if (mountedRef.current) setDraft(next);
        },
      });
      if (!mountedRef.current) return;
      setDraft(rest);
      if (rest.rows.length === 0) {
        clearDraft(getStorage(), uid);
        onClose();
      }
    } catch (err) {
      console.error('Scan commit failed:', err);
      if (mountedRef.current) {
        setCommitError(err?.code === 'commit-in-progress'
          ? 'A previous save is still in progress. Wait for it to finish, then try again.'
          : "Some cards weren't saved. Try again — cards already added won't be added twice.");
      }
    } finally {
      if (mountedRef.current) setCommitting(false);
    }
  }, [collectionRef, draft, uid, onClose]);

  const discard = useCallback(() => {
    clearDraft(getStorage(), uid);
    setDraft(emptyDraft());
    setMode('camera');
  }, [uid]);

  const counts = countByStatus(draft);
  const total = counts.reading + counts.matched + counts.unidentified + counts.failed;
  const attention = counts.unidentified + counts.failed;

  if (mode === 'review') {
    return (
      <div className="fixed inset-0 z-50">
        <ScanReview
          draft={draft}
          onChange={setDraft}
          onRetry={retry}
          onBack={() => setMode('camera')}
          onCommit={commit}
          onDiscard={discard}
          committing={committing}
          commitError={commitError}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-gray-100">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-900/90 border-b border-gray-800">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"
        >
          <X size={20} />
        </button>
        <button
          type="button"
          aria-pressed={foilStack}
          onClick={() => setFoilStack((v) => !v)}
          className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border ${
            foilStack
              ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
              : 'bg-gray-800 border-gray-700 text-gray-400'
          }`}
        >
          <Sparkles size={14} aria-hidden="true" />Foil stack
        </button>
        <button
          type="button"
          onClick={() => setMode('review')}
          className="ml-auto px-3 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold"
        >
          Review ({total})
        </button>
      </div>

      <div
        data-testid="scan-preview"
        onClick={capture}
        className="relative flex-1 overflow-hidden cursor-pointer select-none"
      >
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-[12%] border-2 border-yellow-500/70 rounded-xl" />
        {flash && <div data-testid="scan-flash" className="pointer-events-none absolute inset-0 bg-red-600/40" />}
        {cameraError && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center bg-black/80">
            {cameraError}
          </div>
        )}
        {quota && (
          <div role="alert" className="absolute inset-x-4 bottom-4 p-4 rounded-xl bg-gray-900 border border-yellow-500/50 text-sm text-center">
            Daily scan limit of {quota.limit} reached. It resets at {formatReset(quota.resetsAt)}.
            Your batch is kept — review it and add it now.
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 px-4 py-3 bg-gray-900/90 border-t border-gray-800 text-sm text-gray-400">
        <span>{total} scanned</span>
        {counts.reading > 0 && <span>{counts.reading} reading…</span>}
        {attention > 0 && <span className="text-red-400">{attention} need attention</span>}
        <span className="ml-auto hidden sm:inline">Tap or press Space to capture</span>
      </div>
    </div>
  );
}
