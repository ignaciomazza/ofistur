# Go-Live bancario pendiente para cobranzas recurrentes

## Estado actual del modulo (resumen)

El core de cobranzas recurrentes quedo implementado y endurecido en PR #4, #5, #6 y #7, con foco en:

- Cobranza desacoplada de facturacion fiscal
- Debito por archivo (PD Galicia) con adapters
- Jobs + scheduler + locks + idempotencia
- Dunning + fallback (stub CIG/QR / MP stub)
- Hardening operativo (business day AR + cutoff + rollout por agencia + review cases)
- Operacion sin Galicia online usando `debug_csv` + fixtures

Importante: el sistema esta listo para operar tecnicamente, pero el go-live productivo real depende de validar el circuito bancario real (Galicia) y, si se desea recuperacion real por fallback, integrar un provider real (no stub).

## Objetivo de este documento

Dejar registrado todo lo pendiente para activar produccion bancaria real, de forma ordenada y accionable, para continuar mas adelante con Codex sin perder contexto.

## Regla de arquitectura (se mantiene)

### Cobranza y facturacion siguen desacopladas

- Cobranza: PD Galicia, dunning, fallback, conciliacion, cierre de charge.
- Facturacion fiscal: pipeline separado (AFIP/ARCA), no bloquea cobranza.

### Flag de seguridad (mantener)

- `BILLING_FISCAL_AUTORUN=false` por default.

## 1) Requisito base: acceso operativo a Banco Galicia

### 1.1 Accesos y permisos a conseguir

Cuando este disponible el acceso, confirmar:

- Usuario/s con permisos para:
  - subir archivos de presentacion PD
  - descargar/obtener archivos respuesta
  - consultar estado de presentacion/lote
- Alcance del permiso:
  - empresa/cuenta/sucursal
  - operatoria de debitos directos por archivo (si esta separada)
- Si hay perfiles distintos:
  - carga
  - aprobacion
  - consulta

### 1.2 Datos operativos a relevar con Galicia

Hay que dejar documentado (real, no asumido):

- Layout oficial vigente (outbound e inbound)
- Convencion de nombres de archivo (si aplica)
- Cutoff horario real
- Dias/horarios en que:
  - aceptan presentacion
  - generan respuesta
- Codigos reales de rechazo y su significado
- Reglas de reintentos del banco (si existen limitaciones)
- Si hay diferencias entre ambiente homologacion / productivo (si existieran)

#### Entregable sugerido

Crear una nota interna:

- `docs/BILLING_GALICIA_BANK_OPERATIONS_NOTES.md`

Con:

- contactos
- horarios
- layout recibido
- ejemplos reales anonimizados
- observaciones de operacion

## 2) Validacion real del adapter Galicia (archivo)

### 2.1 Validacion outbound (Ofistur -> Galicia)

Objetivo: confirmar que el adapter `galicia_pd_v1` genera exactamente lo que el banco acepta.

#### Checklist

- [ ] Encoding correcto
- [ ] Longitudes y padding correctos
- [ ] Header/trailer correctos (si aplica)
- [ ] Totales de control correctos
- [ ] Cantidad de registros correcta
- [ ] Importe total correcto
- [ ] Adapter version registrada en metadata
- [ ] Archivo aceptado por el canal de Galicia sin observaciones

#### Resultado esperado

- El archivo se presenta correctamente y Galicia lo toma como valido.

### 2.2 Validacion inbound (Galicia -> Ofistur)

Objetivo: confirmar que el parser/import de respuesta funciona con archivo real.

#### Checklist

- [ ] Parsea layout real del banco (no fixture)
- [ ] Mapea estados correctamente:
  - pagado
  - rechazado
  - observaciones
- [ ] Verifica control totals inbound
- [ ] Mantiene idempotencia por hash/contenido
- [ ] Registra `BillingFileImportRun` con resultado
- [ ] Maneja errores explicitos:
  - adapter mismatch
  - totals mismatch
  - layout parse error
  - batch already reconciled

#### Resultado esperado

- El import real actualiza attempts/charges de forma trazable e idempotente.

## 3) Smoke tests productivos minimos (con banco real)

