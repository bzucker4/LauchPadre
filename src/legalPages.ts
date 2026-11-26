import fs from 'node:fs';
import path from 'node:path';

export type LegalPageId = 'terms' | 'privacy';

const FILES: Record<LegalPageId, string> = {
  terms: 'terms-of-service.md',
  privacy: 'privacy-policy.md',
};

/** Placeholder names used in docs/legal/*.md, each filled from a LEGAL_* environment variable. */
export const LEGAL_PLACEHOLDERS = [
  'COMPANY',
  'ADDRESS',
  'CONTACT_EMAIL',
  'GOVERNING_LAW',
  'EFFECTIVE_DATE',
  'HOSTING_PROVIDER',
  'LOG_RETENTION',
  'BACKUP_RETENTION',
] as const;

export function legalValuesFromEnv(publicOrigin: string): Record<string, string> {
  const values: Record<string, string> = { PRODUCT_URL: publicOrigin };
  for (const name of LEGAL_PLACEHOLDERS) {
    const value = process.env[`LEGAL_${name}`]?.trim();
    if (value) values[name] = value;
  }
  return values;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text: string) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Minimal renderer for the subset of Markdown used by the legal drafts. Input is HTML-escaped first. */
export function renderMarkdown(markdown: string): { title: string; body: string } {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let title = '';
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    if (list.length) out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    if (table.length) {
      const [head, ...rows] = table;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      );
    }
    paragraph = [];
    list = [];
    table = [];
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
    } else if (/^# /.test(line)) {
      flush();
      title = line.slice(2).trim();
      out.push(`<h1>${inline(title)}</h1>`);
    } else if (/^## /.test(line)) {
      flush();
      out.push(`<h2>${inline(line.slice(3).trim())}</h2>`);
    } else if (/^- /.test(line)) {
      if (paragraph.length || table.length) flush();
      list.push(line.slice(2));
    } else if (/^\|/.test(line)) {
      if (paragraph.length || list.length) flush();
      if (/^\|[\s|:-]+\|?$/.test(line)) continue;
      table.push(line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    } else {
      if (list.length || table.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return { title, body: out.join('\n') };
}

const PAGE_STYLE = `
:root{color-scheme:dark light;--bg:#070b19;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--accent:#fbbf24}
@media (prefers-color-scheme:light){:root{--bg:#fff;--fg:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#b45309}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 'Public Sans',system-ui,sans-serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 4rem}
nav{display:flex;gap:1rem;flex-wrap:wrap;font-size:.9rem;margin-bottom:1.5rem}
a{color:var(--accent)} h1{font-size:1.9rem;line-height:1.2} h2{font-size:1.15rem;margin-top:2rem}
code{font-size:.9em} .table-wrap{overflow-x:auto} table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{border:1px solid var(--line);padding:.5rem;text-align:left;vertical-align:top} p,li{overflow-wrap:anywhere}
`;

export function renderLegalPage(id: LegalPageId, docsDir: string, values: Record<string, string>) {
  let markdown = fs.readFileSync(path.join(docsDir, FILES[id]), 'utf8');
  markdown = markdown.replace(/\[([A-Z][A-Z_]+)\]/g, (match, name: string) => values[name] ?? match);
  const unresolved = [...new Set(markdown.match(/\[[A-Z][A-Z_]+\]/g) ?? [])];
  const { title, body } = renderMarkdown(markdown);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · LaunchPadre</title><style>${PAGE_STYLE}</style></head>
<body><main><nav><a href="/">← LaunchPadre</a><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a></nav>
${body}</main></body></html>`;
  return { html, unresolved };
}

/** Loads both pages. In production, unresolved [PLACEHOLDERS] are a startup error. */
export function loadLegalPages(docsDir: string, values: Record<string, string>, production: boolean) {
  const pages = {} as Record<LegalPageId, string>;
  const missing = new Set<string>();
  for (const id of Object.keys(FILES) as LegalPageId[]) {
    const { html, unresolved } = renderLegalPage(id, docsDir, values);
    pages[id] = html;
    unresolved.forEach((u) => missing.add(u.slice(1, -1)));
  }
  if (production && missing.size) {
    const vars = [...missing].map((n) => (n === 'PRODUCT_URL' ? 'PUBLIC_ORIGIN' : `LEGAL_${n}`));
    throw new Error(`Production requires legal page values: set ${vars.join(', ')}`);
  }
  return pages;
}
