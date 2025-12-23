/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    syncCode: 'test-sync',
    setSyncCode: vi.fn(),
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

  it('should display sync code when provided', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByText('test-sync')).toBeInTheDocument();
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
