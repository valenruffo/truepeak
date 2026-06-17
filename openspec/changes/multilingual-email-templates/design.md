# Design: Multilingual Email Templates

## Technical Approach

Introduce a `lang` column to `EmailTemplate` to explicitly track the language of each template, defaulting to `'es'` for backward compatibility. During label registration, automatically seed the default 'approval' and 'rejection' templates in the language chosen by the label owner (`label.lang`). The frontend will pass the label's `lang` when requesting default templates so the correct language variants are previewed and restorable. The backend API `/api/email/templates` will support dynamic language parameters to serve appropriate default text.

## Architecture Decisions

### Decision: Add `lang` column to `EmailTemplate`

**Choice**: Add `lang` (varchar) to the `EmailTemplate` DB schema, defaulting to `'es'`.
**Alternatives considered**: Rely entirely on `Label.lang` and translate dynamically at runtime without a DB column in templates.
**Rationale**: Users can customize templates. An explicitly stored `lang` attribute on the template ensures that custom text is tied to the language it was written in, preventing accidental overwrites or language mismatches if the label changes their default language later.

### Decision: Seed templates explicitly on label registration

**Choice**: Inside `register_label_profile`, immediately seed the initial `EmailTemplate` records using `get_fixed_template` with the new label's `lang`.
**Alternatives considered**: Lazy-load or seed templates only when the user first visits the Email Templates page.
**Rationale**: Explicit seeding on registration guarantees templates exist for immediate use in the CRM inbox, preventing edge cases where emails are sent before the templates page is visited.

## Data Flow

    [Frontend] CRM / Templates
         │
         │ (GET /api/email/templates?defaults=true&lang=en)
         ▼
    [Backend API] (email.py)
         │
         │ Fetch hardcoded English templates
         ▼
    [Frontend] Restores or displays 'en' defaults
    
    [Frontend Registration]
         │ (POST /api/labels/register with lang='en')
         ▼
    [Backend API] (labels.py)
         │ 1. Create Label (lang='en')
         │ 2. Seed EmailTemplate (lang='en', type='approval')
         │ 3. Seed EmailTemplate (lang='en', type='rejection')
         ▼
    [Database]

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/app/models.py` | Modify | Add `lang: str = Field(default="es")` to `EmailTemplate`. |
| `backend/migrations/[migration_name].sql` | Create | Add `lang` column to `email_template` table (default 'es'). |
| `backend/app/api/email.py` | Modify | Update `TemplateResponse` and `CreateTemplateRequest` to include `lang`. Update `list_templates` endpoint to accept `lang` parameter and respect it when `defaults=True`. |
| `backend/app/api/labels.py` | Modify | Update `RegisterProfileRequest` to optionally accept `lang`. Inside `register_label_profile`, seed default templates using the provided language after label creation. |
| `backend/app/api/migrate_templates.py` | Modify | Assign `lang=lang` when instantiating the missing `EmailTemplate` records during the migration script run. |
| `frontend/app/(dashboard)/emails/templates/page.tsx` | Modify | Pass `lang` parameter when fetching defaults from API based on `useLanguage` hook. Update `EmailTemplate` interface with `lang`. |
| `frontend/app/(dashboard)/emails/page.tsx` | Modify | Send emails utilizing the DB-fetched templates (already handled by backend logic). Add `lang` to `Template` interface if referenced locally. |

## Interfaces / Contracts

**API Updates**:
```python
# CreateTemplateRequest
class CreateTemplateRequest(BaseModel):
    name: str
    template_type: str
    subject_template: str
    body_template: str
    lang: str = "es"

# TemplateResponse
class TemplateResponse(BaseModel):
    # ... existing fields ...
    lang: str
```

**Frontend Interfaces**:
```typescript
interface EmailTemplate {
  // ... existing fields
  lang: string;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | API Default templates | Call `GET /api/email/templates?defaults=true&lang=en` and verify English text is returned. |
| Unit | Label Registration | Call `/api/labels/register` with `lang="en"` and verify templates are seeded in English. |
| E2E | Template Restoration | In UI, delete a template and click restore. Verify it restores in the label's chosen language. |

## Migration / Rollout

1. Run the new SQL migration to add the `lang` column to `email_template`.
2. Run `backend/app/api/migrate_templates.py` to ensure existing labels have seeded templates (defaults will be 'es' or their existing `label.lang`).
3. Deploy backend and frontend simultaneously.

## Open Questions

- [ ] Do we need to force existing users to re-select a language if they want English templates, or will they manually restore templates to fetch the new English defaults? (Assuming manual restore).
