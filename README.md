# Gestor de Predicación en Condominios

Aplicación web progresiva (PWA) ligera, adaptable a teléfonos, tablets y computadores, diseñada para ayudar a la congregación a organizar de forma metódica las cartas, visitas, exclusiones y asignaciones en condominios y torres de departamentos.

---

## 1. ¿Qué hace y para qué sirve?

En muchos condominios el acceso puerta a puerta está restringido y se predica mediante cartas, llamadas o visitas coordinadas. Esta herramienta permite:

- **Consultar territorios por condominio, torre y piso:** Visualiza el avance general y por edificio de un vistazo.
- **Distribuir departamentos equitativamente:** Asigna publicadores respetando un **límite máximo** por persona y una **distancia mínima** entre departamentos asignados a un mismo hermano (evitando asignar puertas contiguas).
- **Respetar exclusiones y asignaciones fijas:** Marca departamentos como *Deshabitado* o *Solicitado por ocupante* (`🚫`) y fija asignaciones permanentes (`📌`).
- **Consulta rápida por publicador ("Mis deptos"):** Cada hermano puede ver únicamente sus departamentos asignados y copiar su lista con un toque.
- **Seguimiento local en campo:** En modo consulta, un publicador puede anotar los departamentos trabajados en su dispositivo y copiar un reporte listo para enviar por WhatsApp al encargado de territorios.
- **Panel de Administración conectado a GitHub:** El administrador autenticado actualiza la información desde la propia aplicación y los cambios se publican en los archivos JSON del repositorio para toda la congregación.

---

## 2. Tecnologías utilizadas

Se priorizó la simplicidad, rapidez y bajo mantenimiento sin frameworks complejos ni servidores externos:

- **HTML5 semántico** y accesible.
- **CSS3 modular** con variables de diseño y enfoque *mobile-first* (sin dependencias externas ni CDN).
- **JavaScript nativo (ES Modules)** sin pasos de compilación (`build`).
- **Archivos JSON** en la carpeta `data/` como base de datos ligera.
- **GitHub Pages + GitHub API + GitHub Actions** para alojamiento, persistencia atómica y validación.
- **PWA (Service Worker + Web App Manifest)** para instalación móvil y consulta sin conexión.

---

## 3. Estructura de archivos

```text
.
├── index.html                  # Página principal (Consulta pública + Panel Admin)
├── manifest.json               # Configuración de aplicación instalable (PWA)
├── sw.js                       # Service Worker para caché offline y actualizaciones
├── .nojekyll                   # Evita procesamiento innecesario en GitHub Pages
├── README.md                   # Esta guía
├── backup_original/            # Respaldo intacto del archivo HTML original (v0.2.2)
├── assets/
│   ├── icons/                  # Iconos PNG y SVG para navegador, Android e iOS
│   └── images/                 # Ilustración vectorial local del encabezado
├── css/
│   ├── variables.css           # Colores, paleta de publicadores y tokens de diseño
│   ├── main.css                # Reglas base, tipografía y accesibilidad
│   ├── layout.css              # Encabezado, pestañas y cuadrículas responsivas
│   ├── components.css          # Tarjetas, mapa de pisos, botones, modales y toasts
│   └── admin.css               # Estilos del panel de administración
├── js/
│   ├── app.js                  # Inicialización, navegación, SW y estado de conexión
│   ├── core/
│   │   ├── state.js            # Estado central, normalización y reglas de autorización
│   │   ├── ui-feedback.js      # Notificaciones (toasts) y diálogos de confirmación
│   │   └── utils.js            # Sanitización XSS, parseo de pisos y utilidades
│   ├── modules/
│   │   ├── assignments.js      # Algoritmo de distribución equitativa con distancia mínima
│   │   ├── modals.js           # Ventanas de creación, edición, exclusiones y detalle
│   │   ├── publishers.js       # Pestaña de publicadores y resumen "Mis deptos"
│   │   └── territories.js      # Pestaña de condominios, torres y mapa de departamentos
│   ├── services/
│   │   ├── database.js         # Lectura, validación y exportación/importación JSON
│   │   ├── github.js           # Conexión segura y commits atómicos con GitHub API
│   │   └── storage.js          # Caché offline local y migración desde v0.2.2
│   └── admin/
│       ├── admin.js            # Sesión administrativa, sincronización y respaldos
│       └── admin-ui.js         # Interfaz del panel de administración
├── data/
│   ├── condominios.json        # Condominios, torres y departamentos
│   ├── hermanos.json           # Publicadores registrados y colores
│   ├── configuracion.json      # Título, congregación y parámetros por defecto
│   └── schema.json             # Documentación estructural de los JSON
└── .github/
    └── workflows/
        ├── validate-data.yml   # Valida sintaxis JSON automáticamente al guardar cambios
        └── deploy-pages.yml    # Publica el sitio automáticamente en GitHub Pages
```

---

## 4. Cómo ejecutar localmente

