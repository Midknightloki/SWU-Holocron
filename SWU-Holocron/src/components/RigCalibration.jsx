import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ScanService } from '../services/ScanService';
import { boxToRect, cornerPoint, defaultRect, moveCorner, orientationOf } from '../utils/rigCalibration';

/**
 * Rig calibration: one photo of a card sitting in the user's rig, Gemini finds
 * the card, the user drags (or arrow-key nudges) the corners onto its edges,
 * and the rectangle is saved as fractions of the photo.
 *
 * Calibration never depends on Gemini: if the finder fails or finds nothing,
 * the user places the box by hand from a centred default.
 *
 * @environment:react
 */

const CORNERS = [
  { id: 'tl', label: 'Top-left corner' },
  { id: 'tr', label: 'Top-right corner' },
  { id: 'bl', label: 'Bottom-left corner' },
  { id: 'br', label: 'Bottom-right corner' },
];

const NUDGE = 0.005;
const ARROWS = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] };

export default function RigCalibration({ hasCalibration, onTakePhoto, onSave, onClear, onClose }) {
  const [step, setStep] = useState('ready'); // ready | working | adjust
  const [shot, setShot] = useState(null);
  const [rect, setRect] = useState(null);
  const [message, setMessage] = useState(null);
  const [dragging, setDragging] = useState(null);
  const areaRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const takePhoto = useCallback(async () => {
    setMessage(null);
    setStep('working');
    const photo = await onTakePhoto();
    if (!mountedRef.current) return;
    if (!photo?.image) {
      setStep('ready');
      setMessage("Couldn't take a photo. Check the camera, then try again.");
      return;
    }
    const located = await ScanService.locateCard(photo.image);
    if (!mountedRef.current) return;
    setShot(photo);
    if (located.found && located.box) {
      setRect(boxToRect(located.box));
      setMessage('Drag the corners onto the card’s edges if needed, then Save.');
    } else {
      setRect(defaultRect(photo.width, photo.height));
      setMessage(located.error
        ? "Couldn't reach the card finder — drag the corners onto the card."
        : "Couldn't find the card — drag the corners onto it.");
    }
    setStep('adjust');
  }, [onTakePhoto]);

  const pointToFraction = (e) => {
    const box = areaRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const p = pointToFraction(e);
    if (p) setRect((r) => moveCorner(r, dragging, p.x, p.y));
  };

  const onHandleKey = (corner) => (e) => {
    const delta = ARROWS[e.key];
    if (!delta) return;
    e.preventDefault();
    setRect((r) => {
      const p = cornerPoint(r, corner);
      return moveCorner(r, corner, p.x + delta[0], p.y + delta[1]);
    });
  };

  const save = () => onSave({ rect, source: shot.source, orientation: orientationOf(shot.width, shot.height) });

  const retake = () => {
    setShot(null);
    setRect(null);
    setMessage(null);
    setStep('ready');
  };

  return (
    <div
      role="dialog"
      aria-label="Calibrate rig"
      className="absolute inset-0 z-20 flex flex-col bg-gray-950 text-gray-100"
    >
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <h2 className="text-lg font-bold text-white">Calibrate rig</h2>
        {hasCalibration && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
          >
            Clear calibration
          </button>
        )}
      </div>

      {step !== 'adjust' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-gray-300">
            Put a card in the rig exactly as you will scan it, then tap Take photo.
          </p>
          {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
          <button
            type="button"
            onClick={takePhoto}
            disabled={step === 'working'}
            className="px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold disabled:opacity-50 flex items-center gap-2"
          >
            {step === 'working' && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {step === 'working' ? 'Finding the card…' : 'Take photo'}
          </button>
        </div>
      )}

      {step === 'adjust' && shot && rect && (
        <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
          <div
            ref={areaRef}
            className="relative max-h-full max-w-full touch-none select-none"
            style={{ aspectRatio: `${shot.width} / ${shot.height}`, height: '100%' }}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
          >
            <img
              src={`data:image/jpeg;base64,${shot.image}`}
              alt="Calibration photo"
              className="absolute inset-0 w-full h-full object-fill"
              draggable={false}
            />
            <div
              data-testid="calib-rect"
              data-rect={JSON.stringify(rect)}
              className="absolute border-2 border-yellow-400 bg-yellow-400/10"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
            />
            {CORNERS.map(({ id, label }) => {
              const p = cornerPoint(rect, id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    setDragging(id);
                  }}
                  onKeyDown={onHandleKey(id)}
                  className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full bg-yellow-400 border-2 border-black shadow-lg touch-none"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800 space-y-2">
        {step === 'adjust' && message && <p className="text-sm text-gray-300">{message}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
          >
            Cancel
          </button>
          {step === 'adjust' && (
            <>
              <button
                type="button"
                onClick={retake}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={save}
                className="flex-1 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
              >
                Save
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
