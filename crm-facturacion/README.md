# CRM Facturación

Sistema de ventas / CRM inspirado en el flujo de RapiFac (menú principal con
módulos, ventas con comprobantes electrónicos, dashboard y reportes), construido
con diseño y código propios.

## Módulos incluidos (MVP)

- **Login** con usuario y contraseña.
- **Menú principal** estilo grid de módulos (con "Próximamente" para los módulos
  que no se implementaron en esta primera versión: Finanzas, Conciliación,
  Contabilidad, Planillas, Asistencias, Configuración).
- **Clientes**: alta, edición, búsqueda, eliminación (CRUD completo).
- **Inventario**: catálogo de productos/servicios (categoría, unidad, precio,
  stock y stock mínimo con alerta visual, y equivalencias/presentaciones — ver
  detalle abajo), Movimientos de inventario (registro automático de cada
  venta/anulación, ajustes manuales, Inventario Físico e Importar Stock Real —
  ver detalle abajo), Lotes y Series (control de vencimiento con consumo FEFO
  — ver detalle abajo), Traslados entre sucursales y Producción (recetas/BOM —
  ver detalle abajo), y Lista de Precios exportable a CSV. Precio por Márgenes
  queda como "Próximamente".
- **Ventas**: emisión de Facturas, Boletas y Notas de crédito, con forma de pago
  (Efectivo / Tarjeta / Transferencia-Banco). Cálculo automático de IGV (18%),
  numeración por serie, anulación, descarga de comprobante en PDF.
- **Compras**: registro de compras a proveedores (con alta rápida de proveedor
  desde el propio formulario). Cada compra ingresa el stock de los productos
  comprados automáticamente (kardex con referencia `COMPRA-00001`, etc.),
  calcula IGV (18%) igual que Ventas, y se puede anular (revierte el stock
  ingresado, validando que no se haya vendido/trasladado ya).
- **Modo oscuro**: icono de luna/sol en la barra superior para alternar entre
  modo claro y oscuro en toda la app (incluyendo la pantalla de login); la
  preferencia queda guardada en el navegador y se mantiene entre sesiones.
- **Caja y Bancos**: arqueo de caja diario (ver detalle abajo).
- **Dashboard**: indicadores del día/mes, gráfico de ventas por día, ventas por
  tipo de comprobante, últimas ventas.
- **Reportes**: ventas mensuales (gráfico), ventas por vendedor, productos más
  vendidos (con Mostrar todo/Ocultar lista), informe tributario (ventas netas e
  IGV por mes, exportable a CSV), top clientes, resumen por tipo de comprobante.
- **Usuarios**: además del admin, hay dos usuarios "vendedor" de ejemplo para
  poder ver el reporte de Ventas por vendedor con datos de más de una persona:
  DNI `45678912` (Carlos Ramírez) y DNI `87654321` (Lucía Fernández), ambos
  con contraseña `vendedor123`. Cada venta queda asociada al usuario que la
  emitió. El login es con RUC de la empresa + DNI + contraseña (ver
  "Primer ingreso" más abajo).

## Lotes y series (FEFO)

Para productos que se venden por lote o vencen (suplementos, perecibles, etc.),
el módulo **Lotes y Series** (Inventario → Lotes y Series) permite:

- Registrar lotes o series por producto, con código, tipo (lote/serie),
  fecha de vencimiento opcional y cantidad inicial.
- Ver el estado de cada lote: **Vigente**, **Por vencer** (dentro de los
  próximos 30 días) o **Vencido**, con filtros por Mostrar (con stock / todos /
  agotados / por vencer), búsqueda, categoría y tipo.
- Consumo automático **FEFO (First-Expired-First-Out)**: al emitir una factura
  o boleta, el sistema descuenta primero de los lotes con fecha de vencimiento
  más próxima. Si un producto no tiene lotes registrados, se sigue
  descontando del stock agregado como antes (compatibilidad hacia atrás).
- Al anular un comprobante, las cantidades se restituyen exactamente a los
  lotes de los que se consumieron originalmente (no a un lote genérico).
- Cada movimiento de lote (ingreso, venta, anulación) queda registrado en el
  Kardex (Movimientos de inventario), indicando el lote específico afectado.

