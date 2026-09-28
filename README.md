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

Set a Worker secret named `VERIFY_WRITE_KEY` before using the verification write API or reading retained verification history. Both fail closed when the secret is absent. Do not commit that value to GitHub.

## Endpoints

### `GET /`
Minimal human-readable service page.

### `GET /api/status`
Returns service health and configuration state.

### `GET /api/recent?limit=20`
Returns recent verification records from KV.

Requires header:

`x-curator-verify-key: <VERIFY_WRITE_KEY>`

Retained verification history is operator evidence and is not a public status surface.

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

## Disaster recovery

The complete `CURATOR_VERIFY_RECORDS` namespace can be exported through authenticated `GET /api/recovery-export`. Configure the Worker secret `RECOVERY_EXPORT_TOKEN`; the route remains disabled if the secret is absent. See [`RECOVERY_EXPORT.md`](RECOVERY_EXPORT.md).
