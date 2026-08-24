import type { ReactElement, ReactNode } from 'react';
import type { MessageDoc, MessageParagraph, MessageText } from '@mio/contracts';

/**
 * Controlled rendering of the structured document - React elements from
 * schema-validated data, never markup from storage. Links are derived
 * here at render time from plain text (automatic hyperlinking per the
 * architecture doc), so no href is ever stored.
 */

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

function linkify(text: string, key: string): ReactNode[] {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={`${key}-${index}`}
        href={part}
        target="_blank"
        rel="noreferrer noopener"
        className="text-teal underline underline-offset-4"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function renderText(node: MessageText, key: string): ReactNode {
  let content: ReactNode = <>{linkify(node.text, key)}</>;
  if (node.marks?.includes('italic')) content = <em>{content}</em>;
  if (node.marks?.includes('bold')) content = <strong>{content}</strong>;
  return <span key={key}>{content}</span>;
}

function renderParagraph(paragraph: MessageParagraph, key: string): ReactElement {
  return (
    <p key={key} className="min-h-[1.25em] whitespace-pre-wrap">
      {paragraph.content.map((node, index) => renderText(node, `${key}-${index}`))}
    </p>
  );
}

export function MessageDocView({
  doc,
  attachmentBase,
  attachmentAlt,
}: {
  doc: MessageDoc;
  /** WP-24: '/api/patient/attachments' or '/api/staff/attachments' -
   * the serving endpoint authorizes and audits every read */
  attachmentBase?: string;
  attachmentAlt?: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1 text-sm leading-relaxed">
      {doc.content.map((block, index) => {
        if (block.type === 'paragraph') return renderParagraph(block, `b${index}`);
        if (block.type === 'attachment') {
          if (attachmentBase === undefined) return null;
          return (
            <img
              key={index}
              src={`${attachmentBase}/${block.attachmentId}`}
              alt={attachmentAlt ?? ''}
              loading="lazy"
              className="max-h-72 max-w-full rounded-inner border border-hairline object-contain"
            />
          );
        }
        const items = block.content.map((item, itemIndex) => (
          <li key={itemIndex}>
            {item.content.map((paragraph, pIndex) =>
              renderParagraph(paragraph, `b${index}-${itemIndex}-${pIndex}`),
            )}
          </li>
        ));
        return block.type === 'bullet_list' ? (
          <ul key={index} className="list-disc pl-5">
            {items}
          </ul>
        ) : (
          <ol key={index} className="list-decimal pl-5">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
