# PSYNC — Contexto del proyecto

## Qué es PSYNC

Plataforma de matching entre pacientes y psicólogos/as en Chile. El diferencial es la **Sesión de Arquitectura**: una conversación real de 1 hora con el equipo PSYNC (no un algoritmo) donde se diseña a mano el match terapéutico. El resultado es entre 2 y 3 opciones de psicólogo/a presentadas en una Sesión de Devolución.

### Las 5 etapas del proceso

1. **Formulario inicial** (~5 min) — el paciente completa sus datos, motivo de consulta y preferencias
2. **Sesión de Arquitectura** (1 hora) — conversación con el equipo PSYNC
3. **Diseño del match** (interno) — se cruzan datos del paciente con perfiles de psicólogos
4. **Sesión de Devolución** (~20 min) — se presentan las opciones al paciente
5. **Primera sesión** — el paciente agenda con tarifa preferencial PSYNC

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Hosting | Netlify (site_id: `6599d071-7c3a-44d6-9967-67e256fb436d`) |
| Base de datos | Supabase (project_id: `ngtkghhjkdrwcxavktxu`) |
| Storage | Supabase Storage (bucket: `pacientes-docs`) |
| Frontend | HTML + CSS + JavaScript vanilla (sin frameworks) |
| Fuentes | Libre Caslon Text (títulos) + Libre Franklin (cuerpo) + IBM Plex Mono (acentos) |
| Código fuente | github.com/psync-com/psync (sin git local — deploy directo por Netlify MCP) |

### Deploy
Sin git instalado localmente. Se despliega con Netlify MCP:
```
npx -y @netlify/mcp@latest --site-id 6599d071-7c3a-44d6-9967-67e256fb436d --proxy-path "<token fresco del MCP>"
```
El proxy-path cambia cada vez — obtener uno nuevo desde la herramienta MCP antes de cada deploy.

### Supabase
- URL: `https://ngtkghhjkdrwcxavktxu.supabase.co`
- Anon key pública (RLS configurado con `anon_all_*` para el rol `anon` en todas las tablas → panel interno y formularios tienen acceso total)
- Cliente compartido en `supabase-client.js` → variable global `psyncDB` (lo usan index/panel/formulario/portal de pacientes)
- **RLS de los portales autenticados**: las políticas nuevas deben ir con rol `anon` (no `public`, que incluye a `authenticated` y anula las políticas acotadas). Los portales autenticados quedan con políticas `psicologo_*` / `paciente_*` / `*_own`. Funciones `SECURITY DEFINER` para lookups cruzados sin recursión: `current_psicologo_id()`, `mis_pacientes_ids()`, `mis_pacientes_ids_por_email()`.

### Pagos (Transbank Webpay Plus)
Netlify Functions en `netlify/functions/`:
- `webpay-init.js` — inicia la transacción (`POST` a `.../transactions`), devuelve `token` + `url` para redirigir al paciente
- `webpay-return.js` — recibe el retorno de Transbank (`token_ws` / `TBK_TOKEN` si el usuario cancela), confirma la transacción (`PUT` a `.../transactions/{token}`) y redirige a `agenda.html?pago=ok|error|cancelado`

Credenciales vía variables de entorno de Netlify (scope `functions`), **no hardcodeadas**: `TBK_COMMERCE_CODE` y `TBK_API_KEY`. Endpoint del ambiente de integración: `https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions` (ojo: **no** `webpay3gw.transbank.cl`, ese dominio no existe). Actualmente configuradas con el código público de pruebas de Transbank (`597055555532`) — al pasar a producción solo hay que cambiar el valor de las variables de entorno, sin tocar el código.

