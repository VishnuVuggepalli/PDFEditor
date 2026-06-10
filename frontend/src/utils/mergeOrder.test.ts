import { describe, expect, it } from 'vitest';
import { moveItem, toggleId } from './mergeOrder';

describe('toggleId', () => {
  it('appends an absent id, preserving selection order', () => {
    expect(toggleId([], 'a')).toEqual(['a']);
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['b', 'a'], 'c')).toEqual(['b', 'a', 'c']);
  });

  it('removes a present id without reordering the rest', () => {
    expect(toggleId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(toggleId(['a'], 'a')).toEqual([]);
  });

  it('does not mutate the input', () => {
    const ids = ['a', 'b'];
    toggleId(ids, 'c');
    toggleId(ids, 'a');
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('moveItem', () => {
  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
  });

  it('moves an item down', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('moves across multiple positions', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 5, 1)).toEqual(['a', 'b']);
    expect(moveItem([], 0, 1)).toEqual([]);
  });

  it('does not mutate the input', () => {
    const list = ['a', 'b', 'c'];
    moveItem(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});
