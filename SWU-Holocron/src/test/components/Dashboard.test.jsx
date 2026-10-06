/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../components/PrebuiltDecksPanel', () => ({ default: ({ uid, collectionRef }) => <div>prebuilt for {uid} {collectionRef?.id}</div> }));
vi.mock('../../components/BatchesPanel', () => ({ default: ({ uid, refreshKey }) => <div>batches for {uid} #{refreshKey}</div> }));
import Dashboard from '../../components/Dashboard';
import { mockCards, mockCollectionData } from '../utils/mockData';

describe('Dashboard Component', () => {
  const defaultProps = {
    setCode: 'SOR',
    cards: mockCards.filter(c => c.Set === 'SOR'),
    collectionData: mockCollectionData,
    onImport: vi.fn(),
    onExport: vi.fn(),
    isImporting: false,
    hasDataToExport: true,
    onUpdateQuantity: vi.fn(),
    onCardClick: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('Command Center')).toBeInTheDocument();
  });

  it('offers the card scanner beside Import CSV when given onScan', () => {
    const onScan = vi.fn();
    render(<Dashboard {...defaultProps} onScan={onScan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan cards' }));
    expect(onScan).toHaveBeenCalled();
  });


  it('no longer lists batches in the Command Center', () => {
    render(<Dashboard {...defaultProps} uid="u1" />);
    expect(screen.queryByText(/batches for/)).not.toBeInTheDocument();
  });

  it('opens Market reports and Saved reports/lists', () => {
    const onOpenMarketReports = vi.fn();
    const onOpenSavedLists = vi.fn();
    render(<Dashboard {...defaultProps} uid="u1" onOpenMarketReports={onOpenMarketReports} onOpenSavedLists={onOpenSavedLists} />);
    fireEvent.click(screen.getByRole('button', { name: /Market reports/ }));
    fireEvent.click(screen.getByRole('button', { name: /Saved reports\/lists/ }));
    expect(onOpenMarketReports).toHaveBeenCalled();
    expect(onOpenSavedLists).toHaveBeenCalled();
  });

  it('hides the buttons it has no handler for', () => {
    render(<Dashboard {...defaultProps} onOpenMarketReports={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Market reports/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Saved reports\/lists/ })).not.toBeInTheDocument();
  });

  it('shows prebuilt decks for the signed-in user, with the collection to add to', () => {
    render(<Dashboard {...defaultProps} uid="u1" collectionRef={{ id: 'ref' }} />);
    expect(screen.getByText('prebuilt for u1 ref')).toBeInTheDocument();
  });

  it('shows no scan button without onScan (not Pro, not admin)', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.queryByRole('button', { name: 'Scan cards' })).not.toBeInTheDocument();
  });

  it('should render header details without sync key', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('Manage your collection')).toBeInTheDocument();
  });

  it('should show loading state when no cards', () => {
    render(<Dashboard {...defaultProps} cards={[]} />);
    expect(screen.getByText('Loading set data...')).toBeInTheDocument();
  });

  it('should display correct stats', () => {
    render(<Dashboard {...defaultProps} />);
    
    // Should show owned unique count out of total
    expect(screen.getByText(/4/)).toBeInTheDocument(); // ownedUniqueCount
    expect(screen.getByText(/5/)).toBeInTheDocument(); // totalUniqueCards
  });

  it('should display completion percentage', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('80% Complete')).toBeInTheDocument();
  });

  it('should call onImport when import button clicked', () => {
    render(<Dashboard {...defaultProps} />);
    const importButton = screen.getByText('Import CSV').closest('button');
    fireEvent.click(importButton);
    expect(defaultProps.onImport).toHaveBeenCalledTimes(1);
  });

  it('should call onExport when export button clicked', () => {
    render(<Dashboard {...defaultProps} />);
    const exportButton = screen.getByText('Export CSV').closest('button');
    fireEvent.click(exportButton);
    expect(defaultProps.onExport).toHaveBeenCalledTimes(1);
  });

  it('should disable import button when importing', () => {
    render(<Dashboard {...defaultProps} isImporting={true} />);
    const importButton = screen.getByText('Import CSV').closest('button');
    expect(importButton).toBeDisabled();
  });

  it('should disable export button when no data', () => {
    render(<Dashboard {...defaultProps} hasDataToExport={false} />);
    const exportButton = screen.getByText('Export CSV').closest('button');
    expect(exportButton).toBeDisabled();
  });

  it('should display missing cards list', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('Missing Unique Titles')).toBeInTheDocument();
    expect(screen.getByText('Iden Versio')).toBeInTheDocument();
  });

  it('should call onUpdateQuantity when add button clicked in missing list', () => {
    render(<Dashboard {...defaultProps} />);
    // Find the green add button in the missing cards table
    const addButton = screen.getByRole('button', { name: '' }); // The + button has empty aria-label
    fireEvent.click(addButton);
    expect(defaultProps.onUpdateQuantity).toHaveBeenCalled();
  });

  it('should call onCardClick when card name clicked in missing list', () => {
    render(<Dashboard {...defaultProps} />);
    const cardName = screen.getByText('Iden Versio');
    fireEvent.click(cardName);
    expect(defaultProps.onCardClick).toHaveBeenCalled();
  });

  it('should show export missing cards button when there are missing cards', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('Export List')).toBeInTheDocument();
  });

  it('should display playsets count correctly', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('Playable Sets')).toBeInTheDocument();
  });

  it('should display global summary for all sets', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('Total Volume')).toBeInTheDocument();
  });
});