Como la aplicación usa módulos JavaScript (`type="module"`) y carga archivos JSON mediante `fetch`, **no la abras haciendo doble clic directo (`file://`)** porque el navegador bloqueará las lecturas por seguridad.

Ejecuta un servidor local sencillo desde la carpeta del proyecto:

```bash
python3 -m http.server 8080
```

Luego abre en tu navegador: `http://localhost:8080`.

> En `localhost`, la pestaña **Admin** ofrece también un botón **"Entrar en Modo Pruebas Local"** para probar formularios, asignaciones y exportación JSON sin necesidad de conectar una cuenta de GitHub. En producción (`*.github.io`), solo se permite acceso mediante token válido de GitHub.

---

## 5. Cómo publicar en GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `condominios`) y sube todos los archivos del proyecto a la rama `main`.
2. En tu repositorio de GitHub, ve a **Settings ➔ Pages**.
3. En **Build and deployment ➔ Source**, selecciona **GitHub Actions**.
4. El flujo `.github/workflows/deploy-pages.yml` publicará la aplicación automáticamente en cada cambio sobre `main`.
5. Tu aplicación quedará disponible en:
   - `https://tu-usuario.github.io/nombre-del-repositorio/` (o `https://tu-usuario.github.io/` si el repositorio se llama exactamente `tu-usuario.github.io`).

Todas las rutas del proyecto son relativas (`./`), por lo que funciona en ambos formatos de URL sin modificar nada.

---

## 6. Cómo instalar como aplicación (PWA)

- **Android (Chrome / Edge):** Abre la URL en el navegador y toca el botón **"📲 Instalar App"** que aparece en el encabezado, o abre el menú `⋮` ➔ *Instalar aplicación*.
- **Computador (Chrome / Edge):** Haz clic en el icono de instalación en la barra de direcciones o en **"📲 Instalar App"**.
- **iPhone / iPad (Safari):** Toca el botón **Compartir** (cuadro con flecha hacia arriba) y selecciona **Agregar a pantalla de inicio**.

### Funcionamiento sin conexión
- Una vez abierta la aplicación con internet, la interfaz queda guardada en caché y la última versión descargada de `data/*.json` se guarda localmente.
- Si estás sin internet, verás un aviso amarillo indicando **"Modo sin conexión"** junto con la fecha y hora de la última copia descargada.
- Al recuperar conexión, toca **↻ Actualizar** para verificar novedades en GitHub.

---

## 7. Cómo funciona el almacenamiento y la privacidad

### Almacenamiento compartido en GitHub
- Todos los hermanos consultan la información desde `data/condominios.json`, `data/hermanos.json` y `data/configuracion.json`.
- Cuando el administrador publica cambios desde la app, esta utiliza **GitHub Git Data API** para guardar los tres archivos en **un único commit atómico**, evitando datos inconsistentes y detectando si otro administrador modificó el repositorio antes.

### Seguridad de credenciales y privacidad
- **Nunca se guardan contraseñas ni tokens** en el código fuente, ni en `localStorage`, ni en `IndexedDB`, ni en archivos JSON públicos.
- El token administrativo vive **únicamente en la memoria RAM** de la pestaña activa y se borra al cerrar sesión o cerrar la ventana.
- **Protección de datos personales:** Si el repositorio de GitHub es **público**, se recomienda registrar a los publicadores usando nombre corto o iniciales (ej. `Hno. Carlos M.`). Además, la opción de privacidad activa por defecto **omite automáticamente los teléfonos de contacto** al subir `hermanos.json` a un repositorio público (aunque sí los conserva si exportas un respaldo local privado). Si necesitas compartir teléfonos dentro de la app, considera usar un repositorio privado con GitHub Pages privado (plan Pro/Team).

---

## 8. Cómo configurar y usar el Panel de Administración

Existen dos métodos compatibles para iniciar sesión como administrador (puedes tener ambos activos a la vez):

### Opción A: Cuentas con Usuario y Contraseña (Cloudflare Worker gratuito — recomendado para varios administradores)
Permite crear cuentas como `RLuna` con su propia contraseña para entrar y editar todo sin compartir tu Token de GitHub ni exponer contraseñas en archivos públicos.

