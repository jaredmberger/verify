# Curator Verify

Independent verification layer for CuratorOS.

Verify is intentionally not another discovery monitor. Specialist tools observe conditions; Verify independently tests a claimed condition and returns evidence. Error Bus and Curator Intelligence can then decide whether that evidence warrants escalation.

## Architecture

**Observe → Verify → Escalate**

Verify currently accepts targets only on `oceanliners.net` and its subdomains. This keeps the Worker from becoming a general-purpose fetch proxy and gives CuratorOS a separate observation point on the `oceanlinercurator.com` zone.

## Cloudflare

Worker: `verify`

Custom domain: `verify.oceanlinercurator.com`

KV binding:

- `CURATOR_VERIFY_RECORDS`
- namespace id: `bf7fb04aa1754f729acd62595bf21004`

Set a Worker secret named `VERIFY_WRITE_KEY` before using the write API. Do not commit that value to GitHub.

## Endpoints

### `GET /`
Minimal human-readable service page.

### `GET /api/status`
Returns service health and configuration state.

### `GET /api/recent?limit=20`
Returns recent verification records from KV.

### `POST /api/verify`
Requires header:

`x-curator-verify-key: <VERIFY_WRITE_KEY>`

Example body:

```json
{
  "url": "https://oceanliners.net/",
  "claim": "reachable",
  "expectedStatus": 200,
  "contains": "Ocean Liner Curator",
  "source": "error-bus",
  "incidentId": "public-site-offline"
}
```

Supported claim types:

- `reachable`
- `unreachable`
- `status`
- `content`

Verdicts:

- `confirmed`
- `not_confirmed`
- `inconclusive`

Each verification stores the raw evidence used for the verdict, including HTTP status, final URL, response success, content match, error text, bytes sampled, and duration.

## Design rule

Verify never creates the original incident and never decides priority. It only adds an independent observation.
