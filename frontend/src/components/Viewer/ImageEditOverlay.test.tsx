/** Image-edit selection overlay: box placement, toolbar actions, drag-move
 * Apply gating, escape, busy state. Geometry math itself is covered in
 * src/pdf/imageEdit.test.ts. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ImageEditOverlay } from './ImageEditOverlay';
import type { ImageSelection } from '../../pdf/engineApi';
import type { ViewportParams } from '../../pdf/coords';

const SEL: ImageSelection = {
  page: 1,
  index: 0,
  bbox: [100, 500, 300, 650], // PDF points, y-up
  width: 40,
  height: 30,
};

const VP: ViewportParams = { rotation: 0, scale: 1, viewBox: [0, 0, 595, 842] };

function setup(over: Partial<Parameters<typeof ImageEditOverlay>[0]> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ImageEditOverlay sel={SEL} vp={VP} busy={false} onApply={onApply} onCancel={onCancel} {...over} />,
  );
  return { onApply, onCancel, ...utils };
}

function getBox(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.img-box')!;
}

describe('ImageEditOverlay', () => {
  it('places the selection box over the image bbox in viewport space', () => {
    const { container } = setup();
    const box = getBox(container);
    expect(box.style.left).toBe('100px');
    expect(box.style.top).toBe('192px'); // 842 - 650
    expect(box.style.width).toBe('200px');
    expect(box.style.height).toBe('150px');
    expect(container.querySelectorAll('.img-handle')).toHaveLength(4);
  });

  it('scales with the viewport', () => {
    const { container } = setup({ vp: { ...VP, scale: 2 } });
    const box = getBox(container);
    expect(box.style.left).toBe('200px');
    expect(box.style.width).toBe('400px');
  });

  it('Delete fires a delete edit for the selection', () => {
    const { getByTitle, onApply } = setup();
    fireEvent.click(getByTitle('Delete image'));
    expect(onApply).toHaveBeenCalledWith({ kind: 'delete', sel: SEL });
  });

  it('hides Apply until the box is moved, then sends the new PDF rect', () => {
    const { container, queryByTitle, getByTitle, onApply } = setup();
    expect(queryByTitle('Apply move/resize')).toBeNull();

    const box = getBox(container);
    fireEvent.mouseDown(box, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(document, { clientX: 70, clientY: 40 });
    fireEvent.mouseUp(document);

    fireEvent.click(getByTitle('Apply move/resize'));
    // moved +20px right, -10px up (viewport) -> PDF rect shifts +20 x, +10 y
    expect(onApply).toHaveBeenCalledWith({
      kind: 'transform',
      sel: SEL,
      rect: [120, 510, 320, 660],
    });
  });

  it('Reset restores the original box and hides Apply again', () => {
    const { container, getByTitle, queryByTitle } = setup();
    const box = getBox(container);
    fireEvent.mouseDown(box, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 30, clientY: 0 });
    fireEvent.mouseUp(document);
    fireEvent.click(getByTitle('Reset position'));
    expect(queryByTitle('Apply move/resize')).toBeNull();
    expect(getBox(container).style.left).toBe('100px');
  });

  it('Escape deselects (unless busy)', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('busy: buttons disabled, spinner shown, escape ignored', () => {
    const { container, getByTitle, getByRole, onCancel } = setup({ busy: true });
    expect((getByTitle('Delete image') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTitle('Replace image') as HTMLButtonElement).disabled).toBe(true);
    expect(getByRole('status')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(container.querySelector('.image-edit')!.className).toContain('busy');
  });
});
