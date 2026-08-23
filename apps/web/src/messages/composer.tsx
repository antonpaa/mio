import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import {
  parseMessageDoc,
  type MessageDoc,
  type MessageMark,
  type MessageText,
} from '@mio/contracts';
import { Button } from '@mio/ui';

/**
 * The C4/P6 composer: a contentEditable surface with bold, italics and
 * lists - and NO stored markup. On send the DOM is walked into the
 * structured document; parseMessageDoc is the boundary, so whatever the
 * browser (or a paste) put into the editable that the schema does not
 * know simply does not survive. Twenty lines of walking beats an editor
 * dependency (ADR-0009).
 */

function inlineOf(node: Node, marks: MessageMark[]): MessageText[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text.length === 0) return [];
    return [{ type: 'text', text, ...(marks.length > 0 ? { marks: [...marks] } : {}) }];
  }
  if (!(node instanceof HTMLElement)) return [];
  const tag = node.tagName;
  const next = [...marks];
  if ((tag === 'B' || tag === 'STRONG') && !next.includes('bold')) next.push('bold');
  if ((tag === 'I' || tag === 'EM') && !next.includes('italic')) next.push('italic');
  return [...node.childNodes].flatMap((child) => inlineOf(child, next));
}

export function domToDoc(root: HTMLElement): MessageDoc | null {
  const blocks: object[] = [];
  let run: MessageText[] = [];
  const flush = (): void => {
    if (run.length > 0) blocks.push({ type: 'paragraph', content: run });
    run = [];
  };
  const walk = (node: Node): void => {
    if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
      flush();
      const items = [...node.children]
        .filter((child) => child.tagName === 'LI')
        .map((li) => ({
          type: 'list_item',
          content: [{ type: 'paragraph', content: inlineOf(li, []) }],
        }));
      blocks.push({
        type: node.tagName === 'UL' ? 'bullet_list' : 'ordered_list',
        content: items,
      });
      return;
    }
    if (node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P')) {
      flush();
      const hasBlockChild = [...node.children].some((child) =>
        ['UL', 'OL', 'DIV', 'P'].includes(child.tagName),
      );
      if (hasBlockChild) {
        [...node.childNodes].forEach(walk);
        flush();
        return;
      }
      blocks.push({ type: 'paragraph', content: inlineOf(node, []) });
      return;
    }
    if (node instanceof HTMLElement && node.tagName === 'BR') {
      flush();
      return;
    }
    run.push(...inlineOf(node, []));
  };
  [...root.childNodes].forEach(walk);
  flush();
  return parseMessageDoc({ type: 'doc', content: blocks });
}

function ToolButton({
  label,
  onApply,
  children,
}: {
  label: string;
  onApply: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // mousedown would move focus out of the editable and drop the
      // selection the command should apply to
      onMouseDown={(event) => event.preventDefault()}
      onClick={onApply}
      className="inline-flex h-8 min-w-8 items-center justify-center rounded-inner px-1.5 text-sm text-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {children}
    </button>
  );
}

export function Composer({
  label,
  sendLabel,
  tone = 'message',
  onSend,
  busy,
}: {
  label: string;
  sendLabel: string;
  /** 'note' renders the amber internal-note treatment (C4). */
  tone?: 'message' | 'note';
  onSend: (doc: MessageDoc) => Promise<void>;
  busy: boolean;
}): ReactElement {
  const intl = useIntl();
  const editor = useRef<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(true);

  const exec = (command: string): void => {
    editor.current?.focus();
    document.execCommand(command);
  };
  const send = async (): Promise<void> => {
    const root = editor.current;
    if (root === null) return;
    const doc = domToDoc(root);
    if (doc === null) return;
    await onSend(doc);
    root.innerHTML = '';
    setEmpty(true);
  };

  return (
    <div
      className={`rounded-inner border ${
        tone === 'note' ? 'border-amber-chip-border bg-amber-tint/40' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-center gap-0.5 border-b border-hairline px-2 py-1">
        <ToolButton
          label={intl.formatMessage({ id: 'messages.bold' })}
          onApply={() => exec('bold')}
        >
          <strong>B</strong>
        </ToolButton>
        <ToolButton
          label={intl.formatMessage({ id: 'messages.italic' })}
          onApply={() => exec('italic')}
        >
          <em className="font-display">I</em>
        </ToolButton>
        <ToolButton
          label={intl.formatMessage({ id: 'messages.bulleted' })}
          onApply={() => exec('insertUnorderedList')}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none">
            <path
              d="M5.5 3.5h8M5.5 8h8M5.5 12.5h8M2.2 3.5h.01M2.2 8h.01M2.2 12.5h.01"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </ToolButton>
        <ToolButton
          label={intl.formatMessage({ id: 'messages.numbered' })}
          onApply={() => exec('insertOrderedList')}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none">
            <path
              d="M6.5 3.5h7M6.5 8h7M6.5 12.5h7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <text x="1" y="5.4" fontSize="5.5" fill="currentColor" stroke="none">
              1
            </text>
            <text x="1" y="10" fontSize="5.5" fill="currentColor" stroke="none">
              2
            </text>
            <text x="1" y="14.6" fontSize="5.5" fill="currentColor" stroke="none">
              3
            </text>
          </svg>
        </ToolButton>
      </div>
      <div className="relative">
        {empty ? (
          <p aria-hidden className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted">
            {label}
          </p>
        ) : null}
        <div
          ref={editor}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable
          suppressContentEditableWarning
          onInput={() => setEmpty((editor.current?.textContent ?? '').trim().length === 0)}
          className="min-h-20 px-3 py-2.5 text-sm leading-relaxed outline-none"
        />
      </div>
      <div className="flex justify-end border-t border-hairline px-2 py-1.5">
        <Button size="sm" onPress={() => void send()} isDisabled={busy || empty}>
          {sendLabel}
        </Button>
      </div>
    </div>
  );
}
