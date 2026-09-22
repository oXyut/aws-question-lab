export function isLocalRequest(
  host: string | undefined | null,
  origin?: string | null,
  fetchSite?: string | null,
): boolean {
  if (!host || fetchSite === 'cross-site') return false;
  try {
    const target = new URL(`http://${host}`);
    const allowed = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (
      !allowed.has(target.hostname) ||
      target.username ||
      target.password ||
      target.pathname !== '/'
    )
      return false;
    if (!origin) return true;
    const source = new URL(origin);
    return (
      source.protocol === 'http:' &&
      allowed.has(source.hostname) &&
      source.port === target.port &&
      source.pathname === '/' &&
      !source.username &&
      !source.password
    );
  } catch {
    return false;
  }
}
