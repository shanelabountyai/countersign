// public: the signing token is the credential (D-29); same-origin POST only
import { handlePost, int, str } from '@/lib/proposal/sign-http';
import { signLink } from '@/lib/proposal/signing';

export const dynamic = 'force-dynamic';

// Sign (D-16, D-32, D-37): the version and PDF the page showed, the signature, consent and the chosen add-ons.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePost(
    req,
    token,
    (f, meta) =>
      signLink(token, meta, {
        version: int(str(f, 'version')),
        pdfSha256: str(f, 'pdfSha256'),
        signerName: str(f, 'signerName'),
        method: str(f, 'method') === 'drawn' ? 'drawn' : 'typed',
        signatureData: str(f, 'method') === 'drawn' ? str(f, 'drawn') : str(f, 'typed'),
        consent: str(f, 'consent') === 'yes',
        selected: f.getAll('addOn').filter((x): x is string => typeof x === 'string').slice(0, 1000),
      }),
    'review?signed=1',
  );
}
