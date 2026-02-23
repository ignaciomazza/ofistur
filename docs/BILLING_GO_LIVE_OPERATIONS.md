# Billing Go-Live Operations (PR #7)

## 1) Objetivo del hardening

Este PR deja cobranzas recurrentes listas para operación productiva con:

- rollout gradual por agencia,
- reglas operativas AR (días hábiles + cutoff),
- conciliación por archivo robusta (sin Galicia online),
- cola de revisión contable para pagos tardíos/duplicados,
- observabilidad operativa en panel dev/admin.

## 2) Arquitectura desacoplada

- Cobranza: suscripciones/ciclos/charges/intents/lotes/dunning/fallback/conciliación/revisión.
- Fiscal: pipeline separado (AFIP/ARCA), no bloquea cobranza.

`BILLING_FISCAL_AUTORUN=false` se mantiene como default.

## 3) Rollout por agencia

Campos de control en `AgencyBillingConfig`:

- `collections_pd_enabled`
- `collections_dunning_enabled`
- `collections_fallback_enabled`
- `collections_fallback_provider`
- `collections_fallback_auto_sync_enabled`
- `collections_suspended` (kill-switch por agencia)
- `collections_cutoff_override_hour_ar`
- `collections_notes`

Comportamiento:

- jobs automáticos filtran agencias según flags,
- agencias suspendidas no generan nuevos intents/lotes/fallback automáticos,
- operación manual/observabilidad sigue disponible (con actor/source auditado).

## 4) Business days + cutoff AR

Servicio: `src/services/collections/core/businessCalendarAr.ts`

- `isBusinessDayAr(dateKeyOrDate)`
- `nextBusinessDayAr(...)`
- `addBusinessDaysAr(...)`
- `resolveOperationalDateAr(...)`
- `hourInBuenosAires(date)`

Variables:

- `BILLING_DUNNING_USE_BUSINESS_DAYS=true`
- `BILLING_AR_HOLIDAYS_JSON='["2026-01-01","2026-05-25"]'`
- `BILLING_BATCH_CUTOFF_HOUR_AR=15`

Regla operativa:

- en cron, si no es día hábil: `NO_OP` con `skipped_non_business_day`,
- en cron, si se pasó cutoff: `NO_OP` con `deferred_by_cutoff`,
- en ejecución manual se puede forzar con `force=true`.

## 5) Operación por archivo (sin Galicia online)

Import inbound reforzado:

- valida adapter/layout compatible con el batch,
- valida control totals (cuando layout lo expone),
- idempotencia por hash/totales/adapter aunque cambie filename,
- evita reprocesamiento accidental y devuelve `already_imported`.

Errores operativos explícitos:

- `adapter mismatch`
- `totals mismatch`
- `layout parse error`
- `batch already reconciled`

Registro de ingesta:

- entidad `BillingFileImportRun` (SUCCESS/FAILED/DUPLICATE/INVALID),
- hash, actor, source, metadata/totales/filas parseadas.

## 6) Pagos tardíos y duplicados

Política vigente: **First Win**.

- El primer canal confirmado cierra el charge.
- Si llega confirmación tardía de otro canal:
  - no se recierra ni se revierte el charge,
  - se crea `AgencyBillingPaymentReviewCase` para resolución manual contable.

Tipos/estados:

- type: `LATE_DUPLICATE_PAYMENT`, `AMOUNT_MISMATCH`, `OTHER`
- status: `OPEN`, `IN_REVIEW`, `RESOLVED`, `IGNORED`

Resoluciones:

- `BALANCE_CREDIT`
- `REFUND_MANUAL`
- `NO_ACTION`
- `OTHER`

Nota contable:

Pagos tardíos del segundo canal se marcan para revisión; no se compensan automáticamente en este PR.

## 7) Endpoints de operación manual

Review cases:

- `GET /api/admin/collections/review-cases`
- `POST /api/admin/collections/review-cases/[id]/start-review`
- `POST /api/admin/collections/review-cases/[id]/resolve`
- `POST /api/admin/collections/review-cases/[id]/ignore`

Jobs (manual trigger):

- `POST /api/admin/collections/jobs/run-anchor`
- `POST /api/admin/collections/jobs/prepare-batch`
- `POST /api/admin/collections/jobs/export-batch`
- `POST /api/admin/collections/jobs/reconcile-batch`
- `POST /api/admin/collections/jobs/fallback-create`
- `POST /api/admin/collections/jobs/fallback-sync`

Fallback manual:

- `POST /api/admin/collections/fallback/create`
- `POST /api/admin/collections/fallback/sync`
- `POST /api/admin/collections/fallback/[id]/mark-paid`
- `POST /api/admin/collections/fallback/[id]/cancel`

## 8) Panel operativo

Vista principal: `/dev/collections/recurring`

Incluye:

- health cards (jobs failed, stale batches, fallback expiring, review cases open),
- métricas PD/fallback,
- historial reciente de jobs,
- tabla de review cases con acciones manuales,
- badges de stage + canal + review pending.

## 9) Runbook diario (checklist)

1. Revisar health cards (`jobs_failed_last_24h`, stale batches, review cases open).
2. Ejecutar/validar `run-anchor` si corresponde.
3. Correr `prepare` y `export` de lotes PD (según cutoff AR).
4. Importar respuestas de banco (archivo inbound).
5. Revisar fallback pending/expiring y correr `fallback-sync`.
6. Resolver `review cases` abiertas (`start-review`/`resolve`/`ignore`).
7. Confirmar que fiscal sigue desacoplado (`BILLING_FISCAL_AUTORUN=false`).

## 10) Config recomendada (sin Galicia online)

```env
BILLING_JOBS_ENABLED=true
BILLING_JOBS_TZ=America/Argentina/Buenos_Aires
BILLING_COLLECTIONS_ROLLOUT_REQUIRE_AGENCY_FLAG=true

BILLING_PD_ADAPTER=debug_csv
BILLING_BATCH_AUTO_EXPORT=false
BILLING_BATCH_AUTO_RECONCILE=false
BILLING_BATCH_CUTOFF_HOUR_AR=15

BILLING_DUNNING_ENABLE_FALLBACK=true
BILLING_DUNNING_USE_BUSINESS_DAYS=true
BILLING_FALLBACK_DEFAULT_PROVIDER=cig_qr
BILLING_FALLBACK_EXPIRES_HOURS=72
BILLING_FALLBACK_AUTO_SYNC=false

BILLING_REVIEW_CASES_ENABLED=true
BILLING_HEALTH_STALE_EXPORT_HOURS=24
BILLING_HEALTH_STALE_RECONCILE_HOURS=24

BILLING_FISCAL_AUTORUN=false
```

## 11) Known limitations

- Sin notificaciones automáticas a clientes (email/WhatsApp).
- Sin integración online Galicia; operación sigue por archivo.
- Provider fallback productivo real depende del roadmap de integración (stub/bridge en esta etapa).
