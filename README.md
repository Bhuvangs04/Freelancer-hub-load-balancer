## LOAD BALANCER

### Overview

This project implements an Express-based load balancer with least-connections routing, sticky sessions, health checks, and baseline edge hardening.

### Current behavior

- Least-connections routing over active backends.
- Sticky session affinity via signed `LB_Affinity` cookie (opaque backend ID, no backend URL leakage).
- Health checks against `/health` with timeout control.
- Rate limiting with temporary IP blocking and periodic in-memory cleanup.
- Upstream auth header support via `UPSTREAM_SHARED_SECRET`.

### Environment variables

```env
LOAD_BALANCER_PORT=4000
ALLOWED_ORIGINS=https://freelancerhub-five.vercel.app,https://freelancer-admin.vercel.app
BACKEND_URLS=https://backend-1.internal,https://backend-2.internal
STICKY_SECRET=replace_me
UPSTREAM_SHARED_SECRET=optional_shared_secret
RATE_LIMIT=150
RATE_WINDOW_MS=60000
BLOCK_TTL_MS=600000
HEALTH_CHECK_INTERVAL_MS=10000
HEALTH_CHECK_TIMEOUT_MS=2500
PROXY_TIMEOUT_MS=10000
CLIENT_TIMEOUT_MS=12000
MAX_UPSTREAM_SOCKETS=500
MAX_FREE_SOCKETS=100
```

### Notes for production

- Prefer private backend networking and firewall allowlisting to prevent direct origin access.
- Use distributed rate limiting (Redis/edge) when running multiple instances.
- Add centralized observability (metrics, tracing, structured logs).
