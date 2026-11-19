'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

// App-side forms for the editors (design pass review, UX-1, UX-2, A11Y-3). core/ui/action-form.tsx is template-owned and
// uses React's form `action`, which resets every uncontrolled field after a refused save and shows its message at the top
// of a long form. These call the same orgAction exports, keep what was typed, put the message beside the button and move
// focus to it. Server-side guards and results are unchanged.

type Result = unknown;
const msgOf = (r: Result) => {
  if (r && typeof r === 'object' && 'error' in r) return { kind: 'error' as const, text: String((r as { error: unknown }).error) };
  if (r && typeof r === 'object' && 'notice' in r) return { kind: 'notice' as const, text: String((r as { notice: unknown }).notice) };
  return null;
};

function Message({ m, focusKey }: { m: { kind: 'error' | 'notice'; text: string } | null; focusKey: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (m) ref.current?.focus(); }, [m, focusKey]);
  if (!m) return null;
  return m.kind === 'error'
    ? <p role="alert" tabIndex={-1} ref={ref} className="cs-banner cs-banner--bad cs-msg cs-msg--bad">{m.text}</p>
    : <p role="status" tabIndex={-1} ref={ref} className="cs-banner cs-banner--ok cs-msg cs-msg--ok">{m.text}</p>;
}

/** A save form that keeps its fields on a refusal; the message sits just above the submit row (`footer`). */
export function EditorForm({ action, children, footer, id }: { action: (form: FormData) => Promise<Result>; children: React.ReactNode; footer: React.ReactNode; id?: string }) {
  const [m, setM] = useState<ReturnType<typeof msgOf>>(null);
  const [n, setN] = useState(0);
  const [pending, start] = useTransition();
  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await action(fd);
          setM(msgOf(r));
          setN((x) => x + 1);
        });
      }}
    >
      <div className="cs-rows" style={{ gap: 18 }}>
        {children}
        <Message m={m} focusKey={n} />
        <div className="cs-actions" aria-busy={pending}>
          {footer}
          {pending && <span className="cs-hint">Saving…</span>}
        </div>
      </div>
    </form>
  );
}

/**
 * Send / replace-the-link panel (UX-1, UX-7). The one-time link stays on screen in a copyable field while the page under
 * it refreshes to the new status, so a stale "Send" or "Save draft" is never left behind.
 */
export function LinkActionForm({ action, children, button, hint }: { action: (form: FormData) => Promise<Result>; children: React.ReactNode; button: string; hint?: string }) {
  const router = useRouter();
  const [m, setM] = useState<ReturnType<typeof msgOf>>(null);
  const [n, setN] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const url = m?.kind === 'notice' ? /(https?:\/\/\S+\/sign\/[^\s]+)/.exec(m.text)?.[1] ?? null : null;
  return (
    <div className="cs-rows">
      <Message m={m} focusKey={n} />
      {url && (
        <div className="cs-actions" style={{ alignItems: 'flex-end' }}>
          <label className="cs-label" style={{ flex: '1 1 320px' }}>
            Signing link (shown once)
            <input className="cs-input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" className="cs-btn" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
      )}
      {!url && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await action(fd);
              setM(msgOf(r));
              setN((x) => x + 1);
              setCopied(false);
              if (msgOf(r)?.kind === 'notice') router.refresh();
            });
          }}
        >
          <div className="cs-actions" style={{ alignItems: 'flex-end' }}>
            {children}
            <button type="submit" className={button.startsWith('Send') ? 'cs-btn cs-btn--primary' : 'cs-btn'} disabled={pending}>{button}</button>
          </div>
          {hint && <p className="cs-hint" style={{ margin: '8px 0 0' }}>{hint}</p>}
        </form>
      )}
    </div>
  );
}
