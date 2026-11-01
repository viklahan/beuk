import { describe, expect, it } from 'vitest';
import { readBook } from '../src/model/bookFormat';

describe('the @book alias', () => {
  it('reaches the server\'s readBook (one source)', () => {
    expect(typeof readBook).toBe('function');
  });
});
