# True Peak — Reglas de Negocio

> Última actualización: Junio 2026. Documento vivo — se actualiza con cada cambio.

---

## 1. Planes y Límites

| Plan | Tracks/mes | Emails CRM/mes | Retención HQ | Precio |
|------|-----------|---------------|-------------|--------|
| **Free** | 10 | 0 | 0 días | $0 |
| **Indie** | 100 | 100 | 7 días | — |
| **Pro** | 1000 | 500 | 14 días | — |

**Enforcement:**
- El límite de tracks se cuenta por mes calendario (día 1 al último).
- El conteo incluye TODOS los tracks procesados en el mes, incluso los eliminados (no se puede bypassear borrando).
- Si `month_count >= max_tracks_month` → HTTP 400 al intentar subir.
- El contador de emails se resetea al cambiar de mes.

**Plan Free adicional:**
- La página de CRM está bloqueada (no se pueden enviar emails).
- El Link de envío se bloquea cuando llega al límite mensual.

---

## 2. Pipeline de Submisión

### 2.1 Upload

| Regla | Valor |
|-------|-------|
| Formatos aceptados | `.wav`, `.flac`, `.aiff`, `.aif` (configurable por sello) |
| Tamaño máximo | 100MB por defecto, configurable, hard cap 200MB |
| Campos obligatorios | `producer_name`, `producer_email`, `track_name`, archivo |
| Campos opcionales | Instagram, SoundCloud, Spotify, notas |

### 2.2 Procesamiento

```
1. Recibir WAV → /tmp
2. Analizar audio (BPM, LUFS, fase, key, duración, true_peak, crest_factor)
3. Calcular estado técnico (óptimo / warning / crítico)
4. Evaluar auto-rechazo (si crítico + alertas estructurales + auto_reject_enabled)
5. Convertir a MP3 320kbps (si no fue auto-rechazado)
6. Subir original + MP3 a Cloudflare R2
7. Limpiar archivos temporales del servidor
```

### 2.3 Estados

| Estado | Qué significa |
|--------|-------------|
| `inbox` | En bandeja, esperando revisión |
| `shortlist` | Seleccionado por el sello |
| `rejected` | Rechazado manualmente (requiere motivo) |
| `auto_rejected` | Rechazado automáticamente por reglas técnicas |

---

## 3. Firma Sónica (Auto-Rechazo)

### 3.1 Parámetros por defecto

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `bpm_min` | 70 | BPM mínimo aceptable |
| `bpm_max` | 180 | BPM máximo aceptable |
| `lufs_target` | -14.0 | Loudness objetivo (LUFS) |
| `lufs_tolerance` | ±1.0 | Tolerancia LUFS |
| `phase_correlation_min` | 0.3 | Correlación de fase mínima |
| `peak_limit_max` | 0.0 dB | True Peak recomendado |
| `peak_limit_critical` | +1.5 dB | True Peak crítico |
| `crest_factor_min` | 5.0 dB | Rango dinámico mínimo |
| `crest_factor_critical` | 3.5 dB | Rango dinámico crítico |
| `target_camelot_keys` | [] (vacío) | Tonalidades preferidas (1A-12B) |
| `auto_reject_enabled` | true | Auto-rechazo activado |

### 3.2 Niveles de Severidad

| Métrica | Óptimo | Warning | Crítico |
|---------|--------|---------|---------|
| **Fase** | ≥ min (≥0.3) | ≥ critical y < min (0.0-0.3) | < critical (<0.0) |
| **True Peak** | ≤ max (≤0 dB) | > max y ≤ critical (0-1.5) | > critical (>1.5) |
| **Crest Factor** | ≥ min (≥5.0) | > critical y < min (3.5-5.0) | ≤ critical (≤3.5) |
| **BPM** | Dentro del rango | ±3 del rango | Fuera de ±3 |
| **LUFS** | target ± tolerance | target ± 1.5 | Fuera de ±1.5 |

### 3.3 Reglas de Auto-Rechazo

| Regla | Condición |
|-------|-----------|
| Fase | `rules.phase = true` Y correlación < 0.0 |
| LUFS | **Siempre activo** — LUFS > target + tolerance |
| Tempo | `rules.tempo = true` Y BPM fuera de rango |
| Clipping | `rules.reject_clipping = true` Y true_peak > critical |
| Bajo rango dinámico | `rules.reject_low_dynamic_range = true` Y crest_factor < critical |

---

## 4. Emails

### 4.1 Plantillas Fijas

Dos plantillas hardcodeadas, una de rechazo y una de aprobación. El sello puede editar subject y body antes de enviar.

