# Fase 0 — Guía de ejecución (HU-00.1, HU-00.2, HU-00.3)

> Este documento es un **runbook ejecutable**: a diferencia de
> `plan-desarrollo.md` (que explica el qué y el porqué), acá cada paso trae
> el comando exacto o la acción exacta a realizar, para que un agente pueda
> ejecutarlo sin tener que tomar decisiones de diseño por su cuenta. Todas
> las decisiones ambiguas del plan (gestor de paquetes, estructura de
> carpetas, nombre del repo, valores exactos de tokens) ya están resueltas
> acá abajo.

## 0. Decisiones ya tomadas (no hace falta volver a decidirlas)

| Decisión | Valor |
|---|---|
| Gestor de paquetes | `npm` (viene con Node, cero setup adicional) |
| Node.js requerido | `20.x` LTS o superior |
| Estructura | con carpeta `src/` |
| Router | App Router (`src/app`) |
| TypeScript | sí, modo estricto (el que trae `create-next-app` por defecto) |
| ESLint | sí |
| Tailwind | sí (Tailwind v4, CSS-first config — es lo que trae `create-next-app` por defecto a esta fecha) |
| Alias de imports | `@/*` apuntando a `src/*` |
| Nombre del repo GitHub | `escrutinio` (público) |
| Rama por defecto | `main` |
| Licencia | MIT |

## 1. HU-00.1 — Inicializar repositorio y proyecto base

### 1.1 Crear el repositorio remoto en GitHub

Requiere que `gh` (GitHub CLI) esté instalado y autenticado
(`gh auth status`; si no lo está, correr `gh auth login` de forma
**interactiva antes de continuar** — este paso puntual no lo puede resolver
un agente sin intervención tuya, porque abre un flujo de login en el
navegador).

Después de loguearse, correr también `gh auth setup-git` — sin esto, `git
push` puede fallar con `could not read Username for 'https://github.com'`
porque git no queda enterado de que debe usar las credenciales de `gh`.

Si no tenés configurado un nombre/email de git globalmente (`git config
--global user.name` / `user.email` no devuelven nada), configurarlos antes
del primer commit. Si tu perfil de GitHub no tiene un email público, usar
el email privado que GitHub genera automáticamente
(`<tu-id-numerico>+<usuario>@users.noreply.github.com`, con el ID que
devuelve `gh api user --jq '.id'`) para que los commits se asocien a tu
perfil sin exponer tu email real en un repo público.

Con `gh` ya autenticado, desde la carpeta actual del proyecto
(`/Users/joseoviedo/Documents/Personal/fs-practica/proyectos/escrutinio`,
que ya contiene la carpeta `docs/`), primero inicializar git localmente
(`gh repo create --source=.` lo requiere) y recién ahí crear el repo:

```
git init -b main
gh repo create escrutinio --public --source=. --remote=origin
```

Esto crea el repo en GitHub y deja configurado el remoto `origin` apuntando
a él, sin pushear nada todavía (eso pasa al final de este paso).

### 1.2 Verificar prerequisitos locales

```
node -v
```
Debe reportar `v20.x` o superior. Si no, instalar/activar esa versión antes
de continuar (por ejemplo con `nvm install 20 && nvm use 20`).

### 1.3 Generar el proyecto Next.js

Ejecutar desde la raíz del proyecto (la carpeta ya tiene `docs/`, así que
`create-next-app` va a avisar que el directorio no está vacío — es
esperado, continuar):

```
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"
```

Si el comando pregunta interactivamente por algo no cubierto por los flags
de arriba, elegir siempre la opción por defecto sugerida.

### 1.4 Confirmar que corre localmente

```
npm run dev
```
Abrir `http://localhost:3000` y confirmar que carga la página por defecto
de Next.js sin errores en la consola del navegador ni en la terminal.
Detener el servidor (Ctrl+C) antes de seguir.

