import { isHttpUrl } from "./fetch-progress.ts";
import { decodeView } from "./viewurl.ts";
import type { ViewLink } from "./viewurl.ts";

/**
 * How a drawing was addressed on arrival (DEMO-18, DEMO-23).
 *
 * The demo owns one parameter name, `src`, and it can arrive in either of two
 * carriers. Which carrier it used is not a detail — it decides what happens
 * next, so it is part of the result rather than something the caller infers.
 *
 * Before this existed the app decoded the hash and nothing else, so a `src` in
 * the query string produced the same `null` as an empty hash and landed on the
 * same blank screen. "No request" and "a request in the wrong carrier" were
 * indistinguishable, which is why the failure was silent (#193).
 */
export type Entry =
  /** The hash carried a usable link: load it, as always. */
  | { kind: "link"; link: ViewLink }
  /**
   * The query string carried a source. Offer it rather than loading it: a
   * query string reaches the server, so the URL is already in this site's
   * access log by the time any of this runs, and following it without asking
   * would make a fetch the visitor never requested.
   */
  | { kind: "offer"; src: string }
  /** Nothing addressable. */
  | { kind: "none" };

/** The query parameter the demo answers to — the same name the HTTP API uses. */
const SRC_PARAM = "src";

/**
 * Resolve the entry point from the two carriers, hash first.
 *
 * The hash wins when both are present: it is the canonical share form, it
 * carries the view state as well as the source, and it is what the app writes
 * itself. A query `src` alongside it is a stale fragment of some other link.
 */
export function resolveEntry(hash: string, search: string): Entry {
  const link = decodeView(hash);
  if (link) return { kind: "link", link };

  let src: string | null = null;
  try {
    src = new URLSearchParams(search).get(SRC_PARAM);
  } catch {
    return { kind: "none" };
  }
  // Same guard the hash path applies on decode (DEMO-18): a `javascript:`,
  // `data:` or `file:` value is not a drawing source and is not offered.
  if (!src || !isHttpUrl(src)) return { kind: "none" };
  return { kind: "offer", src };
}

/**
 * The same query string without `src`, as a `?…` string (or "").
 *
 * Used once the offer is answered either way, so a reload does not ask again
 * and the address bar stops advertising a URL the visitor may have declined.
 * Only `src` is dropped: other parameters (the consent-banner override, any
 * campaign tag) are none of this feature's business.
 */
export function withoutSrc(search: string): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return "";
  }
  params.delete(SRC_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
