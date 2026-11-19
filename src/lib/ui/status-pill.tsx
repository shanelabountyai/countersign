import { STATUS, type StatusKey } from './format';

/** Word + glyph + colour status pill (docs/design/HANDOFF.md status set). */
export function StatusPill({ status, large = false }: { status: string; large?: boolean }) {
  const key = (status in STATUS ? status : 'draft') as StatusKey;
  const s = STATUS[key];
  return (
    <span className={`cs-pill cs-pill--${key}${large ? ' cs-pill--lg' : ''}`}>
      <span aria-hidden="true">{s.glyph}</span>{s.word}
    </span>
  );
}
