'use client';
import { useState } from 'react';

/** Reads the chosen file into a hidden base64 field (the action takes strings only), with a preview. */
export function LogoField({ current, maxKb }: { current: string | null; maxKb: number }) {
  const [b64, setB64] = useState('');
  const [preview, setPreview] = useState<string | null>(current);
  const [note, setNote] = useState('');
  return (
    <div className="cs-rows">
      <label className="cs-label">
        Logo (PNG or JPEG, up to {maxKb} KB)
        <input type="file" accept="image/png,image/jpeg" className="cs-input" style={{ padding: 8, minHeight: 52 }} aria-describedby="cs-logo-note"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (!f) { setB64(''); setNote(''); return; }
            if (f.size > maxKb * 1024) { setB64(''); setNote(`That file is ${Math.ceil(f.size / 1024)} KB; the limit is ${maxKb} KB.`); return; }
            const r = new FileReader();
            r.onload = () => {
              const url = String(r.result);
              setPreview(url);
              setB64(url.slice(url.indexOf(',') + 1));
              setNote('Shown below as clients will see it, once you save.');
            };
            r.readAsDataURL(f);
          }} />
      </label>
      <input type="hidden" name="logoBase64" value={b64} />
      <span id="cs-logo-note" className="cs-hint" aria-live="polite">{note || 'Shown at 30 px tall next to your org name on every client page.'}</span>
      {preview && (
        <div className="cs-orgmark" style={{ background: 'var(--cs-surface)', border: '1px solid var(--cs-line)', borderRadius: 10, padding: 12, alignSelf: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL preview */}
          <img src={preview} alt="Logo preview" style={{ height: 30, width: 'auto', maxWidth: 160 }} />
        </div>
      )}
    </div>
  );
}