Los productos de ejemplo **P005 (Creatina Monohidratada 500gr)** y **P006
(Proteína Whey 1kg)** ya incluyen lotes de muestra para probar el flujo.

## Caja y Bancos (arqueo diario)

La pantalla **Caja y Bancos** (menú superior) muestra el arqueo de caja de un
día seleccionable, separado en dos columnas:

- **Efectivo**: Saldo inicial (editable con el lápiz), Ingresos (Ventas —
  calculado automáticamente desde los comprobantes emitidos con forma de pago
  "Efectivo" — más Cuentas x Cobrar, Transferencias y Otros Ingresos
  registrados manualmente), Egresos (Compras, Cuentas x Pagar, Transferencias,
  Otros Egresos, todos manuales) y el Efectivo Final resultante
  (`saldo inicial + ingresos − egresos`).
- **Tarjeta Banco**: la misma estructura de Ingresos/Egresos, pero cada
  categoría se desagrega en Tarjeta, Banco y Otros (Ventas Tarjeta/Banco se
  calculan automáticamente desde los comprobantes; "Ventas Otros" y el resto
  de categorías se registran manualmente). El Saldo Final es el neto del día
  (no lleva saldo inicial propio).

Cada fila con el botón **+** abre un formulario para registrar un monto y una
descripción; todos los movimientos manuales del día quedan listados (y se
pueden eliminar) en la tabla inferior "Movimientos manuales del día". Las
ventas nunca se registran ahí manualmente: siempre se derivan de la forma de
pago elegida al emitir cada comprobante en Ventas.

## Movimientos: Inventario Físico e Importar Stock Real

Desde Inventario → Movimientos, además del ajuste manual (+/- una cantidad),
hay dos formas más de corregir el stock:

- **Inventario Físico**: eliges un producto, ingresas la cantidad que
  contaste físicamente y el sistema calcula la diferencia contra el stock del
  sistema, ajustándolo automáticamente (si la diferencia es 0 no se registra
  ningún movimiento).
- **Importar Stock Real**: subes un archivo CSV con columnas `codigo` y
  `stock_real` (una fila por producto); el sistema actualiza el stock de cada
  producto encontrado por código y muestra un resumen de cuántos se
  actualizaron y cuáles filas tuvieron error (código no encontrado, etc).

Ambas quedan registradas en el Kardex con la referencia `INV-FISICO` o
`IMPORT-STOCK` para poder auditarlas después.

## Traslados entre sucursales

La app incluye 3 sucursales de ejemplo (Miraflores —la principal—, San Borja
y Jesús María). Inventario → Traslados permite mover productos de una
sucursal a otra:

- El stock **agregado** de cada producto (el que usan Ventas, Movimientos y
  Lotes) no cambia con un traslado — un traslado solo redistribuye cómo ese
  total se reparte entre sucursales. Antes del primer traslado de un
  producto, se asume que el 100% de su stock está en la sucursal principal.
- Al registrar un traslado se valida que la sucursal de origen tenga stock
  suficiente del producto. Se puede anular un traslado, lo que devuelve el
  stock a la sucursal de origen.
- Nota de alcance: por ahora sólo Traslados usa el concepto de sucursal de
  forma funcional; el selector "Sucursal" que aparece en otras pantallas
  (Productos, Movimientos, Ventas) sigue siendo decorativo, tal como estaba
  antes de este módulo.

## Producción (recetas / BOM)

Inventario → Producción permite crear **recetas**: un producto de salida (lo
que se produce) más una lista de insumos (materia prima) con la cantidad que
consume cada uno por lote. Al presionar "Producir" e indicar cuántos lotes:

- Se valida que haya stock suficiente de cada insumo.
- Se descuenta el stock de cada insumo (usando FEFO si el insumo tiene lotes
  registrados, igual que en una venta) y se incrementa el stock del producto
  de salida, todo en una sola transacción.
- Ambos movimientos quedan en el Kardex con la referencia `PROD-00001`, etc.,
  para trazabilidad completa.

Hay una receta de ejemplo ("Envasado Pre-Entreno 30gr") que consume el
producto **P007 (Mix Pre-Entreno a Granel)** para producir **P008
(Pre-Entreno 30gr)**.