**Variables disponibles:** `{{producer_name}}`, `{{track_name}}`, `{{bpm}}`, `{{lufs}}`, `{{phase_correlation}}`, `{{musical_key}}`, `{{label_name}}`

### 4.2 Envío

| Regla | Valor |
|-------|-------|
| Proveedor | Resend API |
| Remitente | `{from_name} <noreply@truepeak.space>` |
| Reply-To | `label.reply_to_email` (configurable) si no, `label.owner_email` |
| Timeout | 30 segundos |

### 4.3 Cuotas y Restricciones

- **Doble envío:** Si `human_email_sent = true` → HTTP 400.
- **Cuota mensual:** Si `emails_sent_this_month >= max_emails_month` → HTTP 429.
- **Plan Free:** `max_emails_month = 0` → no puede enviar emails desde CRM.

---

## 5. Página de Envío (Link)

### 5.1 Configuración por Sello

| Campo | Default |
|-------|---------|
| Título | "Enviar demo" |
| Descripción | Texto explicativo del pipeline |
| Formatos | wav, flac, aiff |
| Tamaño máximo | 100MB |
| Pedir Instagram | false |
| Pedir SoundCloud | false |
| Pedir Spotify | false |

### 5.2 Cuenta Congelada

Si `subscription_status = "frozen"`:
- Link muestra página de "deshabilitado".
- Upload devuelve HTTP 403.

---

## 6. CRM

### 6.1 Contactos

- Se generan automáticamente de los submissions.
- Muestra: nombre, email, track, estado (aprobado/rechazado), BPM, enlaces sociales.
- Flag `sent` impide re-envío al mismo contacto.

### 6.2 Email Composer

- Templates de simulador hardcodeados (4 variantes: rechazo-fase, rechazo-tempo, aprobación, seguimiento).
- Variables drag & drop: `{producer}`, `{track}`, `{bpm}`, `{label}`.
- Editor rich text con undo/redo.

---

## 7. Auth y Registro

| Regla | Valor |
|-------|-------|
| Proveedor | Supabase Auth |
| Roles | `label_owner`, `dj` |
| Password mínimo | 8 caracteres |
| Slug | Generado del nombre, único |
| Perfil duplicado | HTTP 409 |

### 7.1 Transferencia de Perfil Huérfano

Si un usuario se registra con Supabase pero ya existe un label con su email (de la migración anterior):
1. Se renombra temporalmente el perfil huérfano.
2. Se crea un nuevo label con el ID de Supabase.
3. Se migran todos los submissions al nuevo label.
4. Se elimina el perfil huérfano.

---

## 8. Cleanup Cron

| Regla | Timing | Acción |
|-------|--------|--------|
| Hard delete | `deleted_at > 24h` | Elimina carpeta R2 + fila DB |
| HQ cleanup | `created_at < now - retention_days` | Borra original de R2 |
| Aviso 15 días | `frozen_at + 15 días` | Email de advertencia |
| Último aviso | `frozen_at + 29 días` | Email de último aviso |
| Purga total | `frozen_at + 30 días` | Elimina TODOS los submissions + archivos |

**Restauración:** Un submission eliminado se puede restaurar dentro de las 24 horas.

---

## 9. Pagos (Polar)

| Producto Polar | Plan |
|----------------|------|
| `400b734f-...` | Indie |
| `7272cf53-...` | Pro |

**Webhooks:**
- `subscription.created/active` → Upgrade inmediato.
- `subscription.canceled/revoked` → Downgrade a Free, cuenta congelada, `frozen_at = now`, se borran los HQ.
- Downgrade de plan → diferido hasta `current_period_end`.
- Prorrateo activado en cambios de suscripción.

---

## 10. Player y Descargas

| Regla | Valor |
|-------|-------|
| Streaming | MP3 desde R2 (320kbps) |
| Descarga original | Una sola vez, luego se borra de R2 |
| Cuentas congeladas | HTTP 402 — no pueden escuchar ni descargar |
| Waveform | Almacenado en R2 como JSON, fallback genera con librosa |

---

## 11. Logo del Sello

| Regla | Valor |
|-------|-------|
| Tamaño máximo | 5MB |
| Formatos | JPG, PNG, WebP |
| Dimensiones | Redimensionado a 512x512 |
| Almacenamiento | Cloudflare R2 |

---

## 12. Feedback

- **Landing:** Botón flotante de WhatsApp (ícono verde, esquina inferior derecha).
- **Dashboard:** Botón "Feedback" en sidebar → modal con textarea → envía por WhatsApp a `+5491135167226`.
- **Email alternativo:** `ruffovalen@gmail.com`.
