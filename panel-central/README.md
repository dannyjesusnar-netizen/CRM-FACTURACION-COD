# Panel Central

App de uso exclusivo del dueño del producto (no de las empresas que rentan
el CRM), para aprobar y administrar a los clientes que se registran solos
en `crm-facturacion` (botón "Registrar mi empresa" en el login) y comparten
la misma URL/despliegue — cada uno con su propia base de datos, aislada.

Código separado (login propio, por correo+contraseña, con su propia base
de datos — nunca se mezcla con la de ninguna empresa cliente), pero se
**sirve bajo el mismo dominio** que `crm-facturacion`, en la ruta `/panel`
— no hace falta un link ni un despliegue de Render aparte. Lo monta
`crm-facturacion/backend/server.js` automáticamente cuando encuentra esta
carpeta al lado (mismo repo).

No tiene nada de ventas, facturación ni inventario — solo permite, por cada
empresa registrada (sección "Cuentas registradas"):

- Ver sus datos (razón social, RUC, estado, sucursales).
- Aprobar o rechazar su registro.
- Activar / desactivar su acceso (suspensión, sin perder el historial).
- Asignar el **costo mensual y la fecha de pago** de su suscripción a la
  plataforma — ver "Suscripción a la plataforma" en
  `crm-facturacion/README.md` para el cobro recurrente (Izipay) del lado
  del CRM — y ver sus ingresos totales.
- Ver sus cuentas de empleados y restablecerles la contraseña (a un valor
  por defecto de un clic, o una personalizada).
- Ver los mensajes que le escribieron al asistente ODIN desde su CRM.

## Cómo funciona

Como panel-central corre co-desplegado en el mismo proceso que
`crm-facturacion` (mismo servidor Node, mismo disco), lee los datos de cada
empresa directamente en memoria — sin llamadas HTTP ni tokens de por
medio — resolviendo la base de datos aislada de cada RUC (ver
`localTenants.js` y `crm-facturacion/backend/utils/tenant.js`). Si
panel-central corriera solo, sin `crm-facturacion` al lado, esta sección
queda deshabilitada sin romper nada más del panel.

## Desarrollo local

**Standalone** (solo el panel, en su propio puerto — útil para trabajar
en el panel sin levantar todo el CRM):

```bash
cd panel-central/backend
PANEL_JWT_SECRET=dev npm install && npm run dev   # puerto 4100, sirve /panel

cd panel-central/frontend
npm install && npm run dev                         # puerto 5174, con proxy /panel-api -> 4100
```

Abrí `http://localhost:5174/panel/login` (no la raíz — el frontend está
compilado para vivir bajo `/panel`, igual que en producción).

**Integrado** (como corre en producción): levantá `crm-facturacion/backend`
normalmente — si esta carpeta (`panel-central/`) existe al lado, el panel
queda montado solo, en `http://localhost:<puerto-del-crm>/panel`.

Login inicial sembrado: `dannyjesusnar@gmail.com` / `26344711` — cámbiala
desde "Cambiar contraseña" en el panel apenas ingreses.

## Desplegar en Render

No necesita un Web Service aparte: `render.yaml` compila los dos frontends
(`crm-facturacion` y `panel-central`) y arranca un único servidor
(`crm-facturacion/backend/server.js`), que sirve el CRM en `/` y el panel
en `/panel`. Solo hace falta la variable de entorno `PANEL_JWT_SECRET`
(ya incluida en `render.yaml`, se genera sola) además de las que ya usa
`crm-facturacion`.
