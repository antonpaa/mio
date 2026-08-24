import { describe, expect, it } from 'vitest';
import { docFromText, parseMessageDoc, plainTextOf, type MessageDoc } from './index.js';

/**
 * The parser rebuilds the document - the tests prove that nothing
 * outside the schema survives and that empty or oversized input is
 * rejected outright, never "best effort".
 */

describe('parseMessageDoc', () => {
  it('accepts a well-formed document and strips what the schema does not know', () => {
    const doc = parseMessageDoc({
      type: 'doc',
      evil: '<script>',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ', onclick: 'x()' },
            { type: 'text', text: 'world', marks: ['bold', 'blink', 'bold'] },
          ],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            { type: 'list_item', content: [] },
          ],
        },
        { type: 'iframe', src: 'https://evil.example' },
      ],
    });
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: ['bold'] },
          ],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(doc)).not.toContain('evil');
    expect(JSON.stringify(doc)).not.toContain('iframe');
  });

  it('rejects non-documents, blank documents and oversized documents', () => {
    expect(parseMessageDoc(null)).toBeNull();
    expect(parseMessageDoc('<b>hi</b>')).toBeNull();
    expect(parseMessageDoc({ type: 'doc', content: [] })).toBeNull();
    expect(
      parseMessageDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
      }),
    ).toBeNull();
    expect(
      parseMessageDoc({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(5001) }] }],
      }),
    ).toBeNull();
  });

  it('round-trips plain text for previews', () => {
    const doc = docFromText('First line\nSecond line') as MessageDoc;
    expect(parseMessageDoc(doc)).toEqual(doc);
    expect(plainTextOf(doc)).toBe('First line\nSecond line');
  });
});
