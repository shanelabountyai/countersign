// public: the signing token is the credential (D-29); this route only reads
import { gonePage, limitedPage, metaOf, notFoundPage, pdfResponse } from '@/lib/proposal/sign-http';
import { ClientRefusal, linkDocument } from '@/lib/proposal/signing';

export const dynamic = 'force-dynamic';

// The stored certificate PDF, the exact bytes that were hashed (D-31). 410 once the link is gone (CS-03).
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return pdfResponse(await linkDocument(token, metaOf(req), 'certificate'), new URL(req.url).searchParams.has('inline'));
  } catch (e) {
    if (!(e instanceof ClientRefusal)) throw e;
    if (e.status === 410) return gonePage(e.reason ?? 'closed');
    if (e.status === 429) return limitedPage();
    return notFoundPage();
  }
}
