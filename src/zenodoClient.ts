export class ZenodoClient {
  constructor(public readonly origin: string, private token: string, private request: typeof fetch = fetch) {
    if (!['https://sandbox.zenodo.org', 'https://zenodo.org'].includes(origin)) throw new Error('Unsupported Zenodo origin');
  }
  private async call(url: string, options: RequestInit = {}) {
    const parsed = new URL(url);
    if (parsed.origin !== this.origin || !parsed.pathname.startsWith('/api/')) throw new Error('Invalid Zenodo API URL');
    const response = await this.request(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Zenodo request failed (${response.status}). Review the deposition in Zenodo before retrying.`);
    return response.json();
  }
  async create(metadata: Record<string, unknown>) {
    return this.call(`${this.origin}/api/deposit/depositions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata }) });
  }
  async get(id: string) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid Zenodo deposition id');
    return this.call(`${this.origin}/api/deposit/depositions/${id}`);
  }
  async upload(deposition: any, filename: string, archive: Buffer) {
    const bucket = deposition.links?.bucket;
    if (typeof bucket !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(filename)) throw new Error('Invalid archive upload target');
    return this.call(`${bucket}/${encodeURIComponent(filename)}`, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(archive) });
  }
  async publish(id: string) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid Zenodo deposition id');
    return this.call(`${this.origin}/api/deposit/depositions/${id}/actions/publish`, { method: 'POST' });
  }
}
