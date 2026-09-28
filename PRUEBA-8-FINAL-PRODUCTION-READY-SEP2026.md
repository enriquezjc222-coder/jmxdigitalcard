# JMX Digital Card — Prueba 8 · FINAL PRODUCTION READY (sep 2026)

**Base (fuente de verdad):** mi versión *Prueba 8 · QR JMX All Cards* (entregada antes).
**Donante:** `JMX-Digital-Card-Prueba-8-QR-JMX-All-Cards.zip` de ChatGPT. Solo se usó como referencia; no se fusionó a ciegas.

No se hizo deploy ni push. No cambió ninguna URL, slug, Card ID, Account ID, Identity Profile ID, Device ID, Activation Code, `/c/**` ni `/d/**`. No hay migraciones de datos.

---

## 1. Tabla comparativa (Claude vs ChatGPT → versión final)

| Área | Claude (base) | ChatGPT (donante) | Final | Motivo |
|---|---|---|---|---|
| Motor QR | Encoder ISO 18004 propio + presupuesto RS exacto por bloque | Módulo `qr-customization/` (mismo origen, versión anterior), presupuesto 0.35 | **Claude** | Un solo motor. El del donante duplicaba el sistema. |
| Renderer | `renderCardQr` único en público, editor y dashboard; el QR viejo no se reemplaza hasta verificar el nuevo | Runtime del módulo + adaptador `jmx-prueba8-adapter.js` | **Claude** | Una sola capa. |
| Tamaño del logo | 22% del ancho total, reducción automática (ver §3) | ≈14% en v6 (budget 0.35) | **Claude** | Llega al 22% pedido y la matriz de escaneo pasa al 100%. |
| Decodificador | Decoder completo con Reed–Solomon (Berlekamp–Massey/Chien/Forney), pixel + peor caso del modelo | Verificación del módulo | **Claude** | Verifica el texto exacto antes de mostrar el QR. |
| targetUrl | `cardQrTargetUrl` = `qrShareURL` original, idéntico byte a byte | Igual | **Claude** | Una sola función. |
| Feature Controls | Resolución duplicada en 3 archivos | Igual, más claves nuevas | **Nuevo `js/feature-controls.js`** | Un solo resolvedor (GLOBAL → OVERRIDE → PLAN), probado equivalente (§5). |
| `customQR` | = QR Visual Customization (`qrDarkColor`/`qrLightColor`) | Se mantenía y además se añadía `qrVisualCustomization` | **Se queda `customQR`** | Ver §4. |
| `qrVisualCustomization` | No existe | Clave nueva + `profiles.qrCustomization` | **Rechazada** | Duplicaba `customQR` y `qrDarkColor`, con dos fuentes de color. |
| `businessLogoQr` | Clave con override por cliente | Existía, pero se ocultaba de la lista de override por cliente | **Claude** | El override INHERIT/ENABLED/DISABLED por cliente es un requisito. |
| Subida del Business Logo | Metadatos en `profiles/{id}` (**escribible por el dueño**) | Metadatos en `cards/{id}.qrBusinessLogo` (solo admin) | **Idea del donante, implementación nueva** | El donante tenía razón: movido a `cards/{id}`. |
| Preservar / Monocromo | No existía | Existía; el monocromo necesita leer píxeles (falla sin CORS) | **Nuevo:** máscara PNG generada al subir; teñido sin leer píxeles | Funciona aunque el bucket no tenga CORS. |
| Storage Rules | Ruta `qrBusinessLogo` escribible por el dueño (**agujero**) | `mediaId != 'qr-logo'` para el dueño | **Final:** `qrBusinessLogo` solo admin y solo `image/png` | Idea del donante, adaptada a la ruta real; ver §6. |
| Acceso a Firestore | Escrituras merge puntuales | Igual | Merge solo del campo `qrBusinessLogo` | Nunca se sobrescribe el documento completo. |
| Wallet | Sin cambios; ya idempotente | Sin cambios | **Sin cambios** | Ver §9. |
| NFC | Sin cambios (hash verificado) | Sin cambios | **Sin cambios** | Ver §9. |
| Auth | Sin cambios | Sin cambios | **Sin cambios** | Login probado con mocks. |
| Móvil / responsive | 128 px en móvil; 245 px (px enteros por módulo) en escritorio | 128 px en CSS | **Claude** + anchos 375 y 1024 añadidos a las pruebas | 10 anchos probados. |
| Pruebas | 9 unitarias + 14 integradas + matriz 288/1.728 | 42 del módulo + 64 decodificaciones | **Claude, ampliado:** 15 + 16 + 288/1.728 | Las del donante probaban su propio módulo, no las páginas reales. |
| Estructura | `js/jmx-qr/` | `qr-customization/` + dos reportes + `.firebase` + `firebase-debug.log` + `functions/node_modules` (74 MB) | **Claude** | Limpio. |
| Manejo de errores | `console.error` con el objeto | Similar | Mensajes amigables; en consola solo código o mensaje | §10. |
| Hosting | `docs/**` excluido | Añadía `storage.cors.json` en la raíz (se servía públicamente) | CORS movido a `docs/deploy/` | §11. |
| Seguridad | Agujero en el Business Logo | Mejor modelo del logo, pero con bug en `openClientDialog` (`resetDraft=true` donde la firma es `preserveDraft=false`) | Agujero cerrado; bug no importado | §6, §10. |

