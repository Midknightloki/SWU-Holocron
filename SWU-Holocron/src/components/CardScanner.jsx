import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles, HelpCircle, Crosshair, ScanLine as AutoIcon } from 'lucide-react';
import { calibratedGuide, clampRect, clearCalibration, cropFor, loadCalibration, saveCalibration, toStreamRect } from '../utils/rigCalibration';
import { initialAutoState, loadAutoSettings, saveAutoSettings, stepAuto } from '../utils/autoCapture';
import { createFrameSampler } from '../utils/frameSampler';
import AutoSettings from './AutoSettings';
import RigCalibration from './RigCalibration';
import ScanSetPicker from './ScanSetPicker';
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

// Sets picked in the scanner, kept per device: a booster box is one set.
export const AUTO_TICK_MS = 100;

const AUTO_STATUS = {
  learning: 'Learning empty rig…',
  empty: 'Ready — slide a card in',
  arriving: 'Card coming in',
  captured: 'Scanned — remove card',
};

const SETS_KEY = 'swu-scan-sets';

const readPickedSets = (validCodes) => {
  try {
    const stored = JSON.parse(localStorage.getItem(SETS_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((code) => validCodes.includes(code)) : [];
  } catch {
    return [];
  }
};

const writePickedSets = (codes) => {
  try {
    localStorage.setItem(SETS_KEY, JSON.stringify(codes));
  } catch {
    // Storage unavailable: the pick lasts for this session only.
  }
};

const pickedLabel = (codes) => {
  if (codes.length === 0) return 'Any set';
  return codes.length === 1 ? codes[0] : `${codes[0]} +${codes.length - 1}`;
};

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

export default function CardScanner({ uid, collectionRef, setCodes, setOptions, onClose }) {
  const [draft, setDraft] = useState(() => loadDraft(getStorage(), uid));
  const [mode, setMode] = useState('camera');
  const [foilStack, setFoilStack] = useState(false);
  const [showHelp, setShowHelp] = useState(() => !readHelpSeen());
  const [flash, setFlash] = useState(null); // null | 'success' | 'error'
  // Whether the last capture was cropped to the rig calibration; drives the
  // amber "not cropped" state of the calibrate button.
  const [lastCropped, setLastCropped] = useState(null);
  const [quota, setQuota] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [level, setLevel] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState(null);
  const [calibration, setCalibration] = useState(() => loadCalibration(getStorage()));
  const [calibrating, setCalibrating] = useState(false);
  const [view, setView] = useState({ vw: 0, vh: 0, bw: 0, bh: 0 });
  const calibratingRef = useRef(false);
  const [pickedSets, setPickedSets] = useState(() => readPickedSets(setCodes));
  const [pickingSets, setPickingSets] = useState(false);
  const pickingSetsRef = useRef(false);
  pickingSetsRef.current = pickingSets;
  calibratingRef.current = calibrating;
  const previewRef = useRef(null);
  const [autoOn, setAutoOn] = useState(false);
  const [autoPhase, setAutoPhase] = useState('learning');
  const [autoSettings, setAutoSettings] = useState(() => loadAutoSettings(getStorage()));
  const [showAutoSettings, setShowAutoSettings] = useState(false);
  const autoStateRef = useRef(initialAutoState());
  const autoSettingsRef = useRef(autoSettings);
  autoSettingsRef.current = autoSettings;
  const showAutoSettingsRef = useRef(false);
  showAutoSettingsRef.current = showAutoSettings;
  const captureRef = useRef(null);
  const samplerRef = useRef(null);
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
  const flashKindRef = useRef(null);
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

  // Green on a good read, red on a problem. Only problems vibrate: on a rigid
  // rig a buzz after every card could blur the next photo.
  // Results arrive out of order, so a green flash never replaces a red one
  // that is still showing: a problem must not be masked by the next card.
  const signal = useCallback((kind) => {
    if (kind === 'success' && flashKindRef.current === 'error') return;
    flashKindRef.current = kind;
    setFlash(kind);
    if (kind === 'error') navigator.vibrate?.(150);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashKindRef.current = null;
      if (mountedRef.current) setFlash(null);
    }, kind === 'error' ? 600 : 400);
  }, []);

  const runScan = useCallback(async (id, image) => {
    const result = await ScanService.scan(image, setCodes, { hintSets: pickedSets });
    if (!mountedRef.current) return;
    signal(result.status === 'matched' ? 'success' : 'error');
    if (result.error === 'quota') {
      quotaRef.current = { limit: result.limit, resetsAt: result.resetsAt };
      setQuota(quotaRef.current);
    }
    setDraft((d) => applyResult(d, id, result));
  }, [setCodes, pickedSets, signal]);

  const capture = useCallback(async () => {
    if (showAutoSettingsRef.current || pickingSetsRef.current || calibratingRef.current || helpOpenRef.current || quotaRef.current || cameraError || capturingRef.current) return;
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
      signal('error');
      return;
    }
    setLastCropped(Boolean(shot.cropped));
    const id = newId();
    setDraft((d) => addCapture(d, { id, isFoil, photo: shot.image }));
    runScan(id, shot.image);
  }, [calibration, cameraError, foilStack, runScan, signal]);
  captureRef.current = capture;

  // Hands-free capture: sample the calibrated card area ~10x a second and let
  // the reducer decide when a card has settled. Any open overlay, the daily
  // limit, or a capture in flight skips the tick.
  useEffect(() => {
    if (!autoOn || mode !== 'camera' || !calibration) return undefined;
    if (!samplerRef.current) samplerRef.current = createFrameSampler();
    const timer = setInterval(() => {
      if (helpOpenRef.current || calibratingRef.current || pickingSetsRef.current
        || showAutoSettingsRef.current || quotaRef.current || capturingRef.current) return;
      const video = videoRef.current;
      const vw = video?.videoWidth;
      const vh = video?.videoHeight;
      const rect = vw && vh
        ? clampRect(toStreamRect(calibration.rect, vw / vh, calibration.aspect))
        : calibration.rect;
      const frame = samplerRef.current(video, rect);
      if (!frame) return;
      const { state, event } = stepAuto(autoStateRef.current, frame, Date.now(), autoSettingsRef.current);
      autoStateRef.current = state;
      setAutoPhase(state.phase);
      if (event === 'capture') captureRef.current?.();
    }, AUTO_TICK_MS);
    return () => clearInterval(timer);
  }, [autoOn, mode, calibration]);


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

  // Never alongside a scan capture: a second takePhoto on a busy track rejects,
  // the capture falls back to a video frame, and a calibration recorded from a
  // video frame silently disables cropping for every later photo.
  const takeCalibrationPhoto = useCallback(async () => {
    if (capturingRef.current) return { image: null, source: 'video', width: 0, height: 0, cropped: false };
    capturingRef.current = true;
    try {
      return await capturePhoto({ track: trackRef.current, video: videoRef.current });
    } finally {
      capturingRef.current = false;
    }
  }, []);

  const saveRig = useCallback((cal) => {
    const saved = saveCalibration(getStorage(), cal);
    // Storage unavailable: keep it for this session anyway.
    setCalibration(saved ?? { version: 1, ...cal, savedAt: Date.now() });
    setLastCropped(null);
    setCalibrating(false);
  }, []);

  const clearRig = useCallback(() => {
    clearCalibration(getStorage());
    setCalibration(null);
    setLastCropped(null);
    setCalibrating(false);
  }, []);

  // Warm the picked sets' card data so the first card from them doesn't wait.
  useEffect(() => {
    if (pickedSets.length) ScanService.prefetchSets(pickedSets);
  }, [pickedSets]);

  const toggleAuto = () => {
    if (autoOn) {
      setAutoOn(false);
      return;
    }
    if (!calibration) {
      setCalibrating(true);
      return;
    }
    autoStateRef.current = initialAutoState();
    setAutoPhase('learning');
    setAutoOn(true);
  };

  const relearnAuto = () => {
    autoStateRef.current = initialAutoState();
    setAutoPhase('learning');
  };

  const dismissHelp = useCallback(() => {
    markHelpSeen();
    setShowHelp(false);
  }, []);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    const onKey = (e) => {
      // Calibration has its own buttons and arrow-key nudging: leave keys alone.
      if (calibratingRef.current || pickingSetsRef.current || showAutoSettingsRef.current) return;
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

  const calibratedStyle = calibratedGuide(calibration, view);
  // Calibrated, yet the last capture went out full frame: the only live sign
  // that cropping has silently stopped applying.
  const cropMissed = Boolean(calibration) && lastCropped === false;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-gray-100">
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
        {autoOn && (
          <button
            type="button"
            data-testid="auto-status"
            aria-label={`Auto settings: ${AUTO_STATUS[autoPhase]}`}
            onClick={(e) => { e.stopPropagation(); setShowAutoSettings(true); }}
            className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold border ${
              autoPhase === 'captured' ? 'bg-green-500/20 border-green-400 text-green-300'
                : autoPhase === 'arriving' ? 'bg-yellow-500/20 border-yellow-400 text-yellow-300'
                  : 'bg-gray-900/80 border-gray-700 text-gray-200'
            }`}
          >
            {AUTO_STATUS[autoPhase]}
          </button>
        )}
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
        {flash && (
          <div
            data-testid="scan-flash"
            data-kind={flash}
            className={`pointer-events-none absolute inset-0 ${flash === 'success' ? 'bg-green-500/35' : 'bg-red-600/40'}`}
          />
        )}
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

      {/* Controls at the bottom, within thumb reach of a phone in a stand. */}
      <div
        data-testid="scanner-controls"
        className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gray-900/90 border-t border-gray-800"
      >
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
          aria-label="Choose sets"
          title="Sets you are scanning: used when a set code is misread"
          onClick={() => setPickingSets(true)}
          className={`px-3 py-2 rounded-lg text-sm font-bold border ${
            pickedSets.length
              ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
              : 'bg-gray-800 border-gray-700 text-gray-400'
          }`}
        >
          {pickedLabel(pickedSets)}
        </button>
        <button
          type="button"
          aria-label="Auto capture"
          aria-pressed={autoOn}
          title="Hands-free: scan each card once it settles (needs a calibrated rig)"
          onClick={toggleAuto}
          className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border ${
            autoOn ? 'bg-green-500/20 border-green-400 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-400'
          }`}
        >
          <AutoIcon size={14} aria-hidden="true" />Auto
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
          title={cropMissed
            ? 'Last photo was not cropped (video frame or phone rotated) — tap to recalibrate'
            : 'Calibrate for your rig'}
          data-crop={cropMissed ? 'missed' : undefined}
          onClick={() => setCalibrating(true)}
          className={`p-2 rounded-lg border ${
            cropMissed
              ? 'bg-amber-500/20 border-amber-400 text-amber-300'
              : calibration
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
          }`}
        >
          <Crosshair size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Review (${total})`}
          title={attention > 0 ? `${attention} need attention` : undefined}
          onClick={() => setMode('review')}
          className="relative ml-auto px-3 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold"
        >
          Review ({total})
          {attention > 0 && (
            <span
              data-testid="review-badge"
              aria-hidden="true"
              className="absolute -top-2 -right-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center"
            >
              {attention}
            </span>
          )}
        </button>
      </div>

      {showHelp && (
        <div
          role="dialog"
          aria-label="How to scan"
          className="absolute inset-x-4 top-4 z-10 p-4 rounded-xl bg-gray-900/95 border border-gray-700 text-sm text-gray-200 shadow-xl"
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
            <li>Calibrated? Turn on Auto with the rig empty: once it says Ready, slide each card in and it scans by itself once the card is still. Take it out before the next one.</li>
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

      {showAutoSettings && (
        <AutoSettings
          settings={autoSettings}
          onChange={(next) => setAutoSettings(saveAutoSettings(getStorage(), next))}
          onRelearn={relearnAuto}
          onClose={() => setShowAutoSettings(false)}
        />
      )}

      {pickingSets && (
        <ScanSetPicker
          options={setOptions?.length ? setOptions : setCodes.map((code) => ({ code, name: code }))}
          selected={pickedSets}
          onChange={(codes) => {
            setPickedSets(codes);
            writePickedSets(codes);
          }}
          onClose={() => setPickingSets(false)}
        />
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

    </div>
  );
}
