# Curator Verify Recovery Export

A complete, read-only backup of `CURATOR_VERIFY_RECORDS` is available at `GET /api/recovery-export`.

Configure the Worker secret `RECOVERY_EXPORT_TOKEN` and send it as `X-Curator-Recovery-Key`. If the secret is absent, the endpoint remains disabled.

The exporter paginates the full namespace, preserves exact key/value pairs, and includes SHA-256 integrity metadata.

On iPad/iPhone, use Shortcuts with:

- URL: `https://verify.oceanlinercurator.com/api/recovery-export`
- Method: GET
- Header: `X-Curator-Recovery-Key` = the configured recovery token
- Save File

Validate with:

```bash
node scripts/validate-recovery-backup.mjs /path/to/backup.json
```

There is intentionally no production restore endpoint.
