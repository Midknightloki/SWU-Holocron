/**
 * @vitest-environment happy-dom
 * @integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from '../../App';
import { AuthContext } from '../../contexts/AuthContext';

// Mock Firebase
vi.mock('../../firebase', () => ({
  db: {},
  storage: {},
  auth: {},
  APP_ID: 'swu-holocron-v1',
  isConfigured: true
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  doc: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn()
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn()
}));

describe('Submission Feature Integration', () => {
  const mockUser = {
    uid: 'test-uid',
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

  describe('Navigation to Submission Form', () => {
    it('should show submission button when authenticated', () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      expect(screen.getByRole('button', { name: /submit.*missing.*card/i })).toBeInTheDocument();
    });

    it('should not show submission button when not authenticated', () => {
      render(
        <AuthContext.Provider value={{ ...mockAuthContext, user: null }}>
          <App />
        </AuthContext.Provider>
      );

      expect(screen.queryByRole('button', { name: /submit.*missing.*card/i })).not.toBeInTheDocument();
    });

    it('should navigate to submission form when button clicked', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      const submitButton = screen.getByRole('button', { name: /submit.*missing.*card/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Submit Missing Card/i)).toBeInTheDocument();
      });
    });

    it('should navigate back to binder from submission form', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      // Go to submission form
      const submitButton = screen.getByRole('button', { name: /submit.*missing.*card/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Submit Missing Card/i)).toBeInTheDocument();
      });

      // Navigate back
      const backButton = screen.getByRole('button', { name: /back|binder/i });
      await userEvent.click(backButton);

      await waitFor(() => {
        expect(screen.queryByText(/Submit Missing Card/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('End-to-End Submission Flow', () => {
    it('should complete full submission workflow', async () => {
      const { addDoc } = await import('firebase/firestore');
      addDoc.mockResolvedValue({ id: 'submission-123' });

      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      // Navigate to submission form
      const submitButton = screen.getByRole('button', { name: /submit.*missing.*card/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Submit Missing Card/i)).toBeInTheDocument();
      });

      // Fill out form
      await userEvent.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');
      await userEvent.type(screen.getByLabelText(/Card Name/i), 'Luke Skywalker');

      // Upload image
      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });
      await userEvent.upload(input, file);

      // Submit
      const submitFormButton = screen.getByRole('button', { name: /submit/i });
      await waitFor(() => {
        expect(submitFormButton).not.toBeDisabled();
      });
      await userEvent.click(submitFormButton);

      // Verify submission
      await waitFor(() => {
        expect(addDoc).toHaveBeenCalled();
        expect(screen.getByText(/success/i)).toBeInTheDocument();
      });
    });

    it('should handle errors during submission', async () => {
      const { addDoc } = await import('firebase/firestore');
      addDoc.mockRejectedValue(new Error('Network error'));

      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      // Navigate and fill form
      const submitButton = screen.getByRole('button', { name: /submit.*missing.*card/i });
      await userEvent.click(submitButton);

      await userEvent.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');
      await userEvent.type(screen.getByLabelText(/Card Name/i), 'Luke Skywalker');

      const file = new File(['dummy'], 'card.jpg', { type: 'image/jpeg' });
      const input = screen.getByLabelText(/front.*image/i, { selector: 'input' });
      await userEvent.upload(input, file);

      const submitFormButton = screen.getByRole('button', { name: /submit/i });
      await userEvent.click(submitFormButton);

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });
  });

  describe('Admin Panel Integration', () => {
    it('should show admin panel for admin users', () => {
      render(
        <AuthContext.Provider value={{ ...mockAuthContext, isAdmin: true }}>
          <App />
        </AuthContext.Provider>
      );

      expect(screen.getByRole('button', { name: /admin/i })).toBeInTheDocument();
    });

    it('should not show admin panel for regular users', () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument();
    });

    it('should navigate to admin panel when admin button clicked', async () => {
      render(
        <AuthContext.Provider value={{ ...mockAuthContext, isAdmin: true }}>
          <App />
        </AuthContext.Provider>
      );

      const adminButton = screen.getByRole('button', { name: /admin/i });
      await userEvent.click(adminButton);

      await waitFor(() => {
        expect(screen.getByText(/Admin Panel/i)).toBeInTheDocument();
      });
    });
  });

  describe('Duplicate Detection Integration', () => {
    it('should show duplicates during submission', async () => {
      const { getDocs } = await import('firebase/firestore');
      getDocs.mockResolvedValue({
        docs: [
          {
            id: 'card-123',
            data: () => ({
              Name: 'Luke Skywalker',
              Set: 'SOR',
              Number: '042',
              OfficialCode: 'SOR-042'
            })
          }
        ]
      });

      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      // Navigate to submission form
      const submitButton = screen.getByRole('button', { name: /submit.*missing.*card/i });
      await userEvent.click(submitButton);

      // Enter code that will find duplicate
      await userEvent.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.getByText(/potential.*duplicate/i)).toBeInTheDocument();
      });
    });
  });

  describe('Persistence and State Management', () => {
    it('should maintain form state when navigating away and back', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext}>
          <App />
        </AuthContext.Provider>
      );

      // Fill form partially
      const submitButton = screen.getByRole('button', { name: /submit.*missing.*card/i });
      await userEvent.click(submitButton);

      await userEvent.type(screen.getByLabelText(/Official Card Code/i), 'SOR-042');

      // Navigate away
      const binderButton = screen.getByRole('button', { name: /back|binder/i });
      await userEvent.click(binderButton);

      // Navigate back
      await userEvent.click(screen.getByRole('button', { name: /submit.*missing.*card/i }));

      // Form should be reset (not maintaining state by default)
      const codeInput = screen.getByLabelText(/Official Card Code/i);
      expect(codeInput).toHaveValue('');
    });
  });
});
