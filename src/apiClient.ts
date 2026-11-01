export type ApiFailure = 'network' | 'session' | 'endpoint' | 'server' | 'request';
export class ApiRequestError extends Error {
  constructor(message: string, public kind: ApiFailure, public status = 0) { super(message); }
}

export async function requestJson<T = any>(url: string, options: RequestInit = {}, request: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await request(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiRequestError('The app cannot reach its server. Keep the LaunchPadre terminal running, then retry.', 'network');
  }
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('launchpadre:session-expired'));
    throw new ApiRequestError('Your session expired or the server restarted. Sign in again.', 'session', 401);
  }
  if (response.status === 404) {
    throw new ApiRequestError('This API endpoint is unavailable. Stop the old server with Ctrl+C, run git pull --ff-only and npm run local, then reload.', 'endpoint', 404);
  }
  let result: any;
  try { result = await response.json(); } catch {
    throw new ApiRequestError('The server returned an unsupported response. Restart LaunchPadre and reload the page.', 'server', response.status);
  }
  if (!response.ok) {
    throw new ApiRequestError(typeof result?.error === 'string' ? result.error : 'The request failed. Retry or run npm run doctor.', response.status >= 500 ? 'server' : 'request', response.status);
  }
  return result as T;
}
