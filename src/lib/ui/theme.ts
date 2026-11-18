// Countersign UI theme (design pass 2026-11-18, docs/design/*.dc.html). One stylesheet for the React pages (root layout)
// and the HTML the /sign and /verify route handlers answer with (D-30, D-42), so both look the same. Tokens are the
// artboards' colours; every text/background pair is at least 4.5:1 and every control border at least 3:1 (D-50).
// System font stacks only: no web font is loaded (D-49). Light only: the app has no dark theme (D-51).

export const THEME_CSS = `
:root{color-scheme:light;
--cs-bg:#EFEFEA;--cs-bg-app:#F7F7F4;--cs-surface:#FFFFFF;--cs-head:#F0F0EB;
--cs-ink:#16181D;--cs-ink-2:#3E434D;--cs-muted:#565B66;
--cs-line:#D9D9D2;--cs-line-soft:#E4E4DE;--cs-field:#8A8F99;
--cs-accent:#0F5E63;--cs-accent-hover:#0A4347;--cs-accent-wash:#F2F8F8;--cs-mark:#7FD1CF;
--cs-blue:#1D4F91;--cs-blue-ink:#163F75;--cs-blue-wash:#E6EEF9;
--cs-amber-ink:#6B4100;--cs-amber-wash:#FBF0DA;--cs-amber-line:#9A6700;
--cs-red-ink:#8A1F11;--cs-red-wash:#FBE9E7;--cs-red-line:#B42318;
--cs-teal-wash:#E3F1F1;--cs-grey-wash:#EEEEEA;
--cs-sans:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--cs-serif:"Source Serif 4",Georgia,Cambria,"Times New Roman",serif;
--cs-display:"Space Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
--cs-mono:ui-monospace,Menlo,Consolas,monospace}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cs-bg-app);color:var(--cs-ink);font-family:var(--cs-sans);font-size:15px;line-height:1.5}
a{color:var(--cs-accent)}a:hover{color:var(--cs-accent-hover)}
:focus-visible{outline:3px solid var(--cs-accent);outline-offset:2px}
input,select,textarea,button{font:inherit;color:inherit}
input[type=checkbox],input[type=radio]{accent-color:var(--cs-accent)}
code{font-family:var(--cs-mono);font-size:.88em}
.cs-skip{position:absolute;left:-9999px;top:0;background:var(--cs-surface);color:var(--cs-ink);padding:10px 14px;z-index:10}
.cs-skip:focus{left:8px;top:8px}
.cs-vh{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}

/* controls */
.cs-btn{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 16px;border-radius:10px;border:1px solid var(--cs-field);background:var(--cs-surface);color:var(--cs-ink);font-weight:600;text-decoration:none;cursor:pointer;line-height:1.2}
.cs-btn:hover{background:var(--cs-head);color:var(--cs-ink)}
.cs-btn--primary{background:var(--cs-accent);border-color:var(--cs-accent);color:#FFFFFF}
.cs-btn--primary:hover{background:var(--cs-accent-hover);color:#FFFFFF}
.cs-btn--blue{background:var(--cs-blue);border-color:var(--cs-blue);color:#FFFFFF}
.cs-btn--blue:hover{background:var(--cs-blue-ink);color:#FFFFFF}
.cs-btn--blue-ghost{border-color:var(--cs-blue);color:var(--cs-blue-ink)}
.cs-btn--danger{background:var(--cs-red-ink);border-color:var(--cs-red-ink);color:#FFFFFF}
.cs-btn--danger:hover{background:#6E180D;color:#FFFFFF}
.cs-btn--lg{min-height:52px;padding:0 24px}
.cs-btn--sm{min-height:44px;padding:0 12px;font-size:14px}
.cs-btn[disabled],fieldset[disabled] .cs-btn{opacity:.6;cursor:not-allowed}
.cs-input{min-height:44px;width:100%;border:1px solid var(--cs-field);border-radius:8px;padding:0 10px;background:var(--cs-surface);font-weight:400}
textarea.cs-input{padding:8px 10px;min-height:88px;resize:vertical}
select.cs-input{padding:0 8px}
.cs-label{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600}
.cs-hint{font-size:13px;color:var(--cs-muted);font-weight:400}
.cs-check{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.cs-check input{width:22px;height:22px;margin:1px 0 0;flex:0 0 auto}

/* surfaces */
.cs-card{background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}
.cs-card--flush{padding:0;gap:0;overflow:hidden}
.cs-card__head{padding:14px 16px;border-bottom:1px solid var(--cs-line-soft);display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between}
.cs-card h2,.cs-card__head h2{margin:0;font-size:17px;font-weight:600}
.cs-scroll{overflow-x:auto}
.cs-table{width:100%;border-collapse:collapse}
.cs-table th{background:var(--cs-head);text-align:left;font-size:13px;font-weight:600;color:var(--cs-ink-2);padding:10px 8px}
.cs-table td{padding:12px 8px;border-top:1px solid var(--cs-line-soft);vertical-align:top}
.cs-table th:first-child,.cs-table td:first-child{padding-left:16px}
.cs-table th:last-child,.cs-table td:last-child{padding-right:16px}
.cs-num{text-align:right!important;font-variant-numeric:tabular-nums}
.cs-totals-wrap{width:380px;max-width:100%;display:flex;flex-direction:column;gap:6px;align-self:flex-end}
.cs-totals{margin:0;width:100%;display:flex;flex-direction:column;gap:6px}
.cs-totals>div{display:flex;justify-content:space-between;gap:12px}
.cs-totals dt{margin:0}.cs-totals dd{margin:0;font-variant-numeric:tabular-nums;text-align:right}
.cs-totals .cs-soft{color:var(--cs-ink-2)}
.cs-totals .cs-grand{border-top:2px solid var(--cs-ink);padding-top:8px;font-weight:600;font-size:17px}

/* status: word + glyph + colour, never colour alone (docs/design/HANDOFF.md) */
.cs-pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 9px;font-size:13px;font-weight:600;white-space:nowrap;background:var(--cs-grey-wash);color:var(--cs-ink-2)}
.cs-pill--lg{padding:4px 12px;font-size:14px}
.cs-pill--sent{background:var(--cs-teal-wash);color:var(--cs-accent)}
.cs-pill--viewed{background:var(--cs-blue-wash);color:var(--cs-blue)}
.cs-pill--signed{background:var(--cs-blue);color:#FFFFFF}
.cs-pill--declined,.cs-pill--bad{background:var(--cs-red-wash);color:var(--cs-red-ink)}
.cs-pill--expired,.cs-pill--superseded,.cs-pill--warn{background:var(--cs-amber-wash);color:var(--cs-amber-ink)}
.cs-pill--accent{background:var(--cs-surface);color:var(--cs-accent);border:1px solid var(--cs-accent);border-radius:6px;padding:0 6px;font-size:12px}
.cs-banner{display:flex;gap:10px;align-items:flex-start;border-radius:10px;padding:12px 14px;background:var(--cs-amber-wash);color:#5C3800}
.cs-banner--info{background:var(--cs-blue-wash);color:var(--cs-blue-ink)}
.cs-banner--bad{background:var(--cs-red-wash);color:var(--cs-red-ink)}
.cs-banner--ok{background:var(--cs-blue-wash);color:var(--cs-blue-ink)}
.cs-banner__glyph{font-weight:700;flex:0 0 auto}
.cs-banner p{margin:0}

/* ActionForm (template-owned) messages */
form>p[role=alert]{margin:0 0 12px;display:flex;gap:8px;background:var(--cs-red-wash);color:var(--cs-red-ink);border-radius:10px;padding:12px 14px}
form>p[role=alert]::before{content:"✗";font-weight:700}
form>p[role=status]{margin:0 0 12px;display:flex;gap:8px;background:var(--cs-blue-wash);color:var(--cs-blue-ink);border-radius:10px;padding:12px 14px;overflow-wrap:anywhere}
form>p[role=status]::before{content:"✓";font-weight:700}

/* sender app shell (Editor.dc.html) */
.cs-top{background:var(--cs-surface);border-bottom:1px solid var(--cs-line)}
.cs-top__in{max-width:1360px;margin:0 auto;padding:8px 24px;display:flex;flex-wrap:wrap;gap:4px 18px;align-items:center;justify-content:space-between}
.cs-nav{display:flex;flex-wrap:wrap;align-items:center;gap:0 18px}
.cs-brand{display:inline-flex;align-items:center;gap:8px;font-family:var(--cs-display);font-weight:700;color:var(--cs-ink);text-decoration:none;min-height:44px}
.cs-nav a.cs-nav__link{display:inline-flex;align-items:center;min-height:44px;color:var(--cs-ink-2);text-decoration:none;border-bottom:2px solid transparent}
.cs-nav a.cs-nav__link:hover{color:var(--cs-ink);border-bottom-color:var(--cs-field)}
.cs-nav a.cs-nav__link[aria-current=page]{color:var(--cs-ink);font-weight:600;border-bottom-color:var(--cs-accent)}
.cs-nav__more{display:flex;flex-wrap:wrap;gap:0 14px;font-size:13px}
.cs-nav__more a{color:var(--cs-ink-2);min-height:44px;display:inline-flex;align-items:center}
.cs-who{font-size:14px;color:var(--cs-muted)}
.cs-app{max-width:1360px;margin:0 auto;padding:24px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
.cs-app>.cs-col{flex:999 1 640px;min-width:0;display:flex;flex-direction:column;gap:18px}
.cs-app>.cs-side{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:16px}
.cs-app--stack{flex-direction:column;flex-wrap:nowrap;align-items:stretch}
.cs-pagehead{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
.cs-pagehead h1,.cs-h1{margin:0;font-family:var(--cs-display);font-size:26px;font-weight:700;line-height:1.2}
.cs-meta{font-size:13px;color:var(--cs-muted)}
.cs-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cs-back{font-size:14px;font-weight:600;min-height:44px;display:inline-flex;align-items:center;align-self:flex-start}
.cs-empty{padding:32px 24px;display:flex;flex-direction:column;gap:8px}
.cs-empty h2{margin:0;font-size:18px}
.cs-empty p{margin:0;color:var(--cs-ink-2)}
.cs-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.cs-steps li{display:flex;align-items:center;gap:10px;color:var(--cs-muted)}
.cs-steps li.cs-done{color:var(--cs-ink)}
.cs-steps li.cs-now{color:var(--cs-accent);font-weight:600}
.cs-steps li .cs-when{margin-left:auto;font-size:13px;font-weight:400;color:var(--cs-muted);text-align:right}
.cs-steps__g{width:18px;text-align:center}
.cs-versions{margin:0;padding:0;list-style:none}
.cs-versions li{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--cs-line-soft)}
.cs-versions .cs-row{display:flex;justify-content:space-between;gap:8px;align-items:center}
.cs-hash{font-family:var(--cs-mono);font-size:12px;overflow-wrap:anywhere;color:var(--cs-ink-2)}
.cs-rows{display:flex;flex-direction:column;gap:10px}
.cs-secrow{margin:0;border:1px solid var(--cs-line-soft);border-radius:10px;padding:12px;display:grid;grid-template-columns:90px 160px minmax(0,1fr);gap:10px}
.cs-secrow legend{font-size:13px;font-weight:600;color:var(--cs-ink-2);padding:0 4px}
.cs-secrow .cs-wide{grid-column:1/-1}
.cs-lines td{padding:8px}
.cs-lines .cs-input{min-width:0}
.cs-danger{border:1px solid var(--cs-line);border-radius:10px;background:var(--cs-surface);padding:0 14px}
.cs-danger summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600;color:var(--cs-red-ink)}
.cs-danger>div{padding:0 0 14px;display:flex;flex-direction:column;gap:8px}
.cs-doc-preview{display:flex;flex-direction:column;gap:12px}
.cs-doc-preview h3{margin:0;font-size:16px}
.cs-doc-preview p{margin:0;white-space:pre-wrap}
@media (max-width:640px){
.cs-top__in,.cs-app{padding-left:16px;padding-right:16px}
.cs-secrow{grid-template-columns:1fr 1fr}
.cs-secrow .cs-title{grid-column:1/-1}
}

/* client pages (Main, PhoneSign, Certificate, Superseded, SignLanding, LinkNotices, DeclineConfirm, Verify) */
.cs-client{min-height:100vh;background:var(--cs-bg);color:var(--cs-ink);font-size:16px}
.cs-topnote{background:var(--cs-ink);color:#E6E7E3;font-size:14px}
.cs-topnote>div{max-width:880px;margin:0 auto;padding:10px 24px;display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:space-between}
.cs-topnote strong{color:#FFFFFF}
.cs-client__main{max-width:880px;margin:0 auto;padding:32px 24px 64px;display:flex;flex-direction:column;gap:24px}
.cs-client__main--narrow{max-width:640px;padding-top:56px;gap:20px}
.cs-orgmark{display:flex;align-items:center;gap:10px;font-family:var(--cs-display);font-weight:700;font-size:18px}
.cs-mono{width:28px;height:28px;border-radius:7px;background:var(--cs-ink);color:var(--cs-mark);display:inline-flex;align-items:center;justify-content:center;font-family:var(--cs-display);font-weight:700;font-size:15px;flex:0 0 auto}
.cs-mono--lg{width:30px;height:30px;font-size:16px}
.cs-doc{background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:6px;padding:56px 64px;display:flex;flex-direction:column;gap:28px;font-family:var(--cs-serif);font-size:18px;line-height:1.6}
.cs-doc__head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid var(--cs-ink);padding-bottom:20px}
.cs-doc__head .cs-orgmark{font-size:20px}
.cs-doc__ref{font-family:var(--cs-sans);font-size:14px;color:var(--cs-muted);text-align:right}
.cs-eyebrow{font-family:var(--cs-sans);font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--cs-muted)}
.cs-doc h1{margin:0;font-size:36px;line-height:1.2;font-weight:600}
.cs-doc h2{margin:0;font-size:22px;font-weight:600}
.cs-doc section{display:flex;flex-direction:column;gap:10px}
.cs-doc p{margin:0}
.cs-prose{white-space:pre-wrap}
.cs-invest{font-family:var(--cs-sans);font-size:15px}
.cs-invest table{width:100%;border-collapse:collapse}
.cs-invest th{text-align:left;padding:8px 0;font-weight:600;border-bottom:1px solid var(--cs-ink)}
.cs-invest td{padding:10px 0;border-bottom:1px solid var(--cs-line-soft);vertical-align:middle}
.cs-invest th+th,.cs-invest td+td{padding-left:12px}
.cs-invest tr.cs-addon{background:var(--cs-surface)}
.cs-invest tr.cs-addon.cs-on{background:var(--cs-accent-wash)}
.cs-invest .cs-addon label{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer}
.cs-invest .cs-addon input{width:22px;height:22px;flex:0 0 auto}
.cs-invest .cs-out{color:var(--cs-muted)}
.cs-invest .cs-sub{display:none;color:var(--cs-muted);font-size:13px}
.cs-invest .cs-note{font-size:13px;color:var(--cs-muted)}
.cs-invest .cs-totals-wrap{width:360px}
.cs-invest .cs-totals{font-size:15px}
.cs-invest .cs-totals .cs-grand{font-size:18px}
.cs-panel{background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:12px;padding:28px;display:flex;flex-direction:column;gap:18px}
.cs-panel h2{margin:0;font-family:var(--cs-display);font-size:24px;font-weight:600}
.cs-panel .cs-foot{font-size:13px;color:var(--cs-muted);margin:0}
.cs-signrow{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end}
.cs-signrow>.cs-namefield{flex:1 1 280px;display:flex;flex-direction:column;gap:6px}
.cs-namefield label{font-weight:600;font-size:15px}
.cs-sig{min-height:52px;width:100%;border:1px solid var(--cs-field);border-radius:10px;padding:0 14px;font-family:var(--cs-serif);font-size:22px;font-style:italic;background:var(--cs-surface)}
.cs-linkbtn{background:none;border:0;padding:0;color:var(--cs-accent);text-decoration:underline;cursor:pointer;min-height:44px;font-size:14px}
.cs-pad{display:flex;flex-direction:column;gap:8px}
.cs-pad canvas{border:1px solid var(--cs-field);border-radius:10px;width:100%;max-width:600px;aspect-ratio:3/1;touch-action:none;background:var(--cs-surface)}
.cs-btnrow{display:flex;flex-direction:row-reverse;gap:10px;flex-wrap:wrap;align-items:flex-start;justify-content:flex-start}
.cs-decline>summary{list-style:none}
.cs-decline>summary::-webkit-details-marker{display:none}
.cs-decline[open]{flex-basis:100%}
.cs-decline[open]>summary{display:none}
.cs-confirm{border:1px solid var(--cs-red-line);border-left-width:4px;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:12px;background:var(--cs-surface)}
.cs-confirm h3{margin:0;font-size:18px;font-weight:600;display:flex;gap:8px;align-items:center}
.cs-confirm p{margin:0;color:var(--cs-ink-2)}
.cs-consent details{margin:4px 0 0 32px;font-size:14px;color:var(--cs-ink-2)}
.cs-consent summary{cursor:pointer;color:var(--cs-accent);min-height:44px;display:inline-flex;align-items:center}
.cs-consent blockquote{margin:0;padding:8px 12px;border-left:3px solid var(--cs-line);overflow-wrap:anywhere}
.cs-done{background:var(--cs-blue-wash);color:var(--cs-blue-ink);border-radius:12px;padding:20px 24px;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between}
.cs-done__mark{width:36px;height:36px;border-radius:50%;background:var(--cs-blue);color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-weight:700;flex:0 0 auto}
.cs-done h1{margin:0;font-family:var(--cs-display);font-size:22px;font-weight:700}
.cs-done p{margin:0;font-size:15px}
.cs-cert{background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:6px;padding:48px 56px;display:flex;flex-direction:column;gap:24px}
.cs-cert__head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;border-bottom:2px solid var(--cs-ink);padding-bottom:16px}
.cs-cert h2{margin:0;font-family:var(--cs-serif);font-size:30px;font-weight:600}
.cs-cert h3{margin:0;font-family:var(--cs-serif);font-size:20px;font-weight:600}
.cs-facts{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 32px;font-size:15px}
.cs-facts dt{color:var(--cs-muted);font-size:13px;font-weight:600}
.cs-facts dd{margin:0}
.cs-facts .cs-wide{grid-column:1/-1}
.cs-fp{font-family:var(--cs-mono);font-size:13px;overflow-wrap:anywhere;background:var(--cs-head);border-radius:6px;padding:8px 10px}
.cs-log{overflow-x:auto;border:1px solid var(--cs-line-soft);border-radius:8px}
.cs-log table{width:100%;min-width:640px;border-collapse:collapse;font-size:14px}
.cs-log th{background:var(--cs-head);text-align:left;padding:10px 12px;font-weight:600}
.cs-log td{padding:10px 12px;border-top:1px solid var(--cs-line-soft);color:var(--cs-ink-2)}
.cs-log td:first-child{white-space:nowrap;color:var(--cs-ink)}
.cs-log td:nth-child(2){color:var(--cs-ink);font-weight:500}
.cs-log .cs-ip{font-family:var(--cs-mono);font-size:13px}
.cs-notice{background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:12px;padding:32px;display:flex;flex-direction:column;gap:16px}
.cs-notice h1{margin:0;font-family:var(--cs-serif);font-size:30px;font-weight:600;line-height:1.25}
.cs-notice p{margin:0;color:var(--cs-ink-2)}
.cs-notice ul{margin:0;padding-left:20px;color:var(--cs-ink-2)}
.cs-small{margin:0;font-size:13px;color:var(--cs-muted)}
.cs-landing dl{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;font-size:15px}
.cs-landing dt{color:var(--cs-muted);font-size:13px;font-weight:600}
.cs-landing dd{margin:0}
.cs-landing form{margin:0}
.cs-verdict{background:var(--cs-surface);border:1px solid var(--cs-line);border-left-width:6px;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:14px}
.cs-verdict--ok{border-color:var(--cs-blue)}.cs-verdict--bad{border-color:var(--cs-red-line)}.cs-verdict--warn{border-color:var(--cs-amber-line)}
.cs-verdict__head{display:flex;gap:12px;align-items:center}
.cs-verdict__head h2{margin:0;font-family:var(--cs-display);font-size:22px;font-weight:700}
.cs-verdict--ok h2{color:var(--cs-blue-ink)}.cs-verdict--bad h2{color:var(--cs-red-ink)}.cs-verdict--warn h2{color:var(--cs-amber-ink)}
.cs-dot{width:36px;height:36px;flex:0 0 auto;border-radius:50%;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-weight:700}
.cs-verdict--ok .cs-dot{background:var(--cs-blue)}.cs-verdict--bad .cs-dot{background:var(--cs-red-ink)}.cs-verdict--warn .cs-dot{background:var(--cs-amber-ink)}
.cs-verdict p{margin:0;color:var(--cs-ink-2)}
.cs-verdict h3{margin:0;font-size:16px}
.cs-verdict dl{border-top:1px solid var(--cs-line-soft);padding-top:14px}
.cs-checks{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;font-size:15px}
.cs-checks li{display:flex;gap:10px;align-items:baseline}
.cs-checks .cs-g{width:18px;font-weight:700;flex:0 0 auto}
.cs-checks [data-ok=true] .cs-g,.cs-checks [data-ok=true] .cs-w{color:var(--cs-blue-ink)}
.cs-checks [data-ok=false] .cs-g,.cs-checks [data-ok=false] .cs-w{color:var(--cs-red-ink)}
.cs-checks .cs-w{font-weight:600}
.cs-codebox{font-family:var(--cs-mono);font-size:13px;overflow-wrap:anywhere;background:var(--cs-head);border-radius:6px;padding:2px 6px}
.cs-upload{background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:12px}
.cs-upload h2{margin:0;font-family:var(--cs-display);font-size:20px;font-weight:600}
.cs-upload label{font-weight:600;font-size:15px}
.cs-upload input[type=file]{min-height:52px;width:100%;border:1px dashed var(--cs-field);border-radius:10px;padding:12px;background:var(--cs-bg-app)}
.cs-pagetitle{margin:0;font-family:var(--cs-serif);font-size:34px;font-weight:600;line-height:1.2}
.cs-lede{margin:0;max-width:680px;color:var(--cs-ink-2)}
.cs-alert{display:flex;gap:10px;background:var(--cs-red-wash);color:var(--cs-red-ink);border-radius:10px;padding:12px 14px}
.cs-alert p{margin:0}

@media (max-width:640px){
.cs-topnote>div{padding:10px 16px;font-size:13px;flex-direction:column;gap:2px}
.cs-client__main{padding:0 0 32px;gap:16px}
.cs-client__main--narrow{padding:32px 16px}
.cs-doc{border:0;border-radius:0;padding:24px 20px;gap:20px;font-size:17px}
.cs-doc h1{font-size:28px}
.cs-doc h2{font-size:20px}
.cs-doc__ref{text-align:left}
.cs-invest thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.cs-invest table,.cs-invest tbody{display:block}
.cs-invest tr{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--cs-line-soft)}
.cs-invest td{border:0;padding:10px 0}
.cs-invest td.cs-qty,.cs-invest td.cs-rate{display:none}
.cs-invest .cs-sub{display:block}
.cs-invest tr.cs-addon{margin-top:8px;border:1px solid var(--cs-accent);border-radius:10px;padding:0 12px}
.cs-invest .cs-totals-wrap{width:100%}
.cs-panel{margin:0 12px;padding:20px 16px;gap:14px;background:var(--cs-bg-app)}
.cs-panel h2{font-size:20px}
.cs-btnrow{flex-direction:column;align-items:stretch}
.cs-btnrow .cs-btn{width:100%}
.cs-decline>summary.cs-btn{width:100%}
.cs-done{margin:16px 12px 0}
.cs-cert{border:0;border-radius:0;padding:24px 20px}
.cs-facts,.cs-landing dl{grid-template-columns:1fr}
.cs-notice{padding:24px 20px}
.cs-notice h1{font-size:26px}
.cs-pagetitle{font-size:28px}
}
`;
