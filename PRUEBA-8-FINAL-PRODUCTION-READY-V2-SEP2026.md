# JMX Digital Card — Prueba 8 · FINAL PRODUCTION READY **V2** (sep 2026)

**Base:** `JMX-Digital-Card-Prueba-8-FINAL-PRODUCTION-READY.zip`. Sigue siendo la fuente de verdad: no se reconstruyó nada ni se cambió el motor QR.

No se hizo deploy ni push. No se borró ningún dato: no hay conexión a producción desde este entorno y la herramienta de limpieza solo se probó con datos ficticios.

**Etiquetas de prueba usadas en este informe:**

- **[REAL]** ejecutado aquí;
- **[MOCK]** ejecutado con Firebase simulado;
- **[ESTÁTICO]** verificación del código;
- **[NO]** no ejecutado, con el motivo.

---

## 1. Archivos modificados

| Archivo | Cambio |
|---|---|
| `script.js` | Usa `js/plan-resolver.js`: `plan: basePlanName(meta)`, `effectivePublicPlan()` = `effectivePlanName(p)` y `planAllows()` usa el mismo plan efectivo. |
| `admin.js` | `currentCardPlan = effectivePlanName(meta)`. El selector `#clientPlan` muestra el plan resuelto. `saveAdminMeta` **solo escribe `plan` (y `inventory.plan`) si el admin cambió el plan**. |
| `dashboard.js` | `basePlan`/`effectivePlan` delegan en el resolvedor. Nota "legacy: no plan saved" en el diálogo. El guardado del diálogo **solo escribe `plan` si cambió**. Guardia de inventario antes de Delete y Regenerate (§6). `releaseForReuse` borra `qrBusinessLogo` de la tarjeta liberada y lo guarda en el snapshot de historial. |
| `functions/index.js` | `normalizePlan()` delega en `functions/plan-resolver.js` (+1 `require`). **Nada más cambió:** una prueba revierte esa edición y exige que el archivo sea idéntico byte a byte a Prueba 8. |
| `functions/package.json`, `functions/package-lock.json` | `engines.node` pasa de `"20"` a `"22"` (commit separado; §18). |
| `firebase.json`, `_config.yml` | Se añadió `tools/**` / `tools` a las exclusiones de hosting, para que la herramienta de auditoría nunca se publique. Nada más cambió; verificado revirtiendo la edición. |
| Pruebas | `unit.test.mjs`, `integration.test.mjs`, `fixtures.mjs`, `server.mjs`, `run-all.sh`. |

## 2. Archivos nuevos

- **`js/plan-resolver.js`:** única fuente de verdad del plan (`resolveEffectivePlan`, `resolveBasePlan`, `effectivePlanName`, `basePlanName`, `normalizePlanName`).
- **`functions/plan-resolver.js`:** copia CommonJS para Cloud Functions. Una prueba verifica que es idéntica en comportamiento.
- **`js/inventory-classifier.js`:** clasificador de inventario puro y de solo lectura, compartido por el dashboard y la herramienta.
- **`tools/inventory-audit/`:** herramienta DRY RUN / EXECUTE (`audit.mjs`, `lib/audit-core.mjs`, `lib/stores.mjs`, `test/audit.test.mjs`, `README.md`, `package.json`).
  - Incluye `sample-output-FICTIONAL-TEST-DATA/`: una salida de ejemplo con datos ficticios, **no son datos de producción**.
- **`docs/emulator-tests/`:** pruebas de reglas para el Firebase Emulator, listas para ejecutar (`rules.emulator.test.mjs`, `package.json`, `README.md`).
- **`docs/qr-integration-tests/fixtures/critical-lines-baseline.json`:** huellas SHA-256 de las líneas de Auth, Wallet y NFC de Prueba 8.
- **Este informe.**

## 3. Archivos eliminados

Ninguno.

## 4. Funciones modificadas

