# Spec: pricing-cta (Delta)

**Change**: beta-prod-mode
**Type**: Modified Capability
**Domain**: pricing-cta

## Requirements

### REQ-PC-1: Beta Mode Button Behavior

When app mode is `beta`, Indie and Pro pricing buttons MUST open the waitlist modal instead of navigating away.

#### Scenario: Click Indie in beta mode
- **Given** the app mode is `beta`
- **When** a user clicks the Indie plan pricing button
- **Then** the waitlist modal MUST open
- **And** no navigation SHALL occur

#### Scenario: Click Pro in beta mode
- **Given** the app mode is `beta`
- **When** a user clicks the Pro plan pricing button
- **Then** the waitlist modal MUST open

### REQ-PC-2: Prod Mode Button Behavior

When app mode is `prod`, Indie and Pro buttons MUST display "Get Started" and link to their respective Polar checkout URLs.

#### Scenario: Click Indie in prod mode
- **Given** the app mode is `prod`
- **When** a user clicks the Indie plan pricing button
- **Then** the browser MUST navigate to the Polar checkout URL for the Indie plan ($25/mo)

#### Scenario: Click Pro in prod mode
- **Given** the app mode is `prod`
- **When** a user clicks the Pro plan pricing button
- **Then** the browser MUST navigate to the Polar checkout URL for the Pro plan ($49/mo)

### REQ-PC-3: Free Tier Unchanged

The Free tier button MUST always link to `/register` regardless of app mode.

#### Scenario: Free tier in any mode
- **Given** the app mode is `beta` or `prod`
- **When** a user clicks the Free plan button
- **Then** the browser MUST navigate to `/register`
