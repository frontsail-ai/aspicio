import { expect, test } from "vite-plus/test";
import {
  ANALYTICS_HOST,
  MEASUREMENT_ID,
  bannerForced,
  bannerVisible,
  bootCommands,
  grantCommand,
  scriptUrl,
  tagEnabled,
} from "./analytics.ts";

test("only the exact production host reports", () => {
  expect(tagEnabled(ANALYTICS_HOST)).toBe(true);
});

test("dev, CI and preview hosts stay silent", () => {
  // The e2e suites run on localhost and 127.0.0.1; Vercel previews and branch
  // aliases must not pollute the property either.
  for (const host of [
    "localhost",
    "127.0.0.1",
    "aspicio-demo.vercel.app",
    "aspicio-demo-git-branch.vercel.app",
  ]) {
    expect(tagEnabled(host)).toBe(false);
  }
});

test("a lookalike host cannot borrow the tag", () => {
  // Suffix matching would have let the first two through.
  for (const host of [
    "aspicio.frontsail.app.evil.com",
    "evil-aspicio.frontsail.app",
    "frontsail.app",
    "",
  ]) {
    expect(tagEnabled(host)).toBe(false);
  }
});

test("the preview flag is opt-in and exact", () => {
  expect(bannerForced("?asp_consent_ui=1")).toBe(true);
  expect(bannerForced("?foo=bar&asp_consent_ui=1")).toBe(true);
  for (const search of ["", "?asp_consent_ui=0", "?asp_consent_ui", "?asp_consent_ui=true"]) {
    expect(bannerForced(search)).toBe(false);
  }
});

test("the banner asks only an unanswered visitor", () => {
  expect(bannerVisible({ stored: null, tag: true, forced: false })).toBe(true);
  expect(bannerVisible({ stored: null, tag: false, forced: true })).toBe(true);
  expect(bannerVisible({ stored: null, tag: false, forced: false })).toBe(false);
});

test("an answered visitor is never asked again, either way", () => {
  for (const stored of ["granted", "denied"] as const) {
    expect(bannerVisible({ stored, tag: true, forced: false })).toBe(false);
    expect(bannerVisible({ stored, tag: true, forced: true })).toBe(false);
  }
});

test("consent is denied before anything else is queued", () => {
  const commands = bootCommands(null, new Date(0));
  expect(commands[0]).toEqual([
    "consent",
    "default",
    {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
    },
  ]);
});

test("the denial is queued ahead of config, not after it", () => {
  // If `config` ran first the pageview would fire with storage still allowed —
  // this ordering is the whole mechanism, so assert the indices, not just
  // membership.
  const names = bootCommands(null, new Date(0)).map((c) => `${String(c[0])}:${String(c[1])}`);
  const denial = names.findIndex((n) => n.startsWith("consent:default"));
  const config = names.findIndex((n) => n.startsWith("config:"));
  expect(denial).toBeGreaterThanOrEqual(0);
  expect(config).toBeGreaterThan(denial);
});

test("an unanswered visitor is never silently granted", () => {
  const commands = bootCommands(null, new Date(0));
  expect(commands).not.toContainEqual(grantCommand());
});

test("a returning granter is restored before config", () => {
  const commands = bootCommands("granted", new Date(0));
  const grant = commands.findIndex((c) => c[0] === "consent" && c[1] === "update");
  const config = commands.findIndex((c) => c[0] === "config");
  expect(grant).toBeGreaterThan(0);
  expect(config).toBeGreaterThan(grant);
});

test("a returning refuser stays denied with no update", () => {
  expect(bootCommands("denied", new Date(0))).not.toContainEqual(grantCommand());
});

test("the boot sequence configures exactly this property", () => {
  expect(bootCommands(null, new Date(0))).toContainEqual(["config", MEASUREMENT_ID]);
  expect(scriptUrl()).toBe(`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
});

test("granting lifts analytics storage only", () => {
  // Ad storage stays denied — the demo runs no ads and must not imply it does.
  expect(grantCommand()).toEqual(["consent", "update", { analytics_storage: "granted" }]);
});