## Equivalencias (Lista de Precios)

Al editar un producto (Inventario → Productos → Editar) se puede abrir la
sección **Equivalencias** para definir presentaciones/unidades de conversión
alternativas (ej. "Caja x12" = 12 unidades base), cada una con su propio
precio de venta y mínimo/máximo. El stock disponible en esa presentación se
calcula automáticamente como `stock del producto ÷ factor`.

## Modo oscuro

El ícono de luna en la esquina superior derecha (junto al de Configuración)
alterna entre modo claro y modo oscuro en toda la aplicación, incluyendo la
pantalla de login. La preferencia se guarda en `localStorage` del navegador,
por lo que se mantiene aunque se recargue la página o se cierre sesión.

## Facturación electrónica: modo simulado vs. real (SUNAT)

Por defecto la app opera en **modo simulado**: no hay conexión real a SUNAT/OSE,
y los PDF generados lo indican claramente ("SIMULADO", sin validez tributaria).
Esto es intencional — activar la emisión real requiere trámites y una
contratación que la app no puede hacer por ti.

### Qué necesitas para emitir comprobantes reales

1. **RUC activo**, registrado como **emisor electrónico** en SUNAT (trámite
   gratuito una vez que tengas RUC, se hace en sunat.gob.pe).
2. Una vía de emisión:
   - **SEE-SOL** (gratis, en el portal de SUNAT): sin costo, pero es manual/web
     y **no tiene API** — no se puede integrar con este CRM. Sirve para muy
     bajo volumen mientras defines proveedor.
   - **Un OSE privado** (Nubefact, Facturador Perú, Efact, etc.), desde unos
     S/30–50/mes: **sí tiene API**, es lo que permite que este CRM emita
     automáticamente y reciba la validación de SUNAT en segundos. Es el
     camino recomendado para uso real.
3. Con el OSE contratado, te dan credenciales de **pruebas (sandbox)** y luego
   de **producción**.

### Cómo activarlo en este sistema

El sistema ya incluye un adaptador para **Nubefact** en
`backend/utils/facturacionElectronica.js`. Mientras no configures las
variables de entorno de abajo, todo sigue funcionando exactamente igual que
hoy (modo simulado). Para activarlo:

1. Contrata Nubefact (u otro OSE) y obtén tu **RUC** y **token de API**
   (primero en sandbox: `https://sandbox.nubefact.com`).
2. Agrega estas variables de entorno al backend (en Render: Settings →
   Environment):

   | Variable | Valor |
   | --- | --- |
   | `NUBEFACT_RUC` | tu RUC (el mismo con el que te registraste como emisor electrónico) |
   | `NUBEFACT_TOKEN` | el token de API que te da Nubefact |
   | `NUBEFACT_ENV` | `sandbox` para pruebas, `production` cuando ya validaste que todo funciona |

3. Reinicia el servicio. Al emitir una Factura, Boleta o Nota de Crédito, el
   sistema ahora intentará enviarla a SUNAT vía Nubefact automáticamente. La
   venta **siempre se guarda localmente primero** (stock, kardex, numeración);
   si el envío al OSE falla por cualquier motivo, la venta no se pierde —
   queda marcada como "Error de envío" (visible en Ventas) en vez de
   mostrarse falsamente como aceptada.
4. En Ventas verás el estado real de cada comprobante: **Simulado** (sin
   credenciales configuradas), **Aceptado SUNAT**, **Rechazado SUNAT**, o
   **Error de envío** — con enlaces directos al PDF/XML/CDR oficiales que
   devuelve Nubefact cuando el envío es aceptado.

### ⚠️ Antes de pasar a producción

La integración con Nubefact se construyó siguiendo su documentación pública,
pero **no pudo probarse contra una cuenta real** (no había credenciales
disponibles al momento de escribirla). Antes de usarla con clientes reales:

