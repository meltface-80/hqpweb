/**
 * On every response: never framed by another site (clickjacking), no sniffing.
 * Pages also get a CSP that allows only our own scripts and connections.
 */
export const SECURITY_HEADERS = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