- **Tarjeta pública:** `script.js` `getOnlineProfile`, `planAllows`, `effectivePublicPlan`.
- **Editor:** `admin.js` `loadRemoteProfile` (una línea), `loadAdminMeta`, `saveAdminMeta`.
- **Dashboard (`dashboard.js`):**
  - modificadas: `basePlan`, `effectivePlan`, `saveClientDialogChanges`, `removeAvailable`, `regenerate`, `releaseForReuse`, la plantilla del diálogo y `loadCards` (fila recuperada: el plan queda `undefined` en lugar de `"Basic"`, solo en pantalla);
  - nuevas: `legacyPlanNote`, `loadCardBundle`, `guardInventoryAction`, `downloadDeletionBackup`.
- **Cloud Functions:** `functions/index.js` `normalizePlan`.

## 5–8. Plan: inconsistencia corregida

**Antes:**

| Superficie | Sin `plan` | Plan no reconocido ("gold", "jmx business"…) |
|---|---|---|
| Tarjeta pública (`script.js`) | Premium | Bucket Premium, pero las comprobaciones exactas fallaban (analytics desactivado, Quick Capture no aparecía). |
| Editor (`admin.js`) | Premium | Igual que la pública, pero el selector mostraba **Basic** y guardar escribía `plan:"Basic"`. |
| Dashboard | **Basic** | **Basic** |
| Cloud Functions | **Basic** | **Basic** |

**Lo que el cliente siempre vio:** Premium. Son las dos superficies de cara al cliente: su tarjeta pública y su editor.

**Riesgos reales que había:**

1. Guardar cualquier cambio en el diálogo del dashboard, o en el editor abierto por el admin, **escribía `plan:"Basic"` sin que nadie lo decidiera**. Eso ocultaba en la tarjeta pública teléfono 2, web, redes, galería, video y más.
2. `purgeGalleryMedia` con alcance "Basic" incluía estas tarjetas, que **sí muestran su galería**.

**Solución: un solo resolvedor en todas partes.**

- **Dónde se usa:** público, editor, dashboard, Cloud Functions y Feature Controls.
- **Planes reconocidos:** Basic / Premium / Business sin distinguir mayúsculas, y "JMX Business" → Business.
- **Plan ausente o no reconocido → Premium.** Es el comportamiento histórico que ve el cliente:
  - no se oculta nada visible hoy;
  - no se regala ninguna función de Business (esas siguen apagadas para Premium).
- **Precedencia de complimentary:** igual que antes.
- **Sin migración automática:** los datos no se reescriben y `plan` solo se escribe cuando un admin lo cambia.

**Cuántas tarjetas sin plan hay: desconocido.** No hay acceso de lectura a producción desde aquí. La herramienta las cuenta:

```bash
node tools/inventory-audit/audit.mjs --project jmx-digital-card --out ./out
```

El resultado queda en `PLAN-AUDIT.json`. Para cada tarjeta incluye:

- evidencia histórica (`inventory.plan`, `cardAdmin.plan`, `complimentaryBasePlan`, `accounts.plan`);
- comportamiento antes y después en cada superficie;
- las funciones que cambian en el dashboard y el servidor;
- el **impacto NFC** (ajustes por plan de `platform/nfcDeviceSettings`).

Con los datos ficticios de prueba encontró 2 casos (LEG09 sin plan, LEG10 "gold"). El comportamiento público no cambia en ninguno.

**Condición para desplegar Functions:** si `PLAN-AUDIT.json` muestra `nfcImpact` en alguna tarjeta, hay que fijar su plan explícitamente antes. Si no, `/d/**` podría comportarse distinto para esa tarjeta.

**Cambios de comportamiento** (todos probados con equivalencia exhaustiva):

- **Tarjeta pública y editor:** ningún cambio para tarjetas sin plan. Solo "JMX Business" o "jmx business" escritos a mano pasan del bucket Premium a Business.
- **Dashboard y servidor:** solo cambian las tarjetas sin plan o con un valor no canónico. Basic, Premium y Business no cambian.
- **Datos:** no se borran ni se modifican. Una prueba lo verifica sobre LEG09: el editor y el dashboard guardan sin tocar `plan`, y conservan teléfono, email y web.