## 2. Archivos del donante: analizados, usados y no usados

| Archivo del donante | Decisión | Motivo |
|---|---|---|
| `storage.rules` | **Idea usada** (reescrita) | Excluir al dueño de la carpeta del logo. El donante usaba `qr-logo`; la ruta real es `qrBusinessLogo`. Además se exige PNG. |
| `storage.cors.json` | **Usado** → `docs/deploy/storage.cors.json` | Necesario para exportar el PNG con el logo. Se movió a `docs/` para que no se sirva. |
| `dashboard.js` (modelo `cards/{id}.qrBusinessLogo`, preservar/monocromo) | **Idea usada**, código propio | Su monocromo lee píxeles (falla sin CORS) y su envoltura de `openClientDialog` tiene un bug de parámetros. |
| `dashboard.js` (ocultar `qrVisualCustomization`/`businessLogoQr` del override) | No usado | Rompe el override por cliente. |
| `admin.js`, `admin.html` (`mountCustomerQrSection`, `qrCustomizationSlot`) | No usado | El editor completo del módulo daba al cliente controles de logo. El logo es solo admin. |
| `script.js`, `card.html`, `styles.css`, `dashboard.html` | No usado | Cargaban `qr-customization/jmx-qr.css` y un segundo runtime. CSS de 128 px ya presente en la base. |
| `qr-customization/**` (src, assets, tests, `package.json`) | No usado | Motor duplicado (versión anterior del mismo módulo, logo ≈14%). |
| `qr-customization/src/integration/jmx-prueba8-adapter.js` | No usado | Adaptador para un segundo motor. |
| `ALL-CARDS-QR-FINAL-REPORT-SEP2026.md`, `QR-CUSTOMIZATION-INTEGRATION-REPORT-SEP2026.md` | No usados | Describen el sistema del donante. |
| `firebase-debug.log` | **Excluido** | Log de la CLI con tu correo y el proyecto (no contiene tokens). Nunca debe publicarse. |
| `.firebase/hosting..cache` | Excluido | Caché de la CLI. |
| `functions/node_modules/` (74 MB) | Excluido | Dependencias instaladas; se reinstalan con `npm ci`. |
| `docs/backups/…`, `js/architecture/` | Excluidos | Carpetas vacías. |

## 3. Logo JMX: tamaño real (medido por el motor, no estimado)

`logoScaleTarget = 0.22` (22% del ancho total del QR, quiet zone incluida) es un **máximo**. Error Correction H, quiet zone 4, presupuesto 50% de la corrección de cada bloque Reed–Solomon.

| Card ID | Longitud de URL | Versión QR | JMX real | Business real | Peor bloque usado (JMX) |
|---|---|---|---|---|---|
| 1–22 caracteres (todas las tarjetas normales, p. ej. `JMXB01`) | 37–58 | v6 | **22.0%** | 19.8% | 50% |
| 23–28 | 59–64 | v7 | **18.6%** | 17.7% | 38% |
| 29–48 | 65–84 | v8 | 22.0% | 19.4% | 46% |
| 49–62 | 85–98 | v9 | 22.0% | 19.8% | 50% |
| 63–64 (ID más largo posible) | 99–100 | v10 | 22.0% | 19.8% | 43% |

**Cuándo y por qué se reduce:**

- **v7:** tiene 5 bloques con 13 codewords corregibles cada uno, así que el límite es 6 por bloque. Al 22%, un bloque perdería 7. El motor baja hasta el mayor tamaño seguro: 18.6%.
- **Si tocara un patrón protegido:** finder, timing, formato/versión o alineación no central. No ocurre en v6–v10.
- **Business Logo:** techo de 0.9 × 22%, porque es cuadrado y suele ser más oscuro.
- **Si el render no decodifica exactamente**, se prueba en este orden:
  1. logo al 85, 70, 55 y 42% del objetivo;
  2. colores por defecto con JMX;
  3. QR sin logo.
