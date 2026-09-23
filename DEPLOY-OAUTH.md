# Adding the OAuth connector

## 1. Run migration 004 in Neon
`db/migrations/004_oauth_codes.sql` — one small table so authorization codes can't be replayed.

## 2. Copy these files in
All of them are new except `app/api/mcp/route.ts` (replaces the old one), `.env.example`
and `README.md`.

**DELETE the old route directory:** `app/api/mcp/[secret]/` — the secret is no longer in the URL.
If you leave it, Next.js has two routes fighting over `/api/mcp/*`.

    git rm -r "app/api/mcp/[secret]"

## 3. MCP_SECRET must be set in Vercel, then REDEPLOY
Environment variables are baked in at build time. Adding the variable changes nothing until a new
build runs. This is the single most common reason the connector keeps failing.

## 4. Verify the server before opening the Claude UI
Expect `HTTP/2 201`:

    curl -si -X POST https://dailycheckin-seven.vercel.app/api/oauth/register \
      -H 'Content-Type: application/json' \
      -d '{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}' | head -1

And expect a 401 carrying a `www-authenticate` header with `resource_metadata=`:

    curl -si -X POST https://dailycheckin-seven.vercel.app/api/mcp \
      -H 'Content-Type: application/json' -d '{}' | grep -i 'www-authenticate'

That header is the pointer Claude follows to discover everything else. No header, no handshake.

## 5. Add the connector
Claude → Settings → Connectors → Add custom connector.

    URL: https://dailycheckin-seven.vercel.app/api/mcp

Leave the OAuth Client ID/Secret fields blank. Click Connect → a SunThru sign-in page appears →
type your MCP_SECRET → it returns to Claude connected.

## If it still fails
- 500 from `/api/oauth/register` → read the JSON body, it names the reason (usually MCP_SECRET unset)
- `FUNCTION_INVOCATION_FAILED` → check Vercel Runtime Logs; every handler here returns JSON errors,
  so this would mean something outside them
- "Redirect URI not allowed" → Claude is using a callback host outside claude.ai / claude.com.
  Send me the exact URI and I'll widen the allowlist.
