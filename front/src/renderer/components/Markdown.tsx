// Renderiza el markdown del chat (lib/markdown.ts). Todo es texto: React
// escapa lo que escribe la gente, nunca se inserta HTML.

import { memo } from 'react';

import { copy } from '../actions';
import { parseMarkdown, type Inline } from '../lib/markdown';
import { toast } from '../store/app';
import { Icon } from './ui';

interface Props {
  content: string;
  /** Tu nickname: tus menciones se resaltan distinto. */
  me: string;
  /** Nombre visible de cada nickname, para el tooltip de una mención. */
  nameOf?: (nick: string) => string | undefined;
}

function InlineNode({ node, me, nameOf }: { node: Inline } & Omit<Props, 'content'>) {
  switch (node.kind) {
    case 'bold':
      return <strong>{node.text}</strong>;
    case 'italic':
      return <em>{node.text}</em>;
    case 'strike':
      return <s>{node.text}</s>;
    case 'code':
      return <code className="md-code">{node.text}</code>;
    case 'mention': {
      const name = nameOf?.(node.nick);
      return (
        <span className={node.nick === me ? 'md-mention me' : 'md-mention'} title={name ?? undefined}>
          @{node.nick}
        </span>
      );
    }
    case 'link':
      return (
        <a className="md-link" href={node.url} target="_blank" rel="noreferrer">
          {node.url}
        </a>
      );
    default:
      return <>{node.text}</>;
  }
}

export const Markdown = memo(function Markdown({ content, me, nameOf }: Props) {
  const blocks = parseMarkdown(content);
  return (
    <div className="md">
      {blocks.map((block, i) => {
        if (block.kind === 'code') {
          return (
            <div key={i} className="md-pre">
              <div className="md-pre-head">
                <span>{block.lang || 'código'}</span>
                <button
                  type="button"
                  className="md-pre-copy"
                  onClick={() => void copy(block.code).then(() => toast('Código copiado', 'success'))}
                  aria-label="Copiar código"
                  title="Copiar"
                >
                  <Icon name="copy" size={12} />
                </button>
              </div>
              <pre>
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }
        const inner = block.inlines.map((node, j) => <InlineNode key={j} node={node} me={me} nameOf={nameOf} />);
        return block.kind === 'quote' ? (
          <blockquote key={i} className="md-quote">
            {inner}
          </blockquote>
        ) : (
          <p key={i} className="md-p">
            {inner}
          </p>
        );
      })}
    </div>
  );
});
