# Panel Central

App separada, de uso exclusivo del dueño del producto (no de las empresas
que rentan el CRM), para administrar de forma remota las cuentas de
Gerencia de cada instancia cliente de `crm-facturacion`.

No tiene nada de ventas, facturación ni inventario — solo permite, por cada
empresa registrada:

- Ver sus datos (razón social, nombre comercial, RUC, teléfono).
- Ver todas sus cuentas de empleados (no solo Gerencia) con su rol y estado.
- Activar / desactivar una cuenta.
- Restaurar la contraseña de una cuenta.
- Restaurar el rol "Gerencia" de una cuenta (por si quedó mal configurada y
  ya nadie en esa empresa puede repararlo desde dentro de su propio CRM).

## Cómo funciona

No existe una base de datos compartida entre instancias de Render — cada
cliente tiene la suya, completamente aislada. El panel central llama por
HTTP, servidor a servidor, a una pequeña superficie protegida que cada
instancia de `crm-facturacion` expone en `/api/platform/*`, autenticada con
un secreto (`PLATFORM_TOKEN`) que tú configuras al desplegar cada cliente.
El navegador nunca llama directo a la instancia del cliente ni ve ese
secreto — solo pasa por el backend del panel.

## Desarrollo local

```bash
cd panel-central/backend
PANEL_JWT_SECRET=dev npm install && npm run dev   # puerto 4100

cd panel-central/frontend
npm install && npm run dev                         # puerto 5174, con proxy a 4100
```

Login inicial sembrado: `dannyjesusnar@gmail.com` / `26344711` — cámbiala
desde "Cambiar contraseña" en el panel apenas ingreses.

## Desplegar en Render

Este repo ya incluye el servicio `panel-central` en `render.yaml`, hermano
del servicio `crm-facturacion`. Si tu servicio actual de Render fue creado
manualmente (no vía Blueprint), tendrás que crear este segundo Web Service
a mano en el dashboard de Render apuntando a este mismo repositorio, con:

- Build command: `cd panel-central/frontend && npm install --include=dev && npm run build && cd ../backend && npm install`
- Start command: `node panel-central/backend/server.js`
- Health check path: `/api/health`
- Variable de entorno `PANEL_JWT_SECRET` (genera un valor aleatorio).

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
