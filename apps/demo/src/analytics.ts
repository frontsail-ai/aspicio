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
 * Nothing is requested from Google until the visitor accepts — not the
 * collector, not gtag.js itself. Google's advanced consent mode (load the tag
 * denied, send cookieless pings until consent) would hand us modelled traffic
 * in exchange for contacting Google about people who declined, which the
 * privacy policy promises we do not do; the modelling needs 1,000 denied
 * events a day to engage anyway, which this site will never see. So the tag
 * loads on grant and not before. See DEMO-19.
 */

import type { ConsentChoice } from "./consent.ts";

/** The GA4 property for the hosted demo. */
export const MEASUREMENT_ID = "G-Z458V0QQ7S";

/** The only host allowed to report. Everything else is dev, CI, or a preview. */
export const ANALYTICS_HOST = "aspicio.frontsail.app";

/** Renders the banner off-host, for e2e and manual review. Never loads the tag. */
export const BANNER_PREVIEW_PARAM = "asp_consent_ui";

/** One queued `gtag(...)` call, as arguments: `["config", MEASUREMENT_ID]`. */
export type GtagCommand = unknown[];

declare global {
  interface Window {
    /**
     * gtag.js executes a queue entry only when it is an `arguments` object, so
     * the queue is typed as one: pushing a plain array is a type error here
     * rather than a tag that loads, reports nothing, and looks healthy.
     */
    dataLayer?: IArguments[];
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
 * The commands queued before gtag.js arrives, in order. The denial still leads
 * even though every caller has consent by then: it is what keeps ad storage
 * denied for a visitor who only agreed to analytics, and `config` must follow
 * it or the first pageview fires under the wrong consent state.
 */
export function bootCommands(now: Date): GtagCommand[] {
  return [
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
    grantCommand(),
    ["js", now],
    ["config", MEASUREMENT_ID],
  ];
}

/** The command that lifts the denial once the visitor accepts. */
export function grantCommand(): GtagCommand {
  return ["consent", "update", { analytics_storage: "granted" }];
}

/** The URL of the gtag.js loader for this property. */
export function scriptUrl(): string {
  return `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
}

/**
 * Google's snippet is `function gtag(){ dataLayer.push(arguments) }`, and the
 * `arguments` object is load-bearing: gtag.js dispatches a queue entry only
 * when `Object.prototype.toString.call(entry) === "[object Arguments]"`. A
 * plain array takes the legacy GTM `["object.method", …]` branch instead — it
 * splits `entry[0]` on `.`, finds no global named `config`, and drops the
 * command with no error. Commands therefore travel as arrays (readable, and
 * assertable in unit tests) and are converted here, at the one place that
 * touches the queue.
 */
const asArguments = function (): IArguments {
  return arguments;
} as (...command: unknown[]) => IArguments;

function push(command: GtagCommand): void {
  (window.dataLayer ??= []).push(asArguments(...command));
}

/**
 * Start measuring: queue the commands and fetch gtag.js. Calling this *is* the
 * act of reporting to Google, so call it only for a visitor who accepted, and
 * only on the production host (`tagEnabled`). Safe to call once per page.
 */
export function loadTag(now: Date = new Date()): void {
  for (const command of bootCommands(now)) push(command);
  const script = document.createElement("script");
  script.async = true;
  script.src = scriptUrl();
  document.head.append(script);
}