> Nota descubierta al ejecutar esto: si ya tenés otro proceso escuchando en
> el puerto 3000 (por ejemplo otro proyecto corriendo en la misma máquina),
> `127.0.0.1:3000` puede responder con ese otro proceso en vez de con Next.
> Si pasa, correr `lsof -nP -iTCP:3000 -sTCP:LISTEN` para identificarlo y,
> en vez de matarlo a ciegas, levantar este proyecto en otro puerto con
> `npm run dev -- -p 3010` (o el que esté libre).

### 1.5 Revisar `.gitignore`

Abrir el `.gitignore` generado por `create-next-app` y confirmar que ya
incluye (si no, agregar manualmente):
```
.env
.env*.local
```
(`create-next-app` ya suele incluir `.env*.local` por defecto — el punto
crítico a verificar es que `.env` a secas también quede cubierto).

> Nota descubierta al ejecutar esto: el `.gitignore` que genera
> `create-next-app` usa el patrón amplio `.env*`, que también excluye
> `.env.example` (el archivo que sí queremos versionar). Agregar una línea
> `!.env.example` inmediatamente después de esa regla para exceptuarlo.

### 1.6 Crear `.env.example`

Crear un archivo `.env.example` en la raíz del proyecto con estas tres
variables, **sin valores reales** (quedan vacías o con un comentario, no
con datos sensibles):

```
# URL base del sitio de divulgación de resultados del TSJE
TSJE_BASE_URL=

# Código de elección activo en el TSJE (ver docs/elecciones.json de referencia)
ACTIVE_ELECCION_CODE=

# Cadena de conexión a la base de datos (se completa en la Fase 3)
DATABASE_URL=
```

### 1.7 Verificar/ajustar el commit inicial

`create-next-app` puede haber hecho ya un primer commit automático al
generar el proyecto (ejecutar `git log --oneline` para confirmar). Dos
escenarios:

- **Si ya hizo un commit automático:** dejarlo como está y hacer un
  **segundo commit** con: `.env.example`, el `README.md` (ver 1.8) y el
  `LICENSE` (ver 1.9).
- **Si no hizo ningún commit:** hacer vos el primer commit incluyendo todo
  lo generado por `create-next-app` más `.env.example`, `README.md` y
  `LICENSE` juntos.

En cualquier caso, el mensaje de commit debe seguir Conventional Commits,
por ejemplo:
```
git add .env.example README.md LICENSE
git commit -m "chore: add project docs and environment template"
```

### 1.8 Escribir el `README.md`

Reemplazar el `README.md` generado por `create-next-app` por uno propio,
con al menos:
- Nombre del proyecto y una descripción de una o dos líneas.
- El disclaimer: *"Proyecto personal no oficial, con fines educativos, que
  consume el mismo endpoint público de divulgación de resultados del TSJE
  (Paraguay). No reemplaza ni representa una fuente oficial de resultados."*
- Una sección "Estado del proyecto: en construcción" (se va a ir
  completando en `HU-10.2`).

### 1.9 Agregar la licencia MIT

Crear el archivo `LICENSE` en la raíz con el texto estándar de la licencia
MIT, con el año actual y tu nombre como titular.

### 1.10 Pushear a `main`

Esta es la **única vez en todo el proyecto** que se pushea directo a `main`
sin pasar por una rama y un Pull Request, porque todavía no hay nada
desplegado que proteger:

```
git branch -M main
git push -u origin main
```

### 1.11 Verificación final de HU-00.1

- [x] El repo `escrutinio` existe en GitHub y es público.
- [x] `main` en GitHub tiene: el proyecto Next.js completo, `docs/` con los
      archivos de referencia y mockups, `README.md`, `LICENSE`,
      `.env.example`, y un `.gitignore` que cubre archivos de entorno.
- [x] `npm run dev` funciona en local sin errores.

## 2. HU-00.2 — Configurar Tailwind con los tokens del design system