### Correos transaccionales (Resend)
El mail de confirmación de postulación ("Recibimos tu postulación a PSYNC 🌿") ya **no lo manda una Netlify Function** — se envía automático desde un **trigger de Supabase** apenas se inserta la fila en `postulaciones_psicologos`, y esa misma automatización marca `email_confirmacion_enviado = true` y `email_confirmacion_fecha = now()`. (Hubo una versión anterior vía Netlify Function `enviar-mail-postulacion.js` con botón manual en el panel — se retiró en sept. 2026 al automatizarse con el trigger.)

En el panel (`panel.html`, vista de postulaciones), cada card muestra solo texto de estado, sin botón: "✓ Mail enviado [fecha]" o "Mail pendiente" (este último caso solo debería darse si la postulación no tiene email o si el trigger falló).

**Nota sobre `/.netlify/functions/`**: el proyecto no tiene `package.json`/`node_modules` ahí, así que cualquier función nueva debe evitar dependencias npm y usar `fetch` nativo (mismo criterio que `webpay-*.js`).

**"Enviar C-NIP" (vista Red de psicólogos)** — activo desde sept. 2026: el botón (`enviarCnipPsicologo` → `POST /.netlify/functions/send-cnip-psicologo` con `{ psicologo_id, nombre, email }`) envía por Resend el mail "Tu perfil terapéutico — PSYNC" con link a un Google Form (`.../1CvZhe-TfOPZzh_qTEGMCjayZ2YlffGu-N61AfWKnaqQ`, distinto del form de pacientes) y, si el envío fue exitoso, marca `psicologos.cnip_enviado = true`. Función copiada tal cual desde una copia paralela del repo (`Downloads/psync-site/netlify/functions/send-cnip-psicologo.js`, jun. 2026) sin cambios de contenido.