Quedan sin tocar (archivos protegidos de Auth y activación), solo como etiquetas:

- `login.js:51` (`card.plan||"Basic"` para mostrar historial);
- `activate.js:54`.

`firestore.rules` exige `plan=='Business'` exacto para crear leads.

## 9–17. Confirmaciones

| # | Confirmación | Cómo |
|---|---|---|
| 9 | **Google Auth intacto** | [ESTÁTICO] `login.js`, `login.html`, `activate.*` y `device-activate.*` idénticos byte a byte (SHA-256). Todas las líneas de Auth de `admin.js`, `dashboard.js`, `landing.js`, `login.js`, `activate.js` y `device-activate.js` son idénticas (`getAuth`, `onAuthStateChanged`, `GoogleAuthProvider`, `signInWith*`, `signOut`, persistencia, `firebaseConfig`). [MOCK] la página de login carga sin errores. **[NO] Google Sign-In real: requiere validación en staging o después del deploy.** |
| 10 | **Wallet intacto** | [ESTÁTICO] las 50 líneas de Wallet de `functions/index.js` y las del cliente en `admin.js` son idénticas. ID de objeto `{issuer}.jmx_{cardid}`, GET → PUT, POST solo si 404, colores y temas con merge. [MOCK] la sección Wallet carga. **[NO] API real de Wallet: sin credenciales.** |
| 11 | **NFC intacto** | [ESTÁTICO] `device.*`, `device-activate.*`, `404.html` y rewrites `/d/**`, `/c/**` idénticos. Las líneas del resolver, la activación, los tokens y el retorno NFC son idénticas en Functions y en el dashboard. [MOCK] `/d/NFC-TEST-0001` → misma tarjeta. **[NO] hardware NFC.** Nota: `nfcControlAllows` usa el plan, ver la condición de §5–8. |
| 12 | **URLs activas intactas** | `cardQrTargetUrl` igual. Las reglas `/c/**` y `/d/**` no cambiaron. El dashboard ya no puede borrar ni regenerar una URL con cualquier referencia (§6). |
| 13–17 | **Card IDs, Account IDs, Identity Profile IDs, Device IDs y Activation Codes intactos** | [MOCK] comparación de la base antes y después de todos los flujos: 0 documentos de identidad cambiados. Conteos de integridad sin bajadas. Ningún código nuevo regenera IDs ni códigos. De las funciones manuales existentes, Delete y Regenerate ahora pasan por la guardia (§6); Release sigue siendo el flujo manual de siempre, con dos confirmaciones y snapshot de historial. |

## 6. Guardia del dashboard (Delete / Regenerate)

Antes, "Delete unused NFC" solo comprobaba `status === "available"`. Podía borrar una tarjeta con dueño, con código usado, con dispositivo NFC, con historial o con un tag físico programado.

Ahora, antes de preguntar y **otra vez justo antes de escribir**, lee **todas** las relaciones y las clasifica con `js/inventory-classifier.js`:

- `cards`, `inventory`, `profiles`, `cardAdmin`;
- `cardOwners`, `cardClaims`, `cardStats`, `aiScannerTotals`, `ownerActivity`;
- `nfcDevices` y `nfcBatches` por `cardId`;
- `accounts` (`cardIds`), `identityProfiles`;
- leads, contacts, `aiScannerHistory`, `cardHistory`, monthly/daily stats, media, eventos NFC.

**Bloquea** si hay cualquier referencia:

- dueño, código usado, NFC, identidad, Wallet, leads, estadísticas, historial, datos del cliente o tag programado;
- o si no es stock libre.

**Si se permite:**

1. descarga un **backup JSON** de los 4 documentos;
2. luego borra.

Si algo cambió entre la primera lectura y la confirmación, cancela. Regenerate usa la misma guardia.

