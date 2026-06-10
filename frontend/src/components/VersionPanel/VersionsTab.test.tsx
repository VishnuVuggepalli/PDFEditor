import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { VersionsTab } from './VersionsTab';
import type { Version } from '../../types/document';

const versions: Version[] = [
  { n: 1, createdAt: '2026-06-01T10:00:00Z', ops: 'upload', size: 2048, sha256: 'a' },
  { n: 2, createdAt: '2026-06-05T10:00:00Z', ops: 'rotate p1 90°', size: 1900, sha256: 'b' },
  { n: 3, createdAt: '2026-06-09T10:00:00Z', ops: 'highlight p2', size: 2100, sha256: 'c' },
];

describe('VersionsTab', () => {
  it('lists versions newest first and tags the head', () => {
    render(
      <VersionsTab versions={versions} headVersion={3} viewing={null} onView={vi.fn()} onRestore={vi.fn()} />,
    );
    const names = screen.getAllByText(/^v\d$/).map((el) => el.textContent);
    expect(names).toEqual(['v3', 'v2', 'v1']);
    expect(screen.getByText('current')).toBeInTheDocument();
    // head row has no view/restore buttons → two non-head rows × 2 buttons
    expect(screen.getAllByText('View')).toHaveLength(2);
  });

  it('restores only after explicit confirmation', () => {
    const onRestore = vi.fn();
    render(
      <VersionsTab versions={versions} headVersion={3} viewing={null} onView={vi.fn()} onRestore={onRestore} />,
    );
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
    render(
      <VersionsTab versions={versions} headVersion={3} viewing={1} onView={vi.fn()} onRestore={vi.fn()} />,
    );
    expect(screen.getByText('viewing')).toBeInTheDocument();
  });
});
