import { describe, expect, it } from 'vitest';
import { parseByteRange } from '../../core/byteRange';

describe('byte ranges of a Media file', () => {
  it('sends the whole file without a range, or with one it does not handle', () => {
    expect(parseByteRange(null, 100)).toBeUndefined();
    expect(parseByteRange('bytes=0-1,5-9', 100)).toBeUndefined();
    expect(parseByteRange('items=0-1', 100)).toBeUndefined();
    expect(parseByteRange('bytes=-', 100)).toBeUndefined();
  });

  it('reads from a byte to another, or to the end', () => {
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('reads the last bytes', () => {
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('refuses a range outside the file', () => {
    expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=9-1', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});
