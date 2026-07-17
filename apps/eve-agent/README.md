# NodeVideo Eve agent

This package is NodeVideo's conversational control plane. It delegates to the
existing capability packs, Convex ledger, and fixed media workers; it does not
run FFmpeg, accept model-authored commands, or expose the held-out target to a
generation agent.

## Local verification

Use Node 24:

```sh
npm ci
npm run check
```

`eve dev` permits localhost through Eve's `localDev()` authenticator. Production
browser traffic remains fail-closed until a real authenticator replaces
`placeholderAuth()`.

## Deployment

Create a separate Vercel project with this directory as its root. Never link
the repository root to this service; the root is the existing Vite application.
Add the deployed agent's exact origin to the Vite application's CSP and CORS
configuration only after production browser authentication is configured.