1. Prueba primero con `NUBEFACT_ENV=sandbox` y una venta de bajo valor.
2. Revisa la respuesta real de Nubefact contra su documentación vigente
   (https://nubefact.com/api/) y ajusta `backend/utils/facturacionElectronica.js`
   si algún nombre de campo cambió.
3. Solo después de confirmar que el sandbox funciona correctamente, cambia
   `NUBEFACT_ENV` a `production` con tus credenciales reales.

Si prefieres otro OSE en vez de Nubefact, el adaptador está aislado en un solo
archivo (`backend/utils/facturacionElectronica.js`) para que sea sencillo
reemplazar la llamada HTTP por la API del proveedor que elijas, sin tocar el
resto del sistema.

## Límite de sedes por plan (`MAX_SUCURSALES`)

Si rentas este CRM a distintas empresas con planes de distinto tamaño (por
ejemplo, "hasta 12 sucursales"), puedes fijar ese tope por variable de
entorno del backend. **No es una opción que Gerencia pueda cambiar desde la
app** — se configura al desplegar la instancia del cliente, para que el
límite acordado sea real y no algo que el propio cliente pueda quitarse.

| Variable | Valor |
| --- | --- |
| `MAX_SUCURSALES` | número máximo de sedes permitidas (ej. `12`) |

Si no defines la variable, no hay límite. Con ella configurada:

- Configuración → Sucursales muestra cuántas sedes lleva usadas la empresa
  frente al máximo del plan.
- El botón "+ Nueva sede" se deshabilita al llegar al tope.
- El backend también rechaza la creación (`POST /api/sucursales`) si de
  todos modos se intenta llegar al límite por otra vía, con un mensaje claro
  indicando que debe contactar a su proveedor para ampliarlo.

## Administración remota de cuentas admin (`PLATFORM_TOKEN`)

Si rentas este CRM a varias empresas, puedes administrar sus cuentas de
Gerencia (activarlas, desactivarlas, restaurar contraseñas, corregir el rol
si alguna quedó mal configurada) desde el **panel central** (`panel-central/`
en este mismo repo, una app separada que despliegas una sola vez para ti).

| Variable | Valor |
| --- | --- |
| `PLATFORM_TOKEN` | secreto largo y aleatorio, único por cada instancia cliente (ej. `openssl rand -hex 32`) |

Sin esta variable, la superficie `/api/platform/*` no existe (404) — ninguna
empresa cliente puede verla ni activarla por su cuenta, y por defecto ningún
cliente queda administrable desde el panel hasta que tú lo configures. Para
habilitarlo en una instancia:

1. Genera un token único para esa empresa y agrégalo como variable de
   entorno `PLATFORM_TOKEN` en su servicio de Render.
2. En el panel central, "+ Nueva empresa" con la URL de Render de esa
   instancia y ese mismo token.

Nunca reutilices el mismo `PLATFORM_TOKEN` en más de un cliente — si se
filtra, solo debe comprometer a esa única empresa.

## Registrar varias empresas en el mismo despliegue (multi-empresa)

Además de rentar una instancia propia por cliente (sección anterior), esta
misma instancia puede alojar **varias empresas a la vez**, cada una con sus
datos completamente aislados, sin necesitar un despliegue de Render aparte
por cada una.

- En `/login` hay un enlace **"Regístrala aquí"** que lleva a `/registro`:
  cualquiera puede dar de alta su empresa (RUC, razón social, y su primera
  cuenta Gerencia).
- Ese registro crea una base de datos propia para esa empresa
  (`backend/data/tenants/<ruc>.db`) pero queda **pendiente de aprobación** —
  no puede iniciar sesión todavía.
- Tú apruebas (o rechazas) el registro llamando a `/api/platform/*` con el
  mismo `PLATFORM_TOKEN` de esta instancia (ver sección anterior):

  ```bash
  # Ver registros pendientes
  curl -H "X-Platform-Token: $PLATFORM_TOKEN" https://tu-instancia.onrender.com/api/platform/registros-pendientes

  # Aprobar uno (a partir de ahí ya puede iniciar sesión)
  curl -X PUT -H "X-Platform-Token: $PLATFORM_TOKEN" https://tu-instancia.onrender.com/api/platform/registros/<RUC>/aprobar

  # Rechazarlo en vez de aprobarlo
  curl -X PUT -H "X-Platform-Token: $PLATFORM_TOKEN" https://tu-instancia.onrender.com/api/platform/registros/<RUC>/rechazar
  ```

- La empresa original de esta instancia (la que ya tenías desplegada antes
  de este cambio) sigue funcionando exactamente igual — nunca pasa por este
  registro ni por la aprobación.
- A diferencia de la instancia de demostración, una empresa recién
  registrada arranca sin datos de ejemplo: solo el catálogo de métodos de
  pago, las series de comprobantes por defecto, una sede ("Sede Principal")
  y el cliente genérico "CLIENTES VARIOS".
- Debe aceptar los **Términos de Servicio** y la **Política de Privacidad**
  (`/terminos`, `/privacidad`) para poder registrarse — la fecha de
  aceptación queda guardada como constancia.
- Desde el **panel central** (`panel-central/`), la pantalla de detalle de
  cada empresa tiene una sección **"Empresas registradas desde 'Registrar
  mi empresa'"** con el historial completo (pendientes, aprobadas y
  rechazadas, con fecha de alta y de aprobación) y botones para
  aprobar/rechazar sin necesitar `curl`.

