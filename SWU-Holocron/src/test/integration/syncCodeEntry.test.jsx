import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { useEffect, useState, useMemo } from 'react';

/**
 * Minimal test component that reproduces the sync code entry flow
 * without the complexity of the full App component.
 * 
 * This isolates the specific bug: entering a sync code causes React error #310
 * "Cannot update a component while rendering a different component"
 */
function MinimalSyncFlow({ onRenderCount }) {
  const [syncCode, setSyncCode] = useState('');
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [hasVisited, setHasVisited] = useState(false);
  const [activeSet, setActiveSet] = useState('SOR');
  const [cards, setCards] = useState([]);
  const [renderCount, setRenderCount] = useState(0);

  // Track renders to detect infinite loops
  useEffect(() => {
    const newCount = renderCount + 1;
    setRenderCount(newCount);
    onRenderCount?.(newCount);
  }, []);

  // Clear filters when switching sets
  useEffect(() => {
    // Simulate filter clearing
    console.log('Clearing filters for set:', activeSet);
  }, [activeSet]);

  // Data Loading - mirrors App.jsx structure
  useEffect(() => {
    if (hasVisited && (syncCode || isGuestMode)) {
      loadSetData();
    }
  }, [activeSet, hasVisited, syncCode, isGuestMode]);

  const loadSetData = async () => {
    console.log('Loading data for set:', activeSet);
    // Simulate async data loading
    await new Promise(resolve => setTimeout(resolve, 10));
    setCards([{ id: 1, Set: activeSet }]);
  };

  const handleStart = (code) => {
    if (code) {
      setSyncCode(code);
      setIsGuestMode(false);
    } else {
      setIsGuestMode(true);
      setSyncCode('');
    }
    setHasVisited(true);
  };

  // Simulate entering sync code immediately on mount
  useEffect(() => {
    if (!hasVisited) {
      handleStart('TEST-CODE');
    }
  }, [hasVisited]);

  return (
    <div>
      <div data-testid="sync-code">{syncCode}</div>
      <div data-testid="card-count">{cards.length}</div>
      <div data-testid="render-count">{renderCount}</div>
    </div>
  );
}

describe.skip('Sync Code Entry Flow (legacy sync-key flow, replaced by Google SSO)', () => {
  let consoleErrorSpy;
  let renderCounts = [];

  beforeEach(() => {
    renderCounts = [];
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should not cause infinite render loop when entering sync code', async () => {
    const { getByTestId } = render(
      <MinimalSyncFlow onRenderCount={(count) => renderCounts.push(count)} />
    );

    // Wait for async operations to complete
    await waitFor(() => {
      expect(getByTestId('sync-code').textContent).toBe('TEST-CODE');
    }, { timeout: 1000 });

    // Check that we don't have excessive renders (indicating infinite loop)
    // Normal flow should render a few times: initial + handleStart + loadSetData
    // Anything over 10 renders suggests an infinite loop
    expect(renderCounts.length).toBeLessThan(10);
    expect(renderCounts[renderCounts.length - 1]).toBeLessThan(10);
  });

  it('should not produce React error #310', async () => {
    render(<MinimalSyncFlow />);

    await waitFor(() => {
      // Check for React error #310 in console
      const error310 = consoleErrorSpy.mock.calls.find(call => 
        call[0]?.includes?.('Cannot update a component') ||
        call[0]?.includes?.('Error #310')
      );
      expect(error310).toBeUndefined();
    }, { timeout: 1000 });
  });

  it('should load cards after sync code is entered', async () => {
    const { getByTestId } = render(<MinimalSyncFlow />);

    await waitFor(() => {
      expect(getByTestId('card-count').textContent).toBe('1');
    }, { timeout: 1000 });
  });

  it('should handle guest mode without infinite loops', async () => {
    function GuestFlow({ onRenderCount }) {
      const [isGuestMode, setIsGuestMode] = useState(false);
      const [hasVisited, setHasVisited] = useState(false);
      const [renderCount, setRenderCount] = useState(0);

      useEffect(() => {
        const newCount = renderCount + 1;
        setRenderCount(newCount);
        onRenderCount?.(newCount);
      }, []);

      useEffect(() => {
        if (!hasVisited) {
          setIsGuestMode(true);
          setHasVisited(true);
        }
      }, [hasVisited]);

      return <div data-testid="guest-mode">{isGuestMode ? 'guest' : 'not-guest'}</div>;
    }

    const guestRenderCounts = [];
    const { getByTestId } = render(
      <GuestFlow onRenderCount={(count) => guestRenderCounts.push(count)} />
    );

    await waitFor(() => {
      expect(getByTestId('guest-mode').textContent).toBe('guest');
    });

    expect(guestRenderCounts.length).toBeLessThan(10);
  });
});

