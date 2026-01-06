/**
 * Type definitions and utilities for card submissions
 *
 * Schema for Firestore collection: artifacts/{APP_ID}/submissions/{submissionId}
 * Status is stored as a field in the document (pending, approved, rejected, processing)
 */

/**
 * @typedef {Object} OCRExtractedData
 * @property {string} cardName - Extracted card name
 * @property {string} subtitle - Extracted subtitle (if present)
 * @property {string} officialCode - Extracted official code (e.g., "G25-3")
 * @property {string} setCode - Extracted set code
 * @property {Object} confidence - Confidence scores for each field
 * @property {number} confidence.name - 0.0 to 1.0
 * @property {number} confidence.code - 0.0 to 1.0
 * @property {number} confidence.overall - 0.0 to 1.0
 */

/**
 * @typedef {Object} SubmittedCardData
 * @property {string} OfficialCode - Printed format (e.g., "G25-3")
 * @property {string} OfficialCodeFull - Full format (e.g., "G25090003")
 * @property {string} Set - Internal set code (e.g., "PROMO", "SOR")
 * @property {string} Number - Internal card number (e.g., "001", "042")
 * @property {string} Name - Card name
 * @property {string} [Subtitle] - Card subtitle (optional)
 * @property {string} Type - "Leader" | "Unit" | "Event" | "Upgrade" | "Base"
 * @property {string[]} Aspects - Array of aspects (e.g., ["Villainy", "Command"])
 * @property {string[]} [Traits] - Array of traits (optional)
 * @property {number} [Cost] - Resource cost (null for leaders)
 * @property {number} [Power] - Attack power (null if not applicable)
 * @property {number} [HP] - Health points (null if not applicable)
 * @property {string} [Text] - Card abilities/text
 * @property {boolean} DoubleSided - Whether card is double-sided
 * @property {boolean} [Unique] - Whether card is unique
 * @property {string} Rarity - "Common" | "Uncommon" | "Rare" | "Legendary" | "Special"
 * @property {string} [Artist] - Artist name
 */

/**
 * @typedef {Object} SubmissionImages
 * @property {string} frontUrl - Firebase Storage URL for front image
 * @property {string} [backUrl] - Firebase Storage URL for back image (if double-sided)
 * @property {string} [frontPath] - Storage path for front image
 * @property {string} [backPath] - Storage path for back image
 */

/**
 * @typedef {Object} PossibleDuplicate
 * @property {string} id - Existing card ID
 * @property {string} officialCode - Existing card's official code
 * @property {string} set - Existing card's set
 * @property {string} number - Existing card's number
 * @property {string} name - Existing card's name
 * @property {number} matchScore - 0.0 to 1.0 similarity score
 * @property {string} matchReason - Why this was flagged as duplicate
 */

/**
 * @typedef {Object} CardSubmission
 * @property {string} id - Submission document ID
 * @property {string} userId - Submitting user's UID
 * @property {string} userEmail - Submitting user's email
 * @property {Date} submittedAt - Submission timestamp
 * @property {"pending" | "approved" | "rejected" | "processing"} status
 * @property {OCRExtractedData} [extractedData] - OCR results (if OCR was used)
 * @property {SubmittedCardData} submittedData - User-confirmed card data
 * @property {SubmissionImages} images - Image URLs and paths
 * @property {string} [officialUrl] - URL from starwarsunlimited.com if provided
 * @property {PossibleDuplicate[]} possibleDuplicates - Potential duplicate cards
 * @property {string} [reviewedBy] - Admin UID who reviewed
 * @property {Date} [reviewedAt] - Review timestamp
 * @property {string} [reviewNotes] - Admin notes/comments
 * @property {string} [rejectionReason] - Why submission was rejected
 */

/**
 * Create a new submission object with default values
 * @param {string} userId - User ID
 * @param {string} userEmail - User email
 * @param {SubmittedCardData} cardData - Card data
 * @param {SubmissionImages} images - Image data
 * @returns {Omit<CardSubmission, 'id'>} Submission object ready for Firestore
 */
export function createSubmission(userId, userEmail, cardData, images) {
  return {
    userId,
    userEmail,
    submittedAt: new Date(),
    status: 'pending',
    submittedData: cardData,
    images,
    possibleDuplicates: [],
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: '',
    rejectionReason: null
  };
}

/**
 * Validate submission data before saving
 * @param {Partial<CardSubmission>} submission - Submission to validate
 * @param {string} [mode='manual'] - Submission mode ('officialUrl' or 'manual')
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSubmission(submission, mode = 'manual') {
  const errors = [];

  // Required user data
  if (!submission.userId) errors.push('User ID is required');
  if (!submission.userEmail) errors.push('User email is required');

  // For officialUrl mode, only require the URL
  if (mode === 'officialUrl') {
    if (!submission.officialUrl) {
      errors.push('Official card URL is required');
    }
    // Validate URL format
    if (submission.officialUrl && !submission.officialUrl.includes('starwarsunlimited.com')) {
      errors.push('URL must be from starwarsunlimited.com');
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Required card data (manual mode)
  const data = submission.submittedData;
  if (!data) {
    errors.push('Card data is required');
    return { valid: false, errors };
  }

  if (!data.Name) errors.push('Card name is required');
  // Official code not required if URL is provided
  if (!data.OfficialCode && !submission.officialUrl) {
    errors.push('Official code is required (unless Official URL is provided)');
  }

  // Type validation (optional but if provided must be valid)
  const validTypes = ['Leader', 'Unit', 'Event', 'Upgrade', 'Base'];
  if (data.Type && !validTypes.includes(data.Type)) {
    errors.push(`Invalid card type: ${data.Type}`);
  }

  const validRarities = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Special'];
  if (data.Rarity && !validRarities.includes(data.Rarity)) {
    errors.push(`Invalid rarity: ${data.Rarity}`);
  }

  // Required images (manual mode)
  if (!submission.images || !submission.images.frontUrl) {
    errors.push('Front card image is required');
  }

  // Double-sided cards need back image
  if (data.DoubleSided && (!submission.images || !submission.images.backUrl)) {
    errors.push('Back image is required for double-sided cards');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get human-readable status display text
 * @param {"pending" | "approved" | "rejected" | "processing"} status
 * @returns {string}
 */
export function getStatusDisplayText(status) {
  const statusMap = {
    pending: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
    processing: 'Processing...'
  };
  return statusMap[status] || status;
}

/**
 * Get status color for UI display
 * @param {"pending" | "approved" | "rejected" | "processing"} status
 * @returns {string} Tailwind color class
 */
export function getStatusColor(status) {
  const colorMap = {
    pending: 'text-yellow-500',
    approved: 'text-green-500',
    rejected: 'text-red-500',
    processing: 'text-blue-500'
  };
  return colorMap[status] || 'text-gray-500';
}

/**
 * Check if user can edit a submission
 * @param {CardSubmission} submission
 * @param {string} userId
 * @param {boolean} isAdmin
 * @returns {boolean}
 */
export function canEditSubmission(submission, userId, isAdmin) {
  // Admins can always edit
  if (isAdmin) return true;

  // Users can only edit their own pending submissions
  return submission.userId === userId && submission.status === 'pending';
}

/**
 * Check if user can delete a submission
 * @param {CardSubmission} submission
 * @param {string} userId
 * @param {boolean} isAdmin
 * @returns {boolean}
 */
export function canDeleteSubmission(submission, userId, isAdmin) {
  // Admins can always delete
  if (isAdmin) return true;

  // Users can only delete their own pending submissions
  return submission.userId === userId && submission.status === 'pending';
}