- **Si el Business Logo no carga:** se usa JMX.

## 4. Decisión de claves de feature (documentada)

- **`customQR`** = QR Visual Customization (colores `qrDarkColor`/`qrLightColor` del perfil más el aro del tema). Es la clave existente, con switches por plan y override por cliente. Se conserva el nombre para no migrar datos.
- **`qrVisualCustomization`** (donante): **rechazada**. Era un segundo nombre para lo mismo, con otra fuente de color (`profiles.qrCustomization`).
- **`businessLogoQr`** = mostrar el logo de empresa. Lo sube **solo el administrador de plataforma**; datos en `cards/{id}.qrBusinessLogo` y archivos en `cards/{id}/qrBusinessLogo/`.
- **`qrCardThemes`** se **reutiliza**: el color del tema alimenta el aro de acento. No se creó otro sistema de temas.

## 5. Feature Controls centralizados

Nuevo `js/feature-controls.js`, usado por `script.js`, `admin.js` y `dashboard.js`. Los nombres de función existentes (`planAllows`, `featureEnabledForPlan`, `clientAllowsFeature`) se mantienen como envoltorios.

**Precedencia:**

1. **GLOBAL OFF** → apagado para todos; nada lo anula.
2. **OVERRIDE** del cliente: ENABLED (`true`) / DISABLED (`false`) / INHERIT (sin clave).
3. **PLAN:** Basic / Premium / Business. Modo legacy (`enabled:false`) igual que antes.

Apagar una feature **no borra** datos: colores, logo y ajustes se conservan y vuelven intactos al encenderla. Así está probado para el Business Logo (§12, prueba 09c). La ocultación pública de secciones es el comportamiento original de cada switch y no se cambió.

**Equivalencia probada** con 77.760 combinaciones (planes, complimentary, overrides, controles aleatorios, modo legacy):

- **Público y dashboard (permiso efectivo):** 0 diferencias frente a las funciones originales.
- **Servidor:** `functions/index.js featureAllows` (sin tocar) coincide con el resolvedor.
- **Dos alineaciones intencionadas:**
  - **Editor del cliente, modo legacy, Premium:** ya no ofrece `quickCapture`, `leads` ni `advancedAnalytics`. La tarjeta pública y el servidor ya los negaban.
  - **Pista "heredado" del dashboard:** respeta un GLOBAL OFF también en modo legacy.
- **Diferencias existentes documentadas, sin cambiar:**
  - Una tarjeta **sin campo `plan`** se trata como Premium en la tarjeta pública y el editor, y como Basic en el dashboard y el servidor. Unificar esto podría ocultar datos públicos; queda como decisión tuya.
  - En el servidor, `BASIC_FEATURE_DEFAULTS` no incluye `profileThemes`, y la lista del servidor no tiene `businessLogoQr`. Ninguna de las dos se valida en el servidor.

## 6. Business Logo QR: solo admin de verdad

| Capa | Protección |
|---|---|
| **Storage** (`storage.rules`) | En `cards/{cardId}/qrBusinessLogo/{file}` solo el admin escribe o borra, y solo `image/png` < 12 MB. El dueño **conserva** todos sus demás permisos de media (perfil, portada, logo, catálogo, galería). Lectura pública igual que antes. |
| **Firestore** | Los datos están en `cards/{id}.qrBusinessLogo`. `firestore.rules` **no cambió**: las escrituras en `cards/{id}` ya eran solo admin, salvo el claim de activación, limitado a `status/activatedAt/updatedAt`. |
| **Lectura** | Público, editor y dashboard leen el logo **solo** del documento de la tarjeta. Cualquier `qrBusinessLogo`/`qrLogoMode` en `profiles/{id}` (escribible por el dueño) se ignora. |
| **Defensa extra** | Solo se aceptan URLs `https://firebasestorage.googleapis.com`, `https://storage.googleapis.com` o del mismo origen. |
| **UI** | El editor del cliente ya no tiene selector de logo; solo muestra "managed by JMX". |

**Controles en el dashboard (Card QR → Business Logo QR):**

- logo actual;
- Upload;
- Replace (los archivos anteriores se borran solo después de guardar el nuevo registro);
- Remove (dos clics; borra el registro y los archivos);
- Preview con el mismo motor;
- Use JMX emblem / Use business logo (conserva el logo);
- Preserve original colours / Monochrome (color del QR).

Cambiar modo o color **solo cambia la representación**.

**Estado de la regla:**

