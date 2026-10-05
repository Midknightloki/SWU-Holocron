import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles, HelpCircle, Crosshair, ScanLine as AutoIcon } from 'lucide-react';
import { calibratedGuide, clampRect, clearCalibration, cropFor, loadCalibration, orientationOf, saveCalibration, toStreamRect, videoCropFor } from '../utils/rigCalibration';
import { initialAutoState, loadAutoSettings, saveAutoSettings, stepAuto } from '../utils/autoCapture';
import { createFrameSampler } from '../utils/frameSampler';
import AutoSettings from './AutoSettings';
import RigCalibration from './RigCalibration';
import ScanSetPicker from './ScanSetPicker';
import { ScanService } from '../services/ScanService';
import { getCardQuantities } from '../utils/collectionHelpers';
import { capturePhoto, captureVideoFrame } from '../utils/frameCapture';
import { laplacianVariance } from '../utils/sharpness';
import { PhotoStore } from '../services/photoStore';
import { createScanQueue } from '../services/scanQueue';
import { levelReading } from '../utils/level';
import {
  addCapture, applyResult, clearDraft, countByStatus, emptyDraft, ensureBatch, loadDraft, markReading, markWaiting, removeRows, saveDraft,
  endBatch, setBatchName, setPricePaid, toWrites,
} from '../utils/scanDraft';
import ScanReview from './ScanReview';
import BatchReport from './BatchReport';
import { BatchService } from '../services/BatchService';
import { PricingService } from '../services/PricingService';

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

const REPORT_FAILED = "Cards added — the batch report couldn't be updated.";

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
  stuck: 'Scanned — remove card (tap here if the rig is empty)',
  rotate: 'Rotate phone to match calibration',
};
// Ignore the camera's first second: after a (re)start it can show black or
// mis-exposed frames for long enough to look like a settled card.
const AUTO_WARMUP_MS = 1000;
// "Remove card" this long suggests the baseline is wrong rather than a card
// being left in place, so the chip offers a re-learn.
const AUTO_STUCK_MS = 10000;

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

