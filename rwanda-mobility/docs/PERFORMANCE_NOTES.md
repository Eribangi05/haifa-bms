# Performance notes

> **Scope.** One measurement session of `backend/scripts/loadtest.ts` on a small shared development VM (4 vCPU, Node 22, PostgreSQL 16 on the same machine, single API process, in-process jobs running). It shows that nothing is pathologically slow and where the first limits are. **It is not a capacity plan**: client and server compete for the same CPUs, the database is nearly empty, there are no drivers online, and no network latency exists.

## How it was run

```
# server on its own port and a scratch database (OTP echo and relaxed limits for the test only)
DATABASE_URL=postgres://rm:rm@localhost:5432/rwanda_mobility_load NODE_ENV=development OTP_DEV_ECHO=true MOMO_MODE=simulator \
  PORT=8099 RATE_LIMIT_MAX=1000000 AUTH_RATE_MAX=1000000 ESTIMATE_RATE_MAX=1000000 QUIET=1 node --import tsx src/server.ts
# plus system_settings: otp.max_per_hour_ip / otp.max_per_hour_phone = 1000000, otp.resend_cooldown_s = 0
npx tsx scripts/loadtest.ts --base http://localhost:8099 --duration 20 --concurrency 20     # then --concurrency 100
```

Each virtual user signs in once (OTP request + verify), then loops `GET /health`, `GET /config`, `POST /fares/estimate` (KCC to Kimironko, all services); every fourth user also keeps creating new OTP sessions. The server and the scratch database were stopped and dropped afterwards.

## Results

20 concurrent users, 20 s (19,745 requests, zero errors, zero 429):

| endpoint | requests | req/s | p50 ms | **p95 ms** | p99 ms | max ms |
|---|---|---|---|---|---|---|
| GET /health | 5993 | 299 | 3.9 | **12.7** | 19.1 | 39.6 |
| GET /config | 5993 | 299 | 16.9 | **30.7** | 39.8 | 58.2 |
| POST /fares/estimate | 5993 | 299 | 33.7 | **53.3** | 66.8 | 124.2 |
| POST /auth/otp/request | 883 | 44 | 16.5 | **31.0** | 130.2 | 142.3 |
| POST /auth/otp/verify (login) | 883 | 44 | 39.4 | **65.6** | 100.9 | 122.0 |

100 concurrent users, 20 s (17,812 requests, zero errors, zero 429):

| endpoint | requests | req/s | p50 ms | **p95 ms** | p99 ms | max ms |
|---|---|---|---|---|---|---|
| GET /health | 5304 | 261 | 9.0 | **84.3** | 107.2 | 181.0 |
| GET /config | 5304 | 261 | 108.6 | **159.0** | 230.9 | 330.3 |
| POST /fares/estimate | 5304 | 261 | 199.1 | **264.4** | 349.6 | 410.2 |
| POST /auth/otp/request | 950 | 47 | 76.2 | **206.4** | 279.9 | 290.9 |
| POST /auth/otp/verify (login) | 950 | 47 | 178.2 | **266.6** | 320.4 | 355.1 |

## Observations

* Throughput saturates at roughly 800 to 900 requests/s in total on this machine (about 260 to 300 per endpoint in the mixed loop): going from 20 to 100 users did not raise throughput, it only moved the time into queueing (p95 of estimate 53 ms to 264 ms). That is a CPU limit of one Node process sharing 4 cores with the load generator and PostgreSQL, not an application error rate: there were no failures at either level.
* `GET /config` costs about 4x `/health` because it reads settings and flags from PostgreSQL on each call (no caching). It is a good candidate for a short in-memory cache (30 to 60 s) if app start-up traffic grows.
* `POST /fares/estimate` is the heaviest hot path: it checks zone coverage, prices every enabled service, and runs a nearby-driver query per service. With no drivers online it still stores no quotes; with real supply each available option also inserts a `fare_quotes` row, so expect it to be slower than measured here. The cancellation-fee lookup added to it is a single indexed query.
* Login (`otp/verify`) is the slowest authentication call (hashing plus session insert); it is rate limited per IP, which is also the real protection against OTP abuse.
* The global per-IP limit (default 300/min) and the per-route limits are intentionally lower than these rates; the load test needs the relaxed settings above. Behind a carrier NAT many users share one IP, so route limits for authenticated calls are keyed by user.
* Not covered: write-heavy flows (booking creation, dispatch, payments), websocket-less location updates from many drivers, the in-process job loop under load (dispatch sweep every 3 s, push flush every 3 s), PostgreSQL on separate hardware, TLS, and long soak runs. Run those against a staging environment that looks like production before launch.

## Suggested next steps

1. Cache `/config` and per-request `getSetting` reads for a few seconds.
2. Measure booking creation and driver location updates (`POST /drivers/me/location`) with 500 to 2,000 simulated drivers; add `EXPLAIN ANALYZE` for the nearby-driver query.
3. Run the API with several processes behind a load balancer and move the jobs to a single worker (see `src/jobs.ts`); verify connection-pool sizing (`max: 20` per process).


## Addendum: place search and the map (measured on the same kind of 4 vCPU development VM, 20 connections, 8 s per path)

| Path | Requests per second | p50 | p99 |
|---|---|---|---|
| `GET /health` | ~4,900 | 3 ms | 11 ms |
| `GET /places/popular` | ~3,800 | 4 ms | 12 ms |
| `GET /places/search` (offline index, with pickup bias) | ~630 | 30 ms | 55 ms |
| `GET /places/search` (by name, cached) | ~1,080 | 17 ms | 33 ms |

A person typing produces a few searches per second, so one API process serves hundreds of people searching at once. Reproduce with `node scripts/loadtest.mjs` (see the header of that script). Backup restore was exercised with `scripts/restore-test.sh`.
