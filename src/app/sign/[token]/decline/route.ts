// public: the signing token is the credential (D-29); same-origin POST only
import { handlePost, int, str } from '@/lib/proposal/sign-http';
import { declineLink } from '@/lib/proposal/signing';

export const dynamic = 'force-dynamic';

// Decline (D-16): the version and PDF the page showed, with an optional reason.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePost(req, token, (f, meta) => declineLink(token, meta, { version: int(str(f, 'version')), pdfSha256: str(f, 'pdfSha256'), reason: str(f, 'reason') }), '');
}