### 3.1 Caso A - Pago OK por PD (happy path)

#### Flujo esperado

1. `run_anchor` genera ciclo + charge + attempts
2. `prepare/export` genera lote PD
3. Se presenta archivo en Galicia
4. Se importa respuesta con pago aprobado
5. Charge se cierra por funcion unificada
6. `paid_via_channel = PD_GALICIA`
7. Se emite evento de cobranza (sin fiscal autorun)

#### Verificar

- [ ] No duplica charge
- [ ] No duplica side effects
- [ ] Quedan metricas/logs en jobs
- [ ] Queda traza de import

### 3.2 Caso B - Rechazos PD + dunning

#### Flujo esperado

- Rechazo intento 1 -> stage sigue progreso normal (sin fallback)
- Rechazo intento 2 -> stage sigue progreso normal (sin fallback)
- Rechazo intento final -> stage pasa a fallback (stage 3) y crea fallback intent idempotente

#### Verificar

- [ ] stages correctos
- [ ] no crea fallback antes de tiempo
- [ ] fallback se crea una sola vez

### 3.3 Caso C - Pago por fallback (mismo charge)

#### Flujo esperado

1. Ultimo rechazo PD dispara fallback
2. Se genera fallback intent
3. Se confirma pago por fallback
4. Se cierra el mismo charge
5. Se cancelan intents pendientes del otro canal
6. `paid_via_channel` queda en fallback

#### Verificar

- [ ] no crea segundo charge
- [ ] cierre unificado idempotente
- [ ] `BILLING_FISCAL_AUTORUN=false` sigue respetado

### 3.4 Caso D - Tardio critico (First Win)

#### Flujo esperado

1. Charge ya fue pagado por fallback
2. Luego entra conciliacion PD como pagado
3. No se re-cierra charge
4. Se crea `AgencyBillingPaymentReviewCase` OPEN (idempotente)
5. Se mantiene `paid_via_channel` del primer canal que gano

#### Verificar

- [ ] policy First Win aplicada
- [ ] review case creado
- [ ] sin side effects duplicados

## 4) Pendiente clave: provider fallback real (no stub)

### Estado actual

- `cig_qr` esta como stub funcional
- `mp` esta como stub/no productivo
- El flujo esta listo, pero el fallback aun no cobra real

### Decision pendiente

Definir provider real de fallback para go-live:

- Opcion A: CIG/QR real
- Opcion B: Mercado Pago real
- Opcion C: primero manual + luego provider real

### Requisitos para integrar provider real

#### A. Contrato (ya existe)

Mantener interfaz actual:

- `createPaymentIntentForCharge`
- `getPaymentStatus`
- `cancelPaymentIntent`

#### B. Idempotencia obligatoria

- `external_reference` unico por fallback intent
- Reintentos de create no deben generar pagos duplicados

#### C. Estados minimos mapeados

- `PENDING`
- `PAID`
- `EXPIRED`
- `FAILED`
- `CANCELED`

#### D. Operacion inicial recomendada

- Primero con sync manual / job
- Webhooks reales despues (otra etapa)

## 5) Politica operativa/contable pendiente (definir con negocio)

### 5.1 Duplicados tardios (segundo canal)

Ya esta implementado:

- First Win
- segundo pago tardio -> `ReviewCase`

#### Falta definir proceso operativo

Que hace administracion cuando aparece un review case?

Opciones tipicas:

- [ ] Devolver dinero
- [ ] Dejar credito a favor
- [ ] Aplicar al proximo ciclo
- [ ] Compensar manualmente en cuenta corriente

#### Recomendacion

Documentar una politica unica y simple para el equipo.

### 5.2 Suspension de servicio / mora escalada

Esta contemplado `dunning_stage=4` (escalado/suspendido), pero falta politica de negocio explicita:

- Cuantos dias despues del fallback expirado se suspende?
- Quien ejecuta la suspension?
- Se reintenta fallback manualmente antes?
- Se puede rehabilitar desde panel?

Esto puede quedar como procedimiento operativo (no necesariamente codigo en esta etapa).

