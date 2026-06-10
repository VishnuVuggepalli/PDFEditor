import { describe, expect, it } from 'vitest';
import { parsePageSelection } from './pageSelection';

describe('parsePageSelection', () => {
  it.each<[string, number[] | null]>([
    ['', []],
    ['   ', []],
    ['1', [1]],
    ['1,3', [1, 3]],
    ['1-3', [1, 2, 3]],
    ['1, 4-6', [1, 4, 5, 6]],
    [' 2 - 4 , 1 ', [1, 2, 3, 4]],
    ['3,1-2,3', [1, 2, 3]], // duplicates dropped, sorted
    ['0', null],
    ['0-2', null],
    ['3-1', null],
    ['a', null],
    ['1,,2', null],
    ['1-', null],
    ['-3', null],
    ['1.5', null],
    ['1-999999999', null], // absurd range capped
  ])('parses %j → %j', (raw, want) => {
    expect(parsePageSelection(raw)).toEqual(want);
  });
});
