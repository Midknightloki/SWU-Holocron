/**
 * @vitest-environment node
 * @unit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateSubmission, createSubmission } from '../../utils/submissionTypes';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

// Mock Firebase
vi.mock('../../firebase', () => ({
  db: {},
  storage: {},
  APP_ID: 'swu-holocron-v1'
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(() => new Date())
}));

describe('Card Submission Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateSubmission - Official URL mode', () => {
    it('should validate submission with only official URL', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        officialUrl: 'https://starwarsunlimited.com/cards/SOR_001'
      };

      const result = validateSubmission(submission, 'officialUrl');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject submission without official URL in officialUrl mode', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com'
      };

      const result = validateSubmission(submission, 'officialUrl');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Official card URL is required');
    });

    it('should reject submission with invalid URL domain', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        officialUrl: 'https://example.com/cards/SOR_001'
      };

      const result = validateSubmission(submission, 'officialUrl');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URL must be from starwarsunlimited.com');
    });

    it('should require userId and userEmail even in officialUrl mode', () => {
      const submission = {
        officialUrl: 'https://starwarsunlimited.com/cards/SOR_001'
      };

      const result = validateSubmission(submission, 'officialUrl');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('User ID is required');
      expect(result.errors).toContain('User email is required');
    });
  });

  describe('validateSubmission - Manual mode', () => {
    it('should validate complete manual submission', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        submittedData: {
          Name: 'Luke Skywalker',
          OfficialCode: 'SOR_001',
          Type: 'Unit',
          Set: 'SOR',
          Number: '001',
          Rarity: 'Rare',
          DoubleSided: false
        },
        images: {
          frontUrl: 'https://storage.googleapis.com/test/front.jpg'
        }
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject manual submission without front image', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        submittedData: {
          Name: 'Luke Skywalker',
          OfficialCode: 'SOR_001',
          Type: 'Unit',
          DoubleSided: false
        },
        images: {}
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Front card image is required');
    });

    it('should reject manual submission without card name', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        submittedData: {
          OfficialCode: 'SOR_001',
          Type: 'Unit',
          DoubleSided: false
        },
        images: {
          frontUrl: 'https://storage.googleapis.com/test/front.jpg'
        }
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Card name is required');
    });

    it('should require back image for double-sided cards', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        submittedData: {
          Name: 'Darth Vader',
          OfficialCode: 'SOR_002',
          Type: 'Leader',
          DoubleSided: true
        },
        images: {
          frontUrl: 'https://storage.googleapis.com/test/front.jpg'
        }
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Back image is required for double-sided cards');
    });

    it('should validate double-sided card with both images', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        submittedData: {
          Name: 'Darth Vader',
          OfficialCode: 'SOR_002',
          Type: 'Leader',
          DoubleSided: true
        },
        images: {
          frontUrl: 'https://storage.googleapis.com/test/front.jpg',
          backUrl: 'https://storage.googleapis.com/test/back.jpg'
        }
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid card type', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        submittedData: {
          Name: 'Luke Skywalker',
          Type: 'InvalidType',
          DoubleSided: false
        },
        images: {
          frontUrl: 'https://storage.googleapis.com/test/front.jpg'
        }
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid card type: InvalidType');
    });

    it('should reject invalid rarity', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        submittedData: {
          Name: 'Luke Skywalker',
          Type: 'Unit',
          Rarity: 'SuperRare',
          DoubleSided: false
        },
        images: {
          frontUrl: 'https://storage.googleapis.com/test/front.jpg'
        }
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid rarity: SuperRare');
    });

    it('should allow official code to be omitted if official URL is provided', () => {
      const submission = {
        userId: 'test-uid',
        userEmail: 'test@example.com',
        officialUrl: 'https://starwarsunlimited.com/cards/SOR_001',
        submittedData: {
          Name: 'Luke Skywalker',
          Type: 'Unit',
          DoubleSided: false
        },
        images: {
          frontUrl: 'https://storage.googleapis.com/test/front.jpg'
        }
      };

      const result = validateSubmission(submission, 'manual');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('createSubmission', () => {
    it('should create submission object with required fields', () => {
      const userId = 'test-uid';
      const userEmail = 'test@example.com';
      const cardData = {
        Name: 'Luke Skywalker',
        OfficialCode: 'SOR_001'
      };
      const images = {
        frontUrl: 'https://storage.googleapis.com/test/front.jpg'
      };

      const submission = createSubmission(userId, userEmail, cardData, images);

      expect(submission.userId).toBe(userId);
      expect(submission.userEmail).toBe(userEmail);
      expect(submission.submittedData).toEqual(cardData);
      expect(submission.images).toEqual(images);
      expect(submission.status).toBe('pending');
      expect(submission.possibleDuplicates).toEqual([]);
      expect(submission.reviewedBy).toBeNull();
      expect(submission.reviewedAt).toBeNull();
      expect(submission.reviewNotes).toBe('');
      expect(submission.rejectionReason).toBeNull();
      expect(submission.submittedAt).toBeInstanceOf(Date);
    });
  });
});