> Nota: como el proyecto se generó con Tailwind v4 (paso 1.3), la
> configuración de tokens se hace en CSS (dentro de `src/app/globals.css`,
> usando variables CSS + el bloque `@theme` de Tailwind), no en un archivo
> `tailwind.config.js` con `theme.extend` como en Tailwind v3.

### 2.1 Rama de trabajo

```
git checkout main
git pull origin main
git checkout -b feat/00-tailwind-tokens
```

### 2.2 Tabla de tokens a trasladar

Estos son los valores **exactos** ya extraídos de
`docs/escrutinio-design-system.html` — no hace falta reabrir ese archivo
para copiarlos, ya están confirmados acá:

**Colores — modo claro (`[data-theme="light"]`, y también el valor por
defecto en `:root`):**

| Variable | Valor |
|---|---|
| `--surface-0` | `#f6f4ef` |
| `--surface-100` | `#ffffff` |
| `--surface-200` | `#f0eee8` |
| `--surface-300` | `#e7e4dc` |
| `--ink-900` | `#12161c` |
| `--ink-700` | `#454e5c` |
| `--ink-500` | `#5b6472` |
| `--border` | `#dfe3e8` |
| `--control-border` | `#7c8794` |
| `--accent-solid` | `#0e7c86` |
| `--accent-text` | `#0b5b61` |
| `--accent-subtle` | `#e2f3f2` |
| `--on-accent` | `#ffffff` |
| `--positive-solid` | `#166a44` |
| `--positive-text` | `#166a44` |
| `--positive-subtle` | `#e3f5ec` |
| `--on-positive` | `#ffffff` |
| `--warning-solid` | `#8a5a10` |
| `--warning-text` | `#8a5a10` |
| `--warning-subtle` | `#faf0dc` |
| `--on-warning` | `#ffffff` |
| `--info-solid` | `#1c4d85` |
| `--info-text` | `#1c4d85` |
| `--info-subtle` | `#e7f0fb` |
| `--on-info` | `#ffffff` |
| `--neutral-blank` | `#b7bcc4` |
| `--neutral-null` | `#8c93a0` |
| `--fallback-a` | `#7c5cbf` |
| `--fallback-b` | `#a33a6b` |
| `--fallback-c` | `#8a6a1c` |
| `--fallback-d` | `#4c5c72` |
| `--fallback-e` | `#5c6b2e` |

**Colores — modo oscuro (`[data-theme="dark"]`):**

| Variable | Valor |
|---|---|
| `--surface-0` | `#101317` |
| `--surface-100` | `#191d24` |
| `--surface-200` | `#20242c` |
| `--surface-300` | `#272c35` |
| `--ink-900` | `#eef1f5` |
| `--ink-700` | `#b7c0cc` |
| `--ink-500` | `#8b95a3` |
| `--border` | `#2a2f38` |
| `--control-border` | `#64707d` |
| `--accent-solid` | `#5fd4de` |
| `--accent-text` | `#7fe0e8` |
| `--accent-subtle` | `#12333a` |
| `--on-accent` | `#10141a` |
| `--positive-solid` | `#4ade94` |
| `--positive-text` | `#4ade94` |
| `--positive-subtle` | `#113321` |
| `--on-positive` | `#10141a` |
| `--warning-solid` | `#f0b429` |
| `--warning-text` | `#f0b429` |
| `--warning-subtle` | `#3a2c0c` |
| `--on-warning` | `#10141a` |
| `--info-solid` | `#7db2ee` |
| `--info-text` | `#7db2ee` |
| `--info-subtle` | `#132a44` |
| `--on-info` | `#10141a` |
| `--neutral-blank` | `#4d525c` |
| `--neutral-null` | `#363b44` |
| `--fallback-a` | `#a996e0` |
| `--fallback-b` | `#e08bb0` |
| `--fallback-c` | `#d1ab4c` |
| `--fallback-d` | `#9fb0c4` |
| `--fallback-e` | `#a8bd6e` |

