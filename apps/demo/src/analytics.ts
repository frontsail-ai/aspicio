/**
 * Google Analytics 4 with Consent Mode v2.
 *
 * Two independent gates decide what happens, and keeping them separate is the
 * whole design:
 *
 *   1. `tagEnabled(hostname)` — whether gtag.js loads at all. Production host
 *      only, so `vp run dev` and the Playwright suites (which open the demo
 *      dozens of times per run, twice over with `E2E_PREVIEW=1`) never report.
 *   2. `bannerVisible(...)` — whether the consent banner renders. Normally it
 *      follows gate 1, but a query flag forces it so the UI is testable and
 *      reviewable off the production host.
 *
 * Consent starts denied. gtag.js is loaded with `analytics_storage: 'denied'`,
 * which is Google's advanced consent mode: the tag boots but sets no cookies
 * until `grantConsent()` runs. See DEMO-19.
 */

import type { ConsentChoice } from "./consent.ts";

/** The GA4 property for the hosted demo. */
export const MEASUREMENT_ID = "G-Z458V0QQ7S";

/** The only host allowed to report. Everything else is dev, CI, or a preview. */
export const ANALYTICS_HOST = "aspicio.frontsail.app";

/** Renders the banner off-host, for e2e and manual review. Never loads the tag. */
export const BANNER_PREVIEW_PARAM = "asp_consent_ui";

/** One queued `gtag(...)` call, in the shape gtag.js reads back off dataLayer. */
export type GtagCommand = unknown[];

declare global {
  interface Window {
    dataLayer?: GtagCommand[];
  }
}

/**
 * Whether the real tag may load. Deliberately an exact match rather than a
 * suffix test: `aspicio.frontsail.app.evil.com` must not qualify, and Vercel
 * preview aliases (`*.vercel.app`) must stay silent.
 */
export function tagEnabled(hostname: string): boolean {
  return hostname === ANALYTICS_HOST;
}

/** Whether the query string asks for the banner without the tag. */
export function bannerForced(search: string): boolean {
  return new URLSearchParams(search).get(BANNER_PREVIEW_PARAM) === "1";
}

/**
 * The banner shows only when there is a real question to ask: analytics is in
 * play (or forced for QA) and the visitor has not answered yet.
 */
export function bannerVisible(options: {
  stored: ConsentChoice | null;
  tag: boolean;
  forced: boolean;
}): boolean {
  if (options.stored !== null) return false;
  return options.tag || options.forced;
}

/**
 * The commands queued before gtag.js arrives, in order. `consent default` must
 * precede `config`, or the first pageview fires before the denial applies —
 * that ordering is the entire point of consent mode.
 */
export function bootCommands(stored: ConsentChoice | null, now: Date): GtagCommand[] {
  const commands: GtagCommand[] = [
    [
      "consent",
      "default",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      },
    ],
  ];
  if (stored === "granted") commands.push(grantCommand());
  commands.push(["js", now], ["config", MEASUREMENT_ID]);
  return commands;
}

/** The command that lifts the denial once the visitor accepts. */
export function grantCommand(): GtagCommand {
  return ["consent", "update", { analytics_storage: "granted" }];
}

/** The URL of the gtag.js loader for this property. */
export function scriptUrl(): string {
  return `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
}

function push(command: GtagCommand): void {
  // gtag.js reads its queue with Array.prototype.slice, so a plain array is
  // interchangeable with the `arguments` object Google's inline snippet pushes.
  (window.dataLayer ??= []).push(command);
}

/**
 * Queue the consent defaults and load gtag.js. Safe to call once per page; the
 * caller is responsible for the `tagEnabled` check.
 */
export function loadTag(stored: ConsentChoice | null, now: Date = new Date()): void {
  for (const command of bootCommands(stored, now)) push(command);
  const script = document.createElement("script");
  script.async = true;
  script.src = scriptUrl();
  document.head.append(script);
}

/** Lift the denial. A no-op when the tag never loaded — the queue just grows. */
export function grantConsent(): void {
  push(grantCommand());
}
