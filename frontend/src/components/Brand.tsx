export const APP_NAME = 'Q-WorkDone';
export const APP_TAGLINE = 'The heart of your business';

/*
 * Logo artwork from the logo kit (logo-concepts/kit). The ring and wordmark use the text colour
 * (ink in light mode, white in dark mode); the tick uses the accent blue.
 */
const RING_SMALL =
  'M21.78,110.16a77 77 0 1 0 154 0a77 77 0 1 0-154 0Z M59.78,110.16a39 39 0 1 0 78 0a39 39 0 1 0-78 0Z';
const TICK_SMALL =
  'M126.36,164.61L168.78,207.03A19 19 0 0 0 195.65,180.16L153.23,137.74A19 19 0 0 0 126.36,164.61Z M198.67,203.1L231.67,145.94A19 19 0 0 0 198.76,126.94L165.76,184.1A19 19 0 0 0 198.67,203.1Z';
const RING =
  'M23.11,114.99a77 77 0 1 0 154 0a77 77 0 1 0-154 0Z M53.11,114.99a47 47 0 1 0 94 0a47 47 0 1 0-94 0Z';
const TICK =
  'M133.34,169.44L167.28,203.38A15 15 0 0 0 188.5,182.16L154.56,148.22A15 15 0 0 0 133.34,169.44Z M190.88,200.27L230.88,130.99A15 15 0 0 0 204.9,115.99L164.9,185.27A15 15 0 0 0 190.88,200.27Z';
/** Hand-built "workdone" lettering (centre-line strokes, width 22) */
const WORDMARK = [
  'M292,96L316,196L340,126L364,196L388,96',
  'M428,146a50 50 0 1 0 100 0a50 50 0 1 0-100 0',
  'M566,196V138A42 42 0 0 1 608,96',
  'M648,40V196M708,96L648,160M670,138L710,196',
  'M750,146a50 50 0 1 0 100 0a50 50 0 1 0-100 0M850,40V196',
  'M888,146a50 50 0 1 0 100 0a50 50 0 1 0-100 0',
  'M1028,96V196M1028,138A42 42 0 0 1 1112,138V196',
  'M1150,146H1250A50 50 0 1 0 1238.3,178.1',
];

/** The Q-with-a-tick symbol (heavier small-size cut, for icons and tight spaces). */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="12 28 230 190" aria-hidden="true">
      <path fillRule="evenodd" fill="currentColor" d={RING_SMALL} />
      <path className="brand-tick" d={TICK_SMALL} />
    </svg>
  );
}

/** Full logo: symbol + "workdone" wordmark. `height` is the rendered height in px. */
export function BrandLogo({ height = 26 }: { height?: number }) {
  return (
    <svg className="brand-logo" height={height} width={(height * 1250) / 186} viewBox="18 26 1250 186" role="img" aria-label={APP_NAME}>
      <path fillRule="evenodd" fill="currentColor" d={RING} />
      <path className="brand-tick" d={TICK} />
      <path d={WORDMARK.join('')} fill="none" stroke="currentColor" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
