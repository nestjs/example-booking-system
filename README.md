# Booking system with NestJS

This is the finished application of the tutorial [Build a booking system in Node.js without double bookings](https://docs.nestjs.com/tutorials/booking-system) in the NestJS documentation. The tutorial builds it step by step and explains each decision.

## What it does

A booking API for resources such as meeting rooms, on PostgreSQL through Drizzle:

- Staff create and edit resources, each with opening hours in its own IANA time zone and a slot length. Anyone can list the resources and the free slots of a day.
- Signed-in users book a resource, list their upcoming bookings, and cancel a booking up to 24 hours before it starts.
- Times are ISO 8601 strings with an offset, stored as `timestamptz` and returned in UTC. A time without an offset is a 400.
- No two confirmed bookings of one resource overlap: a PostgreSQL exclusion constraint (`bookings_no_overlap`, in a custom migration) refuses the second one, and the API answers 409. Back-to-back bookings are allowed.

Sign-in (access and refresh tokens from `@nestjs/authentication`), rate limiting, OpenAPI, health checks and JSON logging come from the tutorial [Build a REST API with JWT authentication](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication).

## Run it

You need Node.js 22.12 or later, and Docker for PostgreSQL.

```bash
git clone https://github.com/nestjs/example-booking-system.git
cd example-booking-system
npm install
cp .env.example .env              # then set JWT_SECRET: openssl rand -base64 32
docker compose up -d
npm run db:migrate
npm run start:dev
```

The API listens on http://localhost:3000, with Swagger UI at http://localhost:3000/docs.

Sign-up creates customers. To let a user manage resources, promote them to staff in the database:

```bash
docker compose exec postgres psql -U postgres -d booking -c "UPDATE users SET role = 'staff' WHERE email = 'sam@example.com'"
```

The role is read on every request, so the user's existing tokens pick it up. The tutorial's [Try it](https://docs.nestjs.com/tutorials/booking-system#try-it) section walks through a session with `curl`.

## Endpoints

| Endpoint | Who | Section |
| --- | --- | --- |
| `POST /auth/sign-up`, `POST /auth/token`, `POST /auth/token/refresh`, `POST /auth/token/revoke` | anyone | [Start from the JWT API](https://docs.nestjs.com/tutorials/booking-system#start-from-the-jwt-api) |
| `GET /me` | signed in | [Start from the JWT API](https://docs.nestjs.com/tutorials/booking-system#start-from-the-jwt-api) |
| `GET /health/live`, `GET /health/ready` | anyone | [Start from the JWT API](https://docs.nestjs.com/tutorials/booking-system#start-from-the-jwt-api) |
| `GET /resources`, `GET /resources/:id` | anyone | [Let staff manage resources](https://docs.nestjs.com/tutorials/booking-system#let-staff-manage-resources) |
| `POST /resources`, `PATCH /resources/:id` | staff | [Let staff manage resources](https://docs.nestjs.com/tutorials/booking-system#let-staff-manage-resources) |
| `POST /bookings`, `GET /bookings`, `GET /bookings/:id` | signed in, own bookings only | [Book without double bookings](https://docs.nestjs.com/tutorials/booking-system#book-without-double-bookings) |
| `GET /resources/:id/availability?date=YYYY-MM-DD` | anyone | [List the free slots of a day](https://docs.nestjs.com/tutorials/booking-system#list-the-free-slots-of-a-day) |
| `POST /bookings/:id/cancel` | signed in, own bookings only | [Cancel before the cutoff](https://docs.nestjs.com/tutorials/booking-system#cancel-before-the-cutoff) |
| `GET /docs` | anyone | Swagger UI |

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | bootstrap on the Node adapter, NestJS Observe instrumentation, JSON logging, security headers, CORS, Swagger UI |
| `src/app.module.ts` | NestJS Observe, config, database, authentication, authorization, throttler, validation pipe |
| `src/config.ts` | the environment schema |
| `src/database/schema.ts` | Drizzle tables: users, resources, bookings, refresh_tokens |
| `src/database/errors.ts` | recognizes the exclusion constraint's violation (SQLSTATE `23P01`) |
| `src/auth/`, `src/users/`, `src/health/` | sign-in, the current user and health checks, from the JWT tutorial |
| `src/resources/` | resources, their policy (staff only), and the free slots of a day |
| `src/bookings/` | booking and cancelling |
| `drizzle/` | migrations: the generated `booking` one, and the custom `no_double_bookings` one with the exclusion constraint |
| `test/` | e2e tests against PostgreSQL: ten users racing for one slot, back-to-back and overlapping bookings, cancellation; the refresh-token store's contract |

## Tests

The tests run against a real PostgreSQL server, so that concurrent bookings really race. `docker compose` creates the `booking_test` database; the tests apply the migrations and truncate its tables, so never point them at your development database.

```bash
TEST_DATABASE_URL=postgres://postgres:booking@localhost:5432/booking_test npm run test:e2e
```

Without `TEST_DATABASE_URL`, the tests are skipped. See [Test it](https://docs.nestjs.com/tutorials/booking-system#test-it).

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, [Zod](https://zod.dev) validation, [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication), [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization), [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL 17, [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting), [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction), [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus), [NestJS Observe](https://docs.nestjs.com/observability/overview), and Vitest.

## Production

Read the tutorial's [production checklist](https://docs.nestjs.com/tutorials/booking-system#production-checklist) first. Among other things, the custom migration creates the `btree_gist` extension: if the role that runs migrations may not create extensions, have an administrator create it once.

The app is wired for [NestJS Observe](https://docs.nestjs.com/observability/overview) (`ObserveModule` in `src/app.module.ts`), and sends nothing until it has a key pair. `npx @nestjs/observe link` writes the key pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) into `.env`. In production, set them in the platform's environment: `start:prod` doesn't load `.env`.

## License

MIT
