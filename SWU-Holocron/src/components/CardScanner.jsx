import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles, HelpCircle, Crosshair } from 'lucide-react';
import { clearCalibration, cropFor, guideStyle, loadCalibration, saveCalibration } from '../utils/rigCalibration';
import RigCalibration from './RigCalibration';
import { ScanService } from '../services/ScanService';
import { capturePhoto } from '../utils/frameCapture';
import { levelReading } from '../utils/level';
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

const HELP_SEEN_KEY = 'swu-scan-help-seen';

const readHelpSeen = () => {
  try {
    return localStorage.getItem(HELP_SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

const markHelpSeen = () => {
  try {
    localStorage.setItem(HELP_SEEN_KEY, '1');
  } catch {
    // Storage unavailable: the how-to just shows again next time.
  }
};

const formatReset = (iso) => {
  if (!iso) return 'midnight UTC';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function CardScanner({ uid, collectionRef, setCodes, onClose }) {
  const [draft, setDraft] = useState(() => loadDraft(getStorage(), uid));
  const [mode, setMode] = useState('camera');
  const [foilStack, setFoilStack] = useState(false);
  const [showHelp, setShowHelp] = useState(() => !readHelpSeen());
  const [flash, setFlash] = useState(false);
  const [quota, setQuota] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [lastCapture, setLastCapture] = useState(null);
  const [level, setLevel] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState(null);
  const [calibration, setCalibration] = useState(() => loadCalibration(getStorage()));
  const [calibrating, setCalibrating] = useState(false);
  const [view, setView] = useState({ vw: 0, vh: 0, bw: 0, bh: 0 });
  const calibratingRef = useRef(false);
  calibratingRef.current = calibrating;
  const previewRef = useRef(null);
  const [owner, setOwner] = useState(uid);
  // Mirrors `quota` for the capture guard. State reaches the key listener only
  // after React re-runs its effect, so a press in between would still capture;
  // the ref is set the moment the limit comes back.
  const quotaRef = useRef(null);

  // A different account signed in while the overlay was open. Swap to that
  // account's own batch during render, before any effect can save the old
  // account's rows under the new uid (or commit them to its collection).
  if (owner !== uid) {
    setOwner(uid);
    setDraft(loadDraft(getStorage(), uid));
    setMode('camera');
    quotaRef.current = null;
    setQuota(null);
    setCommitError(null);
  }

  const videoRef = useRef(null);
  const mountedRef = useRef(false);
  const flashTimer = useRef(null);
  const trackRef = useRef(null);
  // A real photo takes a moment; taps during it are ignored, not queued.
  const capturingRef = useRef(false);
  // Captures pause while the how-to is open (ref: read by the key listener).
  const helpOpenRef = useRef(showHelp);
  helpOpenRef.current = showHelp;

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
          // Ask high: the preview is also the fallback capture source.
          video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        const [track] = stream.getVideoTracks?.() ?? [];
        trackRef.current = track ?? null;
        // Best effort: keep refocusing as cards slide in. Unsupported → ignored.
        track?.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] })?.catch?.(() => {});
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
      trackRef.current = null;
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
    if (result.error === 'quota') {
      quotaRef.current = { limit: result.limit, resetsAt: result.resetsAt };
      setQuota(quotaRef.current);
    }
    setDraft((d) => applyResult(d, id, result));
  }, [setCodes, signalProblem]);

  const capture = useCallback(async () => {
    if (calibratingRef.current || helpOpenRef.current || quotaRef.current || cameraError || capturingRef.current) return;
    capturingRef.current = true;
    // Foil is read at the tap, not after the photo resolves.
    const isFoil = foilStack;
    let shot = null;
    try {
      shot = await capturePhoto({
        track: trackRef.current,
        video: videoRef.current,
        crop: (source, width, height) => cropFor(calibration, source, width, height),
      });
    } catch {
      shot = null;
    } finally {
      capturingRef.current = false;
    }
    if (!mountedRef.current) return;
    if (!shot?.image) {
      signalProblem();
      return;
    }
    setLastCapture({ source: shot.source, width: shot.width, height: shot.height, cropped: Boolean(shot.cropped) });
    const id = newId();
    setDraft((d) => addCapture(d, { id, isFoil, photo: shot.image }));
    runScan(id, shot.image);
  }, [calibration, cameraError, foilStack, runScan, signalProblem]);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    const onOrientation = (e) => setLevel(levelReading(e.beta, e.gamma));
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    const video = videoRef.current;
    const box = previewRef.current;
    if (!video || !box) return undefined;
    const measure = () => {
      const r = box.getBoundingClientRect();
      setView({ vw: video.videoWidth, vh: video.videoHeight, bw: r.width, bh: r.height });
    };
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(box);
    measure();
    return () => {
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [mode]);

  const takeCalibrationPhoto = useCallback(
    () => capturePhoto({ track: trackRef.current, video: videoRef.current }),
    [],
  );

  const saveRig = useCallback((cal) => {
    const saved = saveCalibration(getStorage(), cal);
    // Storage unavailable: keep it for this session anyway.
    setCalibration(saved ?? { version: 1, ...cal, savedAt: Date.now() });
    setCalibrating(false);
  }, []);

  const clearRig = useCallback(() => {
    clearCalibration(getStorage());
    setCalibration(null);
    setCalibrating(false);
  }, []);

  const dismissHelp = useCallback(() => {
    markHelpSeen();
    setShowHelp(false);
  }, []);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    const onKey = (e) => {
      // Calibration has its own buttons and arrow-key nudging: leave keys alone.
      if (calibratingRef.current) return;
      if (!CAPTURE_KEYS.has(e.code) && e.key !== ' ' && e.key !== 'Enter') return;
      // Always swallow the key: Space on a focused button would otherwise
      // also toggle it, and a held key would fire a capture per repeat.
      e.preventDefault();
      if (e.repeat) return;
      if (helpOpenRef.current) {
        dismissHelp();
        return;
      }
      capture();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, capture, dismissHelp]);

  const retry = useCallback((id) => {
    const row = draft.rows.find((r) => r.id === id);
    if (!row?.photo || quotaRef.current) return;
    setDraft((d) => markReading(d, id));
    runScan(id, row.photo);
  }, [draft, runScan]);

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

  const calibratedStyle = calibration
    ? guideStyle(calibration.rect, view.vw, view.vh, view.bw, view.bh)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-gray-100">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-900/90 border-b border-gray-800">
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
          aria-label="How to scan"
          title="How to scan"
          aria-expanded={showHelp}
          onClick={() => (showHelp ? dismissHelp() : setShowHelp(true))}
          className="p-2 rounded-lg border bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
        >
          <HelpCircle size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Calibrate rig"
          title="Calibrate for your rig"
          onClick={() => setCalibrating(true)}
          className={`p-2 rounded-lg border ${
            calibration
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
          }`}
        >
          <Crosshair size={18} aria-hidden="true" />
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
        ref={previewRef}
        data-testid="scan-preview"
        onClick={capture}
        className="relative flex-1 overflow-hidden cursor-pointer select-none"
        style={{ containerType: 'size' }}
      >
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        {/* One portrait guide (63:88) for every card, so a physical jig lines
            them up the same way each time. Two collector boxes, each sized to
            the ~26 x 4mm collector line:
            - bottom-right: normal cards;
            - top-right, upright: leaders and bases turned a quarter-turn
              counter-clockwise, which moves their bottom-right number there.
            Sized against the preview in both directions (container units) so
            it stays card-shaped on a tall phone and a wide laptop alike.
            Calibrated: placed where the rig calibration says the card is.
            That placement is approximate -- the live stream and the still
            photo can frame slightly differently -- but the crop is exact,
            because it is applied to the photo. */}
        <div
          data-testid="card-guide"
          data-calibrated={String(Boolean(calibration))}
          aria-hidden="true"
          className={`pointer-events-none absolute border-2 border-yellow-500/70 rounded-xl ${
            calibratedStyle ? '' : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
          }`}
          style={calibratedStyle
            ? { left: calibratedStyle.left, top: calibratedStyle.top, width: calibratedStyle.width, height: calibratedStyle.height }
            : { width: 'min(96cqw, calc(92cqh * 63 / 88))', aspectRatio: '63 / 88' }}
        >
          <div
            data-testid="collector-guide"
            className="absolute right-[3%] bottom-[1.5%] w-[42%] h-[4.5%] border-2 border-cyan-400 rounded-sm bg-cyan-400/10"
          />
          <div
            data-testid="collector-guide-upright"
            className="absolute right-[2%] top-[2%] w-[6.5%] h-[30%] border-2 border-cyan-400 rounded-sm bg-cyan-400/10"
          />
        </div>
        {level && (
          <div
            data-testid="level"
            data-level={String(level.isLevel)}
            aria-label={level.isLevel ? 'Level' : 'Not level'}
            className={`pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full border-2 ${
              level.isLevel ? 'border-green-400 bg-green-400/20' : 'border-white/70 bg-black/30'
            }`}
          >
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border border-white/50" />
            <div
              className={`absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full ${level.isLevel ? 'bg-green-400' : 'bg-yellow-400'}`}
              style={{ transform: `translate(${level.x * 16}px, ${level.y * 16}px)` }}
            />
          </div>
        )}
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

      {showHelp && (
        <div
          role="dialog"
          aria-label="How to scan"
          className="absolute inset-x-4 top-20 z-10 p-4 rounded-xl bg-gray-900/95 border border-gray-700 text-sm text-gray-200 shadow-xl"
        >
          <h3 className="font-bold text-white mb-2">How to scan</h3>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Using a fixed rig? Tap the crosshair once with a card in place to calibrate — every scan is then cropped to the card.</li>
            <li>Hold the phone flat above the table. Wait for the level at the top to turn green.</li>
            <li>Raise or lower the phone until the card fills the yellow outline.</li>
            <li>
              Put the card number in a cyan box. Most cards: bottom-right. Leaders and bases: stand them
              upright with a quarter-turn counter-clockwise, so their number sits in the top-right box.
            </li>
            <li>Tap the screen or press Space to capture, then slide in the next card.</li>
          </ol>
          <button
            type="button"
            onClick={dismissHelp}
            className="mt-3 w-full py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
          >
            Got it
          </button>
        </div>
      )}

      {calibrating && (
        <RigCalibration
          hasCalibration={Boolean(calibration)}
          onTakePhoto={takeCalibrationPhoto}
          onSave={saveRig}
          onClear={clearRig}
          onClose={() => setCalibrating(false)}
        />
      )}

      <div className="flex items-center gap-4 px-4 py-3 bg-gray-900/90 border-t border-gray-800 text-sm text-gray-400">
        <span>{total} scanned</span>
        {lastCapture && (
          <span className="text-gray-500">
            {lastCapture.source} {lastCapture.width}×{lastCapture.height} · {lastCapture.cropped ? 'cropped' : 'full frame'}
          </span>
        )}
        {counts.reading > 0 && <span>{counts.reading} reading…</span>}
        {attention > 0 && <span className="text-red-400">{attention} need attention</span>}
        <span className="ml-auto hidden sm:inline">Tap or press Space to capture</span>
      </div>
    </div>
  );
}
