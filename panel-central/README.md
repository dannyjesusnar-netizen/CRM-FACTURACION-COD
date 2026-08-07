# Panel Central

App de uso exclusivo del dueño del producto (no de las empresas que rentan
el CRM), para administrar de forma remota las cuentas de Gerencia de cada
instancia cliente de `crm-facturacion` — y, si ese despliegue usa el
registro multi-empresa (ver `crm-facturacion/README.md`), también para
aprobar/rechazar las empresas que se auto-registraron ahí.

Código separado (login propio, por correo+contraseña, con su propia base
de datos — nunca se mezcla con la de ninguna empresa cliente), pero se
**sirve bajo el mismo dominio** que `crm-facturacion`, en la ruta `/panel`
— no hace falta un link ni un despliegue de Render aparte. Lo monta
`crm-facturacion/backend/server.js` automáticamente cuando encuentra esta
carpeta al lado (mismo repo).

No tiene nada de ventas, facturación ni inventario — solo permite, por cada
empresa registrada:

- Ver sus datos (razón social, nombre comercial, RUC, teléfono).
- Ver todas sus cuentas de empleados (no solo Gerencia) con su rol y estado.
- Activar / desactivar una cuenta.
- Restaurar la contraseña de una cuenta.
- Restaurar el rol "Gerencia" de una cuenta (por si quedó mal configurada y
  ya nadie en esa empresa puede repararlo desde dentro de su propio CRM).
- Aprobar o rechazar las empresas que se auto-registraron (multi-empresa).
- Asignar el **costo mensual de suscripción** de cada empresa registrada —
  ver "Suscripción a la plataforma" en `crm-facturacion/README.md` para el
  cobro recurrente (Culqi) del lado del CRM.

## Cómo funciona

No existe una base de datos compartida entre instancias de Render — cada
cliente tiene la suya, completamente aislada. El panel central llama por
HTTP, servidor a servidor, a una pequeña superficie protegida que cada
instancia de `crm-facturacion` expone en `/api/platform/*`, autenticada con
un secreto (`PLATFORM_TOKEN`) que tú configuras al desplegar cada cliente.
El navegador nunca llama directo a la instancia del cliente ni ve ese
secreto — solo pasa por el backend del panel.

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

Si preferís desplegarlo como servicio totalmente aparte (otra URL), podés
seguir usando `panel-central/backend/server.js` como start command con su
propio build command — queda funcionando igual, solo que en su propio
dominio en vez de bajo `/panel` del CRM.

## Dar de alta una empresa cliente

1. Genera un secreto único para esa empresa: `openssl rand -hex 32`.
2. En el servicio de Render de esa empresa, agrega la variable de entorno
   `PLATFORM_TOKEN` con ese secreto, y redespliega.
3. En el panel central, "+ Nueva empresa": nombre, RUC, teléfono (solo para
   identificarla en la lista), la URL de Render de esa instancia, y el
   mismo `PLATFORM_TOKEN` que configuraste ahí.
4. Entra al detalle de esa empresa y confirma que cargan sus datos y
   cuentas — eso confirma que la URL y el token están bien.

Nunca reutilices el mismo `PLATFORM_TOKEN` en dos empresas distintas.