describe('useCallback Infinite Loop Prevention', () => {
  it('should not create infinite loop when function is in effect dependencies', async () => {
    let renderCount = 0;
    
    function ComponentWithCallbackInDeps() {
      const [value, setValue] = useState(0);
      
      // Track renders
      renderCount++;
      
      // BAD: This creates infinite loop
      // useEffect(() => {
      //   doSomething();
      // }, [value, doSomething]);
      
      // const doSomething = useCallback(() => {
      //   setValue(v => v + 1);
      // }, [value]); // value in deps causes doSomething to change
      
      // GOOD: Function defined inside effect
      useEffect(() => {
        const doSomething = () => {
          console.log('Doing something with value:', value);
        };
        doSomething();
      }, [value]);

      return <div data-testid="value">{value}</div>;
    }

    render(<ComponentWithCallbackInDeps />);

    await waitFor(() => {
      expect(renderCount).toBeLessThan(10);
    }, { timeout: 500 });
  });
});

describe('React Error #310 Root Cause', () => {
  it('should document the buggy pattern that causes hook order errors', () => {
    // This test documents what NOT to do
    // It's marked as a documentation test, not an assertion test
    const buggyPattern = `
      function BuggyComponent() {
        const [show, setShow] = useState(false);
        
        // ❌ BAD: Early return before hooks
        if (!show) return <div>Loading</div>;
        
        // This hook only runs sometimes - violates Rules of Hooks!
        const value = useMemo(() => 'value', []);
        
        return <div>{value}</div>;
      }
    `;
    
    expect(buggyPattern).toContain('Early return before hooks');
  });

  it('should reproduce the actual App.jsx bug scenario with try-catch', async () => {
    // This test shows the bug pattern actually breaks React
    let renderError = null;

    function BuggyAppSimulation() {
      const [hasVisited, setHasVisited] = useState(false);
      const [syncCode, setSyncCode] = useState('');
      const [cards] = useState([]);
      
      // Simulate handleStart being called
      useEffect(() => {
        if (!hasVisited) {
          setSyncCode('TEST-CODE');
          setHasVisited(true);
        }
      }, [hasVisited]);
      
      // BAD: Early return before useMemo
      if (!hasVisited) {
        return <div data-testid="landing">Landing</div>;
      }
      
      // This useMemo only runs after hasVisited becomes true
      // Causes hook order change!
      const filteredCards = useMemo(() => {
        return cards.filter(c => c);
      }, [cards]);
      
      return <div data-testid="dashboard">{filteredCards.length}</div>;
    }

    // Expect this to throw
    try {
      render(<BuggyAppSimulation />);
      await waitFor(() => {}, { timeout: 100 });
    } catch (error) {
      renderError = error;
    }

    // The buggy pattern causes an error
    expect(renderError).toBeDefined();
    expect(renderError?.message).toContain('Rendered more hooks');
  });

  it('FIXED: hooks before early returns prevents hook order errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    function ComponentWithFixedHookOrder() {
      const [showContent, setShowContent] = useState(false);
      
      // GOOD: All hooks called before any returns
      const computed = useMemo(() => 'computed value', []);
      
      useEffect(() => {
        setShowContent(true);
      }, []);
      
      // Early returns AFTER hooks is fine
      if (!showContent) {
        return <div data-testid="loading">Loading...</div>;
      }
      
      return <div data-testid="content">{computed}</div>;
    }

    const { getByTestId } = render(<ComponentWithFixedHookOrder />);

    await waitFor(() => {
      expect(getByTestId('content')).toBeDefined();
    });

    // Should not have any hook order warnings
    const hookWarning = consoleWarnSpy.mock.calls.find(call => 
      call[0]?.includes?.('change in the order of Hooks') ||
      call[0]?.includes?.('Rendered more hooks')
    );
    expect(hookWarning).toBeUndefined();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('FIXED: App.jsx with hooks before early returns', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    function FixedAppSimulation() {
      const [hasVisited, setHasVisited] = useState(false);
      const [syncCode, setSyncCode] = useState('');
      const [cards] = useState([]);
      
      // GOOD: All hooks before any returns
      const filteredCards = useMemo(() => {
        return cards.filter(c => c);
      }, [cards]);
      
      // Simulate handleStart being called
      useEffect(() => {
        if (!hasVisited) {
          setSyncCode('TEST-CODE');
          setHasVisited(true);
        }
      }, [hasVisited]);
      
      // Early returns AFTER all hooks
      if (!hasVisited) {
        return <div data-testid="landing">Landing</div>;
      }
      
      return <div data-testid="dashboard">{filteredCards.length}</div>;
    }

    const { getByTestId } = render(<FixedAppSimulation />);

    await waitFor(() => {
      expect(getByTestId('dashboard')).toBeDefined();
    }, { timeout: 1000 });

    // Should not have any hook order errors
    const hookError = [...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls]
      .find(call => 
        call[0]?.includes?.('Rendered more hooks') ||
        call[0]?.includes?.('change in the order of Hooks')
      );
    expect(hookError).toBeUndefined();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });
});