- **Probado:** la lógica de `storage.rules` se tradujo 1:1 y se ejecutó sobre una matriz de 160 casos (4 roles × 8 carpetas × 5 tipos o tamaños), comparada con la regla original de Prueba 8. El dueño ya no puede escribir `qrBusinessLogo` y todo lo demás quedó idéntico. La misma prueba confirma que antes **sí** podía (el agujero existía).
- **No probado:** el **Firebase Emulator**, porque no hay firebase-tools ni Java aquí. Hay que correrlo antes del deploy de reglas (§14).

## 7. Datos

No hay migraciones. Los campos nuevos son opcionales y tienen valores por defecto:

- sin `qrBusinessLogo` → JMX;
- `mode` por defecto `business`;
- `colorMode` por defecto `original`;
- sin máscara → colores originales.

Mi versión anterior guardaba el logo en `profiles/{id}`. Nunca se publicó, así que no hay datos que mover.

## 8. QR en todas las superficies

Público, editor y dashboard usan la misma cadena: `cardQrTargetUrl` → `resolveCardQrCustomization` → `renderCardQr`.

- **Tamaño:** 128 px en móvil (≥128 px garantizado); en escritorio, 245 px con píxeles enteros por módulo.
- **Descarga PNG:** con el Business Logo solo si el bucket tiene CORS; si no, se descarga con JMX y el mismo URL.

## 9. Wallet y NFC

- **Wallet:**
  - El ID de objeto es determinista: `${ISSUER}.jmx_{cardid}`.
  - `upsertWalletObject` hace GET → PUT, y POST solo si no existe (404).
  - `googleWalletObjectId`/`googleWalletStatus` se guardan con merge.
  - `saveGoogleWalletTheme` actualiza solo si el objeto existe.

  Ya es estable e idempotente, con colores y temas persistentes. **Sin cambios.**
- **NFC:** `device.*`, `device-activate.*`, `functions/index.js`, `/d/**` y `nfcDevices` son idénticos byte a byte (SHA-256). La prueba 13 confirma que el QR nunca incluye `src=nfc` ni el Device ID.

## 10. Errores y consola

- Mensajes al admin:
  - "Permission denied (platform admin only)";
  - "Storage is busy";
  - "Unexpected error — nothing was changed".
- En consola solo el código o mensaje del error; nunca datos del usuario.
- Si una subida falla, se borran los archivos ya subidos. Si falla un cambio de modo o color, el selector vuelve al valor guardado.
- 0 errores de consola en las páginas probadas. Solo se ignoran los 404 de la redirección `/c/{id}` y de las imágenes de ejemplo `images/*`, que ya faltaban en el ZIP original.

## 11. Hosting (GitHub Pages / Firebase Hosting)

- **Firebase Hosting** (`public: "."`) ignora dotfiles, `functions/**`, `docs/**`, `*.md`, `*.txt`, `*.ps1` y reglas.
- **GitHub Pages** (`_config.yml`) excluye lo mismo; Jekyll ignora los dotfiles.
- **Se sirve solo:** HTML, CSS, JS, imágenes y `js/**`.
- `storage.cors.json` no se sirve porque vive en `docs/deploy/`.
- Sin secretos en el repo. La `apiKey` web de Firebase es pública por diseño. Recomendado: restringirla por referrer en Google Cloud y activar App Check.
- Si el **repositorio** de GitHub es público, todo el código (incluido `functions/`) es visible aunque no se sirva. No hay secretos en él: las credenciales de Wallet están en Secret Manager.

## 12. Pruebas ejecutadas (reales, en este entorno)

`bash docs/qr-integration-tests/run-all.sh` → **ALL QR INTEGRATION CHECKS PASSED**

| Suite | Resultado |
|---|---|
| Sintaxis (`node --check`) de todos los JS tocados | OK |
| Unitarias | **15/15** |
| Integradas (páginas reales + mocks de Firebase + decodificación OpenCV de cada QR mostrado) | **16/16** |
| Matriz de escaneo: 288 QR, 2 decodificadores | **288/288** limpios |
| Degradaciones tipo cámara (desenfoque, reducción, JPEG q35, rotación 15°, perspectiva, poca luz + ruido) | **1.728/1.728** |
| Decodificaciones con URL incorrecta | **0** |

**Cobertura nueva en esta versión:**

- **Business Logo:** subir, monocromo, Use JMX, Use Business, reemplazar, quitar.
- **Archivos en Storage:** creados y borrados.
- **Datos:** `profiles` sin tocar; feature OFF conserva el logo y ON lo restaura; logo inyectado por el dueño en `profiles` ignorado en la tarjeta pública y en el editor.
- **Permisos:** matriz de Storage Rules; equivalencia de Feature Controls con el cliente y el servidor.
- **Responsive:** 320, 360, 375, 390, 412, 430, 768, 1024, 1280 y 1440 px, sin overflow y con el QR decodificando en todos.
- **Integridad:** Card, Account e Identity IDs, NFC, Device IDs y códigos de activación intactos (base de datos antes/después).

