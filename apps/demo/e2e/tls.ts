import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A throwaway certificate for the analytics suite.
 *
 * That suite has to serve the demo under `aspicio.frontsail.app`, because the
 * GA4 tag loads on that host and no other — and the whole `.app` TLD is in
 * Chromium's HSTS preload list, so a plaintext server is force-upgraded to
 * HTTPS and answers with ERR_SSL_PROTOCOL_ERROR. Hence TLS, with the browser
 * told to ignore the self-signed cert (`ignoreHTTPSErrors`).
 *
 * The cert lives under node_modules/.cache — never committed, regenerated
 * whenever it is missing, and used by nothing but the test server.
 */
const DIR = fileURLToPath(new URL("../node_modules/.cache/e2e-tls/", import.meta.url));

/** Generates the cert on first use and returns the directory holding it. */
export function tlsDir(host: string): string {
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(`${DIR}cert.pem`) || !existsSync(`${DIR}key.pem`)) {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "365",
        "-keyout",
        `${DIR}key.pem`,
        "-out",
        `${DIR}cert.pem`,
        "-subj",
        `/CN=${host}`,
        "-addext",
        `subjectAltName=DNS:${host},DNS:localhost,IP:127.0.0.1`,
      ],
      { stdio: "ignore" },
    );
  }
  return DIR;
}
