// The authorize endpoint. GET renders a one-field sign-in page; POST checks the secret and
// redirects back to Claude with an auth code. There is one user, so the "account" is MCP_SECRET.
import { CODE_TTL, isAllowedRedirect, isConfigured, newJti, safeEqual, sign, verify } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

type ClientBlob = { cid: string; uris: string[]; name: string | null };

function errorPage(message: string, status = 400) {
  return new Response(page(`<h1>Can’t continue</h1><p class="err">${escape(message)}</p>`), {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function page(inner: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to SunThru</title>
<style>
:root{--bg:#eef2f5;--surface:#fff;--ink:#14212b;--muted:#5b6b78;--line:#d7dfe6;--accent:#12557f;--danger:#a1382f}
@media(prefers-color-scheme:dark){:root{--bg:#0f1720;--surface:#172230;--ink:#e9eff4;--muted:#9bb0c2;--line:#2a3a4a;--accent:#7cbde8}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font-family:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;padding:1.5rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:1.75rem;max-width:26rem;width:100%}
h1{font-family:Georgia,serif;font-weight:500;font-size:1.5rem;margin:0 0 .35rem}
p{margin:0 0 1rem;color:var(--muted);font-size:.925rem;line-height:1.5}
label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.3rem}
input{width:100%;font:inherit;padding:.6rem .7rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:inherit}
button{width:100%;margin-top:.9rem;font:inherit;padding:.6rem;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;cursor:pointer}
button:hover{filter:brightness(1.08)}
.err{color:var(--danger)}
.small{font-size:.8rem;margin-top:1rem;margin-bottom:0}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

/** Shared validation for both GET and POST. */
function parse(params: URLSearchParams): { error: string } | { client_id: string; redirect_uri: string; state: string; code_challenge: string; resource: string; cid: string } {
  const client_id = params.get('client_id') ?? '';
  const redirect_uri = params.get('redirect_uri') ?? '';
  const state = params.get('state') ?? '';
  const code_challenge = params.get('code_challenge') ?? '';
  const method = params.get('code_challenge_method') ?? 'S256';
  const resource = params.get('resource') ?? '';

  const client = verify<ClientBlob>('client', client_id);
  if (!client) return { error: 'Unknown or expired client. Remove the connector in Claude and add it again.' };
  if (!redirect_uri) return { error: 'Missing redirect_uri.' };
  // Must be allowlisted AND one this client registered.
  if (!isAllowedRedirect(redirect_uri)) return { error: `Redirect URI not allowed: ${redirect_uri}` };
  if (!client.uris.includes(redirect_uri)) return { error: 'redirect_uri was not registered by this client.' };
  if (!code_challenge) return { error: 'PKCE is required (code_challenge missing).' };
  if (method !== 'S256') return { error: 'Only S256 PKCE is supported.' };
  return { client_id, redirect_uri, state, code_challenge, resource, cid: client.cid };
}

export async function GET(req: Request) {
  if (!isConfigured()) return errorPage('MCP_SECRET is not set on the server. Add it in Vercel and redeploy.', 500);
  const params = new URL(req.url).searchParams;
  const parsed = parse(params);
  if ('error' in parsed) return errorPage(parsed.error);

  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource']
    .map((k) => `<input type="hidden" name="${k}" value="${escape(params.get(k) ?? '')}">`).join('');

  return new Response(page(`
    <h1>Connect Claude to SunThru</h1>
    <p>Enter the connector secret to let Claude read your briefings and manage priorities and tasks.</p>
    <form method="POST">
      ${hidden}
      <label for="secret">Connector secret</label>
      <input id="secret" name="secret" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">Connect</button>
    </form>
    <p class="small">This is the MCP_SECRET from your Vercel environment variables.</p>`),
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!isConfigured()) return errorPage('MCP_SECRET is not set on the server.', 500);
  const form = await req.formData();
  const params = new URLSearchParams();
  form.forEach((v, k) => { if (k !== 'secret') params.set(k, v.toString()); });

  const parsed = parse(params);
  if ('error' in parsed) return errorPage(parsed.error);

  const supplied = String(form.get('secret') ?? '');
  if (!safeEqual(supplied, process.env.MCP_SECRET!)) {
    const hidden = [...params.entries()].map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`).join('');
    return new Response(page(`
      <h1>Connect Claude to SunThru</h1>
      <p class="err">That secret doesn’t match. Try again.</p>
      <form method="POST">
        ${hidden}
        <label for="secret">Connector secret</label>
        <input id="secret" name="secret" type="password" autocomplete="current-password" autofocus required>
        <button type="submit">Connect</button>
      </form>`),
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  const code = sign('code', {
    jti: newJti(), cid: parsed.cid, redirect_uri: parsed.redirect_uri,
    cc: parsed.code_challenge, resource: parsed.resource,
  }, CODE_TTL);

  const back = new URL(parsed.redirect_uri);
  back.searchParams.set('code', code);
  if (parsed.state) back.searchParams.set('state', parsed.state);
  return Response.redirect(back.toString(), 302);
}
