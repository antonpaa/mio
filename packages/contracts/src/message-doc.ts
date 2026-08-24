/**
 * The message body contract (WP-23,
 * docs/architecture/messaging-and-attachments.md): a structured document,
 * never editor HTML. The parser REBUILDS the document from unknown input
 * against this schema - anything not in the schema does not survive, so
 * rendering is a controlled transformation and output sanitisation is the
 * second layer rather than the only one. Shared by the API (validate on
 * post) and the web composer/renderer.
 */

export type MessageMark = 'bold' | 'italic';

export interface MessageText {
  type: 'text';
  text: string;
  marks?: MessageMark[];
}

export interface MessageParagraph {
  type: 'paragraph';
  content: MessageText[];
}

export interface MessageListItem {
  type: 'list_item';
  content: MessageParagraph[];
}

export interface MessageList {
  type: 'bullet_list' | 'ordered_list';
  content: MessageListItem[];
}

export type MessageBlock = MessageParagraph | MessageList;

export interface MessageDoc {
  type: 'doc';
  content: MessageBlock[];
}

/** Bounds hold the document to "a message", not "a payload". */
export const MESSAGE_MAX_CHARS = 5000;
export const MESSAGE_MAX_BLOCKS = 64;
export const MESSAGE_MAX_LIST_ITEMS = 32;

const MARKS: readonly MessageMark[] = ['bold', 'italic'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rebuildText(value: unknown): MessageText | null {
  if (!isRecord(value) || value['type'] !== 'text' || typeof value['text'] !== 'string')
    return null;
  const text = value['text'];
  if (text.length === 0) return null;
  const marks = Array.isArray(value['marks'])
    ? [
        ...new Set(
          value['marks'].filter((mark): mark is MessageMark => MARKS.includes(mark as MessageMark)),
        ),
      ]
    : [];
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text };
}

function rebuildParagraph(value: unknown): MessageParagraph | null {
  if (!isRecord(value) || value['type'] !== 'paragraph') return null;
  const content = Array.isArray(value['content'])
    ? value['content'].map(rebuildText).filter((node): node is MessageText => node !== null)
    : [];
  return { type: 'paragraph', content };
}

function rebuildBlock(value: unknown): MessageBlock | null {
  const paragraph = rebuildParagraph(value);
  if (paragraph !== null) return paragraph;
  if (!isRecord(value)) return null;
  if (value['type'] !== 'bullet_list' && value['type'] !== 'ordered_list') return null;
  const items = (Array.isArray(value['content']) ? value['content'] : [])
    .slice(0, MESSAGE_MAX_LIST_ITEMS)
    .map((item): MessageListItem | null => {
      if (!isRecord(item) || item['type'] !== 'list_item') return null;
      const paragraphs = (Array.isArray(item['content']) ? item['content'] : [])
        .map(rebuildParagraph)
        .filter((node): node is MessageParagraph => node !== null);
      return paragraphs.length > 0 ? { type: 'list_item', content: paragraphs } : null;
    })
    .filter((item): item is MessageListItem => item !== null);
  if (items.length === 0) return null;
  return { type: value['type'], content: items };
}

/**
 * Parse unknown input into a clean document. Returns null when the input
 * is not a document, carries no visible text at all, or exceeds bounds -
 * the caller treats null as a 400, never "best effort".
 */
export function parseMessageDoc(value: unknown): MessageDoc | null {
  if (!isRecord(value) || value['type'] !== 'doc' || !Array.isArray(value['content'])) return null;
  if (value['content'].length > MESSAGE_MAX_BLOCKS) return null;
  const content = value['content']
    .map(rebuildBlock)
    .filter((block): block is MessageBlock => block !== null);
  const doc: MessageDoc = { type: 'doc', content };
  const text = plainTextOf(doc);
  if (text.trim().length === 0) return null;
  if (text.length > MESSAGE_MAX_CHARS) return null;
  return doc;
}

/** Flatten to plain text - previews in lists and notifications. */
export function plainTextOf(doc: MessageDoc): string {
  const paragraphText = (paragraph: MessageParagraph): string =>
    paragraph.content.map((node) => node.text).join('');
  return doc.content
    .map((block) =>
      block.type === 'paragraph'
        ? paragraphText(block)
        : block.content.map((item) => item.content.map(paragraphText).join(' ')).join('\n'),
    )
    .join('\n')
    .trim();
}

/** A one-paragraph document from plain text - seeds and fallbacks. */
export function docFromText(text: string): MessageDoc {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line.length > 0 ? [{ type: 'text', text: line }] : [],
    })),
  };
}
