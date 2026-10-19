import type { CSSProperties, ReactNode } from 'react';
import { Stack } from '@mantine/core';
import { APP_NAME, BrandMark } from './Brand';
import { ThemeToggle } from './ThemeToggle';

interface AuthLayoutProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Small text under the card */
  note?: ReactNode;
  /** Shows the "connected" footer (false when the server could not be reached) */
  connected?: boolean;
  /** Card width (wider for setup screens) */
  width?: number;
}

/** Centered sign-in style page: serif headline over a bezel card. */
export function AuthLayout({ eyebrow, title, subtitle, children, note, connected = true, width = 420 }: AuthLayoutProps) {
  return (
    <div className="wd-auth">
      <header className="wd-auth-top">
        <span className="wd-brand" style={{ padding: 0 }}>
          <BrandMark size={26} />
          {APP_NAME}
        </span>
        <ThemeToggle />
      </header>

      <main className="wd-auth-main">
        <div style={{ textAlign: 'center', maxWidth: 560 }}>
          {eyebrow && <div className="wd-eyebrow">{eyebrow}</div>}
          <h1 className="wd-title" style={{ marginTop: 12 }}>
            {title}
            <span className="wd-period">.</span>
          </h1>
          {subtitle && <p className="wd-sub">{subtitle}</p>}
        </div>

        <section className="wd-bezel" style={{ width: '100%', maxWidth: width }}>
          <div className="wd-card" style={{ padding: 24 }}>
            <Stack gap="md">{children}</Stack>
          </div>
          {note && (
            <div className="wd-bezel-foot" style={{ textAlign: 'center', padding: '12px 16px 8px' }}>
              {note}
            </div>
          )}
        </section>
      </main>

      {connected && (
        <footer className="wd-auth-foot">
          <span className="wd-dot" style={{ '--dot': '#12A150' } as CSSProperties} />
          Connected to the office server
        </footer>
      )}
    </div>
  );
}
