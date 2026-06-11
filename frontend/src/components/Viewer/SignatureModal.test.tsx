import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SignatureModal } from './SignatureModal';
import { ToastProvider } from '../shared/Toasts';

function renderModal() {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(
    <ToastProvider>
      <SignatureModal onApply={onApply} onCancel={onCancel} />
    </ToastProvider>,
  );
  return { onApply, onCancel };
}

describe('SignatureModal digital tab', () => {
  it('offers the three signing modes', () => {
    renderModal();
    expect(screen.getByText('Draw')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText('Digital signature')).toBeInTheDocument();
  });

  it('signs with reason, location and a visible mark by default', () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByText('Digital signature'));

    fireEvent.change(screen.getByPlaceholderText(/I approve/), {
      target: { value: 'Approved by me' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Home office/), {
      target: { value: 'Berlin' },
    });
    fireEvent.click(screen.getByText('Sign & place mark'));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'digital',
      reason: 'Approved by me',
      location: 'Berlin',
      visible: true,
    });
  });

  it('signs invisibly when the visible-mark toggle is off', () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByText('Digital signature'));

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Sign document'));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'digital',
      reason: '',
      location: '',
      visible: false,
    });
  });

  it('explains the self-signed trust model', () => {
    renderModal();
    fireEvent.click(screen.getByText('Digital signature'));
    expect(screen.getByText(/unknown signer/)).toBeInTheDocument();
    expect(screen.getByText(/Later edits will invalidate the signature/)).toBeInTheDocument();
  });
});
