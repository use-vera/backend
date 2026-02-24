# Vera Backend

Express + MongoDB backend for auth, user profile, workspace management, admin promotion, and join-request approval flows.

## Quick Start

1. Copy env file

```bash
cp .env.example .env
```

2. Install dependencies

```bash
npm install
```

3. Start development server

```bash
npm run dev
```

4. Seed demo events (optional)

```bash
npm run seed:events
```

Base URL: `http://localhost:5050`

Default bind host is `0.0.0.0` so mobile devices on the same network can access it.

## Environment

- `MONGO_URI`: MongoDB connection string
- `MONGO_URI_FALLBACK`: optional fallback connection string (useful in development)
- `MONGO_AUTO_INDEX`: `true|false` for Mongoose auto index creation
- `MONGO_FORCE_IPV4`: force IPv4 DNS resolution (`true|false`)
- `MONGO_SERVER_SELECTION_TIMEOUT_MS`: server selection timeout
- `MONGO_CONNECT_TIMEOUT_MS`: initial connect timeout
- `MONGO_SOCKET_TIMEOUT_MS`: socket timeout
- `JWT_SECRET`: signing key (required in production)
- `CORS_ORIGINS`: comma-separated allowed origins, or `*`
- `CORS_ALLOW_CREDENTIALS`: `true` or `false`
- `PRESENCE_MONITOR_ENABLED`: toggle monitor scheduler
- `PRESENCE_MONITOR_TICK_MS`: monitor tick interval in milliseconds
- `PAYSTACK_SECRET_KEY`: Paystack secret key for paid ticket transactions
- `PAYSTACK_BASE_URL`: Paystack API base URL (default `https://api.paystack.co`)
- `PAYSTACK_CALLBACK_URL`: optional default callback URL for checkout redirects
- `PAYSTACK_DEV_BYPASS`: if `true` in development, paid tickets are auto-marked paid when Paystack key is not set

If Atlas access is blocked, verify:
1. Current device IP is in Atlas Network Access list.
2. DB user credentials in `MONGO_URI` are correct.
3. Atlas cluster is healthy and reachable from your network.

## API Overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users/me`
- `PATCH /api/users/me`
- `PATCH /api/users/me/password`
- `POST /api/workspaces`
- `GET /api/workspaces`
- `GET /api/workspaces/:workspaceId`
- `PATCH /api/workspaces/:workspaceId`
- `GET /api/workspaces/:workspaceId/members`
- `PATCH /api/workspaces/:workspaceId/members/:memberId/role`
- `POST /api/workspaces/:workspaceId/admins/:memberId`
- `POST /api/workspaces/:workspaceId/invites`
- `GET /api/workspaces/:workspaceId/invites`
- `POST /api/workspaces/:workspaceId/join-requests`
- `GET /api/workspaces/:workspaceId/join-requests`
- `POST /api/workspaces/:workspaceId/join-requests/:requestId/approve`
- `POST /api/workspaces/:workspaceId/join-requests/:requestId/reject`
- `GET /api/invites/me`
- `POST /api/invites/:inviteId/accept`
- `POST /api/invites/:inviteId/decline`
- `POST /api/workspaces/:workspaceId/attendance/check-in`
- `POST /api/workspaces/:workspaceId/attendance/check-out`
- `GET /api/workspaces/:workspaceId/attendance/logs`
- `GET /api/workspaces/:workspaceId/attendance/logs/:logId`
- `GET /api/events`
- `GET /api/events/mine`
- `POST /api/events`
- `GET /api/events/:eventId`
- `PATCH /api/events/:eventId`
- `POST /api/events/:eventId/tickets/initialize`
- `POST /api/events/tickets/check-in`
- `GET /api/events/:eventId/tickets`
- `GET /api/events/tickets/me`
- `GET /api/events/tickets/:ticketId`
- `POST /api/events/tickets/:ticketId/verify`
- `GET /api/health`
