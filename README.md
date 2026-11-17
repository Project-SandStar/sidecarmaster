# Sidecar Master

A web console that runs a fleet of [SideCar](https://github.com/Project-SandStar/SideCar)
GPU agents from one place. Sidecars connect to it; it shows their GPUs and
containers, assigns roles (embedding, reranker, OCR, LLM), and ships sidecar
updates.

```
  ┌────────────────┐   WebSocket :3002 + HTTP :3010   ┌──────────────┐
  │ Sidecar Master │ ◀──────────────────────────────▶ │ sidecar (GPU)│ × N
  │  web console   │                                  └──────────────┘
  └────────────────┘
```

## Features

- **Fleet view:** every sidecar, its GPUs, VRAM, containers and last heartbeat.
- **Roles:** pick which model roles run on which host; a reconcile loop keeps them in line.
- **Releases:** upload sidecar builds, or import them from GitHub releases
  (every 15 min) or GitLab. Sidecars update themselves through
  `/api/admin/gpu/sidecars/version` and `/download`. Per-host rollout.
- **NetBird + HTTPS:** optional companion containers join a NetBird network and
  serve the console over HTTPS (Let's Encrypt through Cloudflare DNS).
- **Alerts:** e-mail when a host or role goes down.

## Run with Docker

```bash
cp deploy/sidecarmaster.env.example deploy/sidecarmaster.env   # set the three values
docker compose -p sidecarmaster -f deploy/docker-compose.yml up -d --build
```

Open `http://<host>:3010` and sign in with the admin from the env file.
Point each sidecar at `http://<host>:3010` (WebSocket port 3012 on the host).

## Settings (env)

| Variable | Use |
|---|---|
| `SM_ADMIN_USERNAME`, `SM_ADMIN_PASSWORD` | First admin, made at first start |
| `SM_SECRET_KEY` | Encrypts stored secrets (tokens, keys) |
| `SM_PUBLIC_URL` | The URL sidecars and links use |
| `SM_SIDECAR_TOKEN` | Optional shared token sidecars must send |
| `SM_PUBLIC_ENDPOINTS` | JSON list: which URL and port to give sidecars per network (CIDR) |
| `SM_RELAY_PORT`, `SM_RELAY_LAN_PORT`, `SM_HOST_PORT` | Ports |

## Develop

```bash
npm install
npx prisma migrate deploy
npm run dev          # http://localhost:3000
npx vitest run       # tests
```

## License

[Project Sandstar Source-Available License (PSSL v1.1)](LICENSE).
