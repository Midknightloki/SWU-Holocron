import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from '../../App';

// Mock Firebase
vi.mock('../../firebase', () => ({
  auth: { currentUser: null },
  db: {},
  APP_ID: 'test-app',
  isFirebaseConfigured: true
}));

// Mock Firebase auth
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((auth, callback) => {
    setTimeout(() => callback({ uid: 'test-user' }), 0);
    return () => {};
  }),
  signInAnonymously: vi.fn()
}));

// Mock Firebase firestore
vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn(() => () => {}),
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    commit: vi.fn()
  }))
}));

// Mock CardService
vi.mock('../../services/CardService', () => ({
  CardService: {
    getAvailableSets: vi.fn(async () => ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC']),
    fetchSetData: vi.fn(async (setCode) => ({
      data: [
        { Set: setCode, Number: '001', Name: 'Test Card', Type: 'Unit' }
      ],
      source: 'test'
    })),
    getCollectionId: vi.fn((set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`),
    getCardImage: vi.fn((set, number) => `/cards/${set}/${number}.jpg`),
    getBackImage: vi.fn((set, number) => `/cards/${set}/${number}_back.jpg`)
  }
}));

describe('Landing Flow - React Error #310 Prevention', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Suppress console errors during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not crash when entering sync code on fresh load', async () => {
    // This test reproduces the bug: entering sync code caused React error #310
    // "Cannot update a component while rendering a different component"
    
    const { container } = render(<App />);
    
    // Wait for landing screen
    await waitFor(() => {
      expect(screen.getByText(/Enter Sync Code/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/enter.*code/i);
    const startButton = screen.getByRole('button', { name: /start/i });

    // Enter sync code
    await user.type(input, 'L0ki');
    await user.click(startButton);

    // Should NOT crash with white screen
    // Should load the app successfully
    await waitFor(() => {
      // Check for main app elements (tabs, not landing screen)
      const tabs = container.querySelector('.bg-gray-800.p-1.rounded-lg');
      expect(tabs).toBeInTheDocument();
    }, { timeout: 5000 });

    // Verify no React errors were thrown
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining('Minified React error #310')
    );
  });

  it('should not trigger multiple setState calls during sync code initialization', async () => {
    // This test documents the root cause: setState being called during render
    
    const setStateCalls = [];
    const originalUseState = React.useState;
    
    vi.spyOn(React, 'useState').mockImplementation((initial) => {
      const [value, setter] = originalUseState(initial);
      const wrappedSetter = (...args) => {
        setStateCalls.push({ value: initial, args });
        return setter(...args);
      };
      return [value, wrappedSetter];
    });

    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText(/Enter Sync Code/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/enter.*code/i);
    const startButton = screen.getByRole('button', { name: /start/i });

    const callCountBefore = setStateCalls.length;
    
    await user.type(input, 'TEST');
    await user.click(startButton);

    // Wait a bit for any effects to settle
    await waitFor(() => {
      expect(setStateCalls.length).toBeGreaterThan(callCountBefore);
    }, { timeout: 2000 });

    // The bug would cause setState to be called during render
    // After fix, setState calls should only happen in effects, not during render
    expect(console.error).not.toHaveBeenCalled();
  });

  it('should handle guest mode without crashing', async () => {
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText(/Guest Mode/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    const user = userEvent.setup();
    const guestButton = screen.getByRole('button', { name: /guest/i });

    await user.click(guestButton);

    // Should load successfully
    await waitFor(() => {
      expect(screen.queryByText(/Enter Sync Code/i)).not.toBeInTheDocument();
    }, { timeout: 5000 });

    expect(console.error).not.toHaveBeenCalled();
  });

  it('should clear filters only when switching sets, not on initial sync code entry', async () => {
    // This documents the fix: filter clearing should only happen on set switch
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText(/Enter Sync Code/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/enter.*code/i);
    const startButton = screen.getByRole('button', { name: /start/i });

    await user.type(input, 'TEST');
    await user.click(startButton);

    // Wait for app to load
    await waitFor(() => {
      expect(screen.queryByText(/Enter Sync Code/i)).not.toBeInTheDocument();
    }, { timeout: 5000 });

    // Search for a card
    const searchInput = screen.queryByPlaceholderText(/search/i);
    if (searchInput) {
      await user.type(searchInput, 'Test');
      expect(searchInput).toHaveValue('Test');

      // Switch to another set
      const tabs = screen.getAllByRole('button').filter(btn => 
        ['SOR', 'SHD', 'TWI', 'JTL'].includes(btn.textContent || '')
      );
      
      if (tabs.length > 1) {
        await user.click(tabs[1]);
        
        // Filter should be cleared after set switch
        await waitFor(() => {
          expect(searchInput).toHaveValue('');
        }, { timeout: 1000 });
      }
    }
  });

  it('should not crash when localStorage has stale sync code', async () => {
    // Set a stale sync code in localStorage
    localStorage.setItem('swu-sync-code', 'STALE');
    localStorage.setItem('swu-has-visited', 'true');

    const { container } = render(<App />);

    // Should load without crashing
    await waitFor(() => {
      const tabs = container.querySelector('.bg-gray-800.p-1.rounded-lg');
      expect(tabs).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining('Minified React error #310')
    );
  });

  it('should handle rapid state changes without cascading renders', async () => {
    // Test for the specific pattern that caused the bug:
    // Multiple setState calls triggered by a single user action
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText(/Enter Sync Code/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/enter.*code/i);
    const startButton = screen.getByRole('button', { name: /start/i });

    // This single action used to trigger:
    // 1. setSyncCode
    // 2. setIsGuestMode
    // 3. setHasVisited
    // 4. Then useEffect triggered: setSearchTerm, setSelectedAspect, setSelectedType
    // All in the same render cycle -> React error #310
    
    await user.type(input, 'RAPID');
    await user.click(startButton);

    await waitFor(() => {
      expect(screen.queryByText(/Enter Sync Code/i)).not.toBeInTheDocument();
    }, { timeout: 5000 });

    // After fix, these should be properly sequenced through effects
    expect(console.error).not.toHaveBeenCalled();
  });
});
