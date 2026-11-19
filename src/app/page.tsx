// public: the landing page
import Link from 'next/link';
import { demoEnabled } from '@/core/auth/demo';

export const dynamic = 'force-dynamic'; // reads DEMO_MODE per request, never baked in at build

export default function Home() {
  return (
    <main className="cs-app cs-app--stack" style={{ maxWidth: 720 }}>
      <h1 className="cs-h1">Countersign</h1>
      <p style={{ margin: 0 }}>Proposals with an e-sign audit trail. A demo, not a legally vetted e-signature product. Have a signed PDF? <a href="/verify">Verify it</a>.</p>
      <Link href="/login">Sign in</Link>
      {demoEnabled() && <> · <Link href="/demo">Demo accounts</Link></>}
      <footer>
        <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/terms">Terms</Link>
      </footer>
    </main>
  );
}
