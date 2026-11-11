import { describe, expect, it } from 'vitest';
import { transferText } from '../../src/CampaignList';

describe('Export and Import progress text', () => {
  it('shows bytes done out of the total, with a whole percentage', () => {
    expect(transferText({ kind: 'export', doneBytes: 1024 ** 3, totalBytes: 3 * 1024 ** 3 })).toBe(
      '1 Go sur 3 Go (33 %)',
    );
    expect(transferText({ kind: 'import', doneBytes: 2048, totalBytes: 2048 })).toBe(
      '2 Ko sur 2 Ko (100 %)',
    );
  });

  it('shows nothing when there are no bytes to count', () => {
    expect(transferText({ kind: 'import', doneBytes: 0, totalBytes: 0 })).toBe('');
  });
});