### Verificación real del RUC contra SUNAT (`RUC_LOOKUP_TOKEN`)

SUNAT no expone una API pública oficial para consultar RUC. El registro
puede verificar el RUC contra un proveedor externo que sí ofrece una API
sobre esos mismos datos públicos ([apis.net.pe](https://apis.net.pe/), con
plan gratuito limitado):

| Variable | Valor |
| --- | --- |
| `RUC_LOOKUP_TOKEN` | token de tu cuenta en apis.net.pe (u otro proveedor compatible) |

- Sin esta variable, el registro sigue funcionando igual que antes: solo
  valida que el RUC tenga 11 dígitos.
- Con la variable configurada, el registro se rechaza si el proveedor
  confirma que el RUC **no existe** o que figura **inactivo** en SUNAT.
- Si el proveedor externo falla o no responde a tiempo, el registro
  **nunca se bloquea** por eso — es una verificación de mejor esfuerzo, no
  un requisito indispensable.

## Estructura del proyecto

```
crm-facturacion/
  backend/     API en Node.js + Express + SQLite (better-sqlite3)
  frontend/    App en React + Vite + React Router + Chart.js
```

## Cómo correrlo

### 1. Backend

```bash
cd backend
npm install
npm start
```

Levanta en `http://localhost:4000`. La base de datos SQLite se crea
automáticamente en `backend/data/crm.db` con datos de ejemplo (clientes,
productos) y un usuario admin la primera vez que se ejecuta.

**Login:** el ingreso es con RUC de la empresa + DNI + contraseña (igual que
en la app de referencia). Mientras la empresa no haya configurado su RUC en
Configuración → Datos de la empresa, el campo RUC no se valida (para no
dejar a Gerencia sin forma de entrar y configurarlo la primera vez).
**Usuario de prueba:** DNI `00000000` / contraseña `admin123` (con
cualquier RUC, hasta que se configure el real).

### 2. Frontend

En otra terminal:

```bash
cd frontend
npm install
npm run dev
```

Levanta en `http://localhost:5173` y ya tiene configurado un proxy hacia el
backend (`/api` → `http://localhost:4000`).

Abre `http://localhost:5173/login` en el navegador.

### 3. Build de producción del frontend

```bash
cd frontend
npm run build
```

Genera los archivos estáticos en `frontend/dist`, listos para servir con
cualquier servidor web (o para que el backend los sirva como estáticos).

Desde este cambio, si `frontend/dist` existe, **el propio backend lo sirve
automáticamente** (`backend/server.js` detecta la carpeta y expone el sitio
completo por la misma URL, ademas de las rutas `/api/...`). Esto permite
desplegar todo como un único servicio.

## Publicarlo gratis en internet (Render, sin tarjeta de crédito)

La app queda como **un solo servicio Node** (API + frontend juntos), lo que
hace muy simple publicarla gratis en [Render](https://render.com) — no pide
tarjeta de crédito y te da una URL propia del tipo
`https://tu-app.onrender.com`.

El repositorio ya incluye `render.yaml` en la raíz, así que no hace falta
subir nada manualmente: solo conecta este repositorio de GitHub a Render.

Pasos:

1. **Crea una cuenta gratis en [render.com](https://render.com)** (puedes
   entrar directamente con tu cuenta de GitHub).
2. En el dashboard de Render, click en **New → Blueprint** y selecciona
   este repositorio (`CRM-FACTURACION-COD`) y la rama que quieras publicar.
   Render va a detectar automáticamente el archivo `render.yaml` en la raíz
   del repo y va a configurar solo el servicio (build command, start
   command, variable `JWT_SECRET` generada de forma segura, etc.).
3. Click en **Apply** / **Deploy**. El primer build tarda unos minutos
   (instala dependencias del frontend, hace el build, instala dependencias
   del backend). Cuando termine, Render te da la URL pública.
4. Entra a esa URL — vas a ver la pantalla de login (RUC + DNI + contraseña).
   Usuario de prueba: DNI `00000000` / contraseña `admin123` (cualquier RUC,
   hasta que configures el real en Configuración → Datos de la empresa).

**Limitaciones del plan gratuito de Render** (importante tenerlas en
cuenta):

- El servicio "duerme" tras 15 minutos sin uso; la siguiente visita tarda
  ~1 minuto en despertar (después responde normal).
- El disco es temporal: no incluye almacenamiento persistente, así que la
  base de datos SQLite (y lo que se registre en ella) se reinicia a los
  datos de ejemplo cada vez que se hace un nuevo deploy (incluido agregar o
  cambiar una variable de entorno). **Antes de cargar datos reales de un
  cliente, activa el disco persistente** (ver siguiente sección) — si no,
  se van a perder en el próximo deploy.

### Activar disco persistente (evita perder los datos en cada deploy)

`render.yaml` ya incluye la configuración de un disco de 1GB montado en
`/var/data`, y el backend lee la variable `DATA_DIR` para saber dónde
guardar la base de datos (por defecto usa una carpeta local, que es lo que
causa el problema de arriba). Para activarlo en una instancia ya
desplegada:

1. Los discos persistentes de Render **no están disponibles en el plan
   Free** — hay que subir ese servicio a un plan pago (el más económico,
   Starter, ronda los $7/mes; el disco de 1GB cuesta centavos extra al mes).
2. En el dashboard de Render, entra al servicio → **Settings** → cambia el
   "Instance Type" de Free a Starter (o el que prefieras).
3. Ve a la pestaña **Disks** → **Add Disk**: Mount Path `/var/data`, tamaño
   1GB (o más).
4. En **Environment**, agrega `DATA_DIR` = `/var/data`.
5. Redeploy. A partir de ahí, los redeploys ya no van a borrar los datos.

Si el servicio se creó vía Blueprint (`render.yaml`), sincronizar el
blueprint después de subir el plan también debería configurar el disco
automáticamente, sin tener que hacerlo a mano.

## Personalización

- **Nombre de la empresa / marca**: editar `frontend/src/components/Layout.jsx`
  (texto "MI EMPRESA S.A.C.") y `frontend/src/pages/Login.jsx`.
- **Colores**: variables CSS en `frontend/src/styles.css` (`--brand-blue`, etc).
- **Íconos del menú**: `frontend/src/pages/Menu.jsx` (actualmente son emojis,
  se pueden reemplazar por SVGs o una librería de iconos como `lucide-react`).
- **Base de datos**: para pasar a PostgreSQL en producción, reemplazar
  `backend/db.js` por un cliente de `pg` y ajustar las consultas (la sintaxis
  SQL usada es muy similar).

## Próximos pasos sugeridos

1. Integración real con un proveedor SUNAT (OSE/PSE).
2. Módulo de Contabilidad / Planillas (evaluar si aplican a tu negocio).
3. Roles de usuario más granulares (actualmente todo usuario autenticado tiene
   acceso completo).
4. Despliegue: contenedores Docker para backend/frontend + base de datos
   administrada.
5. Vincular Compras con Caja y Bancos: hoy el egreso de "Compras" en Caja
   sigue siendo manual (igual que "Cuentas x Pagar"); se podría calcular
   automáticamente desde las compras registradas, igual que ya ocurre con
   las Ventas.