## 18. Node 22 (commit separado `8bb882e`)

| Punto | Resultado |
|---|---|
| Archivo modificado | `functions/package.json`: `engines.node` `"20"` → `"22"`. La raíz de `functions/package-lock.json` refleja lo mismo. |
| Dependencias | **Sin cambios.** firebase-functions 6.6.0, firebase-admin 13.10.0, google-auth-library 10.9.1, jsonwebtoken 9.0.3. |
| Compatibilidad | [REAL] Los 149 paquetes del lock que declaran `engines` aceptan Node 22.22.2 (comprobado con `semver`). `node_modules` coincide con el lock. |
| APIs deprecadas | [REAL] Usa la API v2 (`onCall`, `onSchedule`, `onDocumentWritten`, `defineSecret`); no hay `functions.config()`. `node --throw-deprecation` carga el módulo sin avisos. |
| Carga | [REAL] `functions/index.js` carga en Node 22.22.2 con 28 exports, los mismos nombres que en Prueba 8. |
| Functions afectadas | Todas (el runtime cambia al desplegar). El código solo cambió en `normalizePlan`. |
| Emulator | **[NO]** Sin firebase-tools (§21). |
| Fecha límite | Google no permite desplegar ni actualizar Functions en Node 20 después del **30-oct-2026**. |
| npm audit | **[NO]** El registro npm está bloqueado en este entorno. No se usó `npm audit fix --force`. |

## 19. Pruebas ejecutadas

`bash docs/qr-integration-tests/run-all.sh`

| Paso | Resultado | Tipo |
|---|---|---|
| `node --check` de todos los JS, incluidos functions, tools y emulator-tests | OK | REAL |
| `functions/index.js` carga en Node 22.22.2 | 28 exports | REAL |
| Unitarias: QR, decoder de 40 versiones × 4 niveles, zona del logo, Storage Rules (matriz de 160 casos), `firestore.rules`, Feature Controls (77.760 combinaciones + servidor), plan resolver (paridad, precedencia, comparación con el comportamiento anterior, fuente única), archivos protegidos (con reversión de las ediciones intencionales), Auth, Wallet y NFC | **20/20** | REAL |
| Auditoría de inventario: clasificación, fuzz de 5.000 casos (ninguna referencia produce YES), DRY RUN de solo lectura, EXECUTE archive → delete, EXECUTE aborta si aparece una referencia, listas sincronizadas | **6/6** | REAL (sobre un export ficticio) |
| Integradas: páginas reales, decodificación OpenCV de cada QR, responsive de 320 a 1440 px, Business Logo, plan legacy, guardia del dashboard, integridad antes y después | **18/18** | MOCK |
| Matriz de escaneo: 288 QR y 1.728 degradaciones | **288/288** limpios, **1.728/1.728** degradaciones, **0** decodificaciones incorrectas | REAL |

## 20. Pruebas no ejecutadas

- **Firebase Emulator** (§21).
- **Google Sign-In real:** requiere staging o validarlo después del deploy.
- **API real de Google Wallet:** no hay credenciales.
- **Hardware NFC.**
- **Cámaras reales.**
- **Auditoría contra producción:** no hay credenciales ni acceso.
- **`npm audit`.**

## 21. Firebase Emulator

**NO SE PUDO EJECUTAR EL EMULATOR.** Java 21 está disponible, pero no se pudieron instalar `firebase-tools` ni `@firebase/rules-unit-testing`: la política de red del entorno bloquea `registry.npmjs.org` (HTTP 403).

Queda listo `docs/emulator-tests/`, con 8 pruebas:

- dueño → `qrBusinessLogo`: DENEGADO;
- dueño → `profile`, galería y catálogo: PERMITIDO;
- admin → `qrBusinessLogo` PNG: PERMITIDO;
- otro usuario o anónimo: DENEGADO;
- archivo que no es PNG: DENEGADO;
- 12 MB o más: DENEGADO;
- lectura pública: PERMITIDA;
- Firestore: el dueño no puede escribir `cards/X.qrBusinessLogo`.

