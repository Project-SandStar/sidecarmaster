# sidecarmaster Docker scripts (local only, not in git)

Run from this Mac. Values are in `config.sh`: host `my-docker-host`, folder `C:\sidecar-deploy\sidecarmaster`,
compose project `sidecarmaster`, port 3010.

| Script | What it does |
|---|---|
| `./update.sh` | Pack the source, copy it, build `sidecarmaster:latest` (old one kept as `:previous`), recreate app + netbird + caddy, wait for `/api/health`. |
| `./update.sh --dry-run` | Check the host and show the plan. Changes nothing. |
| `./update.sh --no-build` | Recreate the containers from the current image. |
| `./update.sh --rollback` | Make `:previous` the `:latest` again and recreate. |
| `./status.sh` | Containers, images, health, NetBird and HTTPS state. |
| `./logs.sh app\|netbird\|caddy [lines]` | Last log lines of one container. |

Rules:
- Never `docker compose down -v`: the volumes hold the DB, NetBird keys and certificates.
- Secrets live in `C:\sidecar-deploy\sidecarmaster\sidecarmaster.env` (UTF-8, no BOM):
  `SM_ADMIN_USERNAME`, `SM_ADMIN_PASSWORD`, `SM_SECRET_KEY`. Never commit or print them.
- Paste the NetBird setup key and Cloudflare token in Settings → NetBird (`http://my-docker-host:3010/settings`).
- Sound Suite's data volume is mounted read-only. sidecarmaster never writes to it.
