import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { BrandMark } from '@/lib/ui/brand-mark';
import { NavLink } from './nav-link';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
// The header is Editor.dc.html's: Proposals, Templates and Verify first; the foundation's pages stay one click away.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const base = `/o/${ctx.slug}`;
  return (
    <>
      <a className="cs-skip" href="#content">Skip to content</a>
      <header className="cs-top">
        <nav aria-label="Main" className="cs-top__in">
          <div className="cs-nav">
            <Link href={base} className="cs-brand"><BrandMark />Countersign</Link>
            <NavLink href={`${base}/proposals`}>Proposals</NavLink>
            <NavLink href={`${base}/templates`}>Templates</NavLink>
            <a href="/verify" className="cs-nav__link">Verify a PDF</a>
          </div>
          <div className="cs-nav__more">
            <Link href={base}>Home</Link>
            <Link href={`${base}/projects`}>Projects</Link>
            <Link href={`${base}/settings/members`}>Members</Link>
            {can(ctx.role, 'audit.read') && <><Link href={`${base}/settings/audit`}>Audit log</Link><Link href={`${base}/settings/security`}>Security</Link></>}
            {ctx.role === 'owner' && <Link href={`${base}/settings/sso`}>SSO</Link>} {/* sso */}
            {can(ctx.role, 'apikeys.manage') && <Link href={`${base}/settings/apikeys`}>API keys</Link>} {/* apikeys */}
            {can(ctx.role, 'org.delete') && <Link href={`${base}/settings/danger`}>Export or delete</Link>}
            <Link href="/onboarding">Your orgs</Link>
            <Link href="/account/security">Account</Link>
          </div>
          <span className="cs-who"><strong>{org.name}</strong> · {ctx.session.email} ({ctx.role})</span>
        </nav>
      </header>
      <div id="content" tabIndex={-1}>{children}</div>
    </>
  );
}
