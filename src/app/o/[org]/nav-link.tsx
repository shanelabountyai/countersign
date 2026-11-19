'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A main-nav link that marks the current section with aria-current (Editor.dc.html header). */
export function NavLink({ href, children, exact = false }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname() ?? '';
  const current = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className="cs-nav__link" aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
