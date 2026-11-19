// public: the signing token is the credential (D-29); this route only reads (D-33)
import { gonePage, landingPage, limitedPage, metaOf, notFoundPage } from '@/lib/proposal/sign-http';
import { ClientRefusal, openLink } from '@/lib/proposal/signing';

export const dynamic = 'force-dynamic';

// GET /sign/<token> (D-30): 200 landing, 410 when the version was superseded, declined or expired or the link lapsed or
// was replaced (CS-03), 404 for an unknown token.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const v = await openLink(token, metaOf(req));
    if (v.code === 404) return notFoundPage();
    if (v.code === 410) return gonePage(v.reason, v.title, v.orgName, v.brand);
    return landingPage(token, v);
  } catch (e) {
    if (e instanceof ClientRefusal && e.status === 429) return limitedPage();
    throw e;
  }
}
