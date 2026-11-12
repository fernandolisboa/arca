import { describe, expect, it } from 'vitest';
import { handCheckKey, parseMarks, toggledMarks } from '../src/knowledge/hand-checks.js';

describe('hand checks', () => {
  it('keeps each version and content apart', () => {
    const one = handCheckKey({ routeId: 'us-eb5', number: 8, hash: 'a' });
    expect(handCheckKey({ routeId: 'us-eb5', number: 8, hash: 'b' })).not.toBe(one);
    expect(handCheckKey({ routeId: 'us-eb5', number: 9, hash: 'a' })).not.toBe(one);
  });

  it('reads anything unreadable as no mark', () => {
    expect([...parseMarks(null)]).toEqual([]);
    expect([...parseMarks('not json')]).toEqual([]);
    expect([...parseMarks('{"a":1}')]).toEqual([]);
    expect([...parseMarks('["requirement:capital", 3, null]')]).toEqual(['requirement:capital']);
  });

  it('flips one item and leaves the others', () => {
    const marked = toggledMarks(new Set(['cost:fee']), 'requirement:capital');
    expect([...marked].sort()).toEqual(['cost:fee', 'requirement:capital']);
    expect([...toggledMarks(marked, 'cost:fee')]).toEqual(['requirement:capital']);
  });
});
