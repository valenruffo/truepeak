# Spec: app-mode-config

**Change**: beta-prod-mode
**Type**: New Capability
**Domain**: app-mode-config

## Requirements

### REQ-AM-1: Read Current Mode

The system MUST expose `GET /api/config/app-mode` returning `{ "mode": "beta" | "prod" }`.

#### Scenario: Mode from database
- **Given** the `app_config` table has a row with `key="app_mode"` and `value="prod"`
- **When** a GET request is sent to `/api/config/app-mode`
- **Then** the response MUST be `{ "mode": "prod" }`

#### Scenario: Fallback to env var
- **Given** no `app_mode` row exists in `app_config`
- **And** the env var `NEXT_PUBLIC_APP_MODE` is set to `beta`
- **When** a GET request is sent to `/api/config/app-mode`
- **Then** the response MUST be `{ "mode": "beta" }`

#### Scenario: Default when nothing configured
- **Given** no DB row and no env var exist
- **When** a GET request is sent to `/api/config/app-mode`
- **Then** the response MUST be `{ "mode": "beta" }`

### REQ-AM-2: Set Mode (Admin-Protected)

The system MUST expose `PUT /api/config/app-mode` accepting `{ "mode": "beta" | "prod" }`. This endpoint MUST require admin authentication.

#### Scenario: Admin sets mode
- **Given** the request includes a valid admin password header
- **When** a PUT is sent with `{ "mode": "prod" }`
- **Then** the `app_config` table MUST be updated with `key="app_mode"`, `value="prod"`
- **And** the response status MUST be 200

#### Scenario: Unauthorized mode change
- **Given** the request has no admin password or an invalid one
- **When** a PUT is sent to `/api/config/app-mode`
- **Then** the response status MUST be 401

### REQ-AM-3: DB Overrides Env Var

When both a DB value and env var exist, the DB value MUST take precedence.

#### Scenario: DB overrides env
- **Given** DB has `app_mode = "prod"` and env var `NEXT_PUBLIC_APP_MODE = "beta"`
- **When** a GET is sent to `/api/config/app-mode`
- **Then** the response MUST be `{ "mode": "prod" }`
