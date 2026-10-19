export const APP_NAME = 'Q-WorkDone';
export const APP_TAGLINE = 'The heart of your business';

/** Square ink "Q" logo mark (follows the color scheme). */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span className="wd-logo brand-mark" style={{ width: size, height: size, borderRadius: size * 0.3 }} aria-hidden="true">
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m15.5 15.5 4 4" />
      </svg>
    </span>
  );
}

/** Logo mark with the product name and tagline. */
export function BrandLockup({ size = 60, tagline = true }: { size?: number; tagline?: boolean }) {
  return (
    <div className="brand-lockup">
      <BrandMark size={size} />
      <div>
        <div className="brand-name">{APP_NAME}</div>
        {tagline && <div className="brand-tagline">{APP_TAGLINE}</div>}
      </div>
    </div>
  );
}
