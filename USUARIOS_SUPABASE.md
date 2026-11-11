# Gestión de usuarios con Supabase

La PWA crea invitaciones con la Edge Function `admin-users`. La clave secreta de Supabase se mantiene en el servidor de funciones y nunca se incluye en el navegador.

## Preparar la base de datos

En el SQL Editor de Supabase, ejecuta `sql/05_usuarios_activos.sql`. Esto agrega el campo `usuarios.activo` y hace que los perfiles inactivos no puedan autenticarse en las funciones RLS.

Confirma que los catálogos `tipos_residente` contengan `propietario` y `habitante`, y que existan inmuebles para asociar a residentes.

## Desplegar la invitación segura

Desde PowerShell, en la carpeta `C:\rmeza\PWA`:

```powershell
npx supabase login
npx supabase link --project-ref trsfdydsazavqzrjehsn
npx supabase secrets set PORTAL_ALLOWED_ORIGINS=http://localhost:3000
npx supabase functions deploy admin-users
```

Supabase inyecta las claves del proyecto en Edge Functions. No copies una clave `service_role` o `sb_secret` en `app.js`, en esta PWA ni en el chat.

## Permitir el enlace de invitación

En Supabase, ve a **Authentication → URL Configuration** y añade `http://localhost:3000/` a **Redirect URLs**. Si ejecutas la app con `127.0.0.1`, añade también `http://127.0.0.1:3000/`.

En la configuración de secretos de Edge Functions, define `PORTAL_ALLOWED_ORIGINS` con el origen que usas, por ejemplo `http://localhost:3000`. Para aceptar los dos orígenes, usa `http://localhost:3000,http://127.0.0.1:3000`.

Después de desplegar la función, entra a la PWA como administrador y abre **Usuarios → Invitar usuario**. Para residentes, el formulario permite seleccionar uno o varios inmuebles y uno o más tipos de residente; las asociaciones se guardan en `inmueble_usuarios`. El enlace de invitación permite que la persona defina su contraseña.
