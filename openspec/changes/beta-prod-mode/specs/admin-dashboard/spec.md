# Spec: admin-dashboard

**Change**: beta-prod-mode
**Type**: New Capability
**Domain**: admin-dashboard

## Requirements

### REQ-AD-1: Admin Authentication

All admin endpoints MUST require a password matching the `ADMIN_PASSWORD` env var, sent via `X-Admin-Password` header.

#### Scenario: Valid admin login
- **Given** `ADMIN_PASSWORD` is set to `s3cret`
- **When** a request includes header `X-Admin-Password: s3cret`
- **Then** the request MUST be authorized

#### Scenario: Missing or wrong password
- **Given** `ADMIN_PASSWORD` is set to `s3cret`
- **When** a request includes header `X-Admin-Password: wrong`
- **Then** the response status MUST be 401 with `{ "detail": "Unauthorized" }`

### REQ-AD-2: Waitlist List Endpoint

`GET /api/admin/waitlist` MUST return a paginated list of waitlist entries ordered by `created_at` DESC.

#### Scenario: Fetch first page
- **Given** 25 waitlist entries exist and admin is authenticated
- **When** a GET is sent to `/api/admin/waitlist?page=1&per_page=20`
- **Then** the response MUST contain 20 entries, most recent first
- **And** the response MUST include `total` count of 25

#### Scenario: Empty waitlist
- **Given** no waitlist entries exist and admin is authenticated
- **When** a GET is sent to `/api/admin/waitlist`
- **Then** the response MUST contain an empty `entries` array and `total: 0`

### REQ-AD-3: CSV Export

`GET /api/admin/waitlist/export` MUST return a CSV file with columns `email,created_at`.

#### Scenario: Export waitlist
- **Given** 3 waitlist entries exist and admin is authenticated
- **When** a GET is sent to `/api/admin/waitlist/export`
- **Then** the response `Content-Type` MUST be `text/csv`
- **And** the body MUST contain a header row `email,created_at` followed by 3 data rows

### REQ-AD-4: Dashboard UI

The admin page MUST display: total waitlist count, email list table, CSV export button, and mode toggle.

#### Scenario: Dashboard loads
- **Given** an admin enters the correct password on the admin page
- **When** the dashboard renders
- **Then** it MUST show the current mode, total email count, and a table of emails
