/** Inline edit overlay: positioning, prefill, commit/cancel keyboard and
 * focus behaviors, busy state. Placement math itself is covered in
 * src/pdf/overlay.test.ts. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { InlineTextEdit } from './InlineTextEdit';
import type { TextSpanInfo } from '../../pdf/engineApi';
import type { ViewportParams } from '../../pdf/coords';

const SPAN: TextSpanInfo = {
  page: 1,
  text: 'Hello world',
  bbox: [72, 714, 272, 746],
  fitzBox: [72, 96, 272, 128],
  fontName: 'Helvetica',
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  fontStyle: 'normal',
  fontSize: 24,
};

const VP: ViewportParams = { rotation: 0, scale: 1.5, viewBox: [0, 0, 595, 842] };

function setup(over: Partial<Parameters<typeof InlineTextEdit>[0]> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <InlineTextEdit span={SPAN} vp={VP} busy={false} onCommit={onCommit} onCancel={onCancel} {...over} />,
  );
  const input = utils.getByRole('textbox');
  return { onCommit, onCancel, input, ...utils };
}

describe('InlineTextEdit', () => {
  it('positions the overlay over the line bbox and matches the rendered size', () => {
    const { input, container } = setup();
    const box = container.querySelector<HTMLElement>('.inline-edit')!;
    expect(box.style.left).toBe('108px'); // 72 * 1.5
    expect(box.style.top).toBe('144px'); // (842-746) * 1.5
    expect(box.style.width).toBe('300px'); // 200 * 1.5
    expect(input.style.fontSize).toBe('36px'); // 24 * 1.5
    expect(input.style.fontFamily).toBe('sans-serif');
  });

  it('rotates with the viewport', () => {
    const { container } = setup({ vp: { ...VP, rotation: 90 } });
    const box = container.querySelector<HTMLElement>('.inline-edit')!;
    expect(box.style.transform).toBe('rotate(90deg)');
  });

  it('prefills the line text and focuses the input', () => {
    const { input } = setup();
    expect(input.textContent).toBe('Hello world');
    expect(document.activeElement).toBe(input);
  });

  it('Enter commits the changed text (normalized)', () => {
    const { input, onCommit, onCancel } = setup();
    input.textContent = '  Edited\n line ';
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Edited line');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Enter with unchanged text cancels instead of committing', () => {
    const { input, onCommit, onCancel } = setup();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels even when the text changed', () => {
    const { input, onCommit, onCancel } = setup();
    input.textContent = 'changed';
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('focus loss commits if changed, cancels otherwise', () => {
    const a = setup();
    a.input.textContent = 'changed';
    fireEvent.blur(a.input);
    expect(a.onCommit).toHaveBeenCalledWith('changed');
    a.unmount();

    const b = setup();
    fireEvent.blur(b.input);
    expect(b.onCommit).not.toHaveBeenCalled();
    expect(b.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows no font hint for a standard-14 font', () => {
    const { container, queryByRole } = setup(); // SPAN uses Helvetica
    expect(queryByRole('note')).toBeNull();
    expect(container.querySelector('.ie-hint')).toBeNull();
  });

  it('shows the approximation hint for an exotic font', () => {
    const { getByRole } = setup({
      span: { ...SPAN, fontName: 'ABCDEF+DroidSansFallback' },
    });
    expect(getByRole('note')).toHaveTextContent('Font will be approximated');
  });

  it('hides the font hint while the edit is in flight', () => {
    const { queryByRole } = setup({
      span: { ...SPAN, fontName: 'ABCDEF+DroidSansFallback' },
      busy: true,
    });
    expect(queryByRole('note')).toBeNull();
  });

  it('busy: shows the spinner, disables editing, and ignores keys/blur', () => {
    const { input, onCommit, onCancel, getByRole, container } = setup({ busy: true });
    expect(getByRole('status')).toBeInTheDocument();
    expect(container.querySelector('.inline-edit.busy')).not.toBeNull();
    expect(input.getAttribute('contenteditable')).toBe('false');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
