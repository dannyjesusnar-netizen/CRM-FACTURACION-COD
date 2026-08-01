# CRM Facturación

Sistema de ventas / CRM inspirado en el flujo de RapiFac (menú principal con
módulos, ventas con comprobantes electrónicos, dashboard y reportes), construido
con diseño y código propios.

## Módulos incluidos (MVP)

- **Login** con usuario y contraseña.
- **Menú principal** estilo grid de módulos (con "Próximamente" para los módulos
  que no se implementaron en esta primera versión: Compras, Finanzas,
  Conciliación, Contabilidad, Planillas, Asistencias, Configuración).
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
  `vendedor1` / `vendedor123` (Carlos Ramírez) y `vendedor2` / `vendedor123`
  (Lucía Fernández). Cada venta queda asociada al usuario que la emitió.

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

## Importante: modo simulado

La facturación electrónica se genera en **modo simulado**: no hay conexión real
a SUNAT/OSE. Los PDF generados indican claramente que no tienen validez
tributaria. Cuando quieras emitir comprobantes reales, hay que integrar un
proveedor OSE/PSE (ej. Nubefact, Facturación Perú) en `backend/routes/invoices.js`
y `backend/utils/pdf.js`.

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

**Usuario de prueba:** `admin` / `admin123`

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

Pasos:

1. **Sube el código a GitHub** (si no tienes cuenta, créala gratis en
   [github.com](https://github.com)):
   - Crea un repositorio nuevo (puede ser privado).
   - Sube todo el contenido de esta carpeta (`crm-facturacion/`) — puedes
     arrastrar los archivos desde la web de GitHub ("Add file → Upload
     files") o usar `git push` si ya usas Git.
2. **Crea una cuenta gratis en [render.com](https://render.com)** (puedes
   entrar directamente con tu cuenta de GitHub).
3. En el dashboard de Render, click en **New → Blueprint** y selecciona el
   repositorio que subiste. Render va a detectar automáticamente el archivo
   `render.yaml` incluido en este proyecto y va a configurar solo el
   servicio (build command, start command, variable `JWT_SECRET` generada
   de forma segura, etc.).
4. Click en **Apply** / **Deploy**. El primer build tarda unos minutos
   (instala dependencias del frontend, hace el build, instala dependencias
   del backend). Cuando termine, Render te da la URL pública.
5. Entra a esa URL — vas a ver la pantalla de login. Usuario de prueba:
   `admin` / `admin123`.

**Limitaciones del plan gratuito de Render** (importante tenerlas en
cuenta):

- El servicio "duerme" tras 15 minutos sin uso; la siguiente visita tarda
  ~1 minuto en despertar (después responde normal).
- El disco es temporal: no incluye almacenamiento persistente, así que la
  base de datos SQLite (y lo que se registre en ella) se reinicia a los
  datos de ejemplo cada vez que se hace un nuevo deploy. Para un uso real
  de largo plazo con datos que deban conservarse siempre, más adelante
  conviene mover la base de datos a un servicio con almacenamiento
  persistente (ej. Render con disco pago, o una base de datos administrada
  como PostgreSQL) y/o pasar a un dominio propio.

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

1. Módulo de Compras e Inventario con kardex.
2. Integración real con un proveedor SUNAT (OSE/PSE).
3. Módulo de Contabilidad / Planillas (evaluar si aplican a tu negocio).
4. Roles de usuario más granulares (actualmente todo usuario autenticado tiene
   acceso completo).
5. Despliegue: contenedores Docker para backend/frontend + base de datos
   administrada.
