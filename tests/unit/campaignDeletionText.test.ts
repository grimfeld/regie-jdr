import { describe, expect, it } from 'vitest';
import { deletionContents, formatSize } from '../../src/CampaignList';

describe('Campaign delete confirmation text', () => {
  it('shows sizes in French units, one decimal at most', () => {
    expect(formatSize(0)).toBe('0 octets');
    expect(formatSize(1023)).toBe('1\u202f023 octets');
    expect(formatSize(1536)).toBe('1,5 Ko');
    expect(formatSize(12.34 * 1024 * 1024)).toBe('12,3 Mo');
    expect(formatSize(3 * 1024 ** 3)).toBe('3 Go');
  });

  it('counts Scenes and Media, singular and plural', () => {
    const summary = { id: 'x', name: 'Les Ombres', sizeBytes: 2048 };
    expect(deletionContents({ ...summary, sceneCount: 1, mediaCount: 0 })).toBe(
      '1 scène et 0 média, 2 Ko',
    );
    expect(deletionContents({ ...summary, sceneCount: 3, mediaCount: 2 })).toBe(
      '3 scènes et 2 médias, 2 Ko',
    );
  });
});
