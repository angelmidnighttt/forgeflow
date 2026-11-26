import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/features/auth/auth-provider';
import './globals.css';

// The vietnamese subset carries the precomposed letters with diacritics (ạ, ế, ữ…).
const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: { default: 'ForgeFlow', template: '%s · ForgeFlow' },
  description: 'Deployment, sự cố và khắc phục có kiểm soát ở cùng một nơi.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={cn('font-sans', inter.variable)}>
      <body className="min-h-svh bg-muted/40 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