## 6) Rollout productivo por agencia (tenant-level)

### Objetivo

No activar todo junto. Hacer rollout controlado por agencia usando flags de `AgencyBillingConfig`.

### 6.1 Checklist de activacion por agencia

Antes de prender una agencia:

- [ ] Mandato validado (vigente)
- [ ] Datos bancarios correctos
- [ ] Monto/ciclo esperado validado
- [ ] `collections_pd_enabled=true`
- [ ] `collections_dunning_enabled=true`
- [ ] `collections_fallback_enabled` definido
- [ ] `collections_fallback_provider` definido
- [ ] `collections_suspended=false`
- [ ] Responsable interno asignado
- [ ] Agencia informada del comienzo de cobro automatico (proceso/fecha)

### 6.2 Estrategia sugerida de rollout

#### Fase 1 - Piloto

- 1 a 3 agencias
- Supervision diaria manual
- Validacion end-to-end

#### Fase 2 - Controlado

- 5 a 10 agencias
- Medir KPIs y errores operativos

#### Fase 3 - Escalado

- Resto de agencias
- Activacion por tandas

## 7) Configuracion de entorno para activacion real

### 7.1 Variables criticas (mantener / revisar)

```env
# Jobs
BILLING_JOBS_ENABLED=true
BILLING_JOBS_TZ=America/Argentina/Buenos_Aires
BILLING_JOB_RUNNER_SECRET=...
BILLING_JOB_LOCK_TTL_SECONDS=...

# PD (Galicia)
BILLING_PD_ADAPTER=galicia_pd_v1
BILLING_BATCH_AUTO_EXPORT=true
BILLING_BATCH_AUTO_RECONCILE=false   # al inicio mejor manual/semiautomatico
BILLING_BATCH_CUTOFF_HOUR_AR=...

# Dunning / fallback
BILLING_DUNNING_ENABLE_FALLBACK=true
BILLING_FALLBACK_DEFAULT_PROVIDER=cig_qr   # mientras siga stub
BILLING_FALLBACK_EXPIRES_HOURS=72
BILLING_FALLBACK_AUTO_SYNC=false           # arrancar manual/controlado
BILLING_FALLBACK_MP_ENABLED=false

# Fiscal (desacoplado)
BILLING_FISCAL_AUTORUN=false
```

### 7.2 Cuando haya provider real

Actualizar:

- `BILLING_FALLBACK_DEFAULT_PROVIDER=...` (real)
- credenciales/secretos del provider
- `BILLING_FALLBACK_AUTO_SYNC=true` (solo despues de validar)

## 8) Operacion diaria minima (runbook)

### 8.1 Tareas diarias

#### Manana

- [ ] Revisar jobs (`BillingJobRun`)
- [ ] Ver batches preparados/exportados pendientes de conciliacion
- [ ] Ver fallback intents pending/expired
- [ ] Ver review cases nuevos

#### Durante el dia

- [ ] Presentar archivo PD (si operacion manual/semimanual)
- [ ] Importar inbound (si llega archivo)
- [ ] Sync fallback (si aplica)
- [ ] Resolver review cases urgentes

#### Fin del dia

- [ ] Confirmar no quedaron jobs fallidos sin revisar
- [ ] Confirmar no hay batches viejos trabados
- [ ] Confirmar metricas coherentes (paid/rejected/overdue)

### 8.2 KPIs recomendados (para tablero)

- % exito PD primer intento
- % recuperacion por reintento PD
- % recuperacion por fallback
- % charges escalados
- % charges vencidos > X dias
- review cases abiertos / cerrados
- tiempo medio de cierre de charge

## 9) Seguridad y control operativo

### Checklist minimo

- [ ] Endpoints admin/dev protegidos por rol
- [ ] Secret de cron configurado
- [ ] Variables sensibles en entorno seguro
- [ ] Acceso a storage restringido
- [ ] Logs sin exponer datos sensibles
- [ ] Backup DB y auditoria disponibles
- [ ] Operadores definidos (quien hace que)

## 10) Known limitations actuales (esperadas)

Estas limitaciones no bloquean el estado actual, pero siguen vigentes:

1. No hay integracion online real con Galicia todavia
   Se opera por archivos (presentacion/import).

2. Fallback provider actual es stub
   El flujo existe, pero no cobra real hasta integrar provider productivo.

3. No hay notificaciones automaticas (WhatsApp/email)
   Queda fuera de alcance por decision (se mantiene asi por ahora).

4. No hay webhook real de fallback provider
   El sync es manual/job (suficiente para primera etapa).

## 11) Que falta para decir "esta listo para cobrar automaticamente sin problema"

### Minimo indispensable

#### A. Banco Galicia real validado

- [ ] Layout outbound validado
- [ ] Layout inbound validado
- [ ] Primer lote real procesado OK
- [ ] Primer import real conciliado OK

#### B. Piloto con agencias reales

- [ ] Al menos 1-3 agencias cobradas end-to-end
- [ ] Sin duplicados
- [ ] Dunning/fallback (si aplica) probado

#### C. Procedimiento operativo claro

- [ ] Runbook diario definido
- [ ] Politica de review cases definida
- [ ] Responsable operativo asignado

### Para cierre completo (recomendado)

#### D. Fallback real productivo

- [ ] Provider real integrado (CIG/QR o MP)
- [ ] Sync estable
- [ ] Pago real por fallback validado

## 12) Siguiente etapa sugerida (cuando tengas acceso)

### Opcion de naming

Esto podria ser:

- PR #8 - Activacion bancaria real Galicia (validacion productiva por archivo + piloto)

### Alcance sugerido PR #8

- Validacion adapter Galicia con archivos reales
- Ajustes de layout (si hicieran falta)
- Hardening final de import real
- Runbook operativo final
- Piloto 1-3 agencias
- (Opcional) mejoras de observabilidad segun feedback de operacion real

Notificaciones siguen fuera de scope, salvo decision explicita.

## 13) Prompt listo para Codex (para retomar mas adelante)

Copiar/pegar cuando tengas acceso al banco y quieras continuar.

```txt
Contexto:
El modulo de cobranzas recurrentes de Ofistur ya tiene PR #4, #5, #6 y #7 implementados:
- PR4: mandates + adapter galicia_pd_v1 + conciliacion + desacople fiscal
- PR5: jobs/scheduler/locks/BillingJobRun
- PR6: dunning + fallback intents + provider abstraction + first win
- PR7: rollout por agencia + business day AR + cutoff + import hardening + review cases

Importante:
- Mantener COBRANZA y FACTURACION desacopladas
- BILLING_FISCAL_AUTORUN=false por default
- No integrar notificaciones (WhatsApp/email) en esta etapa

Objetivo ahora:
Activar validacion bancaria real con Galicia (PD por archivo) y dejar listo el go-live productivo.

Tareas:
1) Revisar adapter galicia_pd_v1 contra archivo/layout real del banco
   - validar outbound (header/detail/trailer, totals, encoding, padding)
   - ajustar parser inbound si hay diferencias reales
2) Ejecutar smoke tests end-to-end con lote real
   - caso pago OK PD
   - caso rechazo PD
   - caso rechazo final -> fallback
   - caso tardio PD luego de fallback pagado (first win + review case)
3) Endurecer errores operativos si aparecen diferencias reales
   - adapter mismatch / totals mismatch / parse errors / duplicate imports
4) Mejorar docs operativas con datos reales de Galicia
   - cutoff real
   - tiempos reales de respuesta
   - codigos de rechazo reales
5) Mantener compatibilidad manual y flags por agencia
6) No tocar pipeline fiscal
7) No agregar notificaciones

Entregables esperados:
- ajustes de codigo minimos necesarios
- tests actualizados
- docs de operacion actualizadas con datos reales
- checklist de piloto (1-3 agencias)
```

## 14) Notas finales

- El sistema ya esta bien encaminado y con una base muy solida para no romper nada cuando entres a banco real.
- Lo que falta ya no es arquitectura core, sino validacion operativa real + decisiones de operacion + (si queres) provider fallback real.
- Mantener el rollout por agencia y la politica de First Win fue una muy buena decision para evitar problemas contables al escalar.
