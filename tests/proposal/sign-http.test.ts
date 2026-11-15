import { describe, expect, it } from 'vitest';
import { esc, gonePage, notFoundPage, sameSite } from '@/lib/proposal/sign-http';

describe('signing POST CSRF guard', () => {
  const h = (o: Record<string, string>) => new Headers({ host: 'app.test', ...o });
  it.each<[string, Record<string, string>, boolean]>([
    ['same-origin fetch metadata (Origin null under no-referrer)', { 'sec-fetch-site': 'same-origin', origin: 'null' }, true],
    ['cross-site fetch metadata', { 'sec-fetch-site': 'cross-site', origin: 'https://app.test' }, false],
    ['same-site but another origin', { 'sec-fetch-site': 'same-site' }, false],
    ['no metadata, same Origin', { origin: 'https://app.test' }, true],
    ['no metadata, other Origin', { origin: 'https://evil.test' }, false],
    ['no metadata, Origin null', { origin: 'null' }, false],
    ['nothing at all', {}, false],
  ])('%s', (_, headers, ok) => expect(sameSite(h(headers))).toBe(ok));
});

describe('signing pages', () => {
  it('escape what they print', () => expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));

  it('answer 410 and 404 with no-store, no-referrer, noindex', async () => {
    const g = gonePage('superseded', '<b>T</b>', 'Org');
    expect(g.status).toBe(410);
    expect(g.headers.get('referrer-policy')).toBe('no-referrer');
    expect(g.headers.get('cache-control')).toContain('no-store');
    expect(g.headers.get('x-robots-tag')).toContain('noindex');
    const body = await g.text();
    expect(body).toContain('earlier version');
    expect(body).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(notFoundPage().status).toBe(404);
  });
});
