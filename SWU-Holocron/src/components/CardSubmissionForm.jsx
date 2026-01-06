import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Upload,
  X,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Loader,
  FileImage
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { storage, db, APP_ID } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import {
  printedToFullCode,
  parseOfficialCode,
  officialToInternal,
  isPrintedFormat,
  isSpecialSet
} from '../utils/officialCodeUtils';
import { createSubmission, validateSubmission } from '../utils/submissionTypes';
import { checkForDuplicates, getDuplicateWarningMessage } from '../utils/duplicateDetection';

export default function CardSubmissionForm({ onSuccess, onCancel }) {
  const { user } = useAuth();

  // Submission mode: 'officialUrl' or 'manual'
  const [submissionMode, setSubmissionMode] = useState('officialUrl');

  // Form state
  const [formData, setFormData] = useState({
    officialCode: '',
    name: '',
    subtitle: '',
    type: 'Unit',
    aspects: [],
    traits: [],
    cost: '',
    power: '',
    hp: '',
    text: '',
    doubleSided: false,
    unique: false,
    rarity: 'Common',
    artist: '',
    officialUrl: ''
  });

  // Image state
  const [frontImage, setFrontImage] = useState(null);
  const [backImage, setBackImage] = useState(null);
  const [frontPreview, setFrontPreview] = useState(null);
  const [backPreview, setBackPreview] = useState(null);

  // Camera state
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [capturingFor, setCapturingFor] = useState(null); // 'front' or 'back'
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Validation state
  const [duplicates, setDuplicates] = useState([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [errors, setErrors] = useState([]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Aspect options
  const aspectOptions = ['Aggression', 'Command', 'Cunning', 'Heroism', 'Villainy', 'Vigilance'];
  const typeOptions = ['Leader', 'Unit', 'Event', 'Upgrade', 'Base'];
  const rarityOptions = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Special'];

  // Auto-parse official code when entered
  useEffect(() => {
    if (formData.officialCode && isPrintedFormat(formData.officialCode)) {
      try {
        const fullCode = printedToFullCode(formData.officialCode, formData.type);
        const parsed = parseOfficialCode(fullCode);

        // Auto-fill set and number
        setFormData(prev => ({
          ...prev,
          set: parsed.internalSet,
          number: parsed.paddedNumber
        }));
      } catch (error) {
        console.error('Error parsing official code:', error);
      }
    }
  }, [formData.officialCode, formData.type]);

  // Check for duplicates when key fields change
  useEffect(() => {
    const checkDuplicates = async () => {
      if (!formData.officialCode && !formData.name) return;

      setCheckingDuplicates(true);
      try {
        const fullCode = isPrintedFormat(formData.officialCode)
          ? printedToFullCode(formData.officialCode, formData.type)
          : formData.officialCode;

        const internal = formData.officialCode ? officialToInternal(fullCode) : {};

        const results = await checkForDuplicates({
          OfficialCode: formData.officialCode,
          Set: internal.set || formData.set,
          Number: internal.number || formData.number,
          Name: formData.name,
          Subtitle: formData.subtitle
        });

        setDuplicates(results);
      } catch (error) {
        console.error('Error checking duplicates:', error);
      } finally {
        setCheckingDuplicates(false);
      }
    };

    const debounce = setTimeout(checkDuplicates, 500);
    return () => clearTimeout(debounce);
  }, [formData.officialCode, formData.name, formData.subtitle, formData.type]);

  // Handle image file selection
  const handleFileSelect = (event, side) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be smaller than 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (side === 'front') {
        setFrontImage(file);
        setFrontPreview(reader.result);
      } else {
        setBackImage(file);
        setBackPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Start camera for image capture
  const startCamera = async (side) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      setCameraStream(stream);
      setCapturingFor(side);
      setShowCamera(true);

      // Wait for video element to be ready
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert('Could not access camera. Please check permissions.');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
    setCapturingFor(null);
  };

  // Capture image from camera
  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      const file = new File([blob], `card-${capturingFor}-${Date.now()}.jpg`, {
        type: 'image/jpeg'
      });

      const reader = new FileReader();
      reader.onloadend = () => {
        if (capturingFor === 'front') {
          setFrontImage(file);
          setFrontPreview(reader.result);
        } else {
          setBackImage(file);
          setBackPreview(reader.result);
        }
        stopCamera();
      };
      reader.readAsDataURL(file);
    }, 'image/jpeg', 0.9);
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors([]);

    if (!user || user.isAnonymous) {
      setErrors(['You must be signed in to submit cards']);
      return;
    }

    // Validate based on submission mode
    if (submissionMode === 'officialUrl') {
      if (!formData.officialUrl) {
        setErrors(['Official URL is required when using URL submission mode']);
        return;
      }
      // URL mode doesn't require image or other fields
    } else {
      // Manual mode validation
      if (!frontImage) {
        setErrors(['Front card image is required for manual submissions']);
        return;
      }

      if (formData.doubleSided && !backImage) {
        setErrors(['Back image is required for double-sided cards']);
        return;
      }

      if (!formData.name) {
        setErrors(['Card name is required for manual submissions']);
        return;
      }
    }

    // Check for exact duplicates (only in manual mode)
    if (submissionMode === 'manual') {
      const exactDuplicate = duplicates.find(d => d.matchScore === 1.0);
      if (exactDuplicate) {
        const confirm = window.confirm(
          `This card (${exactDuplicate.name}) already exists in the database. Do you still want to submit it?`
        );
        if (!confirm) return;
      }
    }

    setSubmitting(true);
    setProgress(0);

    try {
      let frontUrl = null;
      let backUrl = null;
      let frontPath = null;
      let backPath = null;
      let cardData = null;

      if (submissionMode === 'officialUrl') {
        // URL-only submission
        setProgress(50);
        cardData = {
          OfficialUrl: formData.officialUrl,
          SubmissionMode: 'url',
          Name: formData.name || 'Unknown',
          UserSubmitted: true,
          SubmittedBy: user.uid
        };
      } else {
        // Manual submission with images
        // 1. Upload images to Firebase Storage
        setProgress(20);
        const submissionId = `${Date.now()}_${user.uid.substring(0, 8)}`;
        frontPath = `user-submissions/${user.uid}/${submissionId}/front.jpg`;
        const frontRef = ref(storage, frontPath);
        await uploadBytes(frontRef, frontImage);
        frontUrl = await getDownloadURL(frontRef);

        if (backImage) {
          setProgress(40);
          backPath = `user-submissions/${user.uid}/${submissionId}/back.jpg`;
          const backRef = ref(storage, backPath);
          await uploadBytes(backRef, backImage);
          backUrl = await getDownloadURL(backRef);
        }

        // 2. Prepare card data
        setProgress(60);
        const fullCode = isPrintedFormat(formData.officialCode)
          ? printedToFullCode(formData.officialCode, formData.type)
          : formData.officialCode;

        const internal = formData.officialCode ? officialToInternal(fullCode) : {};

        cardData = {
          OfficialCode: formData.officialCode || undefined,
          OfficialCodeFull: fullCode || undefined,
          Set: internal.set || formData.set,
          Number: internal.number || formData.number,
          Name: formData.name,
          Subtitle: formData.subtitle || undefined,
          Type: formData.type,
          Aspects: formData.aspects,
          Traits: formData.traits.length > 0 ? formData.traits : undefined,
          Cost: formData.cost ? parseInt(formData.cost) : null,
          Power: formData.power ? parseInt(formData.power) : null,
          HP: formData.hp ? parseInt(formData.hp) : null,
          Text: formData.text || undefined,
          DoubleSided: formData.doubleSided,
          Unique: formData.unique,
          Rarity: formData.rarity,
          Artist: formData.artist || undefined,
          ImageSource: 'user-upload',
          SubmissionMode: 'manual',
          UserSubmitted: true,
          SubmittedBy: user.uid
        };
      }

      // 3. Create submission object
      const submission = createSubmission(
        user.uid,
        user.email,
        cardData,
        {
          frontUrl,
          backUrl,
          frontPath,
          backPath
        }
      );

      submission.submissionMode = submissionMode;
      submission.officialUrl = formData.officialUrl || null;
      submission.possibleDuplicates = submissionMode === 'manual' ? duplicates : [];

      // 4. Validate submission
      const validation = validateSubmission(submission, submissionMode);
      if (!validation.valid) {
        setErrors(validation.errors);
        setSubmitting(false);
        return;
      }

      // 5. Save to Firestore
      setProgress(80);
      const submissionsRef = collection(db, 'artifacts', APP_ID, 'submissions');
      const docRef = await addDoc(submissionsRef, {
        ...submission,
        status: 'pending',
        submittedAt: serverTimestamp()
      });

      setProgress(100);

      // Success!
      if (onSuccess) {
        onSuccess(docRef.id);
      } else {
        alert('Card submitted successfully! It will be reviewed by an admin.');
        window.location.reload();
      }

    } catch (error) {
      console.error('Error submitting card:', error);
      setErrors([`Submission failed: ${error.message}`]);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle aspect selection
  const toggleAspect = (aspect) => {
    setFormData(prev => ({
      ...prev,
      aspects: prev.aspects.includes(aspect)
        ? prev.aspects.filter(a => a !== aspect)
        : [...prev.aspects, aspect]
    }));
  };

  return (
    <div className="max-w-4xl mx-auto bg-gray-800 border border-gray-700 rounded-lg p-6">
      <h2 className="text-2xl font-bold text-white mb-6">Submit Missing Card</h2>

      {/* Instructions */}
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-300">
          Help expand the database by submitting missing cards. Find the official card at{' '}
          <a
            href="https://starwarsunlimited.com/cards"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1"
          >
            starwarsunlimited.com/cards
            <ExternalLink className="w-3 h-3" />
          </a>
          {' '}and provide either the URL to the card or manually enter its details.
        </p>
      </div>

      {/* Submission Mode Toggle */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Submission Method *
        </label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setSubmissionMode('officialUrl')}
            className={`p-4 rounded-lg border-2 transition-all ${
              submissionMode === 'officialUrl'
                ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                : 'border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500'
            }`}
          >
            <ExternalLink className="w-6 h-6 mx-auto mb-2" />
            <div className="font-semibold">Official URL</div>
            <div className="text-xs mt-1">Provide link from starwarsunlimited.com</div>
          </button>
          <button
            type="button"
            onClick={() => setSubmissionMode('manual')}
            className={`p-4 rounded-lg border-2 transition-all ${
              submissionMode === 'manual'
                ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                : 'border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500'
            }`}
          >
            <FileImage className="w-6 h-6 mx-auto mb-2" />
            <div className="font-semibold">Manual Entry</div>
            <div className="text-xs mt-1">Upload images and enter details</div>
          </button>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-400">Please fix the following errors:</p>
              <ul className="list-disc list-inside text-sm text-red-300 mt-2">
                {errors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate warning */}
      {duplicates.length > 0 && (
        <div className={`border rounded-lg p-4 mb-6 ${
          duplicates.some(d => d.matchScore === 1.0)
            ? 'bg-red-900/20 border-red-800'
            : 'bg-yellow-900/20 border-yellow-800'
        }`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
              duplicates.some(d => d.matchScore === 1.0) ? 'text-red-500' : 'text-yellow-500'
            }`} />
            <div>
              <p className={`font-semibold ${
                duplicates.some(d => d.matchScore === 1.0) ? 'text-red-400' : 'text-yellow-400'
              }`}>
                {getDuplicateWarningMessage(duplicates)}
              </p>
              <div className="mt-2 space-y-2">
                {duplicates.map((dup, idx) => (
                  <div key={idx} className="text-sm text-gray-300">
                    • {dup.name} ({dup.set} {dup.number}) - {dup.matchReason}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Official URL Field (prominently displayed in URL mode) */}
        {submissionMode === 'officialUrl' && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Official Card URL *
            </label>
            <input
              type="url"
              value={formData.officialUrl}
              onChange={(e) => setFormData({ ...formData, officialUrl: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              placeholder="https://starwarsunlimited.com/cards/..."
              required
            />
            <p className="text-sm text-gray-400 mt-2">
              Navigate to the card on starwarsunlimited.com and copy the URL from your browser.
            </p>
          </div>
        )}

        {/* Manual Entry Fields */}
        {submissionMode === 'manual' && (
          <>
            {/* Camera Modal */}
        {showCamera && (
          <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg"
                />

                {/* Card frame overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-4 border-4 border-yellow-500 rounded-lg opacity-50" />
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <p className="text-yellow-500 text-sm bg-black bg-opacity-70 px-3 py-1 rounded">
                      Align card within frame
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={captureImage}
                  className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold flex items-center gap-2"
                >
                  <Camera className="w-5 h-5" />
                  Capture
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {/* Image Upload Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Front Image */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Front Image *
            </label>

            {frontPreview ? (
              <div className="relative">
                <img
                  src={frontPreview}
                  alt="Front preview"
                  className="w-full h-64 object-contain bg-gray-900 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => {
                    setFrontImage(null);
                    setFrontPreview(null);
                  }}
                  className="absolute top-2 right-2 p-2 bg-red-600 hover:bg-red-700 rounded-full"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="flex items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-600 rounded-lg hover:border-gray-500 cursor-pointer">
                  <Upload className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-400">Choose File</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileSelect(e, 'front')}
                    className="hidden"
                  />
                </label>

                {navigator.mediaDevices && (
                  <button
                    type="button"
                    onClick={() => startCamera('front')}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-gray-700 hover:bg-gray-600 rounded-lg"
                  >
                    <Camera className="w-5 h-5" />
                    <span>Take Photo</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Back Image (if double-sided) */}
          {formData.doubleSided && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Back Image *
              </label>

              {backPreview ? (
                <div className="relative">
                  <img
                    src={backPreview}
                    alt="Back preview"
                    className="w-full h-64 object-contain bg-gray-900 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setBackImage(null);
                      setBackPreview(null);
                    }}
                    className="absolute top-2 right-2 p-2 bg-red-600 hover:bg-red-700 rounded-full"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="flex items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-600 rounded-lg hover:border-gray-500 cursor-pointer">
                    <Upload className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-400">Choose File</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFileSelect(e, 'back')}
                      className="hidden"
                    />
                  </label>

                  {navigator.mediaDevices && (
                    <button
                      type="button"
                      onClick={() => startCamera('back')}
                      className="w-full flex items-center justify-center gap-2 p-3 bg-gray-700 hover:bg-gray-600 rounded-lg"
                    >
                      <Camera className="w-5 h-5" />
                      <span>Take Photo</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Official Code */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Official Code * <span className="text-gray-500">(as printed on card, e.g., "G25-3" or "SOR-42")</span>
          </label>
          <input
            type="text"
            value={formData.officialCode}
            onChange={(e) => setFormData({ ...formData, officialCode: e.target.value.toUpperCase() })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            placeholder="G25-3"
            required
          />
          {checkingDuplicates && (
            <p className="text-sm text-gray-400 mt-1 flex items-center gap-2">
              <Loader className="w-4 h-4 animate-spin" />
              Checking for duplicates...
            </p>
          )}
        </div>

        {/* Official URL */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Official URL <span className="text-gray-500">(optional, from starwarsunlimited.com)</span>
          </label>
          <input
            type="url"
            value={formData.officialUrl}
            onChange={(e) => setFormData({ ...formData, officialUrl: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            placeholder="https://starwarsunlimited.com/..."
          />
        </div>

        {/* Card Name */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Card Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              placeholder="Obi-Wan Kenobi"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Subtitle <span className="text-gray-500">(if applicable)</span>
            </label>
            <input
              type="text"
              value={formData.subtitle}
              onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              placeholder="Jedi Master"
            />
          </div>
        </div>

        {/* Type and Rarity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Type *
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              required
            >
              {typeOptions.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Rarity *
            </label>
            <select
              value={formData.rarity}
              onChange={(e) => setFormData({ ...formData, rarity: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              required
            >
              {rarityOptions.map(rarity => (
                <option key={rarity} value={rarity}>{rarity}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Aspects */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Aspects
          </label>
          <div className="flex flex-wrap gap-2">
            {aspectOptions.map(aspect => (
              <button
                key={aspect}
                type="button"
                onClick={() => toggleAspect(aspect)}
                className={`px-4 py-2 rounded-lg border font-medium transition ${
                  formData.aspects.includes(aspect)
                    ? 'bg-yellow-600 border-yellow-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              >
                {aspect}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Cost
            </label>
            <input
              type="number"
              min="0"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              placeholder="-"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Power
            </label>
            <input
              type="number"
              min="0"
              value={formData.power}
              onChange={(e) => setFormData({ ...formData, power: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              placeholder="-"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              HP
            </label>
            <input
              type="number"
              min="0"
              value={formData.hp}
              onChange={(e) => setFormData({ ...formData, hp: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              placeholder="-"
            />
          </div>
        </div>

        {/* Card Text */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Card Text
          </label>
          <textarea
            value={formData.text}
            onChange={(e) => setFormData({ ...formData, text: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            rows={4}
            placeholder="Card abilities and text..."
          />
        </div>

        {/* Traits */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Traits <span className="text-gray-500">(comma-separated)</span>
          </label>
          <input
            type="text"
            value={formData.traits.join(', ')}
            onChange={(e) => setFormData({
              ...formData,
              traits: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
            })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            placeholder="Imperial, Official"
          />
        </div>

        {/* Artist */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Artist
          </label>
          <input
            type="text"
            value={formData.artist}
            onChange={(e) => setFormData({ ...formData, artist: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
            placeholder="Artist name"
          />
        </div>

        {/* Checkboxes */}
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.doubleSided}
              onChange={(e) => setFormData({ ...formData, doubleSided: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-gray-300">Double-Sided (Leader/Base)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.unique}
              onChange={(e) => setFormData({ ...formData, unique: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-gray-300">Unique Card</span>
          </label>
        </div>
        </>
        )}

        {/* Submit Buttons */}
        <div className="flex gap-4 pt-4 border-t border-gray-700">
          <button
            type="submit"
            disabled={submitting || (submissionMode === 'manual' && !frontImage) || (submissionMode === 'officialUrl' && !formData.officialUrl)}
            className="flex-1 px-6 py-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Submitting... {progress}%
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Submit Card
              </>
            )}
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-lg font-semibold"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