**No probado aquí** (necesita infraestructura real):

- Firebase Emulator o reglas en producción;
- Google Sign-In real (se probó la página de login con mocks);
- API real de Google Wallet;
- tags NFC físicos;
- cámaras reales de iPhone, Android y Samsung;
- `npm audit` (el registro npm está bloqueado en este entorno).

## 13. Archivos

- **Modificados:**
  - `storage.rules`, `script.js`, `admin.js`, `admin.html`, `dashboard.js`, `dashboard.css`;
  - `js/jmx-qr/card-qr.js`, `js/jmx-qr/qr-logo-upload.js`;
  - pruebas: `unit.test.mjs`, `integration.test.mjs`, `harness.mjs`, `mock-firebase/firebase-storage.js`, `protected-files.sha256.json` (sale `storage.rules`, que ahora se verifica por la prueba de reglas), `run-all.sh`, `README.md`.
- **Nuevos:**
  - `js/feature-controls.js`;
  - `docs/deploy/storage.cors.json`;
  - `docs/qr-integration-tests/fixtures/storage.rules.base-prueba8` (regla original, para la comparación);
  - `docs/qr-integration-tests/.gitignore`.
- **Movido:** `QR-JMX-ALL-CARDS-SEP2026.md` → este archivo; su contenido fue reemplazado.
- **Eliminados:**
  - `docs/qr-integration-tests/undefined/` (180 PNG basura de una ejecución antigua);
  - `docs/qr-integration-tests/results/` del paquete (capturas y JSON; se regeneran en cada ejecución).
- **Fuera del ZIP:** el ZIP anterior (y la Prueba 8 original) traía `firebase-debug.log`, la caché `.firebase/` y `functions/node_modules/`. Ya no van incluidos (están en `.gitignore`); se reinstalan con `npm ci` en `functions/`.
- **Sin cambios:** `firestore.rules`, `firebase.json`, `_config.yml`, `functions/**`, `404.html`, NFC, Auth, Wallet y activación.
- **Paquetes y configuración:** sin cambios. No se usó `npm audit fix --force`.
- **Candidato a limpieza** (no se tocó; es tuyo): `docs/bkp-0920/` (copia antigua del dashboard, no se sirve).

## 14. Deploy

**Necesita deploy (cuando lo autorices):**

1. **`storage.rules`** → `firebase deploy --only storage`. Antes, conviene correr el Firebase Emulator con: dueño sube a `cards/X/qrBusinessLogo/a.png` → denegado; dueño sube a `cards/X/profile/a.png` → permitido; admin sube PNG a `qrBusinessLogo` → permitido.
2. **Front-end** (GitHub Pages o Firebase Hosting):
   - `script.js`, `card.html`, `styles.css`;
   - `admin.html`, `admin.js`, `admin.css`;
   - `dashboard.js`, `dashboard.css`;
   - `js/feature-controls.js`, `js/jmx-qr/**`.
3. **Orden recomendado:** primero `storage.rules`, luego el front-end.
4. **Opcional:** `gsutil cors set docs/deploy/storage.cors.json gs://<bucket>`, para que la descarga PNG incluya el Business Logo.

**No necesita deploy:** `firestore.rules`, índices, Cloud Functions, Wallet, Auth, NFC y datos (no hay migraciones).

## 15. Node 20 → 22 (analizado, NO actualizado)

- **Fechas oficiales de Google Cloud:**
  - Node 20: deprecación 2026-04-30, **decommission 2026-10-30**;
  - Node 22: deprecación 2027-04-30, decommission 2027-10-31.
- **Qué significa:** después del 30-oct-2026 ya **no se podrán desplegar ni actualizar** funciones en Node 20.
- **Compatibilidad:** las dependencias bloqueadas (firebase-functions 6.6.0, firebase-admin 13.10.0, google-auth-library 10.9.1, jsonwebtoken 9.0.3) declaran compatibilidad con Node ≥18. `functions/index.js` **carga sin errores en Node 22.22.2** aquí (28 exports).
- **Recomendación:** cambio separado y urgente:
  1. `engines.node: "22"`;
  2. `npm ci`;
  3. prueba con el emulador;
  4. `firebase deploy --only functions` con tu autorización.

No se cambió en este paquete para no mezclar un cambio de runtime con el del QR.

Fuente: https://docs.cloud.google.com/functions/docs/runtime-support
