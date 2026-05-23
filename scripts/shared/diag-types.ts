// Result of a single egress-IP probe — used by /api/_diag/server-ip and
// /api/_diag/relay-ip to surface what `api.ipify.org` sees when the request
// originates from the central server vs each laptop relay.
export interface ProbeResult {
  ip: string;
  status: number;
  body: string;
}
