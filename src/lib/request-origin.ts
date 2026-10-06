import "server-only";

function protocol(value: string): string | null {
  const normalized = value.toLowerCase();
  return normalized === "http" || normalized === "https" ? normalized : null;
}

function originFromHost(proto: string, host: string): string | null {
  // Accept only an authority, never credentials, paths, escapes or a host list.
  if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/i.test(host)) return null;
  try {
    const url = new URL(`${proto}://${host}`);
    return url.hostname ? url.origin : null;
  } catch { return null; }
}

function browserOrigin(value: string): string | null {
  const match = /^(https?):\/\/([^/\\?#]+)$/i.exec(value);
  return match ? originFromHost(match[1].toLowerCase(), match[2]) : null;
}

function lastForwardedValue(value: string): string {
  // The nearest trusted proxy must overwrite or append its own value. Never
  // choose an earlier value that a client could have supplied.
  return value.split(",").at(-1)!.trim();
}

/** Validate browser origins; preserve support for clients without Origin. */
export function isValidRequestOrigin(request: Request): boolean {
  const supplied = request.headers.get("origin");
  if (supplied === null) return true;
  const origin = browserOrigin(supplied);
  if (!origin) return false;

  // Render sets RENDER=true. Other deployments must opt in only when their
  // ingress sanitizes forwarded headers and direct client access is blocked.
  const trustProxy = process.env.RENDER === "true" || process.env.TRUST_PROXY === "true";
  try {
    const url = new URL(request.url);
    const forwardedHost = trustProxy ? request.headers.get("x-forwarded-host") : null;
    const forwardedProto = trustProxy ? request.headers.get("x-forwarded-proto") : null;
    const host = forwardedHost !== null ? lastForwardedValue(forwardedHost) : request.headers.get("host") ?? url.host;
    const proto = protocol(forwardedProto !== null ? lastForwardedValue(forwardedProto) : url.protocol.slice(0, -1));
    // Invalid trusted metadata fails closed; do not fall back to an alternate
    // origin (including the internal URL) after selecting the public authority.
    return proto !== null && originFromHost(proto, host) === origin;
  } catch { return false; }
}