1. Crea una cuenta gratuita en [Cloudflare Workers](https://workers.cloudflare.com/) y crea un nuevo Worker pegando el código de `worker/cloudflare-worker.js`.
2. En **Settings ➔ Variables and Secrets** del Worker, configura:
   - **`GITHUB_OWNER`** (texto): tu usuario GitHub (ej. `KuyenDev`).
   - **`GITHUB_REPO`** (texto): nombre del repositorio (ej. `condominiosMirasur`).
   - **`GITHUB_BRANCH`** (texto): `main`.
   - **`ALLOWED_ORIGIN`** (texto): tu URL de GitHub Pages sin barra final (ej. `https://kuyendev.github.io`).
   - **`GITHUB_TOKEN`** (**Secret**): un Fine-Grained Token tuyo con permiso `Contents: Read and write` solo para este repositorio.
   - **`SESSION_SECRET`** (**Secret**): una frase aleatoria larga y secreta (mínimo 32 caracteres).
   - **`ADMIN_USERS_JSON`** (**Secret**): el JSON de usuarios y hashes generado desde el **Panel Admin ➔ Cuentas con Usuario y Contraseña** (por ejemplo `[{"username":"RLuna","hash":"pbkdf2$100000$..."}]`).
3. Copia la URL pública de tu Worker (`https://....workers.dev`).
4. Entra una vez a **🔐 Admin** con tu **Token de GitHub** (Opción B), pega la URL del Worker en **Configuración de la Congregación ➔ URL del servidor de acceso**, guarda en sesión y pulsa **☁️ Publicar cambios en GitHub**.
5. Desde ese momento, cualquier hermano con cuenta en `ADMIN_USERS_JSON` solo escribe su **Usuario** y **Contraseña** en **🔐 Admin**.

### Opción B: Token directo de GitHub (uso técnico / respaldo)
1. Inicia sesión en tu cuenta de GitHub (la dueña o administradora del repositorio).
2. Ve a **Settings ➔ Developer settings ➔ Personal access tokens ➔ Fine-grained tokens**.
3. Pulsa **Generate new token**.
4. Configura:
   - **Token name:** `Admin Condominios`
   - **Expiration:** Elige la duración que prefieras (ej. 90 días o 1 año).
   - **Repository access:** Elige **Only select repositories** y selecciona únicamente este repositorio.
   - **Permissions ➔ Repository permissions ➔ Contents:** selecciona **Read and write**.
5. Genera el token y guárdalo en un gestor de contraseñas seguro (como Bitwarden o el llavero de tu teléfono).

### Uso habitual desde la aplicación
1. Abre la pestaña **🔐 Admin**.
2. Verifica el usuario y repositorio (en GitHub Pages se completan automáticamente) y pega tu token.
3. Una vez dentro, puedes ir a **Territorios** o **Publicadores** para:
   - Crear/editar condominios y torres (incluye generador rápido de pisos).
   - Configurar exclusiones (`🚫`) y asignaciones automáticas equitativas (`👥 Asignar`).
   - Cambiar el modo de toque en una torre entre **✓ Completar rápido** y **✏️ Editar / Fijar 📌** para asignar manualmente o fijar departamentos.
   - Reiniciar el ciclo de una torre cuando se complete al 100%.
4. Al terminar tus cambios, vuelve a **🔐 Admin** y pulsa **☁️ Publicar cambios en GitHub**.
5. Espera ~1 minuto para que GitHub Pages actualice el sitio público.

> **¿Ya usabas la versión anterior (`Deptos 0.2.2.html`)?** Si la abriste en el mismo navegador, el panel de administración detectará automáticamente tus datos antiguos y te mostrará un botón **"Importar datos de la v0.2.2"** para migrarlos sin perder nada.

---

## 9. Respaldos y restauración

- **Generar respaldo:** En **🔐 Admin**, pulsa **⬇️ Descargar respaldo completo (.json)**. Guarda ese archivo en tu computador o nube personal.
- **Actualización manual (alternativa sin token en app):** Puedes usar **📄 Exportar JSON para /data** y subir los tres archivos directamente en la carpeta `data/` de tu repositorio en GitHub.
- **Restaurar información:** En **🔐 Admin**, usa **⬆️ Importar respaldo (.json)** y selecciona tu archivo. La app validará la estructura, pedirá confirmación y guardará un punto de recuperación temporal (**↩️ Deshacer última importación**) por si te equivocas de archivo. Luego pulsa **☁️ Publicar cambios en GitHub**.

---

## 10. Solución de problemas frecuentes

- **Hice cambios y los publiqué en GitHub, pero otro hermano aún ve los datos anteriores:**
  1. GitHub Pages tarda entre 30 y 90 segundos en reconstruir el sitio tras un commit.
  2. Pide al hermano pulsar el botón **↻ Actualizar** en el encabezado de la app.
- **Me aparece un error de conflicto al publicar en GitHub:**
  Otro administrador guardó cambios después de que abriste tu sesión. Pulsa **↻ Recargar desde GitHub** o descarga primero un respaldo JSON de tus cambios, recarga y aplica nuevamente.
- **No aparece el botón "Instalar App":**
  En iPhone/iPad Safari no muestra ese botón; usa *Compartir ➔ Agregar a pantalla de inicio*. En Android o PC asegúrate de abrir la URL con `https://` (en GitHub Pages siempre es HTTPS).
- **Error `Token inválido` o `Permisos insuficientes`:**
  Verifica que el Fine-Grained Token tenga seleccionado exactamente este repositorio y el permiso **Contents: Read and write** (no solo Read-only), y que no haya expirado.

