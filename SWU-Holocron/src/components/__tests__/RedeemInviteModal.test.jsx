import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RedeemInviteModal from '../RedeemInviteModal';

const redeemInviteCode = vi.fn();

vi.mock('../../services/GuidedModeService', () => ({
  GuidedModeService: {
    redeemInviteCode: (...args) => redeemInviteCode(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RedeemInviteModal', () => {
  it('redeems the entered code', async () => {
    redeemInviteCode.mockResolvedValue(true);
    const onRedeemed = vi.fn();
    render(<RedeemInviteModal onClose={vi.fn()} onRedeemed={onRedeemed} />);

    await userEvent.type(screen.getByLabelText(/invite code/i), 'HOLOCRON-4F2A');
    await userEvent.click(screen.getByRole('button', { name: /redeem/i }));

    await waitFor(() => expect(redeemInviteCode).toHaveBeenCalledWith('HOLOCRON-4F2A'));
    expect(onRedeemed).toHaveBeenCalled();
    expect(await screen.findByText(/contributor access granted/i)).toBeInTheDocument();
  });

  it('shows the failure reason instead of swallowing it', async () => {
    // The old flow hid failures behind .catch(() => {}), so a rejected invite
    // was indistinguishable from never having been invited.
    redeemInviteCode.mockRejectedValue(new Error('That invite code is not valid.'));
    render(<RedeemInviteModal onClose={vi.fn()} onRedeemed={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/invite code/i), 'WRONG');
    await userEvent.click(screen.getByRole('button', { name: /redeem/i }));

    expect(await screen.findByText(/not valid/i)).toBeInTheDocument();
  });

  it('does not call the service for an empty code', async () => {
    render(<RedeemInviteModal onClose={vi.fn()} onRedeemed={vi.fn()} />);

    expect(screen.getByRole('button', { name: /redeem/i })).toBeDisabled();
    expect(redeemInviteCode).not.toHaveBeenCalled();
  });

  it('tells a guest to sign in rather than offering the form', async () => {
    // The Cloud Function refuses anonymous accounts; saying so up front beats
    // letting the user type a code and then rejecting it.
    render(<RedeemInviteModal isAnonymous onClose={vi.fn()} onRedeemed={vi.fn()} />);

    expect(screen.getByText(/guest sessions cannot become contributors/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/invite code/i)).not.toBeInTheDocument();
  });

  it('closes when cancelled', async () => {
    const onClose = vi.fn();
    render(<RedeemInviteModal onClose={onClose} onRedeemed={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
