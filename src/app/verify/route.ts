// public: the verify page is for anyone holding a Countersign PDF; it only reads, and needs the exact bytes (D-40, D-42)
import { clientIp } from '@/core/http';
import { verifyErrorPage, verifyFormPage, verifyResultPage } from '@/lib/proposal/verify-http';
import { checkVerifyLimit, verifyPdf, VerifyRefusal, VERIFY_MAX_BYTES } from '@/lib/proposal/verify';

export const dynamic = 'force-dynamic';

/** GET /verify: the upload form. */
export async function GET() {
  return verifyFormPage();
}

/** Multipart overhead allowed on top of the file itself. */
const ENVELOPE = 64 * 1024;
const TOO_BIG = `That file is larger than ${VERIFY_MAX_BYTES / 1024 / 1024} MB, so it is not a Countersign document.`;

/** The request body, or null once it passes `max` bytes (a declared or a chunked body alike: nothing past the cap is read). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** POST /verify: one uploaded file in, a verdict page out (200 for every verdict; 400/413/429 for a refused upload). */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  try {
    await checkVerifyLimit(ip); // before the body is read
    const body = await readCapped(req, VERIFY_MAX_BYTES + ENVELOPE);
    if (!body) return verifyErrorPage(413, TOO_BIG);
    let file: FormDataEntryValue | null = null;
    try {
      file = (await new Response(Buffer.from(body), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData()).get('file');
    } catch {
      return verifyErrorPage(400, 'Upload the file from the form on this page.');
    }
    if (!(file instanceof File) || file.size === 0) return verifyErrorPage(400, 'Choose a PDF file to check.');
    return verifyResultPage(await verifyPdf(new Uint8Array(await file.arrayBuffer()), { ip, limited: true }));
  } catch (e) {
    if (e instanceof VerifyRefusal) return verifyErrorPage(e.status, e.message);
    throw e;
  }
}