Comando (proyecto `demo-jmx`, nunca producción):

```bash
npm --prefix docs/emulator-tests install
npx firebase-tools@latest emulators:exec --project demo-jmx --only firestore,storage "node --test docs/emulator-tests/rules.emulator.test.mjs"
```

## 22–24. Inventario

**No hay datos reales.** No se pudo leer producción, así que **no se generó ningún `DELETE-CANDIDATES.json` real**.

- **Herramienta lista:** `tools/inventory-audit/`. Primero DRY RUN (solo lectura). Después EXECUTE en dos etapas: archivar con backup, luego borrar solo lo archivado. Re-valida antes de escribir, aborta ante cualquier referencia nueva y controla la integridad.
- **Ejemplo con datos ficticios:** `tools/inventory-audit/sample-output-FICTIONAL-TEST-DATA/`.

**Clasificación (conteos de los datos ficticios de prueba, solo como ejemplo):**

| STATUS | COUNT (ficticio) | SAFE TO DELETE? | REASON |
|---|---|---|---|
| ACTIVE | 13 | NO | Dueño, código usado o activada |
| ASSIGNED_NFC (reservada, pendiente) | 1 | NO | Un dispositivo o lote NFC apunta a la tarjeta |
| HAS_REFERENCES | 1 | NO | Historial, analytics, identidad, Wallet, leads, datos del cliente… |
| IN_STOCK (válida, no programada) | 1 | NO | Stock disponible para vender o activar |
| IN_STOCK_PROGRAMMED | 1 | NO | Un tag físico ya tiene la URL |
| SOLD_PENDING_ACTIVATION | 1 | NO | Vendida, pendiente de activar |
| ORPHANED_INVENTORY | 1 | REVIEW REQUIRED | Inventario sin documento de tarjeta; puede ser stock físico |
| ORPHAN_FRAGMENT con notas del admin | 1 | REVIEW REQUIRED | Tiene notas internas |
| ORPHAN_FRAGMENT | 1 | YES, tras validación | Solo quedan restos vacíos de profile/cardAdmin: sin tarjeta, sin inventario y sin referencias |
| UNREACHABLE_ID | 1 | YES, tras validación | ID en minúsculas que ninguna URL pública puede servir, sin referencias ni tag programado |

**Nunca se marcan para borrado:**

- activas, asignadas, suspendidas;
- vendidas, reservadas, pendientes;
- en stock (programadas o no), liberadas con historial;
- con NFC, Wallet, leads, analytics o datos de cliente;
- `BOSS` y `main`.

Ante cualquier duda: REVIEW REQUIRED.

## 25. Necesita deploy (cuando lo autorices), en este orden

1. **Correr el Emulator (§21).**
2. **DRY RUN de la auditoría contra producción** (solo lectura) y revisar `PLAN-AUDIT.json`.
3. **`firebase deploy --only storage`**, si el Emulator pasa.
4. **Front-end:**
   - `script.js`, `admin.js`, `dashboard.js`, `card.html`, `styles.css`, `admin.html`, `admin.css`, `dashboard.css`;
   - `js/plan-resolver.js`, `js/feature-controls.js`, `js/inventory-classifier.js`, `js/jmx-qr/**`;
   - `firebase.json` / `_config.yml` (exclusión de `tools/`).
5. **`firebase deploy --only functions`** (Node 22 + resolvedor de plan), después del paso 2 y sin `nfcImpact` pendiente. Si prefieres separar los riesgos, despliega primero solo Node 22 (commit `8bb882e` sobre el anterior) y luego el resolvedor.
6. **Limpieza de inventario:** solo después de revisar el DRY RUN, con `--execute archive` y luego `--execute delete`.

## 26. NO necesita deploy

- `firestore.rules` e índices;
- datos: no hay migraciones;
- `tools/` y `docs/` (no se publican);
- Wallet, Auth y NFC (código sin cambios).