**🚨 Pendiente — agenda caída en producción**: `agenda.html` y `entrevista.html` llaman a `/.netlify/functions/calendar-book` y `calendar-slots` (crean evento en Google Calendar + link Jitsi Meet + mandan mail de confirmación vía Resend). **Ninguna de las dos existe en este proyecto** — confirmado con `GET` directo a `https://psync.cl/.netlify/functions/calendar-book` y `calendar-slots` → 404. Existen versiones completas y compatibles (mismo contrato de payload que usa `agenda.html`) en `Downloads/psync-site/netlify/functions/`, usando las env vars ya configuradas en Netlify (`GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `RESEND_API_KEY`, `RESEND_FROM`). No se sabe si esto se rompió con el deploy de sept. 2026 (el deploy reemplaza el directorio de funciones completo) o si ya estaba caído antes — pendiente restaurar cuanto antes, es el flujo de agendamiento de la Sesión de Arquitectura (paso 2 del proceso).

(`send-entrevista-psicologo.js`, también en esa copia de Downloads, es código obsoleto — no restaurar: `generarLinkEntrevista()` en este proyecto ya no manda mail automático, genera el link en `sesiones` y lo copia al portapapeles a propósito.)

---

## Estructura de archivos

```
psync-site/
├── index.html            # Landing page pública
├── formulario.html       # Formulario de postulación del paciente
├── panel.html            # Panel interno (CEO / equipo PSYNC)
├── portal.html           # Portal del paciente (Supabase Auth email/contraseña)
├── portal-psicologo.html # Portal del psicólogo (Supabase Auth email/contraseña)
├── styles.css            # Hoja de estilos unificada (~1350 líneas)
├── logo.png            # Símbolo de la marca (celeste original) — usado en hero y footer
├── logo-burdeos.png    # Mismo símbolo recoloreado a #4B1E23 — usado en las barras de navegación
├── og-image.png        # Portada 1200×630 para Open Graph / Twitter (símbolo blanco + PSYNC sobre burdeos)
└── supabase-client.js  # Cliente Supabase compartido (psyncDB)
```

---

## Base de datos — Supabase

### Tabla `pacientes`
Columna principal del sistema. Cada fila es un paciente que completó el formulario o fue creado manualmente.

| Columna | Tipo | Notas |
|---------|------|-------|
| id | uuid | PK |
| nombre | text | |
| email | text | |
| telefono | text | |
| edad | int | |
| area | text | Área principal (ansiedad, depresión, etc.) |
| motivo | text | En sus palabras |
| estado | text | Ver estados abajo. Default: `formulario` |
| riesgo | text | `no`, `bajo`, `medio`, `alto`. Default: `no` |
| notas_vinculacion | text | Notas internas del equipo |
| notas_sesion | text | |
| diagnostico | text | |
| medicacion | text | |
| gen_pref | text | Preferencia de género del terapeuta |
| edad_terapeuta | text | |
| modalidad | text | online / presencial / ambas |
| horario | text | |
| presupuesto | int | CLP por sesión |
| poblacion | text | adulto, adolescente, pareja, etc. |
| como | text | Canal de llegada (instagram, google, etc.) |
| historial_terapia | boolean | |
| exp_terapia | text | Experiencia previa en sus palabras |
| estilo_pref | text | Enfoque terapéutico preferido |
| necesidad_calidez | int | 1–5 |
| psicologo_asignado | text | |
| feedback | jsonb | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Estados del proceso** (campo `estado`):
- `formulario` — formulario recibido
- `sesion_coordinada` — sesión de arquitectura coordinada
- `en_diseno` — en diseño de match
- `match_propuesto` — match propuesto al paciente
- `devolucion_coordinada` — sesión de devolución coordinada
- `activo` — activo en terapia
- `cerrado` — cerrado

### Tabla `psicologos`
Red de psicólogos/as de PSYNC.

Columnas clave: `id`, `nombre`, `enfoque`, `especializacion`, `precio_primera`, `precio_normal`, `modalidad`, `calidez`, `estado`

### Tabla `matches`
Vincula pacientes con psicólogos/as propuestos.

Columnas clave: `id`, `paciente_id` (FK pacientes), `psicologo_id` (FK psicologos), `ranking` (1/2/3), `razones` (array text), `estado` (`propuesto` / `aceptado` / `rechazado`)

### Tabla `sesiones`
Agenda de sesiones. Columnas clave: `id`, `paciente_id`, `psicologo_id`, `tipo` (`primera` / `seguimiento` / `arquitectura` / `devolucion` / …), `fecha` (date), `hora_inicio` (text), `duracion_min`, `modalidad`, `estado` (`agendada` / `confirmada` / `realizada` / `cancelada` / `reagendamiento_solicitado`), `meet_link`, `notas`, `nombre`, `email`

### Tabla `fichas_clinicas`
Una ficha (anamnesis / intake) por paciente — `unique (paciente_id)`. Columnas: `paciente_id`, `psicologo_id`, `motivo_consulta`, `anamnesis_proxima`, `anamnesis_remota`, `antecedentes_morbidos`, `antecedentes_familiares`, `examen_mental`, `hipotesis_diagnostica`, `plan_terapeutico`

### Tabla `notas_evolucion`
Nota por sesión en formato SOAP. Columnas: `sesion_id` (FK sesiones), `paciente_id`, `psicologo_id`, `subjetivo`, `objetivo`, `analisis`, `plan`. Sin unique — la app hace insert si no existe, update si ya hay.

### Tabla `postulaciones_psicologos`
Postulaciones a la red recibidas desde `postulacion-psicologo.html` (insert directo vía `psyncDB`, sin intermediarios). Columnas clave: `id`, `nombre`, `email`, `telefono`, `ciudad`, `titulo`, `universidad`, `anio_titulacion`, `anios_experiencia`, `enfoque`, `especializaciones`, `poblaciones`, `modalidad`, `horarios`, `precio_sesion`, `tarifa_psync` (boolean), `motivacion`, `como`, `estado` (`nueva` / `en_revision` / `entrevista_coordinada` / `aprobado` / `no_aprobado`), `psicologo_id` (FK, se llena al aprobar), `fecha_entrevista`, `link_entrevista`, `email_confirmacion_enviado` (boolean, default `false`), `email_confirmacion_fecha` (timestamptz, nullable) — estas dos últimas registran el envío del mail de confirmación (ver sección "Correos transaccionales").

### Supabase Storage — `pacientes-docs`
- Bucket público, límite 20MB por archivo
- RLS: anon puede INSERT, SELECT, DELETE
- Path de archivos: `{paciente_id}/{timestamp}_{nombre_archivo}`

---

## Sistema de diseño (styles.css)

### Variables CSS
```css
--bg: #EBDFDB;           /* Fondo crema/greige (matiz rosado-gris, no amarillo) — también color de texto sobre fondo vino */
--surface: #FDFAF7;      /* Superficies de cards (valor único en todo el sitio) */
--ink: #3D2212;          /* Texto principal marrón oscuro */
--ink-soft: #7A5840;     /* Texto secundario */
--accent: #4B1E23;       /* Vino / merlot — color principal */
--accent-deep: #35161A;  /* Hover del accent */
--accent-vivid: #851B33; /* Solo en index.html — burdeos vivo/saturado para distinguir "Por qué PSYNC" y "Quiénes somos" de los bloques oscuros en --accent (hero, CTA final) */
--teal: #4D7A68;         /* Verde salvia — acento secundario */
--sky: #9BBDCC;          /* Azul polvo — acento terciario */
--sky-deep: #6B9EAF;     /* Azul polvo oscuro */
--dark: #36200C;         /* Marrón casi negro (sidebar del panel) */
--line: #DDD4C8;         /* Bordes suaves */
--line-strong: #C8BDB0;  /* Bordes más visibles */
--font-display: 'Libre Caslon Text', serif;
--font-body: 'Libre Franklin', sans-serif;
--font-mono: 'IBM Plex Mono', monospace;
```

Cada página con `<style>` propio (`index.html`, `portal.html`, `terminos.html`,
`politica-de-privacidad.html`, etc.) repite este mismo `:root` — mantener los
valores sincronizados con `styles.css` al cambiarlos. Google Fonts se importa en
cada HTML: `family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Libre+Franklin:wght@300;400;500;600;700` (las páginas del panel/formulario/booking añaden `family=IBM+Plex+Mono:wght@400;500`).

### Convenciones de color
- **Texto sobre fondo vino** (`background: var(--accent)`): usar `color: var(--bg)` (crema `#EBDFDB`), nunca `#fff`
- **Texto sobre fondo teal** (`background: var(--teal)`): `color: #fff` (excepción intencional)
- **Sombras / tints de marca**: `rgba(75,30,35,α)` (= `#4B1E23`). El antiguo `rgba(107,60,36,α)` (chocolate) ya no se usa
- **Superficies blancas del panel**: `var(--surface)`, no `#FFFFFF`

### Principios de diseño
- **Escala editorial (pasada set. 2026)**: títulos ~15–20% más chicos que el diseño original (hero landing 52px, h2 sección 35px), cuerpo 16px (era 17–18), `line-height` de títulos 1.1–1.15. Padding vertical de sección ~46–64px (era 64–90px).
- **Esquinas**: botones/chips cuadrados llevan `border-radius: 3px`; tarjetas/contenedores `4px`. Las píldoras reales (`.btn`, `.choice`, `.badge`, `.filter-btn`…) siguen en `999px`. Cards ya redondeadas (`12–20px`) sin cambio.
- **Bordes**: líneas de 1.5px/2px bajadas a **1px** (los hairline de 0.5px se mantienen).
- **Botones pill**: `border-radius: 999px` en todos los `.btn`
- **Cards redondeadas**: `border-radius: 12px–20px` con `box-shadow: 0 2px 12px rgba(61,34,18,0.07)`
- **Paleta tierra**: crema claro, vino/merlot, marrón oscuro — minimalista y cálido
- **Tipografía**: Libre Caslon Text para títulos (serif de texto, pesos 400/700), Libre Franklin para cuerpo y labels (grotesca), IBM Plex Mono para etiquetas técnicas
- **Eyebrows tipo chip**: los labels de sección sobre un título (`.eyebrow`, `.step-label`, `.booking-card-label`, `.cnip-eyebrow`, `.porq-card-label`, `.panel-card-title`, `.dash-section-title`) van como chip: fondo `rgba(75,30,35,0.08–0.09)`, texto en `var(--accent)`, formato normal (sin `text-transform`, sin `letter-spacing`), `border-radius: 2px`. Las micro-etiquetas de tabla/filtro/campo del panel siguen en mono mayúsculas.
- **Excepción — eyebrows tipográficos en index.html (rediseño editorial set. 2026)**: `.section-tag` (todas las secciones de index.html, incluyendo "Bienvenido/a", "Cómo funciona", "Por qué PSYNC", "Más información", "Por qué el match importa", "Quiénes somos", "Para psicólogos/as", "Preguntas frecuentes", "El primer paso", "Legal") y `.step-time` dejaron el formato chip: sin `background`, sin `padding`, sin `border-radius`; solo texto — `font-size: 11px`, `letter-spacing: 2px`, `text-transform: uppercase`, color `var(--accent)` sobre fondo claro o `rgba(237,224,212,0.85)` sobre fondo oscuro (overrides en `.porq`, `.quienes`, `.cta-final`). Es la única excepción a la regla de arriba dentro de index.html — `.porq-card-label` (el label de cada tarjeta en "Por qué PSYNC") sigue siendo chip clásico, sin cambio. El resto de las páginas (`portal.html`, `formulario.html`, `panel.html`, etc.) no se tocó y sigue con el chip estándar.
- **Divisores bajo título**: en vez de línea fina de ancho completo, barra corta de `44px × 3px` en `var(--accent)` alineada a la izquierda (`::before`/`::after` sobre `.terminos-subh`, `.quienes-subh`, `.t-section h2`, `.form-header`). Los separadores estructurales de región (`.panel-header`, `.form-section`, `.dash-section`…) se mantienen como hairline.
- **Barra de navegación**: transparente cuando la página está arriba del todo; al hacer scroll >10px se le añade la clase `.scrolled` por JS y pasa a sólida (`var(--surface)`/`var(--bg)` + borde + sombra sutil). Aplica a `nav` (index/términos/privacidad), `header` (formulario/postulación/agenda/entrevista) y `.site-nav` (portal). El símbolo de la marca en el nav va en burdeos vía `content: url(logo-burdeos.png)`; en el hero y el footer sigue el `logo.png` original.

### Clases clave
- `.btn`, `.btn--solid`, `.btn--ghost` — botones principales
- `.panel-card` — cards del panel interno (16px radius, sombra suave)
- `.badge` — etiquetas de estado (pill shape)
- `.panel-save-btn` — botón de guardado interno (pill, vino)
- `.modal-overlay` / `.modal-card` — sistema de modales
- `.estado-pipeline` / `.estado-step` — pills de estado del paciente
- `.upload-zone` — zona de drag & drop para archivos
- `.archivo-item` — fila de archivo en la lista

---

## Panel interno (panel.html)

### Autenticación
- Contraseña hardcodeada: `psync2026`
- Persistencia: `sessionStorage` con clave `psync_panel_auth = '1'`
- Email mostrado: `contacto@psync.cl`

### Layout
```css
/* Estructura crítica — no cambiar */
.panel-shell { display: flex; height: 100vh; overflow: hidden; }
.panel-sidebar { width: 224px; flex-shrink: 0; }
.panel-main { flex: 1; min-width: 0; overflow-y: auto; }
```
El scroll ocurre en `.panel-main`, no en `window`. Usar `document.querySelector('.panel-main').scrollTop = 0` para volver arriba.

### Vistas
- `view-inicio` — dashboard con funnel de proceso, alertas de riesgo alto, últimos 5 pacientes
- `view-lista` — tabla de pacientes con búsqueda, filtros por estado, botón "+ Nuevo paciente"
- `view-detalle` — ficha completa del paciente (oculta por defecto)

### Variables JS globales
```javascript
pacientesList      // array con todos los pacientes cargados
psicologosList     // array con todos los psicólogos
currentPaciente    // paciente abierto en detalle
matchesActuales    // matches del paciente actual
filtroActivo       // filtro activo en vista lista
searchQuery        // búsqueda activa
```

### Funciones clave
- `navigateTo(vista)` — cambia vista, resetea scroll, re-renderiza
- `abrirDetalle(id)` — carga matches y abre ficha del paciente
- `renderDashboard()` — renderiza funnel, alertas, recientes
- `renderListaPacientes()` — aplica filtros y búsqueda
- `renderEstadoPipeline()` — dibuja los pills de estado clickeables
- `cambiarEstadoDesdePanel(estado)` — guarda nuevo estado en Supabase
- `guardarMatch()` — reemplaza matches del paciente
- `guardarNotas()` — guarda notas_vinculacion
- `mostrarModalPaciente()` / `cerrarModal()` / `guardarNuevoPaciente()` — modal de nuevo paciente
- `cargarArchivos()` / `subirArchivos(files)` / `eliminarArchivo(path)` — gestión de archivos en Storage
- `handleDragOver/Leave/Drop` — drag & drop de archivos

---

## Funcionalidades construidas

### Landing page (index.html)
- Hero con blueprint SVG del proceso
- Sección "Cómo funciona" con 5 pasos
- Sección "Por qué PSYNC"
- Sección para psicólogos/as
- FAQ
- CTA final

### Formulario (formulario.html)
- Formulario completo de postulación
- Guarda en tabla `pacientes` via Supabase
- Duración de Sesión de Arquitectura: 1 hora

### Panel interno (panel.html)
- Login con contraseña
- Dashboard con funnel visual por etapa, alertas de riesgo alto, pacientes recientes
- Lista de pacientes con búsqueda, filtros por estado, avatares con iniciales
- Ficha de paciente con toda la información del formulario
- **Pipeline visual de estados**: pills clickeables para mover al paciente entre etapas
- **Gestión de matches**: asignar hasta 3 psicólogos con razones, visualizar estado
- **Notas internas**: textarea guardado en Supabase
- **Subida de archivos**: drag & drop o selección, almacenados en Supabase Storage
- **Crear paciente manualmente**: modal con nombre, email, teléfono, área, estado inicial

### Portal del psicólogo (portal-psicologo.html)
Sección privada donde cada psicólogo/a de la red inicia sesión y ve **solo lo suyo** (RLS filtra por `current_psicologo_id()`, que cruza `auth.email()` con `psicologos.email`).
- **Auth**: Supabase Auth email/contraseña, mismo patrón que `portal.html` (login + reset + nueva contraseña). Sin auto-registro — las cuentas las crea el equipo. Cliente Supabase propio en la página (NO `psyncDB`), con `storageKey: 'psync-psico-auth'` para no pisar la sesión del portal de pacientes. El id del psicólogo se resuelve con `db.rpc('current_psicologo_id')`, nunca asumiendo "la primera fila de `psicologos`".
- **Agenda**: sesiones (`sesiones`) separadas en próximas / realizadas.
- **Pacientes**: lista con datos de contacto.
- **Ficha clínica**: ver y editar los campos de `fichas_clinicas` (crea la ficha si no existe).
- **Notas de evolución**: al abrir una sesión realizada, ver/agregar/actualizar la nota SOAP en `notas_evolucion`.
- Cuenta de prueba: `domingamartinberd@gmail.com` (psicólogo `P013`, 2 pacientes ficticios con fichas y notas de ejemplo).