export default function CardScanner({ uid, collectionRef, setCodes, setOptions, collectionData = {}, onClose }) {
  const [draft, setDraft] = useState(() => loadDraft(getStorage(), uid));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const collectionRefData = useRef(collectionData);
  collectionRefData.current = collectionData;
  const [newCard, setNewCard] = useState(null);
  const newCardTimer = useRef(null);
  // Base sets, searched for a face-up leader that has no collector number.
  const baseSets = useMemo(
    () => (setOptions ?? []).filter((o) => o.isBaseSet).map((o) => o.code),
    [setOptions],
  );
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
  // The finished batch whose report is showing; closing it closes the scanner.
  const [reportBatchId, setReportBatchId] = useState(null);
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
  const autoOnRef = useRef(false);
  autoOnRef.current = autoOn;
  const [autoCapturing, setAutoCapturing] = useState(false);
  const cameraStartedAtRef = useRef(null);
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
      clearTimeout(newCardTimer.current);
      // Closed: stop reading. The saved batch keeps these rows as reading, and
      // the next session's queue reads them -- once, not twice.
      queueRef.current?.stop();
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
        cameraStartedAtRef.current = Date.now();
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

  // Each capture's result, whenever the background queue gets to it. No
  // flash: recognition problems show only as the Review badge.
  const handleResult = useCallback((id, result) => {
    if (!mountedRef.current) return;
    // A card not owned in any finish, and its first copy in this batch: a gap
    // closed. A little celebration.
    if (result.status === 'matched'
      && getCardQuantities(collectionRefData.current, result.set, result.number).total === 0
      && !draftRef.current.rows.some((r) => r.id !== id && r.status === 'matched'
        && r.set === result.set && r.number === result.number)) {
      setNewCard(result.name);
      clearTimeout(newCardTimer.current);
      newCardTimer.current = setTimeout(() => { if (mountedRef.current) setNewCard(null); }, 1500);
    }
    setDraft((d) => applyResult(d, id, result));
  }, []);
  const handleResultRef = useRef(handleResult);
  handleResultRef.current = handleResult;

  // Background recognition: captures are read a few at a time, so capturing
  // never waits on Gemini. Created once; reads current options through a ref.
  const scanOptionsRef = useRef(null);
  scanOptionsRef.current = { setCodes, hintSets: pickedSets, baseSets };
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createScanQueue({
      scan: async (image) => {
        const { setCodes: codes, hintSets, baseSets: bases } = scanOptionsRef.current;
        const result = await ScanService.scan(image, codes, { hintSets, baseSets: bases });
        if (result.error === 'quota') quotaRef.current = { limit: result.limit, resetsAt: result.resetsAt };
        return result;
      },
      getImage: (id) => PhotoStore.get(id),
      onResult: (id, result) => handleResultRef.current(id, result),
      onPause: (reason, ids) => {
        if (!mountedRef.current) return;
        if (reason === 'quota') setQuota(quotaRef.current ?? { limit: null, resetsAt: null });
        setDraft((d) => markWaiting(d, ids, reason));
      },
    });
  }

  const capture = useCallback(async (options) => {
    if (showAutoSettingsRef.current || pickingSetsRef.current || calibratingRef.current || helpOpenRef.current || quotaRef.current || cameraError || capturingRef.current) return;
    capturingRef.current = true;
    // A tap (or Space) with Auto on: tell Auto this card is done, or it would
    // settle a moment later and scan the same card again -- and commits add.
    // (`options` is a click event for taps; only the auto loop passes { auto: true }.)
    if (options?.auto !== true && autoOnRef.current && autoStateRef.current.phase !== 'learning') {
      autoStateRef.current = { ...autoStateRef.current, phase: 'captured', capturedAt: Date.now(), stillSince: null, anchor: null };
      setAutoPhase('captured');
    }
    // Foil is read at the tap, not after the photo resolves.
    const isFoil = foilStack;
    let shot = null;
    try {
      // Auto: an instant frame of the live stream, if it is sharp enough --
      // no shutter wait, the card can be pulled straight away. Blurry, or
      // "Always use full photos": a full photo as before. Taps use photos.
      if (options?.auto === true && !autoSettingsRef.current.fullPhotos) {
        // Only a sharp frame is kept (and encoded); otherwise a full photo.
        shot = captureVideoFrame({
          video: videoRef.current,
          crop: (source, width, height) => videoCropFor(calibration, width, height),
          accept: (gray, width, height) => laplacianVariance(gray, width, height) >= autoSettingsRef.current.sharpness,
        });
      }
      if (!shot) {
        shot = await capturePhoto({
          track: trackRef.current,
          video: videoRef.current,
          crop: (source, width, height) => cropFor(calibration, source, width, height),
        });
      }
    } catch {
      shot = null;
    } finally {
      capturingRef.current = false;
    }
    if (!mountedRef.current) return;
    if (!shot?.image) {
      // The only live warning left: nothing usable was captured.
      signal('error');
      return;
    }
    setLastCropped(Boolean(shot.cropped));
    const id = newId();
    await PhotoStore.put(id, shot.image);
    if (!mountedRef.current) return;
    setDraft((d) => addCapture(ensureBatch(d, Date.now(), newId()), { id, isFoil }));
    queueRef.current.enqueue(id);
  }, [calibration, cameraError, foilStack, signal]);
  captureRef.current = capture;

  // Hands-free capture: sample the calibrated card area ~10x a second and let
  // the reducer decide when a card has settled. Any open overlay or the daily
  // limit skips the tick. Sampling continues during a capture -- from
  // 'captured' the reducer can only re-arm -- so a swap made during the
  // exposure is still seen; a card that settles while a capture is in flight
  // is held in 'arriving' and captured as soon as the camera is free.
  useEffect(() => {
    if (!autoOn || mode !== 'camera' || !calibration) return undefined;
    if (!samplerRef.current) samplerRef.current = createFrameSampler();
    // The video may have restarted (e.g. back from Review): forget motion state.
    autoStateRef.current = { ...autoStateRef.current, previous: null, anchor: null, stillSince: null };
    const timer = setInterval(() => {
      if (helpOpenRef.current || calibratingRef.current || pickingSetsRef.current
        || showAutoSettingsRef.current || quotaRef.current) return;
      const now = Date.now();
      if (cameraStartedAtRef.current === null || now - cameraStartedAtRef.current < AUTO_WARMUP_MS) return;
      const video = videoRef.current;
      const vw = video?.videoWidth;
      const vh = video?.videoHeight;
      if (vw && vh && calibration.orientation !== orientationOf(vw, vh)) {
        setAutoPhase('rotate');
        return;
      }
      const rect = vw && vh
        ? clampRect(toStreamRect(calibration.rect, vw / vh, calibration.aspect))
        : calibration.rect;
      const frame = samplerRef.current(video, rect);
      if (!frame) return;
      const { state, event } = stepAuto(autoStateRef.current, frame, now, autoSettingsRef.current);
      if (event === 'capture' && capturingRef.current) {
        // Camera busy: keep the card pending; it fires again once free.
        autoStateRef.current = { ...state, phase: 'arriving' };
        setAutoPhase('arriving');
        return;
      }
      autoStateRef.current = state;
      setAutoPhase(state.phase === 'captured' && now - (state.capturedAt ?? now) > AUTO_STUCK_MS ? 'stuck' : state.phase);
      if (event === 'capture') {
        setAutoCapturing(true);
        Promise.resolve(captureRef.current?.({ auto: true }))
          .finally(() => { if (mountedRef.current) setAutoCapturing(false); });
      }
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
    // A new card area makes the old empty-rig baseline meaningless.
    autoStateRef.current = initialAutoState();
    setAutoPhase('learning');
  }, []);

  const clearRig = useCallback(() => {
    clearCalibration(getStorage());
    setCalibration(null);
    setLastCropped(null);
    setCalibrating(false);
    // Auto needs a calibration: don't leave a dead toggle looking switched on.
    setAutoOn(false);
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
    const row = draftRef.current.rows.find((r) => r.id === id);
    if (!row?.hasPhoto) return;
    // A retry also lifts a daily-limit pause (the limit may have reset).
    if (quotaRef.current) {
      quotaRef.current = null;
      setQuota(null);
    }
    setDraft((d) => markReading(d, id));
    queueRef.current.resume();
    queueRef.current.enqueue(id);
  }, []);

  // On open: cards still reading from a previous session go back in the queue
  // if their photo survived; otherwise they can't be read any more.
  useEffect(() => {
    let cancelled = false;
    // Waiting rows too: a daily-limit pause lasts until a new session.
    const unread = draftRef.current.rows.filter((r) => r.status === 'reading' || r.status === 'waiting');
    unread.forEach(async (row) => {
      const photo = row.hasPhoto ? await PhotoStore.get(row.id) : null;
      if (cancelled || !mountedRef.current) return;
      if (photo) {
        if (row.status === 'waiting') setDraft((d) => markReading(d, row.id));
        queueRef.current.enqueue(row.id);
      }
      else setDraft((d) => applyResult(d, row.id, { status: 'failed', error: 'interrupted' }));
    });
    // Back online: lift an offline pause only -- a daily-limit pause stays
    // until a Retry or a new session -- and show those cards reading again.
    const onOnline = () => {
      const waiting = draftRef.current.rows.filter((r) => r.status === 'waiting' && r.reason === 'offline');
      queueRef.current.resume('offline');
      if (waiting.length) setDraft((d) => waiting.reduce((next, row) => markReading(next, row.id), d));
    };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Rows that leave the batch (added, removed, collapsed, discarded) take
  // their photos with them, so the store doesn't grow forever.
  const prevIdsRef = useRef(null);
  useEffect(() => {
    const ids = new Set(draft.rows.map((r) => r.id));
    const prev = prevIdsRef.current;
    prevIdsRef.current = ids;
    if (!prev) return;
    const gone = [...prev].filter((id) => !ids.has(id));
    if (gone.length) PhotoStore.remove(gone);
  }, [draft]);

  // Appends lines -- and any a failed append left pending -- to the batch's
  // report. Success marks the batch appended (so emptying the draft finishes
  // it); failure keeps the lines on the batch for a retry, never losing them.
  const recordBatch = useCallback(async (batch, newLines) => {
    const all = [...(batch.pending ?? []), ...newLines];
    if (all.length === 0) return true;
    const res = await BatchService.appendToBatch(uid, batch, all);
    const ok = !res?.error;
    const patch = ok
      ? { appended: true, pending: [], syncedName: batch.name, syncedPricePaid: batch.pricePaid ?? null }
      : { pending: all };
    const apply = (d) => (d.batch?.id === batch.id ? { ...d, batch: { ...d.batch, ...patch } } : d);
    // Ahead of the re-render, so a Finish straight after sees the result.
    draftRef.current = apply(draftRef.current);
    saveDraft(getStorage(), uid, draftRef.current);
    if (mountedRef.current) setDraft(apply);
    return ok;
  }, [uid]);

  // Finish batch: close the batch and show its report. Lines a failed append
  // left pending go first; if they still can't be saved the batch stays open.
  // Rows still in the list (unread, unidentified) wait for the next batch.
  const finishBatch = useCallback(async () => {
    let { batch } = draftRef.current;
    if (!batch) return;
    if (batch.pending?.length) {
      if (!(await recordBatch(batch, []))) {
        if (mountedRef.current) setCommitError(REPORT_FAILED);
        return;
      }
      ({ batch } = draftRef.current);
    }
    if (batch.appended) await BatchService.closeBatch(uid, batch.id);
    if (!mountedRef.current) return;
    setDraft((d) => endBatch(d));
    if (batch.appended) setReportBatchId(batch.id);
  }, [uid, recordBatch]);

  const commit = useCallback(async ({ finish = false } = {}) => {
    if (!collectionRef) {
      setCommitError('Not connected to cloud storage.');
      return;
    }
    if (finish && toWrites(draft).length === 0) {
      setCommitting(true);
      setCommitError(null);
      try {
        await finishBatch();
      } finally {
        if (mountedRef.current) setCommitting(false);
      }
      return;
    }
    setCommitting(true);
    setCommitError(null);
    const { batch } = draft;
    // Batch report lines are built before the commit: "new" means not owned
    // in any finish before this Add. A price or detail that can't be had is
    // left null, never a reason to hold up the cards.
    const writes = toWrites(draft);
    const [details, prices] = batch && writes.length
      ? await Promise.all([
        Promise.all(writes.map((w) => ScanService.cardDetails(w.set, w.number))),
        PricingService.getBulkPrices(writes.map((w) => ({ cardId: w.collectionId, set: w.set, number: w.number, isFoil: w.isFoil })))
          .catch(() => ({})),
      ])
      : [[], {}];
    const lines = writes.map((w, i) => ({
      id: w.collectionId,
      set: w.set,
      number: w.number,
      name: w.name,
      type: details[i]?.type ?? null,
      rarity: details[i]?.rarity ?? null,
      aspects: details[i]?.aspects ?? [],
      variant: details[i]?.variant ?? null,
      isFoil: w.isFoil,
      qty: w.qty,
      isNew: getCardQuantities(collectionRefData.current, w.set, w.number).total === 0,
      priceAtAdd: typeof prices?.[w.collectionId]?.market === 'number' ? prices[w.collectionId].market : null,
      // No price for this finish: the other finish's, flagged in the report.
      priceIsFallback: Boolean(prices?.[w.collectionId]?.isFallback),
      rowIds: w.rowIds,
    }));
    const committedIds = new Set();
    const committedLines = () => lines
      .filter((l) => l.rowIds.every((rid) => committedIds.has(rid)))
      .map(({ rowIds, ...line }) => line);
    // Cards keep reading (and captures keep landing) while Add saves, so take
    // out only the rows that were committed. Replacing the batch with the
    // snapshot this save started from would revert anything that arrived
    // meanwhile -- a card matched mid-save went back to "reading" for good.
    const snapshotIds = draft.rows.map((r) => r.id);
    const dropCommitted = (next) => {
      const kept = new Set(next.rows.map((r) => r.id));
      const committed = snapshotIds.filter((id) => !kept.has(id));
      committed.forEach((id) => committedIds.add(id));
      const live = removeRows(draftRef.current, committed);
      // Persist synchronously: if the overlay closes mid-commit, the saved
      // batch must not still hold rows that were already added.
      saveDraft(getStorage(), uid, live);
      if (mountedRef.current) setDraft((d) => removeRows(d, committed));
      return live;
    };
    try {
      const rest = await ScanService.commitDraft(draft, collectionRef, {
        onProgress: (next) => { dropCommitted(next); },
      });
      if (!mountedRef.current) return;
      const live = dropCommitted(rest);
      // The cards are in; the report is a record of them. A failed append
      // says so (and can be retried), but never undoes or fails the Add. An
      // emptied batch is finished by the effect below, report and all.
      const reportFailed = batch ? !(await recordBatch(batch, committedLines())) : false;
      if (!mountedRef.current) return;
      if (reportFailed) {
        setCommitError(REPORT_FAILED);
        return;
      }
      if (finish) {
        await finishBatch();
      } else if (live.rows.length === 0) {
        // Only Finish ends a batch: back to scanning the rest of the box.
        if (batch) {
          setMode('camera');
        } else {
          clearDraft(getStorage(), uid);
          onClose();
        }
      }
    } catch (err) {
      console.error('Scan commit failed:', err);
      // Chunks saved before the failure are in the collection: report them.
      if (batch) await recordBatch(batch, committedLines());
      if (mountedRef.current) {
        setCommitError(err?.code === 'commit-in-progress'
          ? 'A previous save is still in progress. Wait for it to finish, then try again.'
          : "Some cards weren't saved. Try again — cards already added won't be added twice.");
      }
    } finally {
      if (mountedRef.current) setCommitting(false);
    }
  }, [collectionRef, draft, uid, onClose, recordBatch, finishBatch]);

  const retryReport = useCallback(async () => {
    const { batch } = draftRef.current;
    if (!batch?.pending?.length) return;
    setCommitting(true);
    setCommitError(null);
    const ok = await recordBatch(batch, []);
    if (!mountedRef.current) return;
    if (!ok) setCommitError(REPORT_FAILED);
    setCommitting(false);
  }, [recordBatch]);

  const discard = useCallback(() => {
    // This batch's photos go with its rows (the cleanup effect below); never
    // PhotoStore.clear(), which would take other accounts' batches too.
    clearDraft(getStorage(), uid);
    setDraft(emptyDraft());
    setMode('camera');
  }, [uid]);

  const counts = countByStatus(draft);
  const total = counts.reading + counts.matched + counts.unidentified + counts.failed + counts.waiting;
  const attention = counts.unidentified + counts.failed;

  if (reportBatchId) {
    return (
      <BatchReport
        uid={uid}
        batchId={reportBatchId}
        onClose={() => { setReportBatchId(null); onClose(); }}
        onDeleted={() => { setReportBatchId(null); onClose(); }}
      />
    );
  }

  if (mode === 'review') {
    return (
      <div className="fixed inset-0 z-50">
        <ScanReview
          draft={draft}
          onChange={setDraft}
          batch={draft.batch ?? null}
          onRetryReport={retryReport}
          onBatchChange={({ name, pricePaid }) => setDraft((d) => (name !== undefined ? setBatchName(d, name) : setPricePaid(d, pricePaid)))}
          collectionData={collectionData}
          onRetry={retry}
          onBack={() => setMode('camera')}
          onCommit={() => commit()}
          onFinish={() => commit({ finish: true })}
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
            aria-label={`Auto settings: ${autoCapturing ? 'Capturing… hold still' : AUTO_STATUS[autoPhase]}`}
            onClick={(e) => { e.stopPropagation(); setShowAutoSettings(true); }}
            className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold border ${
              autoPhase === 'captured' ? 'bg-green-500/20 border-green-400 text-green-300'
                : autoPhase === 'arriving' ? 'bg-yellow-500/20 border-yellow-400 text-yellow-300'
                  : 'bg-gray-900/80 border-gray-700 text-gray-200'
            }`}
          >
            {autoCapturing ? 'Capturing… hold still' : AUTO_STATUS[autoPhase]}
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
        {newCard && (
          <div
            data-testid="new-card-toast"
            role="status"
            className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 px-4 py-2 rounded-2xl bg-green-500 text-black font-black shadow-xl shadow-green-500/40 animate-bounce"
          >
            ✨ NEW: {newCard}
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
          {counts.reading > 0 && <span className="ml-1 text-xs font-normal">· reading {counts.reading}</span>}
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
