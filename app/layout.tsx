import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chapter Companion',
  description: 'Track characters as you read your ebook — spoiler-free.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
