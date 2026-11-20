# Inventario · Hotel Misión San Gil

Sistema web de control de inventarios para el almacén general del Hotel Misión San Gil (San Gil, Querétaro).
Es una aplicación **estática** (HTML, CSS y JavaScript) que se publica con GitHub Pages y guarda sus datos en **Supabase** (PostgreSQL con autenticación y permisos por rol).

## Estructura del repositorio

```
inventario-hotel-san-gil/
├── index.html            Página principal: inicio de sesión y aplicación
├── css/style.css         Estilos (paleta corporativa, modo oscuro, responsivo)
├── js/
│   ├── config.js         URL y clave pública de Supabase (lo editas tú)
│   ├── db.js             Única capa que habla con Supabase
│   └── js.js             Interfaz: módulos, reportes Excel y sesión
├── assets/logo.png       Logotipo original del hotel
├── supabase/
│   ├── schema.sql        Tablas, roles, permisos (RLS) y validaciones
│   └── seed.sql          Datos de demostración (opcional)
├── .nojekyll             Indica a GitHub Pages que sirva todos los archivos
└── .gitignore
```

## 1. Crear el proyecto en Supabase (gratuito)

1. Entra a <https://supabase.com>, crea un proyecto y espera a que termine de iniciarse.
2. Ve a **SQL Editor > New query**, pega el contenido de `supabase/schema.sql` y pulsa **Run**.
3. (Opcional) Repite con `supabase/seed.sql` para cargar los productos y proveedores de demostración.
4. Ve a **Authentication > Sign In / Providers > Email** y **desactiva "Allow new users to sign up"**. Así solo el administrador crea cuentas.
5. Ve a **Authentication > Users > Add user > Create new user**, crea la cuenta del administrador con una contraseña de al menos 12 caracteres.
6. En el **SQL Editor** cambia su rol a administrador (sustituye el correo):
   ```sql
   update profiles set rol = 'admin'
   where id = (select id from auth.users where email = 'correo@hotel.mx');
   ```
7. Ve a **Project Settings > API** y copia la **Project URL** y la clave **anon public**.

## 2. Configurar la aplicación

Edita `js/config.js` con los datos del paso 7:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...'
};
```

La clave **anon** es pública por diseño: la seguridad real la aplican las políticas de `schema.sql`. **Nunca** pongas la clave `service_role` en este repositorio.

## 3. Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube todos los archivos de esta carpeta.
2. Ve a **Settings > Pages**, en *Source* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. En unos minutos la app estará en `https://tu-usuario.github.io/nombre-del-repositorio/`.
4. En Supabase, **Authentication > URL Configuration**, agrega esa URL en *Site URL* si quieres que los enlaces de recuperación apunten a ella.

Para trabajar desde varios dispositivos, basta con clonar el repositorio (`git clone`) o abrir la URL de Pages. Los datos siempre están en Supabase, así que se ven iguales en todos los equipos.

## 4. Roles y permisos

| Rol | Puede |
|---|---|
| **Administrador** | Todo, incluido eliminar productos y proveedores, gestionar áreas y cambiar roles |
| **Encargado de almacén** | Registrar entradas, salidas, productos y proveedores; consultar reportes |
| **Usuario de consulta** | Ver existencias, movimientos, proveedores y reportes; no modifica nada |

Los movimientos (entradas y salidas) **no se pueden editar ni borrar** desde la aplicación: así se conserva la trazabilidad.

## Seguridad

Lo que protege el sistema, en capas:

- **Autenticación** con Supabase Auth (contraseñas cifradas, nunca se guardan en el navegador en texto plano).
- **Autorización en la base de datos**: políticas RLS por rol. Aunque alguien modifique el código de la página, el servidor rechaza las operaciones no permitidas (probado con Postgres real).
- **Existencias validadas en el servidor**: ninguna salida puede dejar el stock en negativo, ni siquiera con dos operaciones simultáneas.
- **Operaciones atómicas**: una entrada o salida con varios artículos se guarda completa o no se guarda.
- **Anti-XSS**: todo dato mostrado se escapa, y la política de contenido (CSP) bloquea scripts externos no autorizados.
- **Librerías verificadas** con SRI (`integrity`): si el archivo del CDN cambia, el navegador no lo ejecuta.
- **Cierre de sesión automático** tras 15 minutos de inactividad.
- **Mensajes de error genéricos**: no se muestran detalles internos de la base de datos.

### Buenas prácticas que debes seguir

- Usa contraseñas de 12 o más caracteres; activa la verificación en dos pasos en tu cuenta de GitHub y de Supabase.
- Revisa periódicamente **Authentication > Users** y desactiva cuentas de personal que ya no trabaje en el hotel.
- Activa copias de seguridad diarias en Supabase (plan de pago) o exporta reportes periódicamente.
- Si una clave se expone, regénerala en **Project Settings > API** y actualiza `config.js`.
- Las librerías de terceros están fijadas a una versión exacta. Para actualizarlas, cambia la versión y recalcula el hash `integrity`.

## Limitaciones conocidas

- GitHub Pages no permite cabeceras HTTP personalizadas, así que la protección contra incrustación en otros sitios (`frame-ancestors`) no se puede aplicar desde la página.
- Aún no están implementados: PEPS con fechas de vencimiento, inventario físico con comparación de diferencias, y edición o cancelación de operaciones con autorización.
