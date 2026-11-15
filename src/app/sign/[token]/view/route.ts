// public: the signing token is the credential (D-29); same-origin POST only
import { handlePost, int, str } from '@/lib/proposal/sign-http';
import { recordView } from '@/lib/proposal/signing';

export const dynamic = 'force-dynamic';

// "Open proposal" (D-33): records the view, bound to the version and PDF the landing showed (D-16).
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePost(req, token, (f, meta) => recordView(token, meta, { version: int(str(f, 'version')), pdfSha256: str(f, 'pdfSha256') }), 'review');
}
