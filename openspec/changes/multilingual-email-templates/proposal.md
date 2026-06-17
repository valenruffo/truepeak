# Proposal: Multilingual Email Templates

## Intent
Support per-label languages ('es', 'en') for CRM email templates (approval, rejection, follow-up). Currently, templates are hardcoded in Spanish, causing non-Spanish speaking users to send/receive emails in Spanish. 

## Scope

### In Scope
- Add `lang` column to `EmailTemplate` DB model (defaults to 'es').
- Create DB migration for `EmailTemplate` update.
- Update `get_fixed_template` and `/api/email/templates` to support `lang` query parameters.
- Update `register_profile` to seed default templates in the label's chosen language.
- Update frontend (`emails/templates/page.tsx`) to pass the label's language when fetching defaults.
- Ensure the template placeholder parser handles variables like `{producer}` correctly across languages.

### Out of Scope
- Supporting languages other than English ('en') and Spanish ('es') at this time.
- Translating existing custom template content for existing users.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `email-templates`: Updated to handle dynamic language switching ('en' and 'es') for default template generation and restoration.

## Approach
Add the `lang` column to `EmailTemplate`. Update backend default template providers to hold a dictionary of defaults per language. Update the `/api/email/templates` endpoints to accept `lang` and return the appropriate text. Pass the current label's language from the frontend `LabelStore` or `useLanguage` hook. On label registration, use `Label.lang` to seed the initial templates.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| DB schema (`EmailTemplate`) | Modified | Add `lang` column. |
| `backend/app/api/email.py` | Modified | Accept and process `lang` parameter for templates. |
| `backend/app/api/migrate_templates.py` | Modified | Support multiple languages for default texts. |
| `backend/app/api/labels.py` | Modified | Seed templates using `label.lang` on registration. |
| `frontend/app/(dashboard)/emails/templates/page.tsx` | Modified | Pass `lang` parameter when fetching defaults. |
| `frontend/app/(dashboard)/emails/page.tsx` | Modified | Send emails using the DB template text (no UI logic changes needed, backend will handle). |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DB Migration failure | Low | Ensure default `'es'` is applied to all existing records during migration. |
| Variable placeholders (`{producer}`) mismatch | Low | Use standard brace-parsing and keep variable names English/universal in all translated templates. |

## Rollback Plan
1. Revert frontend changes to drop `lang` parameter.
2. Revert backend API to ignore `lang` and return Spanish defaults.
3. Rollback DB migration to remove `lang` column from `EmailTemplate`.

## Dependencies
- Relies on existing `lang` field in the `Label` model.

## Success Criteria
- [ ] Existing templates retain current text and are tagged as `lang = 'es'`.
- [ ] New English signups receive English default email templates.
- [ ] Restoring templates in an English dashboard resets text to the English version.
- [ ] Placeholders like `{producer}` correctly interpolate in all languages.
