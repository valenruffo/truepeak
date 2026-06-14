# Spec: waitlist-capture

**Change**: beta-prod-mode
**Type**: New Capability
**Domain**: waitlist-capture

## Requirements

### REQ-WL-1: Email Submission Endpoint

The system MUST expose `POST /api/waitlist` accepting JSON `{ "email": string, "company": string }` where `company` is a honeypot field.

#### Scenario: Valid email submission
- **Given** the system is running
- **When** a POST request is sent to `/api/waitlist` with `{ "email": "user@example.com", "company": "" }`
- **Then** the response status MUST be 200
- **And** the response body MUST contain `{ "status": "ok" }`
- **And** the email MUST be persisted in the `waitlist_entry` table

#### Scenario: Invalid email format
- **Given** the system is running
- **When** a POST request is sent to `/api/waitlist` with `{ "email": "not-an-email", "company": "" }`
- **Then** the response status MUST be 422
- **And** the response body MUST contain a validation error message

### REQ-WL-2: Honeypot Spam Protection

The system MUST reject submissions where the `company` field is non-empty. Rejection MUST return 200 with `{ "status": "ok" }` to avoid signaling bots.

#### Scenario: Bot fills honeypot
- **Given** a POST to `/api/waitlist` with `{ "email": "bot@spam.com", "company": "BuySEO" }`
- **When** the server processes the request
- **Then** the response status MUST be 200 with `{ "status": "ok" }`
- **And** the email MUST NOT be persisted

### REQ-WL-3: Duplicate Email Handling

The system MUST handle duplicate emails gracefully via upsert. No error SHALL be returned to the user.

#### Scenario: Duplicate email submitted
- **Given** `user@example.com` already exists in the waitlist
- **When** a POST is sent with `{ "email": "user@example.com", "company": "" }`
- **Then** the response status MUST be 200 with `{ "status": "ok" }`
- **And** no duplicate row SHALL be created

### REQ-WL-4: Rate Limiting

The endpoint MUST enforce a rate limit of 5 requests per minute per IP address.

#### Scenario: Rate limit exceeded
- **Given** a client has sent 5 POST requests to `/api/waitlist` within 60 seconds
- **When** the client sends a 6th request
- **Then** the response status MUST be 429