**Tipografía (sin variación por tema):**

| Variable | Valor |
|---|---|
| `--font-display` | `"Newsreader", Georgia, serif` |
| `--font-sans` | `"Public Sans", system-ui, sans-serif` |
| `--font-mono` | `"IBM Plex Mono", ui-monospace, monospace` |

**Espaciado (sin variación por tema):**

| Variable | Valor |
|---|---|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-10` | `40px` |
| `--space-12` | `48px` |
| `--space-16` | `64px` |

**Radios (sin variación por tema):**

| Variable | Valor |
|---|---|
| `--radius-sm` | `6px` |
| `--radius-md` | `10px` |
| `--radius-lg` | `16px` |
| `--radius-full` | `999px` |

**Sombras — modo claro:**

| Variable | Valor |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(18,22,28,0.06)` |
| `--shadow-md` | `0 4px 12px rgba(18,22,28,0.08)` |
| `--shadow-lg` | `0 12px 32px rgba(18,22,28,0.14)` |

**Sombras — modo oscuro:**

| Variable | Valor |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.4)` |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.5)` |
| `--shadow-lg` | `0 16px 40px rgba(0,0,0,0.6)` |

**Colores de estado del sistema electoral** (mapeo semántico a definir con
nombres propios, ya que el design system los expresa reutilizando las
familias de arriba — usar esta equivalencia):
- **Provisorio** → familia `warning` (`--warning-solid` / `--warning-subtle` / `--warning-text` / `--on-warning`)
- **En vivo** → familia `accent` (`--accent-solid` / `--accent-subtle` / `--accent-text` / `--on-accent`)
- **Electo** → familia `positive` (`--positive-solid` / `--positive-subtle` / `--positive-text` / `--on-positive`)

### 2.3 Definir las variables CSS en `globals.css`

En `src/app/globals.css`, agregar (respetando lo que ya haya generado
`create-next-app` con `@import "tailwindcss";`) dos bloques de variables
CSS con exactamente los nombres y valores de la tabla 2.2: uno para
`:root, [data-theme="light"]` con los valores de "modo claro", y otro para
`[data-theme="dark"]` con los valores de "modo oscuro". Las variables sin
variación de tema (tipografía, espaciado, radios) van en un único bloque
`:root`.

### 2.4 Mapear las variables al `@theme` de Tailwind

En el mismo archivo, agregar un bloque `@theme inline` que declare, por
cada variable CSS de la tabla 2.2, su equivalente en la nomenclatura que
Tailwind v4 espera para generar utilidades automáticamente:
- Colores → prefijo `--color-*` (por ejemplo, la variable `--surface-0` se
  expone como `--color-surface-0`, apuntando a `var(--surface-0)`; esto
  habilita clases como `bg-surface-0`, `text-ink-900`, `border-border`).
- Espaciado → prefijo `--spacing-*`.
- Radios → prefijo `--radius-*`.
- Sombras → prefijo `--shadow-*`.
- Tipografías → prefijo `--font-*`.

Para los tres colores de estado semánticos (Provisorio/En vivo/Electo),
exponerlos también con su propio nombre semántico además del genérico (por
ejemplo `--color-status-provisorio` apuntando a lo mismo que
`--color-warning-solid`), para que el componente `StatusBadge` pueda usar
clases con nombre de negocio (`bg-status-provisorio`) en vez de tener que
saber que "provisorio" internamente es "warning".

### 2.5 Cargar las tipografías

Configurar las tres familias tipográficas (`Newsreader`, `Public Sans`,
`IBM Plex Mono`) usando la optimización de fuentes de Next.js
(`next/font/google`) en el layout raíz, en vez de un `<link>` a Google
Fonts como hace el HTML original del design system — es la forma
recomendada en Next.js y evita layout shift.

### 2.6 Página de verificación visual

