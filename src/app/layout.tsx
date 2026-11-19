// public: the root shell; renders no data
import { THEME_CSS } from '@/lib/ui/theme';

export const metadata = { title: 'Countersign' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* One constant stylesheet shared with the /sign and /verify route handlers (src/lib/ui/theme.ts). */}
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
