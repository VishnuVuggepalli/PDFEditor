import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { VersionsTab } from './VersionsTab';
import type { Version } from '../../types/document';

const versions: Version[] = [
  { n: 1, createdAt: '2026-06-01T10:00:00Z', ops: 'upload', size: 2048, sha256: 'a' },
  { n: 2, createdAt: '2026-06-05T10:00:00Z', ops: 'rotate p1 90°', size: 1900, sha256: 'b' },
  { n: 3, createdAt: '2026-06-09T10:00:00Z', ops: 'highlight p2', size: 2100, sha256: 'c' },
];

/** Render helper so every test gets the full required prop set. */
function renderTab(overrides: Partial<Parameters<typeof VersionsTab>[0]> = {}) {
  const props = {
    versions,
    headVersion: 3,
    viewing: null,
    onView: vi.fn(),
    onRestore: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<VersionsTab {...props} />);
  return props;
}

describe('VersionsTab', () => {
  it('lists versions newest first and tags the head', () => {
    renderTab();
    const names = screen.getAllByText(/^v\d$/).map((el) => el.textContent);
    expect(names).toEqual(['v3', 'v2', 'v1']);
    expect(screen.getByText('current')).toBeInTheDocument();
    // head row has no view/restore buttons → two non-head rows
    expect(screen.getAllByText('View')).toHaveLength(2);
  });

  it('restores only after explicit confirmation', () => {
    const { onRestore } = renderTab();
    fireEvent.click(screen.getAllByText('Restore')[0]); // v2 row
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.getByText('Restore v2?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onRestore).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText('Restore')[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Restore'));
    expect(onRestore).toHaveBeenCalledWith(2);
  });

  it('marks the version being viewed', () => {
    renderTab({ viewing: 1 });
    expect(screen.getByText('viewing')).toBeInTheDocument();
  });

  it('offers Delete only on non-head, non-original versions', () => {
    renderTab();
    // v1 (original) and v3 (head) are protected → only the v2 row deletes.
    expect(screen.getAllByText('Delete')).toHaveLength(1);
    const v2card = screen.getByText('v2').closest('.vcard')! as HTMLElement;
    expect(within(v2card).getByText('Delete')).toBeInTheDocument();
    const v1card = screen.getByText('v1').closest('.vcard')! as HTMLElement;
    expect(within(v1card).queryByText('Delete')).toBeNull();
    const v3card = screen.getByText('v3').closest('.vcard')! as HTMLElement;
    expect(within(v3card).queryByText('Delete')).toBeNull();
  });

  it('deletes only after explicit confirmation', () => {
    const { onDelete } = renderTab();
    fireEvent.click(screen.getByText('Delete')); // v2 row
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete v2?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith(2);
  });

  // Retention pruning leaves gaps in version numbers (e.g. v1, v17, v18);
  // the panel must render and restore from actual entries, never assume
  // contiguous 1..head numbering.
  it('handles gapped version histories from retention pruning', () => {
    const gapped: Version[] = [
      { n: 1, createdAt: '2026-06-01T10:00:00Z', ops: 'upload', size: 2048, sha256: 'a' },
      { n: 17, createdAt: '2026-06-08T10:00:00Z', ops: 'rotate p1 90°', size: 1900, sha256: 'q' },
      { n: 18, createdAt: '2026-06-09T10:00:00Z', ops: 'highlight p2', size: 2100, sha256: 'r' },
    ];
    const { onRestore, onDelete } = renderTab({ versions: gapped, headVersion: 18 });
    const names = screen.getAllByText(/^v\d+$/).map((el) => el.textContent);
    expect(names).toEqual(['v18', 'v17', 'v1']);
    // Head tag follows the headVersion number, not array position assumptions.
    expect(within(screen.getByText('v18').closest('.vcard')! as HTMLElement).getByText('current')).toBeInTheDocument();

    // Restoring a gapped survivor passes its real version number.
    fireEvent.click(screen.getAllByText('Restore')[0]); // v17 row (newest non-head)
    expect(screen.getByText('Restore v17?')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Restore'));
    expect(onRestore).toHaveBeenCalledWith(17);

    // Deleting a gapped survivor passes its real version number too.
    fireEvent.click(screen.getByText('Delete')); // v17 is the only deletable row
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith(17);
  });
});