Crear una página temporal (por ejemplo `src/app/design-tokens/page.tsx`,
pensada para borrarse o dejarse fuera de navegación al final del proyecto)
que renderice un bloque por cada color (con su nombre visible encima) y
una muestra de cada espaciado/radio/sombra, usando las clases de Tailwind
generadas en el paso 2.4.

### 2.7 Comparar contra el original

Abrir en el navegador, lado a lado, `docs/escrutinio-design-system.html` y
`http://localhost:3000/design-tokens`, y confirmar visualmente que los
colores coinciden. Alternar el atributo `data-theme` (`light`/`dark`) en
las herramientas de desarrollo del navegador para verificar ambos modos.

### 2.8 Commit y PR

```
git add src/app/globals.css src/app/design-tokens src/app/layout.tsx
git commit -m "feat: map design system tokens into Tailwind v4 theme"
git push -u origin feat/00-tailwind-tokens
gh pr create --title "feat: Tailwind tokens from design system" --body "Maps all color/spacing/radius/shadow tokens from docs/escrutinio-design-system.html into Tailwind v4's @theme. Verified visually at /design-tokens in both light and dark mode."
```
Revisar el diff, mergear con squash, sincronizar `main` local (pasos 6–8
del flujo de Git de `plan-desarrollo.md`).

## 3. HU-00.3 — Deploy inicial en Vercel

> Los pasos 3.1 y 3.2 requieren que **vos** completes un login/autorización
> vía navegador — son la única parte de esta fase que un agente no puede
> hacer de punta a punta sin tu intervención directa.

### 3.1 Conectar Vercel con GitHub (manual, una sola vez)

1. Entrar a `vercel.com` e iniciar sesión (o crear cuenta) con tu cuenta de
   GitHub.
2. Autorizar a Vercel a acceder al repositorio `escrutinio` (podés
   autorizar solo ese repo, no toda tu cuenta, si preferís permisos más
   acotados).

### 3.2 Importar el proyecto (manual, una sola vez)

1. Desde el dashboard de Vercel, "Add New… → Project".
2. Seleccionar el repositorio `escrutinio`.
3. Vercel debería detectar automáticamente "Next.js" como framework — no
   cambiar la configuración de build sugerida.
4. Antes de confirmar el deploy, en "Environment Variables" agregar las
   tres variables de `.env.example` (`TSJE_BASE_URL`,
   `ACTIVE_ELECCION_CODE`, `DATABASE_URL`) para los tres ambientes
   (Development, Preview, Production). Como todavía no se usan en código,
   pueden quedar con un valor placeholder de texto (por ejemplo
   `pending`) — se completan con valores reales en la Fase 3/4.
5. Confirmar el deploy.

### 3.3 Verificación (esto sí lo puede confirmar un agente, revisando el resultado)

- [ ] La URL de producción que asigna Vercel (`https://escrutinio.vercel.app`
      o similar) responde con la página por defecto de Next.js, sin errores.
- [ ] Abrir un Pull Request de prueba (puede ser el mismo de HU-00.2 si
      todavía está abierto) y confirmar que Vercel comenta en el PR con una
      URL de "deploy preview" distinta de la de producción.
- [ ] Agregar la URL de producción al `README.md` en una rama nueva
      (`docs/00-readme-url`), con su propio commit/PR siguiendo el mismo
      flujo de Git.

## 4. Cierre de la Fase 0

Una vez verificados los tres checklists (1.11, y los de 2 y 3 de arriba):

1. Marcar `HU-00.1`, `HU-00.2` y `HU-00.3` como hechas (☑) en
   `docs/plan-desarrollo.md`.
2. Taguear el hito:
   ```
   git checkout main
   git pull origin main
   git tag -a v0.0.1 -m "Project scaffold, design tokens, and first deploy"
   git push origin v0.0.1
   ```
3. Continuar con la Fase 1 (`HU-01.1` en adelante) del backlog.
