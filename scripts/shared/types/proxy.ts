export interface ProxyOpts {
  sendCookies?: boolean;
  stripSetCookie?: boolean;
  setPreviewCookie?: number;
  devTools?: boolean;
}

// Internal relay-pool state. `url` is the parsed form used for outbound
// requests; `raw` is the original config string echoed back into logs so
// the operator sees the same value they configured. `healthy` flips on
// every health probe / live failure.
export interface RelayStatus {
  url: URL;
  raw: string;
  healthy: boolean;
  lastCheckedAt: number;
  lastError: string | null;
}

// Public-facing relay status returned by the /api/_diag/relays endpoint —
// scrubbed of the live URL object so it round-trips cleanly through JSON.
export interface PublicRelayStatus {
  url: string;
  healthy: boolean;
  lastCheckedAt: number;
  lastError: string | null;
}
