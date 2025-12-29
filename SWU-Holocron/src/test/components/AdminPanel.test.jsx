/**
 * @vitest-environment happy-dom
 * @unit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import AdminPanel from '../../components/AdminPanel';
import { AuthContext } from '../../contexts/AuthContext';

// Mock Firebase
vi.mock('../../firebase', () => ({
  db: {},
  APP_ID: 'swu-holocron-v1',
  isConfigured: true
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn()
}));

describe('AdminPanel', () => {
  const mockAdminUser = {
    uid: 'admin-uid',
    email: 'admin@example.com'
  };

  const mockRegularUser = {
    uid: 'user-uid',
    email: 'user@example.com'
  };

  const createLogsSnapshot = (entries) => ({
    forEach: (callback) => {
      entries.forEach((entry) => {
        callback({ id: entry.id, data: () => entry.data });
      });
    }
  });

  const getFirestoreMocks = () => import('firebase/firestore');

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDoc, getDocs } = await getFirestoreMocks();
    getDoc.mockResolvedValue({ exists: () => false });
    getDocs.mockResolvedValue(createLogsSnapshot([]));
  });

  describe('Access Control', () => {
    it('should not render for non-authenticated users', () => {
      render(
        <AuthContext.Provider value={{ user: null, isAdmin: false, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );

      expect(screen.queryByRole('heading', { name: /Card Database Admin/i })).not.toBeInTheDocument();
    });

    it('should not render for regular users', () => {
      render(
        <AuthContext.Provider value={{ user: mockRegularUser, isAdmin: false, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );

      expect(screen.queryByRole('heading', { name: /Card Database Admin/i })).not.toBeInTheDocument();
    });

    it('should render for admin users', async () => {
      render(
        <AuthContext.Provider value={{ user: mockAdminUser, isAdmin: true, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );

      expect(await screen.findByRole('heading', { name: /Card Database Admin/i })).toBeInTheDocument();
    });

    it('should show loading state while checking admin status', () => {
      render(
        <AuthContext.Provider value={{ user: mockAdminUser, isAdmin: false, loading: false, adminLoading: true }}>
          <AdminPanel />
        </AuthContext.Provider>
      );

      expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    });
  });

  describe('Admin Features', () => {
    const renderAdminPanel = () => {
      return render(
        <AuthContext.Provider value={{ user: mockAdminUser, isAdmin: true, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );
    };

    it('should display card sync metadata', async () => {
      const { getDoc, getDocs } = await import('firebase/firestore');
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          lastFullSync: new Date('2025-01-01').valueOf(),
          totalCards: 500,
          syncStatus: 'healthy',
          updatedSets: 7,
          setVersions: { SOR: '1.0' },
          lastDuration: 120000
        })
      });

      getDocs.mockResolvedValue(createLogsSnapshot([]));

      renderAdminPanel();

      await waitFor(() => {
        expect(screen.getByText(/500/)).toBeInTheDocument();
        expect(screen.getByText(/7/)).toBeInTheDocument();
      });
    });

    it('should display recent sync logs', async () => {
      const { getDocs } = await import('firebase/firestore');
      getDocs.mockResolvedValue(createLogsSnapshot([
        {
          id: 'log-1',
          data: {
            timestamp: new Date('2025-01-01'),
            status: 'success',
            cardsAdded: 10,
            cardsUpdated: 5,
            sets: ['SOR'],
            cardCount: 15,
            duration: 120000,
            changes: { updated: 5 }
          }
        }
      ]));

      renderAdminPanel();

      await waitFor(() => {
        expect(screen.getByText(/success/i)).toBeInTheDocument();
        expect(screen.getByText(/15/)).toBeInTheDocument();
      });
    });

    it('should handle metadata loading errors', async () => {
      const { getDoc } = await import('firebase/firestore');
      getDoc.mockRejectedValue(new Error('Failed to load'));

      renderAdminPanel();

      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
      });
    });

    it('should show empty state when no logs exist', async () => {
      const { getDocs } = await import('firebase/firestore');
      getDocs.mockResolvedValue(createLogsSnapshot([]));

      renderAdminPanel();

      await waitFor(() => {
        expect(screen.getByText(/no.*logs/i)).toBeInTheDocument();
      });
    });
  });

  describe('Admin Actions', () => {
    const renderAdminPanel = () => {
      return render(
        <AuthContext.Provider value={{ user: mockAdminUser, isAdmin: true, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );
    };

    it('should display refresh button', async () => {
      renderAdminPanel();

      expect(await screen.findByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    it('should reload data when refresh is clicked', async () => {
      const { getDoc, getDocs } = await import('firebase/firestore');
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ totalCards: 500 })
      });
      getDocs.mockResolvedValue(createLogsSnapshot([]));

      renderAdminPanel();

      await waitFor(() => {
        expect(screen.getByText(/500/)).toBeInTheDocument();
      });

      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ totalCards: 550 })
      });

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await userEvent.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText(/550/)).toBeInTheDocument();
      });
    });
  });

  describe('Integration with AuthContext', () => {
    it('should use isAdmin from AuthContext', async () => {
      const { rerender } = render(
        <AuthContext.Provider value={{ user: mockAdminUser, isAdmin: false, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );

      expect(screen.queryByRole('heading', { name: /Card Database Admin/i })).not.toBeInTheDocument();

      rerender(
        <AuthContext.Provider value={{ user: mockAdminUser, isAdmin: true, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Card Database Admin/i })).toBeInTheDocument();
      });
    });

    it('should display user email in admin panel', async () => {
      render(
        <AuthContext.Provider value={{ user: mockAdminUser, isAdmin: true, loading: false, adminLoading: false }}>
          <AdminPanel />
        </AuthContext.Provider>
      );

      expect(await screen.findByText(/admin@example\.com/i)).toBeInTheDocument();
    });
  });
});
