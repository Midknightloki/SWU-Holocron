/**
 * @vitest-environment happy-dom
 * @integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import CardSubmissionForm from '../../components/CardSubmissionForm';
import { AuthContext } from '../../contexts/AuthContext';

// Mock Firebase
vi.mock('../../firebase', () => ({
  db: {},
  storage: {},
  APP_ID: 'swu-holocron-v1',
  isConfigured: true
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => new Date())
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(() => Promise.resolve('https://example.com/image.jpg'))
}));

// Mock duplicate detection
vi.mock('../../utils/duplicateDetection', () => ({
  findPotentialDuplicates: vi.fn(() => Promise.resolve([]))
}));

describe('CardSubmissionForm', () => {
  const mockUser = {
    uid: 'test-uid-123',
    email: 'test@example.com'
  };

  const mockAuthContext = {
    user: mockUser,
    isAdmin: false,
    loading: false,
    adminLoading: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderForm = (authOverrides = {}) => {
    return render(
      <AuthContext.Provider value={{ ...mockAuthContext, ...authOverrides }}>
        <CardSubmissionForm />
      </AuthContext.Provider>
    );
  };

  describe('Authentication', () => {
    it('should show sign-in message when not authenticated', () => {
      render(
        <AuthContext.Provider value={{ ...mockAuthContext, user: null }}>
          <CardSubmissionForm />
        </AuthContext.Provider>
      );

      expect(screen.getByText(/sign in/i)).toBeInTheDocument();
    });

    it('should show form when authenticated', () => {
      renderForm();

      expect(screen.getByText(/Submit Missing Card/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Official Card Code/i)).toBeInTheDocument();
    });
  });

  describe('Form Fields', () => {
    it('should render all required form fields', () => {
      renderForm();

      expect(screen.getByLabelText(/Official Card Code/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Card Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Set/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Card Number/i)).toBeInTheDocument();
      expect(screen.getByText(/Upload Card Image/i)).toBeInTheDocument();
    });

    it('should accept text input in form fields', async () => {
      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);
      const nameInput = screen.getByLabelText(/Card Name/i);

      await user.type(codeInput, 'SOR-042');
      await user.type(nameInput, 'Luke Skywalker');

      expect(codeInput).toHaveValue('SOR-042');
      expect(nameInput).toHaveValue('Luke Skywalker');
    });

    it('should validate official code format', async () => {
      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);

      await user.type(codeInput, 'INVALID');
      await user.tab(); // Blur to trigger validation

      await waitFor(() => {
        expect(screen.queryByText(/invalid.*code/i)).toBeInTheDocument();
      });
    });

    it('should accept valid official code formats', async () => {
      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);

      const validCodes = ['SOR-042', 'G25-3', 'I01-001', '01010042'];

      for (const code of validCodes) {
        await user.clear(codeInput);
        await user.type(codeInput, code);
        await user.tab();

        // Should not show error for valid codes
        expect(screen.queryByText(/invalid.*code/i)).not.toBeInTheDocument();
      }
    });
  });

  describe('Image Upload', () => {
    it('should show image upload area', () => {
      renderForm();

      expect(screen.getByText(/Upload Card Image/i)).toBeInTheDocument();
      expect(screen.getByText(/front.*card/i)).toBeInTheDocument();
    });

    it('should accept image file upload', async () => {
      renderForm();

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/card\.jpg/i)).toBeInTheDocument();
      });
    });

    it('should show preview after image upload', async () => {
      renderForm();

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });

      await userEvent.upload(input, file);

      await waitFor(() => {
        const img = screen.getByAltText(/preview/i);
        expect(img).toBeInTheDocument();
      });
    });

    it('should allow removing uploaded image', async () => {
      renderForm();

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/card\.jpg/i)).toBeInTheDocument();
      });

      const removeButton = screen.getByRole('button', { name: /remove/i });
      await userEvent.click(removeButton);

      expect(screen.queryByText(/card\.jpg/i)).not.toBeInTheDocument();
    });

    it('should validate image file type', async () => {
      renderForm();

      const file = new File(['dummy'], 'card.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/invalid.*file.*type/i)).toBeInTheDocument();
      });
    });

    it('should validate image file size', async () => {
      renderForm();

      // Create a large file (> 10MB)
      const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.jpg', {
        type: 'image/jpeg'
      });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });

      await userEvent.upload(input, largeFile);

      await waitFor(() => {
        expect(screen.getByText(/file.*too.*large/i)).toBeInTheDocument();
      });
    });
  });

  describe('Duplicate Detection', () => {
    it('should check for duplicates on code entry', async () => {
      const { findPotentialDuplicates } = await import('../../utils/duplicateDetection');
      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);
      await user.type(codeInput, 'SOR-042');
      await user.tab();

      await waitFor(() => {
        expect(findPotentialDuplicates).toHaveBeenCalled();
      });
    });

    it('should display duplicate warning when duplicates found', async () => {
      const { findPotentialDuplicates } = await import('../../utils/duplicateDetection');
      findPotentialDuplicates.mockResolvedValue([
        {
          id: 'card-123',
          Name: 'Luke Skywalker',
          Set: 'SOR',
          Number: '042',
          matchScore: 0.95
        }
      ]);

      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);
      await user.type(codeInput, 'SOR-042');
      await user.tab();

      await waitFor(() => {
        expect(screen.getByText(/potential.*duplicate/i)).toBeInTheDocument();
        expect(screen.getByText(/Luke Skywalker/i)).toBeInTheDocument();
      });
    });

    it('should show match score for duplicates', async () => {
      const { findPotentialDuplicates } = await import('../../utils/duplicateDetection');
      findPotentialDuplicates.mockResolvedValue([
        {
          id: 'card-123',
          Name: 'Luke Skywalker',
          matchScore: 0.95
        }
      ]);

      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);
      await user.type(codeInput, 'SOR-042');
      await user.tab();

      await waitFor(() => {
        expect(screen.getByText(/95%/i)).toBeInTheDocument();
      });
    });

    it('should not show warning when no duplicates found', async () => {
      const { findPotentialDuplicates } = await import('../../utils/duplicateDetection');
      findPotentialDuplicates.mockResolvedValue([]);

      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);
      await user.type(codeInput, 'SOR-999');
      await user.tab();

      await waitFor(() => {
        expect(findPotentialDuplicates).toHaveBeenCalled();
      });

      expect(screen.queryByText(/potential.*duplicate/i)).not.toBeInTheDocument();
    });
  });

  describe('Form Submission', () => {
    it('should disable submit button when form is invalid', () => {
      renderForm();

      const submitButton = screen.getByRole('button', { name: /submit/i });
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when form is valid', async () => {
      const user = userEvent.setup();
      renderForm();

      // Fill required fields
      await user.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');
      await user.type(screen.getByLabelText(/Card Name/i), 'Luke Skywalker');

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });
      await userEvent.upload(input, file);

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /submit/i });
        expect(submitButton).not.toBeDisabled();
      });
    });

    it('should submit form with valid data', async () => {
      const { addDoc } = await import('firebase/firestore');
      addDoc.mockResolvedValue({ id: 'submission-123' });

      const user = userEvent.setup();
      renderForm();

      // Fill form
      await user.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');
      await user.type(screen.getByLabelText(/Card Name/i), 'Luke Skywalker');

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });
      await userEvent.upload(input, file);

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /submit/i });
        expect(submitButton).not.toBeDisabled();
      });

      const submitButton = screen.getByRole('button', { name: /submit/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(addDoc).toHaveBeenCalled();
      });
    });

    it('should show success message after submission', async () => {
      const { addDoc } = await import('firebase/firestore');
      addDoc.mockResolvedValue({ id: 'submission-123' });

      const user = userEvent.setup();
      renderForm();

      // Fill and submit form
      await user.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');
      await user.type(screen.getByLabelText(/Card Name/i), 'Luke Skywalker');

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });
      await userEvent.upload(input, file);

      const submitButton = screen.getByRole('button', { name: /submit/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/success/i)).toBeInTheDocument();
      });
    });

    it('should clear form after successful submission', async () => {
      const { addDoc } = await import('firebase/firestore');
      addDoc.mockResolvedValue({ id: 'submission-123' });

      const user = userEvent.setup();
      renderForm();

      const codeInput = screen.getByLabelText(/Official Card Code/i);
      const nameInput = screen.getByLabelText(/Card Name/i);

      await user.type(codeInput, 'SOR-042');
      await user.type(nameInput, 'Luke Skywalker');

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });
      await userEvent.upload(input, file);

      const submitButton = screen.getByRole('button', { name: /submit/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(codeInput).toHaveValue('');
        expect(nameInput).toHaveValue('');
      });
    });

    it('should handle submission errors gracefully', async () => {
      const { addDoc } = await import('firebase/firestore');
      addDoc.mockRejectedValue(new Error('Submission failed'));

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');
      await user.type(screen.getByLabelText(/Card Name/i), 'Luke Skywalker');

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });
      await userEvent.upload(input, file);

      const submitButton = screen.getByRole('button', { name: /submit/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });
  });

  describe('Official URL Integration', () => {
    it('should show link to official card list', () => {
      renderForm();

      const link = screen.getByText(/starwarsunlimited\.com\/cards/i);
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', 'https://www.starwarsunlimited.com/cards');
    });

    it('should accept pasted official URL', async () => {
      const user = userEvent.setup();
      renderForm();

      const urlInput = screen.getByPlaceholderText(/paste.*url/i);
      await user.type(urlInput, 'https://www.starwarsunlimited.com/cards/sor/042');

      expect(urlInput).toHaveValue('https://www.starwarsunlimited.com/cards/sor/042');
    });

    it('should extract code from official URL', async () => {
      const user = userEvent.setup();
      renderForm();

      const urlInput = screen.getByPlaceholderText(/paste.*url/i);
      await user.type(urlInput, 'https://www.starwarsunlimited.com/cards/sor/042');
      await user.tab();

      await waitFor(() => {
        const codeInput = screen.getByLabelText(/Official Card Code/i);
        expect(codeInput).toHaveValue('SOR-042');
      });
    });
  });
});
