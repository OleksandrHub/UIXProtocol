// Must stay in sync with API_PREFIX in scripts/shared/constants/api.ts.
// Two copies because frontend JS isn't built from the same TS module graph.
export const API_PREFIX = '/_uix/api';

export async function api(p, opts = {}) {
  const res = await fetch(API_PREFIX + p, {
    ...opts,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}
