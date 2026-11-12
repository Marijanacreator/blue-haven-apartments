# Blue Haven inquiry integration

The existing design is preserved. The form now POSTs JSON to `/api/inquiries`;
localStorage inquiries are no longer created or treated as successful submissions.
No reservations, payments or emails are created by this code.

## Run locally

Requires Node.js 24. From this directory run `npm start`, then open
http://127.0.0.1:8080. No dependencies need installing.
The server serves only approved public files, never environment files.
Without webhook configuration, submitting displays an honest not-connected error
and preserves the entered values. Use fictional guest details for training.

## Configure later, when connecting n8n

1. Copy `.env.example` to `.env.local` locally, or set these variables in Vercel
   project settings. Never commit `.env.local` or paste secrets into browser code.
2. Set `SITE_ORIGIN` to the exact website origin (scheme + hostname + optional port,
   without a path). Use HTTPS for deployment.
3. Set `N8N_WEBHOOK_URL` to the HTTPS webhook endpoint.
4. Set `N8N_WEBHOOK_SECRET` to a strong shared secret. Configure n8n Header Auth
   with header name `X-Webhook-Secret` and the identical secret value.
5. Restart the local server or redeploy after changing environment variables.

The browser sends request_id (UUID v4), guest_name, email, room_id, check_in,
check_out, adults, and message. The server validates these and adds source=website
and status=New. The server also sends `Idempotency-Key: <request_id>` to n8n.
Capacities are A101=2, A102=3, B201=4; B202 is unavailable.
Dates must be real YYYY-MM-DD dates, with check-out after check-in.
Past dates are not currently prohibited (useful for training scenarios).

## Required n8n acknowledgement contract

Only after validating authentication and safely accepting/persisting the inquiry,
respond with HTTP 200 or 202, application/json:

```json
{"accepted": true, "request_id": "<the incoming request_id>"}
```

A default 'Workflow was started' response is deliberately not treated as success.
Acceptance is not confirmation of availability or a reservation. Do not add email,
payment or reservation-confirmation nodes as part of this connection step.

## Retries and limitations

The browser disables submission while pending, retains input on failure and reuses
an ID for unchanged details. Session storage holds only the ID and a payload hash,
not the guest's name/email/message. If the guest reloads, fields are not restored
by this app, but reentering identical details in the same tab reuses the ID.
Changing details starts a new inquiry. A verified success clears the form.

The server suppresses in-flight duplicates and remembers accepted IDs for 24 hours
within one running process. These limits and the 10-attempts/minute/IP rate limit
are best-effort: serverless restarts and multiple instances do not share memory.
Before public use, configure a shared rate limiter / hosting firewall and implement
persistent atomic request-ID deduplication in n8n's backing store. A UUID alone
does not guarantee exactly-once delivery. If n8n persists an inquiry but the response
is lost, a retry must return the existing inquiry's acknowledgement, without a new
record. Reuse of an ID with different details must be rejected there as well.
Forwarding timeout: 10 seconds; browser timeout: 15 seconds; maximum JSON: 8 KiB.
No secret values or guest payloads are logged by this code.

## Vercel preparation

Set this folder (`blue-haven-site`) as the Vercel project root; choose Other as the
framework preset. `vercel.json` builds only public assets into `public/`, while
`api/inquiries.js` runs as a Node.js function. GitHub Pages/static Python hosting
cannot execute this API. This work has not deployed or connected to live n8n.

## Checks

Run `npm test` and `node build.js`. Tests use mock webhook responses only.
