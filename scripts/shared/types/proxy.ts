export interface ProxyOpts {
  sendCookies?: boolean;
  stripSetCookie?: boolean;
  setPreviewCookie?: number;
  devTools?: boolean;
}

export interface RelayStatus {
  url: URL;
  raw: string;
  healthy: boolean;
  lastCheckedAt: number;
  lastError: string | null;
}

export interface PublicRelayStatus {
  url: string;
  healthy: boolean;
  lastCheckedAt: number;
  lastError: string | null;
}
