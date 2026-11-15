import { requireOrg } from '@/core/authz/guards';
import { slugify } from '@/lib/proposal/signing';
import { getDocument } from '@/lib/proposal/store';

export const dynamic = 'force-dynamic';

// A stored PDF of one of the org's proposals: ?v=<version>&kind=proposal|certificate. The exact bytes that were hashed
// (D-31), so the download always verifies against the recorded SHA-256.
export async function GET(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const v = q.get('v') ?? '';
  const kind = q.get('kind') === 'certificate' ? 'certificate' : 'proposal';
  if (!/^\d{1,9}$/.test(v) || !/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const d = await getDocument(ctx, id, Number(v), kind);
  return new Response(Buffer.from(d.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slugify(d.version.title)}-v${d.version.number}${kind === 'certificate' ? '-certificate' : ''}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': d.sha256,
    },
  });
}
