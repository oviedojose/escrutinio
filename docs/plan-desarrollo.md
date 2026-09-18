# Escrutinio TSJE — Plan de desarrollo y backlog de historias de usuario

> Proyecto personal de práctica de TypeScript + React. Consume datos públicos de
> divulgación de resultados del TSJE (Paraguay) para mostrar resultados de
> Intendente y Junta Municipal, incluyendo el armado de bancas según el sistema
> electoral paraguayo (orden por voto preferencial dentro de cada lista + reparto
> entre listas por método D'Hondt).
>
> **Disclaimer para el README final:** este es un proyecto no oficial, hecho con
> fines educativos/portfolio, que consume el mismo endpoint público que usa
> `resultados.tsje.gov.py`. No reemplaza ni representa una fuente oficial de
> resultados.

## Cómo usar este documento

Este documento es el backlog completo, pero **no se implementa todo de una**.
El flujo real de trabajo es:

1. Elegí la próxima historia sin marcar (☐) siguiendo el orden de fases.
2. Si la historia es no trivial, traela a una sesión de diseño corta (decisión
   de archivos/approach) antes de tocar código — igual que hicimos para armar
   este plan, pero a escala de una sola historia.
3. Implementá siguiendo el paso a paso de la historia y el flujo de Git de la
   sección 4 (ramas, commits atómicos, PR, squash merge).
4. Marcá la historia como hecha (☑) y pasá a la siguiente.

No se salta de fase: cada fase depende de que la anterior esté funcionando,
aunque sea de forma mínima.

Cada historia de la sección 5 incluye un **paso a paso explícito** de qué
hacer, en qué orden y por qué — sin código — pensado para que puedas
implementarla siguiendo la secuencia sin tener que adivinar decisiones de
diseño intermedias.

---

## 1. Stack tecnológico y justificación

| Pieza | Elección | Por qué |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Un solo repo para frontend y backend. Los *Route Handlers* son el backend: la misma función que atiende el botón de sync manual (Fase 4) es la que después atiende el cron automático (Fase 8). |
| Hosting | **Vercel** | Deploy automático por push/PR (deploy previews), plan gratuito suficiente, y trae **Vercel Cron Jobs** para la Fase 8. |
| Base de datos | **PostgreSQL gestionado (Neon)** | Gratis, apto para funciones serverless, misma base en dev (branch de Neon) y prod — evita divergencias tipo "funciona en SQLite pero no en Postgres". |
| ORM | **Prisma** | Tipado end-to-end generado desde el schema, migraciones versionadas en git, sintaxis didáctica para practicar modelado relacional. |
| Estilos | **Tailwind CSS**, `theme.extend` mapeado 1:1 a los tokens de `docs/escrutinio-design-system.html` (`--surface-*`, `--space-*`, `--radius-*`, colores de estado Provisorio/En vivo/Electo) | Reutiliza el design system ya definido en vez de reinventar valores. |
| Data fetching cliente | **TanStack Query (React Query)** | Cachea lecturas locales, maneja loading/error/refetch, invalida cache tras un sync manual. |
| Componentes de datos | **A medida (sin librería de charts)** | El design system define componentes específicos (`VoteBar`, `SeatDistributionBar`, `DHondtTable`, `PartyChip`, `ElectedList`, `StatusBadge`, `StatTile`, `DataTable`). Son SVG/CSS simples — una librería genérica (Recharts/Nivo) sería una dependencia pesada para menos control del que ya tenemos con CSS/Tailwind. |
| Validación de datos externos | **Zod** | El JSON que devuelve el TSJE no es un contrato que controlemos — se valida su forma antes de guardar en la base, para no propagar datos corruptos si el TSJE cambia algo. |
| Testing (Fase 9) | **Vitest + React Testing Library** | Unit tests de la lógica electoral y tests de componentes clave. |
| CI (Fase 9) | **GitHub Actions** | Typecheck + lint + test en cada PR. |

**Por qué no separar frontend/backend en dos proyectos:** el navegador no puede
llamar de forma confiable a `resultados.tsje.gov.py` directamente (CORS no está
pensado para consumo externo). Por eso, incluso el botón manual de la Fase 4
llama a **tu propio Route Handler**, que hace el `fetch` del lado servidor,
guarda en tu DB, y devuelve el resultado ya fresco. Con Next.js full-stack esto
no requiere piezas adicionales (sin CORS que configurar, sin dos builds, sin
dos hostings).

---

## 2. Modelo de datos y lógica electoral

### Entidades (Prisma / Postgres)

- **`Eleccion`** — código TSJE, nombre, fecha, `activa: boolean`. Permite
  cambiar de elección (por ejemplo cuando el TSJE asigne el código real de la
  municipal) sin tocar código, solo configuración.
- **`Candidatura`** — pertenece a una `Eleccion` (código TSJE, nombre, `tipCandidatura`).
- **`Departamento`** / **`Distrito`** — datos de referencia, respetando el
  anidamiento real del TSJE (elección → candidatura → departamento → distrito),
  tal como viene en `docs/departamentos.json` y `docs/distritos.json`.
- **`SyncRun`** — un registro por cada intento de sincronización de una
  combinación (elección, candidatura, departamento, distrito): timestamp,
  status (ok/error), y los totales de esa consulta (`totalMesas`,
  `mesasPublicadas`, `blancos`, `nulos`, `totalVotos`, `canElectores`,
  `nocomputados`). Nunca se actualiza un `SyncRun` existente — cada
  sincronización crea uno nuevo. La "foto actual" de un distrito es
  simplemente su `SyncRun` más reciente con status ok.
- **`ResultadoLista`** — snapshot de cada candidato/lista de un `SyncRun`
  (`orden`, `numLista`, `nomCandidato`, `desPartido`, `colLista`, `votos`).
- **`ResultadoPreferencial`** — hijos de `ResultadoLista` para concejales
  (`candidatosPref`): `nomCandidato`, `votos`, `ordCandidato`.

Guardar historial en vez de sobrescribir evita `UPDATE`s conflictivos si dos
syncs se solapan, y de regalo da una línea de tiempo del conteo sin trabajo
extra.

### Lógica electoral (funciones puras, sin dependencia de UI ni de la API)

1. **Orden interno de una lista (quién ocupa cada banca que le toque a esa
   lista):** los candidatos preferenciales se ordenan por `votos` descendente.
   Verificado con el JSON de ejemplo: `sum(candidatosPref.votos) === votos`
   del candidato/lista (7009 = 1284+728+700+696+650+617+553+436+396+389+283+277),
   así que el orden preferencial es directo, sin recalcular nada adicional.
   Definir explícitamente el criterio de desempate en caso de empate exacto en
   votos (por ejemplo, `ordCandidato` como respaldo).
2. **Cantidad de bancas a repartir en un distrito:** se deriva del propio
   `totales.canElectores` que ya trae cada consulta de Junta Municipal,
   aplicando los tramos que define la ley electoral paraguaya
   (población/electores → cantidad de concejales). **Los tramos exactos deben
   verificarse contra el Código Electoral / resolución vigente del TSJE antes
   de dar la historia por terminada** — no se debe hardcodear un número sin
   verificar la fuente legal. La función debe recibir una tabla de tramos
   como configuración fácil de ajustar, no como constantes dispersas en la
   lógica.
3. **Reparto de bancas entre listas (D'Hondt):** se toma el `votos` total de
   cada lista dentro del distrito y se divide sucesivamente por 1, 2, 3...
   hasta cubrir la cantidad de bancas obtenida en el paso 2.

---

## 3. Flujo de sincronización

- **Manual (Fase 4):** la pantalla de selección dispara `POST /api/sync` con
  (elección, candidatura, departamento, distrito). El Route Handler llama al
  TSJE del lado servidor, valida el JSON con Zod, crea el `SyncRun` y sus
  resultados, y responde con el dato fresco. El frontend invalida la query de
  React Query correspondiente.
- **Masivo (Fase 7):** un botón dispara N llamadas a esa misma lógica con
  concurrencia limitada (no 761 mesas de una sola vez). Cada combinación es
  independiente: si una falla, se guarda un `SyncRun` de error y **no aborta
  el resto**. La UI muestra qué quedó pendiente/fallido y permite reintentar
  puntualmente.
- **Automático (Fase 8):** un Vercel Cron Job llama a un endpoint interno
  (protegido con un secreto) cada N minutos configurable, que ejecuta la
  misma lógica de sync masivo.
- **Regla de oro:** el frontend nunca llama al TSJE directamente. Siempre lee
  de la base propia. El único tráfico hacia el TSJE ocurre en syncs
  explícitos (botón o cron), nunca por el hecho de que alguien esté mirando
  una pantalla.

---

## 4. Flujo de Git / GitHub

**Convenciones:**

- Commits en inglés, [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `style:`.
- Una rama por historia: `feat/<fase>-<slug>` (ej. `feat/01-ui-shell`).
- `main` siempre desplegable — nunca se commitea directo (salvo el commit
  inicial del repo, antes de que exista nada que proteger).
- Un Pull Request por historia, aunque se trabaje solo.
- **Squash and merge** al mergear a `main` — varios commits chicos en la rama,
  uno solo limpio en `main`.
- Tags por hito de fase (no por historia): `v0.1.0` al cerrar Fase 1, `v0.2.0`
  al cerrar Fase 3, `v0.3.0` al cerrar Fase 4, etc.

**Paso a paso (se repite en cada historia):**

1. Actualizar `main` local:
   ```
   git checkout main
   git pull origin main
   ```
2. Crear la rama de la historia:
   ```
   git checkout -b feat/01-ui-shell
   ```
3. Trabajar en pasos pequeños, commiteando cada vez que algo queda en un
   estado coherente (no al final del día):
   ```
   git status
   git add <archivos específicos>
   git commit -m "feat: add StatTile component with design tokens"
   ```
4. Subir la rama (primera vez con `-u`, después solo `git push`):
   ```
   git push -u origin feat/01-ui-shell
   ```
5. Abrir el Pull Request cuando la historia está completa y probada
   manualmente en local:
   ```
   gh pr create --title "feat: static UI shell for the 5 mockup screens" --body "..."
   ```
   La descripción debe incluir qué hace y cómo se probó.
6. Auto-revisión: mirar el diff completo en "Files changed" como si fuera
   otra persona revisando.
7. Mergear con squash:
   ```
   gh pr merge --squash --delete-branch
   ```
8. Sincronizar local y limpiar:
   ```
   git checkout main
   git pull origin main
   git branch -d feat/01-ui-shell
   ```
9. Tag opcional al cerrar una fase completa:
   ```
   git tag -a v0.1.0 -m "Static UI shell for all 5 screens"
   git push origin v0.1.0
   ```

**Cuidados desde el primer commit:**
- `.env` nunca se commitea (en `.gitignore` desde el commit inicial);
  versionar `.env.example` con las variables sin valores reales
  (`DATABASE_URL=`, `TSJE_BASE_URL=`, `ACTIVE_ELECCION_CODE=`).
- Revisar `git status` antes de cada `git add`.

---

## 5. Backlog de historias de usuario

Cada historia trae: la necesidad en formato "Como/quiero/para", un **paso a
paso explícito** de qué hacer y en qué orden (sin código), los criterios de
aceptación, los conceptos/librerías que entran en juego, y la rama sugerida.
Todas siguen el flujo de Git de la sección 4.

### Fase 0 — Setup del proyecto

**☑ HU-00.1 — Inicializar repositorio y proyecto base**

*Como* desarrollador, *quiero* tener el repositorio y el proyecto Next.js
listos, *para* empezar a construir sobre una base versionada desde el día 1.

Paso a paso:
1. Crear el repositorio en GitHub como **público**, con un nombre corto y
   descriptivo (ej. `escrutinio-tsje`), **sin** inicializarlo con README
   desde GitHub (lo vas a crear vos localmente, para controlar exactamente
   qué entra en el primer commit).
2. Generar el proyecto Next.js localmente con TypeScript y App Router
   habilitados. Decidí desde ahora si vas a usar una carpeta `src/` o no, y
   mantené esa decisión de forma consistente en todo el proyecto.
3. Correr el proyecto en modo desarrollo y confirmar que carga sin errores
   **antes** de commitear nada — así te asegurás de versionar una base que
   funciona, no un punto de partida roto.
4. Revisar el `.gitignore` generado automáticamente y agregar manualmente
   cualquier variante de archivo de entorno que no venga cubierta
   (`.env`, `.env.local`, `.env*.local`).
5. Crear un archivo `.env.example` sin valores reales, listando ya los
   nombres de variables que vas a necesitar más adelante aunque todavía no
   las uses: la URL base del TSJE, el código de elección activo, y la
   cadena de conexión a la base de datos. Esto documenta la configuración
   necesaria del proyecto desde el día 1, sin exponer secretos.
6. Escribir un README mínimo (una descripción de una o dos líneas del
   proyecto, más el disclaimer de que es un proyecto personal no oficial).
7. Elegir una licencia open source (MIT es razonable para un proyecto de
   portfolio) y agregar el archivo correspondiente.
8. Inicializar git localmente, hacer el primer commit con todo lo anterior,
   y conectarlo al repositorio remoto de GitHub.
9. Pushear directamente a `main` — es la única vez en todo el proyecto que
   se hace esto sin pasar por una rama y un PR, porque todavía no hay nada
   "en producción" que proteger.
10. Verificar en GitHub que el repo se ve como esperás: README visible,
    licencia detectada automáticamente, estructura de Next.js presente.

Criterios de aceptación: repo público en GitHub; proyecto corre en local;
`.gitignore` cubre archivos de entorno; `.env.example` documenta las
variables necesarias; README y licencia presentes; primer commit en `main`.

Conceptos/librerías: `create-next-app`, estructura de App Router (carpeta
`app/`, `layout.tsx`, `page.tsx`), `gh repo create`, licencias open source.

---

**☑ HU-00.2 — Configurar Tailwind con los tokens del design system**

*Como* desarrollador, *quiero* que las utilidades de Tailwind usen los mismos
valores que `docs/escrutinio-design-system.html`, *para* no duplicar ni
desincronizar los tokens de diseño.

Paso a paso:
1. Abrir `docs/escrutinio-design-system.html` y, en la sección de
   fundamentos visuales, anotar los valores exactos de cada variable CSS:
   colores de superficie (`--surface-0/100/200/300`), colores de estado
   (`--accent-*`, `--positive-*`, `--warning-*`, `--info-*`), tinta de texto
   (`--ink-500/700/900`), bordes, espaciados (`--space-1` a `--space-16`),
   radios (`--radius-sm/md/lg/full`) y sombras.
2. Decidir la convención de nombres que van a tener esos mismos valores
   dentro de la configuración de Tailwind — idealmente los mismos nombres,
   para no tener que traducir mentalmente entre el design system y el código.
3. Extender la configuración de Tailwind (`theme.extend`) agregando esos
   colores, espaciados, radios y sombras como tokens propios, en vez de
   apoyarte en los valores numéricos por defecto de Tailwind.
4. Prestar especial atención a los tres colores de estado del sistema
   electoral (Provisorio, En vivo, Electo): van a ser los más usados en
   `StatusBadge` y necesitan nombres claros e inequívocos.
5. Decidir si el modo claro/oscuro que menciona el design system se
   implementa ya o se deja preparado para más adelante (alcanza con dejar
   la estructura de tokens lista; no hace falta implementarlo completo en
   esta historia).
6. Crear una página de prueba temporal (por ejemplo `/design-system`, que
   podés borrar o dejar oculta después) que renderiza muestras de cada
   color/espaciado/radio usando las nuevas clases de Tailwind.
7. Comparar, en dos pestañas del navegador, el HTML original del design
   system contra tu página de prueba, y ajustar hasta que coincidan.
8. Commitear la configuración una vez conforme con la comparación visual.

Criterios de aceptación: los valores de Tailwind coinciden con los tokens
del design system; existe una forma de verificar esto visualmente.

Conceptos/librerías: Tailwind `theme.extend`, CSS custom properties, diseño
por tokens (design tokens).

---

**☐ HU-00.3 — Deploy inicial en Vercel**

*Como* desarrollador, *quiero* tener el proyecto desplegado públicamente
desde el principio, *para* validar el pipeline de deploy antes de que haya
lógica compleja que depurar.

Paso a paso:
1. Crear/usar una cuenta de Vercel conectada a tu cuenta de GitHub.
2. Importar el repositorio como nuevo proyecto en Vercel, dejando la
   detección automática de framework (Next.js) sin modificar.
3. Antes del primer deploy, configurar en el dashboard de Vercel variables
   de entorno placeholder (sin valores reales todavía) para los tres
   ambientes — Development, Preview, Production — usando los mismos nombres
   definidos en `.env.example`.
4. Confirmar que el primer deploy automático (al importar el proyecto)
   termina bien y que la URL pública muestra la página de inicio sin
   errores.
5. Verificar que abrir un Pull Request genera automáticamente un "deploy
   preview" con URL propia, distinta de producción (podés confirmarlo con
   el PR de la siguiente historia).
6. Agregar la URL pública al README.

Criterios de aceptación: URL de producción funcionando; deploy previews
funcionando por PR; variables de entorno configuradas por ambiente.

Conceptos/librerías: integración Git de Vercel, variables de entorno por
ambiente (development/preview/production).

### Fase 1 — UI estática con datos fijos

**☐ HU-01.1 — Tipar los datos de referencia**

*Como* desarrollador, *quiero* interfaces TypeScript para el formato de
`elecciones.json`, `candidaturas.json`, `departamentos.json` y
`distritos.json`, *para* trabajar con autocompletado y errores en tiempo de
compilación en vez de en tiempo de ejecución.

Paso a paso:
1. Abrir cada uno de los cuatro archivos y entender su forma real: notar que
   están envueltos en una asignación de variable estilo `var jsonX = {...}`
   (no son JSON puro), y que el anidamiento de claves sigue el patrón
   elección → (candidatura →) departamento → distrito.
2. Llevar el contenido de esos archivos (sin la parte `var jsonX =`) a una
   carpeta de datos locales dentro del proyecto (por ejemplo `data/` o
   `lib/reference-data/`), como estructuras que el código pueda importar
   directamente — en esta fase todavía no hay backend ni base de datos.
3. Definir, para cada uno de los cuatro conjuntos, un tipo de TypeScript que
   describa exactamente su forma (claves como identificadores, valores como
   nombres legibles).
4. Escribir funciones de acceso pequeñas y bien nombradas que oculten el
   anidamiento crudo: por ejemplo, una función que dado elección+candidatura
   devuelva la lista de departamentos disponibles, y otra que dado además un
   departamento devuelva sus distritos. Así ningún componente necesita saber
   cómo están anidados los objetos originales.
5. Verificar manualmente (podés imprimir en consola durante desarrollo) que
   para elección 44 candidatura 1 aparecen los 17 departamentos + Capital, y
   que un departamento conocido trae los distritos esperados.
6. Dejar anotado (en el código o en este documento) que estos archivos
   corresponden a elecciones internas partidarias (44/45) usadas como
   fixtures de desarrollo, y que para la elección municipal real habrá que
   confirmar que la forma no cambió (ver riesgos, sección 6).

Conceptos/librerías: TypeScript `interface`/`type`, tipos anidados,
utilidades de tipos (`Record`, `keyof`).

---

**☐ HU-01.2 — Pantalla "Inicio — selector"**

*Como* usuario, *quiero* elegir elección, candidatura, departamento y
distrito desde selects encadenados, *para* navegar a los resultados que me
interesan.

Paso a paso:
1. Mirar el mockup correspondiente en `docs/Escrutinio — Pantallas.html`
   para entender el layout exacto: orden de los selectores, textos, y qué
   se muestra antes de tener una selección completa.
2. Crear la página correspondiente en el App Router (por ejemplo la raíz `/`).
3. Armar el selector de elección con los datos tipados de HU-01.1; si solo
   hay una elección marcada como "activa", podés preseleccionarla
   automáticamente en vez de forzar al usuario a elegir entre elecciones
   pasadas.
4. Armar el selector de candidatura, filtrado según la elección elegida.
5. Armar el selector de departamento, filtrado según elección + candidatura
   (usando las funciones de acceso de HU-01.1).
6. Armar el selector de distrito, filtrado según el departamento elegido, y
   deshabilitado hasta que haya un departamento seleccionado.
7. Manejar el estado de los cuatro selectores con estado de React,
   asegurando que cambiar un selector "de arriba" (por ejemplo elección)
   resetea los de abajo si dejan de ser válidos con la nueva selección.
8. Agregar un botón "Ver resultados" que solo se habilita con las cuatro
   selecciones completas, y que navega a la pantalla de resultados
   correspondiente pasando esos cuatro valores (por ahora sin datos reales,
   eso llega en fases posteriores).
9. Revisar accesibilidad básica: cada select debe tener una etiqueta
   (`label`) asociada, no solo un placeholder visual.
10. Probar manualmente el flujo completo, incluyendo casos límite: un
    departamento sin distritos, cambiar de candidatura a mitad de camino,
    etc.

Conceptos/librerías: `useState`, componentes controlados, selects
encadenados (cascading selects), formularios accesibles.

---

**☐ HU-01.3 — Componentes base del design system**

*Como* desarrollador, *quiero* implementar `StatTile`, `PartyChip`,
`StatusBadge` y `VoteBar` como componentes reutilizables y tipados, *para*
no repetir estilos entre pantallas.

Paso a paso:
1. En `docs/escrutinio-design-system.html`, sección "Componentes", estudiar
   qué props visuales necesita cada uno de los cuatro (texto, color, tamaño,
   estado) y en qué variantes aparece.
2. Crear una carpeta de componentes de dominio separada de componentes
   genéricos de UI (por ejemplo `components/electoral/`), ya que estos son
   específicos del negocio electoral, no reutilizables en cualquier proyecto.
3. Implementar primero `StatTile` (el más simple): recibe una etiqueta y un
   valor, se ve como una tarjeta de estadística. Tipar sus props explícitamente,
   marcando qué es obligatorio y qué opcional.
4. Implementar `StatusBadge`: recibe un estado (Provisorio / En vivo /
   Electo) y aplica el color correspondiente de HU-00.2. Usar un tipo unión
   de TypeScript (no un string libre) para los tres estados posibles, para
   que sea imposible pasarle un estado inválido sin que TypeScript avise.
5. Implementar `PartyChip`: recibe el nombre del partido y su `colLista`
   (texto con tres números separados por coma, ej. "90, 50, 20") y lo
   convierte en un color de fondo real. Aislar esa conversión texto-a-color
   en una función propia y bien nombrada, reutilizable también desde
   `VoteBar`.
6. Implementar `VoteBar`: recibe votos y un total, dibuja una barra
   proporcional, reutilizando la función de color de `colLista`.
7. Crear una página de prueba temporal con varias combinaciones de estos
   cuatro componentes usando datos ficticios variados (nombres largos,
   colores distintos, los tres estados posibles), para revisar casos
   límite antes de usarlos en pantallas reales.
8. Comparar visualmente contra el mockup del design system y ajustar
   espaciados/tamaños hasta que coincidan.

Conceptos/librerías: composición de componentes, tipado de props, helper
para combinar clases de Tailwind condicionalmente (ej. `clsx`/`cva`).

---

**☐ HU-01.4 — Pantalla Resultados · Intendente (desktop) con datos de ejemplo**

*Como* usuario, *quiero* ver el resultado de Intendente de un distrito
(usando el JSON de ejemplo de este proyecto como dato fijo), *para* validar
el layout antes de conectar datos reales.

Paso a paso:
1. Tomar el JSON de ejemplo de intendentes (`candidatura=1`) de este
   documento y guardarlo como fixture local tipado, en un archivo separado
   de los datos de referencia de HU-01.1 (esto es un *resultado*, no un
   catálogo).
2. Definir el tipo TypeScript de la respuesta completa del endpoint de
   resultados (totales, lista de candidatos, hora), reflejando exactamente
   los campos del JSON de ejemplo (`orden`, `numLista`, `nomCandidato`,
   `desPartido`, `colLista`, `votos`, `imgCandidato`, `candidatosPref`).
3. Crear la página de resultados de Intendente, recibiendo como parámetros
   de navegación la elección/candidatura/departamento/distrito elegidos en
   la pantalla anterior (el contenido mostrado sigue siendo el fixture fijo
   en esta historia).
4. Armar la fila superior de totales usando varios `StatTile` (mesas
   totales/publicadas, votos totales, blancos, nulos, electores).
5. Ordenar la lista de candidatos por votos descendente en el código
   (aunque el ejemplo ya venga ordenado, no asumirlo) y renderizar cada uno
   con `PartyChip` + `VoteBar`.
6. Calcular y mostrar el porcentaje de cada candidato sobre el total de
   votos válidos, verificando a mano con el ejemplo que los números
   cuadran (81416 de 132736 ronda 61%).
7. Comparar el layout contra el mockup "Resultados · Intendente (desktop)".

Conceptos/librerías: fixtures estáticos tipados, composición de layout,
cálculo de porcentajes.

---

**☐ HU-01.5 — Pantalla Resultados · Concejales (desktop) con datos de ejemplo**

*Como* usuario, *quiero* ver las listas de Junta Municipal y sus candidatos
preferenciales, *para* validar el layout de `DHondtTable` y `ElectedList`
antes de tener lógica electoral real.

Paso a paso:
1. Tomar el JSON de ejemplo de concejales (`candidatura=2`) como fixture
   tipado, extendiendo el tipo de HU-01.4 para incluir `candidatosPref`
   dentro de cada candidato de lista.
2. Crear la página de resultados de Concejales.
3. Extraer a un componente compartido la fila de totales usada en HU-01.4,
   ya que Intendente y Concejales comparten esa sección.
4. Por cada lista, mostrar su `PartyChip`, sus votos totales, y una sección
   con sus `candidatosPref` anidados (en esta historia el orden interno
   puede ser el que trae el JSON de ejemplo tal cual, ya que la Fase 2
   —donde se define el criterio real de orden— todavía no existe).
5. Dejar un espacio visual reservado para la cantidad de bancas por lista
   (`DHondtTable`) y quién las ocupa (`ElectedList`), con datos ficticios
   fijos o un texto "próximamente", ya que el cálculo real llega en la
   Fase 2/5.
6. Comparar el layout contra el mockup correspondiente.

Conceptos/librerías: renderizado de datos anidados, tablas complejas.

---

**☐ HU-01.6 — Pantalla Panorama nacional (maqueta con datos de ejemplo)**

*Como* usuario, *quiero* una vista agregada a nivel país, *para* tener una
foto general del conteo, no solo distrito por distrito.

Paso a paso:
1. Mirar el mockup "Panorama nacional (desktop)" y anotar qué información
   agregada muestra (por ejemplo: cuántos distritos ya tienen resultado,
   distribución de intendencias/bancas ganadas por partido a nivel país).
2. Armar un fixture con datos ficticios de varios departamentos/distritos
   inventados (en esta fase no hay datos reales ni base de datos todavía),
   suficiente para maquetar la pantalla.
3. Implementar `SeatDistributionBar` (barra horizontal segmentada por
   partido, proporcional a cantidad de bancas/intendencias), con el mismo
   patrón de props tipadas que los componentes de HU-01.3.
4. Armar la página de Panorama nacional combinando `StatTile` (totales país)
   y `SeatDistributionBar`.
5. Comparar contra el mockup.

Conceptos/librerías: agregación de datos ficticios, componente de barra
segmentada.

---

**☐ HU-01.7 — Versión mobile de Resultados · Intendente**

*Como* usuario en el celular, *quiero* ver el mismo resultado en una
pantalla angosta, *para* poder revisar resultados desde cualquier
dispositivo.

Paso a paso:
1. Comparar el mockup "Resultados · Intendente (mobile)" contra la versión
   desktop ya construida, identificando qué cambia realmente (por ejemplo,
   los `StatTile` pasando de una fila a una grilla de 2 columnas) y qué se
   mantiene igual.
2. Usar breakpoints responsivos de Tailwind para que la misma página se
   adapte según el ancho de pantalla, evitando duplicar la página completa
   salvo que el mockup muestre una estructura realmente distinta (no solo
   reordenada).
3. Probar manualmente en varios anchos de pantalla usando las herramientas
   de desarrollo del navegador en modo dispositivo, no solo el ancho exacto
   del mockup.
4. Confirmar que textos largos (nombres de candidatos, partidos) no rompen
   el layout en pantallas angostas.

Conceptos/librerías: breakpoints responsivos de Tailwind, diseño
mobile-first.

### Fase 2 — Lógica electoral pura

**☐ HU-02.1 — Función de orden preferencial por lista**

*Como* desarrollador, *quiero* una función pura que ordene `candidatosPref`
por votos descendente con desempate definido, *para* saber quién ocupa cada
banca que le toque a una lista.

Paso a paso:
1. Crear una carpeta de lógica de dominio sin dependencias de React (por
   ejemplo `lib/electoral/` o `domain/electoral/`), dejando claro que este
   código no importa nada de UI ni de red.
2. Escribir una función que reciba el arreglo de `candidatosPref` de una
   lista y devuelva un nuevo arreglo ordenado por votos descendente, sin
   mutar el arreglo original.
3. Definir explícitamente qué pasa ante un empate exacto en votos entre dos
   candidatos: usar `ordCandidato` (la posición interna que la lista les dio)
   como criterio de desempate, y documentar esto como una decisión
   consciente, no como un detalle accidental del algoritmo de ordenamiento
   usado.
4. Verificar manualmente la función contra el JSON de ejemplo de concejales
   de este documento: confirmar que para la lista de HONOR COLORADO el
   resultado es Christian Meza (1284), Dra. Mariela Davalos (728), Fredy
   Medina (700)... en ese orden exacto.
5. Dejar anotado (comentario breve, no un bloque largo) el supuesto
   validado de que `sum(candidatosPref.votos) === votos` del candidato/lista
   — si algún día una lista real no cumple esto, es señal de que hay algo
   raro en los datos que vale la pena investigar antes de confiar en el
   resultado.

Conceptos/librerías: funciones puras, `Array.sort` con comparador estable,
diseño pensado para ser testeable (el test formal llega en Fase 9).

---

**☐ HU-02.2 — Función de bancas según electores**

*Como* desarrollador, *quiero* derivar la cantidad de bancas de un distrito
a partir de `canElectores`, *para* poder correr D'Hondt sin depender de un
dato que el TSJE no publica en este endpoint.

Paso a paso:
1. Investigar la fuente legal vigente (Código Electoral paraguayo y/o
   resoluciones del TSJE) que define cuántos concejales corresponden a un
   municipio según su cantidad de electores/población. **Este paso es
   investigación externa, no programación, y debe hacerse antes de escribir
   la función** — no se debe inventar ni asumir un número.
2. Con los tramos reales ya confirmados, representarlos como una estructura
   de datos simple y editable (una lista ordenada de rangos con su cantidad
   de bancas correspondiente), separada físicamente de la lógica que la usa,
   de forma que si la ley cambia alcance con editar esa lista.
3. Escribir la función que, dado un número de electores, recorre los tramos
   y devuelve la cantidad de bancas correspondiente.
4. Definir qué hace la función ante un valor fuera de cualquier tramo
   conocido (por ejemplo, cero o negativo): debe fallar de forma explícita
   y clara, nunca devolver un número arbitrario en silencio.
5. Dejar anotada la fuente exacta (ley/resolución y artículo) junto a la
   estructura de tramos, para que quede trazable de dónde salió cada valor.

Conceptos/librerías: tablas de rangos/umbrales como configuración,
investigación de fuentes normativas.

---

**☐ HU-02.3 — Función D'Hondt**

*Como* desarrollador, *quiero* repartir una cantidad de bancas entre listas
usando el método D'Hondt, *para* reflejar cómo se conforma realmente una
Junta Municipal en Paraguay.

Paso a paso:
1. Repasar el mecanismo de D'Hondt con un ejemplo simple hecho a mano en
   papel (3 listas con votos redondos y una cantidad chica de bancas) antes
   de programarlo, para entender el algoritmo de memoria propia.
2. Escribir la función que recibe una lista de pares (identificador de
   lista, votos totales) y una cantidad de bancas, y devuelve cuántas
   bancas le corresponden a cada lista.
3. Implementar el mecanismo generando, para cada lista, la secuencia de
   cocientes (votos divididos por 1, 2, 3...) y seleccionando los cocientes
   más altos en general hasta completar el total de bancas a repartir.
4. Definir qué pasa ante un empate exacto en el último cociente que decide
   una banca (caso raro pero posible): documentar el criterio elegido (por
   ejemplo, mayor votación total de la lista) en vez de dejarlo librado al
   orden accidental en que quedaron los datos en memoria.
5. Verificar la función contra el ejemplo hecho a mano del paso 1, y luego
   contra el JSON de ejemplo de concejales una vez que tengas (de HU-02.2)
   una cantidad de bancas de referencia para ese distrito.

Conceptos/librerías: método de divisores D'Hondt.

---

**☐ HU-02.4 — Conectar la lógica pura a las pantallas de Fase 1**

*Como* usuario, *quiero* que la pantalla de Concejales muestre el reparto
real de bancas (todavía con el JSON de ejemplo, no con datos del TSJE en
vivo), *para* ver el sistema electoral funcionando de punta a punta antes de
sumar la complejidad de la base de datos.

Paso a paso:
1. En la pantalla de Concejales de HU-01.5, reemplazar el espacio
   reservado/ficticio de reparto de bancas aplicando, en este orden: la
   función de HU-02.2 (bancas según electores del fixture de ejemplo) → la
   función de HU-02.3 (D'Hondt entre listas) → la función de HU-02.1
   (orden preferencial dentro de cada lista, para saber qué personas
   específicas ocupan las bancas ganadas por su lista).
2. Implementar `DHondtTable` mostrando, por lista, sus votos, el cociente
   usado, y la cantidad de bancas obtenidas.
3. Implementar `ElectedList` mostrando los nombres de las personas que
   efectivamente ocupan una banca, tomando de cada lista tantos nombres (en
   el orden de HU-02.1) como bancas le tocaron.
4. Confirmar con el JSON de ejemplo que la cantidad total de bancas
   mostradas coincide con la calculada en HU-02.2, y que ninguna lista
   aparece con más bancas ocupadas de las que ganó.
5. Comparar visualmente contra el mockup correspondiente.

Conceptos/librerías: composición de las tres funciones de dominio,
verificación cruzada de invariantes (total de bancas mostradas = total
calculado).

### Fase 3 — Base de datos

**☐ HU-03.1 — Modelado del schema Prisma**

*Como* desarrollador, *quiero* definir `Eleccion`, `Candidatura`,
`Departamento`, `Distrito`, `SyncRun`, `ResultadoLista` y
`ResultadoPreferencial` en Prisma, *para* tener un modelo relacional que
refleje el dominio.

Paso a paso:
1. Instalar y configurar Prisma en el proyecto, generando el archivo de
   esquema inicial.
2. Definir `Eleccion` (identificador interno, código TSJE, nombre, fecha,
   si está activa).
3. Definir `Candidatura`, relacionada con `Eleccion` (una elección tiene
   varias candidaturas).
4. Definir `Departamento` y `Distrito`, respetando que en el TSJE el
   departamento depende de elección+candidatura (no es un catálogo único
   global), y que distrito depende de departamento.
5. Definir `SyncRun`, relacionado con elección/candidatura/departamento/
   distrito, con un campo de estado (ok/error), timestamp, y los campos de
   totales (mesas, blancos, nulos, votos totales, electores, no
   computados).
6. Definir `ResultadoLista`, relacionado con `SyncRun` (un sync run tiene
   varios resultados de lista), con los campos del candidato/lista.
7. Definir `ResultadoPreferencial`, relacionado con `ResultadoLista` (una
   lista tiene varios preferenciales), con los campos de cada candidato
   preferencial.
8. Antes de generar la migración, dibujar (a mano o en una herramienta
   simple) el diagrama entidad-relación completo, para detectar relaciones
   faltantes o mal dirigidas mientras es barato corregirlas.
9. Generar la migración inicial localmente y revisar el SQL generado para
   confirmar que refleja lo que pensabas modelar.

Conceptos/librerías: Prisma schema, relaciones uno-a-muchos, claves
foráneas, migraciones.

---

**☐ HU-03.2 — Provisionar Postgres y correr la primera migración**

*Como* desarrollador, *quiero* una base Neon conectada por Prisma tanto en
local (branch de dev) como en producción, *para* tener persistencia real.

Paso a paso:
1. Crear un proyecto en Neon con dos bases (o un branch de desarrollo y uno
   de producción).
2. Obtener las cadenas de conexión de cada una: la de desarrollo va a tu
   `.env` local (nunca commiteado); la de producción va a las variables de
   entorno de Vercel.
3. Correr la migración de HU-03.1 contra la base de desarrollo y confirmar
   en el panel de Neon que las tablas se crearon con la forma esperada.
4. Correr la migración contra producción (para un proyecto de práctica,
   está bien hacerlo manualmente la primera vez, y automatizarlo como paso
   de build recién si se vuelve una tarea repetitiva).
5. Confirmar que el proyecto sigue deployando correctamente en Vercel con
   las nuevas variables de entorno configuradas.

Conceptos/librerías: Neon (branching de bases de datos), `DATABASE_URL`,
migraciones de Prisma en distintos ambientes.

---

**☐ HU-03.3 — Seed de datos de referencia**

*Como* desarrollador, *quiero* poblar `Eleccion`/`Candidatura`/
`Departamento`/`Distrito` a partir de los JSON de `docs/`, *para* no tener
que cargarlos a mano.

Paso a paso:
1. Escribir un script de seed que lea los cuatro archivos JSON originales de
   `docs/` (o una copia de ellos pensada para este propósito).
2. Implementar el parseo del formato `var jsonX = {...}`, aislando la parte
   después del signo igual antes de interpretarla como datos.
3. Recorrer la estructura anidada (elección → candidatura → departamento →
   distrito) e insertar filas normalizadas respetando las relaciones del
   schema de HU-03.1.
4. Marcar como `activa` la elección que vayas a usar durante las siguientes
   fases (probablemente la 44, ya que trae ambas candidaturas de interés:
   intendente y concejales).
5. Correr el seed contra la base de desarrollo y verificar con una consulta
   simple que la cantidad de departamentos/distritos insertados coincide
   con lo esperado (17 departamentos + Capital, y la cantidad de distritos
   por departamento).
6. Dejar el script de seed re-ejecutable de forma segura (que no duplique
   filas si se corre dos veces), ya que probablemente lo vas a correr
   varias veces mientras ajustás el modelo.

Conceptos/librerías: scripts de seed de Prisma, parseo de JSON con forma
irregular, operaciones idempotentes (upsert).

### Fase 4 — Sync manual (un distrito)

**☐ HU-04.1 — Endpoint de sincronización**

*Como* desarrollador, *quiero* un Route Handler `POST /api/sync` que llame
al TSJE real, valide la respuesta y guarde un `SyncRun`, *para* tener la
pieza central de la que dependen todas las fases siguientes.

Paso a paso:
1. Crear el Route Handler de `POST /api/sync`, recibiendo como entrada
   candidatura, departamento y distrito (la elección puede tomarse de la
   marcada como `activa` en la base, ya que normalmente hay una sola
   elección activa a la vez).
2. Construir la URL real del TSJE usando la URL base y el código de
   elección como variables de entorno, nunca hardcodeadas en el handler.
3. Hacer el `fetch` del lado servidor hacia esa URL.
4. Definir con Zod el esquema exacto esperado de la respuesta (totales,
   arreglo de candidatos con sus campos, y opcionalmente
   `candidatosPref`), y validar la respuesta contra ese esquema antes de
   tocar la base de datos.
5. Si la validación falla, o si el `fetch` falla (timeout, error de red,
   status HTTP de error), guardar igual un `SyncRun` con estado error y un
   mensaje descriptivo, en vez de dejar que el request completo falle sin
   dejar rastro.
6. Si la validación pasa, crear el `SyncRun` con estado ok y sus
   `ResultadoLista`/`ResultadoPreferencial` asociados, todo dentro de una
   única transacción de base de datos (para no dejar resultados a medio
   guardar si algo falla a mitad de camino).
7. Devolver como respuesta del endpoint el `SyncRun` recién creado con sus
   resultados.
8. Probar el endpoint manualmente (Postman/Insomnia o `curl`) contra una
   combinación real de departamento/distrito **antes** de conectarlo a la
   UI, para aislar errores de backend de errores de frontend.

Conceptos/librerías: Route Handlers de Next.js, `fetch` server-side, Zod,
transacciones de Prisma, manejo de errores HTTP.

---

**☐ HU-04.2 — Conectar el botón de sync real**

*Como* usuario, *quiero* que el botón "Sincronizar" dispare el sync real y
actualice la vista, *para* obtener datos frescos bajo demanda.

Paso a paso:
1. Instalar y configurar TanStack Query (proveedor global en el layout raíz).
2. En la pantalla correspondiente, crear una mutación que llame a
   `POST /api/sync` con los parámetros elegidos.
3. Mientras la mutación está en curso, deshabilitar el botón y mostrar un
   indicador de carga, para evitar que el usuario dispare varias
   sincronizaciones superpuestas para la misma combinación.
4. Al completarse con éxito, invalidar solo la query de resultados de esa
   combinación específica (no todas las queries del proyecto), para que la
   pantalla de resultados vuelva a pedir los datos y refleje lo recién
   sincronizado.
5. Si la mutación falla, mostrar un mensaje de error claro (distinguiendo,
   si es posible, "el TSJE no respondió" de "hubo un problema en nuestro
   servidor"), sin dejar la aplicación en un estado inconsistente.
6. Probar el flujo completo manualmente: elegir una combinación real,
   sincronizar, y confirmar que los datos mostrados coinciden con lo que
   devuelve el TSJE en ese momento.

Conceptos/librerías: mutaciones de TanStack Query, invalidación selectiva
de queries, estados de carga/error en UI.

---

**☐ HU-04.3 — Indicador de última sincronización**

*Como* usuario, *quiero* ver "última actualización: hace X minutos" en cada
distrito, *para* saber qué tan frescos son los datos que estoy mirando.

Paso a paso:
1. Exponer, como parte de la respuesta de la pantalla de resultados, el
   timestamp del `SyncRun` más reciente con estado ok para la combinación
   mostrada.
2. En el frontend, calcular y mostrar una diferencia relativa legible
   ("hace 3 minutos", "hace 1 hora") a partir de ese timestamp.
3. Decidir si ese texto se recalcula solo cada cierto intervalo corto
   mientras la pantalla está abierta, o solo al recargar/refetchear — para
   un proyecto de práctica alcanza con un recálculo periódico simple, sin
   necesidad de un sistema de tiempo real complejo.
4. Mostrar de forma visible si la combinación nunca fue sincronizada (sin
   ningún `SyncRun`), diferenciándolo claramente de "sincronizado hace
   mucho tiempo".

Conceptos/librerías: formateo de fechas relativas, actualización periódica
ligera en el cliente.

### Fase 5 — Pantallas con datos reales

**☐ HU-05.1 — Resultados · Intendente con datos reales**

*Como* usuario, *quiero* ver el resultado real de Intendente de un distrito
ya sincronizado, *para* dejar de depender de datos de ejemplo.

Paso a paso:
1. Reemplazar el fixture estático de HU-01.4 por una llamada real (vía
   TanStack Query) a un endpoint `GET` que devuelva el `SyncRun` más
   reciente con estado ok para la combinación elegida, junto con sus
   `ResultadoLista`.
2. Mantener sin cambios toda la lógica de presentación (ordenamiento,
   cálculo de porcentajes, componentes `StatTile`/`PartyChip`/`VoteBar`) —
   el objetivo de esta historia es *solo* cambiar el origen de los datos,
   no la presentación.
3. Confirmar visualmente que la pantalla se ve igual que en HU-01.4 pero
   con datos que vienen de tu propia base, ya sincronizados con el botón de
   la Fase 4.
4. Probar sincronizar dos veces seguidas la misma combinación y confirmar
   que la pantalla siempre muestra el `SyncRun` más reciente, no uno viejo.

Conceptos/librerías: queries de TanStack Query sobre tu propia API,
separación entre origen de datos y presentación.

---

**☐ HU-05.2 — Resultados · Concejales con reparto real de bancas**

*Como* usuario, *quiero* ver el reparto real de bancas de un distrito ya
sincronizado, *para* ver el sistema electoral funcionando con datos reales.

Paso a paso:
1. Repetir el reemplazo de origen de datos de HU-05.1, pero para la
   pantalla de Concejales, incluyendo los `ResultadoPreferencial` anidados.
2. Confirmar que la lógica electoral de la Fase 2 (orden preferencial,
   bancas según electores, D'Hondt) sigue funcionando igual al recibir
   datos reales en vez del fixture de ejemplo, sin necesidad de modificar
   esas funciones. Si hiciera falta modificarlas, es señal de que estaban
   acopladas a la forma exacta del fixture en vez de a un tipo genérico, y
   conviene corregir eso antes de seguir.
3. Elegir un distrito real ya sincronizado y verificar a mano (aunque sea
   de forma aproximada) que el reparto de bancas mostrado tiene sentido con
   los votos reales de ese distrito.

Conceptos/librerías: mismos de HU-05.1, aplicados a la pantalla de
Concejales.

---

**☐ HU-05.3 — Estados vacío/carga/error reales**

*Como* usuario, *quiero* mensajes claros cuando un distrito no fue
sincronizado o cuando algo falló, *para* entender qué está pasando sin
confundirlo con un error de la aplicación.

Paso a paso:
1. En las pantallas de Intendente y Concejales, definir tres estados
   visuales diferenciados: cargando (mientras se pide el dato), vacío (la
   combinación existe pero nunca fue sincronizada), y error (la última
   sincronización de esa combinación falló).
2. Para el estado vacío, incluir un llamado a la acción claro (por ejemplo,
   un botón para sincronizar esa combinación).
3. Para el estado de error, mostrar el motivo guardado en el `SyncRun`
   fallido de forma legible, sin exponer detalles técnicos internos
   innecesarios.
4. Probar los tres estados intencionalmente: pidiendo una combinación nunca
   sincronizada, una recién sincronizada con éxito, y forzando un error
   (por ejemplo apuntando momentáneamente a una URL del TSJE inválida) para
   confirmar que cada estado se ve como corresponde.

Conceptos/librerías: manejo de estados de UI (loading/empty/error) como
casos de primera clase, no como un afterthought.

### Fase 6 — Panorama nacional

**☐ HU-06.1 — Endpoint de agregación nacional**

*Como* desarrollador, *quiero* un endpoint que agregue resultados de todos
los distritos ya sincronizados, *para* alimentar la vista de panorama sin
recalcular todo en el cliente.

Paso a paso:
1. Diseñar la consulta que, para cada distrito con al menos un `SyncRun`
   exitoso, toma su resultado más reciente y lo agrega a nivel nacional
   (por ejemplo: quién ganó la intendencia en cada distrito, sumado por
   partido; o el total de bancas de concejales ganadas por partido a nivel
   país, sumando el D'Hondt de cada distrito ya sincronizado).
2. Decidir explícitamente cómo se refleja en la agregación que todavía no
   todos los distritos del país fueron sincronizados (por ejemplo,
   mostrando cuántos de los distritos totales tienen datos), para que el
   panorama nunca dé la impresión de estar completo cuando es parcial.
3. Implementar el endpoint `GET` que devuelve esta agregación ya calculada
   del lado del servidor, en vez de traer todos los resultados crudos al
   cliente y agregar ahí.
4. Probar el endpoint con la cantidad de distritos que tengas sincronizados
   hasta el momento y confirmar que los números agregados son consistentes
   con sumar a mano esos pocos casos.

Conceptos/librerías: consultas de agregación en Prisma/SQL, diseño de
endpoints que devuelven datos ya procesados.

---

**☐ HU-06.2 — Pantalla Panorama nacional con datos reales**

*Como* usuario, *quiero* ver el panorama nacional con datos reales, *para*
tener una visión general del avance del conteo.

Paso a paso:
1. Reemplazar el fixture ficticio de HU-01.6 por el resultado real del
   endpoint de HU-06.1.
2. Mostrar explícitamente el indicador de cobertura ("X de Y distritos con
   datos") junto al `SeatDistributionBar`.
3. Confirmar que la pantalla se actualiza correctamente a medida que se
   sincronizan manualmente más distritos (probar sincronizando uno nuevo y
   recargando el panorama).

Conceptos/librerías: mismos de HU-06.1, aplicados a la UI.

### Fase 7 — Sync masivo

**☐ HU-07.1 — Endpoint de sync masivo con concurrencia limitada**

*Como* desarrollador, *quiero* sincronizar muchas combinaciones sin saturar
al TSJE ni a mi propia función serverless, *para* poder actualizar todo el
país en una operación.

Paso a paso:
1. Diseñar la lista completa de combinaciones a sincronizar para "todo el
   país" en una candidatura dada, recorriendo todos los departamentos y,
   dentro de cada uno, todos sus distritos, según los datos sembrados en la
   Fase 3.
2. Reutilizar exactamente la misma función de sync de una sola combinación
   (HU-04.1) — el endpoint masivo orquesta muchas llamadas a esa lógica
   central, no la reimplementa.
3. Implementar un límite de concurrencia explícito (por ejemplo, nunca más
   de 5 combinaciones sincronizándose al mismo tiempo), procesando el resto
   en tandas.
4. Asegurar que si una combinación falla, el proceso continúa con las
   siguientes sin detenerse, y que al final se puede consultar un resumen:
   cuántas terminaron ok, cuántas con error, y cuáles.
5. Tener en cuenta el límite de tiempo de ejecución de las funciones
   serverless de Vercel: si sincronizar todo el país no entra en ese
   límite, dividir el trabajo en llamadas más chicas (por ejemplo, un
   request por departamento) en vez de un único request gigante.

Conceptos/librerías: control de concurrencia (ej. `p-limit`), manejo de
fallos parciales, límites de ejecución de funciones serverless.

---

**☐ HU-07.2 — UI de progreso de sync masivo**

*Como* usuario, *quiero* ver el progreso de un sync masivo mientras corre,
*para* entender el estado del proceso sin quedarme mirando una pantalla en
blanco.

Paso a paso:
1. Diseñar cómo se dispara y se sigue el progreso desde la UI, considerando
   que puede tardar más que un solo request HTTP (por eso conviene
   dividirlo en varias llamadas más chicas, como se decidió en HU-07.1, y
   que el frontend las vaya disparando y acumulando resultados).
2. Mostrar contadores claros: total de combinaciones, cuántas ya están ok,
   cuántas pendientes, cuántas con error.
3. Listar explícitamente las combinaciones con error, con la posibilidad de
   reintentar solo esas (llamando de nuevo al endpoint individual de
   HU-04.1 para cada una), sin volver a correr todo el proceso completo.
4. Probar el flujo completo con un subconjunto chico primero (un solo
   departamento) antes de probarlo con el país completo, para no depender
   de un caso lento para detectar errores de lógica.

Conceptos/librerías: orquestación de múltiples llamadas desde el cliente,
UI de progreso/reintento.

### Fase 8 — Sync automático

**☐ HU-08.1 — Cron de sincronización automática**

*Como* desarrollador, *quiero* que el sync masivo corra solo cada N minutos
configurable durante el conteo, *para* no depender de que alguien apriete
el botón manualmente.

Paso a paso:
1. Definir en la configuración de Vercel un cron job que llame
   periódicamente a un endpoint interno propio (no directamente al
   endpoint de sync masivo expuesto al usuario, para poder protegerlo de
   forma distinta).
2. Proteger ese endpoint interno con un secreto (por ejemplo, un valor que
   Vercel envía automáticamente en las llamadas de cron y que el endpoint
   valida antes de hacer cualquier trabajo), para que no cualquiera que
   descubra la URL pueda dispararlo desde afuera.
3. Hacer que ese endpoint interno ejecute la misma lógica de sync masivo de
   la Fase 7, reutilizando en vez de duplicar.
4. Definir el intervalo del cron como una decisión consciente y
   documentada: balancear "qué tan frescos quiero los datos" contra
   "cuántas llamadas le hago al TSJE en total durante todo un día de
   conteo", dejando el intervalo fácil de cambiar (variable de entorno),
   ya que puede necesitar ajustarse el día real de la elección según cómo
   responda el TSJE bajo carga.
5. Probar el cron en el ambiente de Vercel (no corre en desarrollo local de
   la misma forma) y confirmar en los logs que se ejecuta en los horarios
   esperados y que efectivamente crea nuevos `SyncRun`.

Conceptos/librerías: Vercel Cron Jobs, protección de endpoints internos,
configuración de intervalos como parámetro externo.

### Fase 9 — Testing + CI

**☐ HU-09.1 — Tests de la lógica electoral**

*Como* desarrollador, *quiero* tests automáticos de orden preferencial,
bancas-por-electores y D'Hondt, *para* tener cubierta la parte con más
riesgo de error silencioso de todo el proyecto.

Paso a paso:
1. Configurar Vitest (instalación, archivo de configuración, script `test`
   en `package.json`).
2. Escribir casos de prueba para la función de orden preferencial (HU-02.1)
   usando el JSON de ejemplo de concejales como entrada, verificando el
   orden de salida exacto.
3. Escribir casos de prueba para bancas según electores (HU-02.2),
   cubriendo al menos un valor típico dentro de cada tramo, y los valores
   límite exactos entre dos tramos (para detectar errores de "mayor o
   igual" vs "mayor estricto").
4. Escribir casos de prueba para D'Hondt (HU-02.3), incluyendo el caso
   simple hecho a mano en esa historia, y al menos un caso con más de dos
   listas.
5. Confirmar que los tests fallan intencionalmente si rompés algo a
   propósito (comentando una línea clave), como forma de verificar que
   realmente están probando lo que creés, no pasando siempre sin importar
   el código.

Conceptos/librerías: Vitest, diseño de casos de prueba con valores límite.

---

**☐ HU-09.2 — Tests de componentes clave**

*Como* desarrollador, *quiero* tests de `DHondtTable`, `ElectedList` y la
pantalla de selección, *para* detectar regresiones de UI temprano.

Paso a paso:
1. Configurar React Testing Library junto con Vitest.
2. Escribir tests para `DHondtTable` y `ElectedList`, confirmando que
   muestran la cantidad de bancas y los nombres correctos dado un resultado
   de ejemplo ya calculado (sin recalcular D'Hondt dentro del test de UI,
   ya que eso está cubierto en HU-09.1).
3. Escribir tests para la pantalla de selección (HU-01.2), confirmando que
   el selector de distrito permanece deshabilitado hasta elegir un
   departamento, y que cambiar la elección resetea las selecciones
   dependientes.
4. Usar selectores de test basados en rol/accesibilidad (por ejemplo, "por
   su rol de combobox y su nombre accesible") en vez de basarse en detalles
   de implementación como clases CSS, para que los tests no se rompan con
   cambios puramente visuales.

Conceptos/librerías: React Testing Library, consultas por rol/accesibilidad.

---

**☐ HU-09.3 — CI en GitHub Actions**

*Como* desarrollador, *quiero* que cada PR corra typecheck, lint y tests
automáticamente, *para* no poder mergear algo roto.

Paso a paso:
1. Crear el workflow de GitHub Actions que se dispare en cada Pull Request
   (y opcionalmente en cada push a `main`).
2. Definir los pasos: instalar dependencias, correr el chequeo de tipos de
   TypeScript sin generar archivos de salida, correr ESLint, y correr la
   suite de tests de Vitest.
3. Configurar la protección de la rama `main` en GitHub para que ese
   workflow sea un check requerido antes de poder mergear un PR.
4. Probar el workflow intencionalmente con un PR que rompa algo (un error
   de tipos) para confirmar que efectivamente bloquea el merge, y después
   corregirlo para ver el check pasar en verde.

Conceptos/librerías: GitHub Actions, `tsc --noEmit`, ESLint, protección de
ramas.

### Fase 10 — Pulido y publicación

**☐ HU-10.1 — Accesibilidad y estados finales en todas las pantallas**

Paso a paso:
1. Recorrer las cinco pantallas del mockup una por una revisando: contraste
   de color suficiente entre texto y fondo (especialmente en los
   `StatusBadge` de colores), que todo elemento interactivo sea alcanzable
   por teclado, y que imágenes/iconos decorativos no interrumpan la
   navegación por lectores de pantalla.
2. Confirmar que todos los estados de carga/vacío/error definidos en
   HU-05.3 están efectivamente implementados en las cinco pantallas, no
   solo en las que se usaron como ejemplo durante el desarrollo.
3. Revisar el comportamiento en pantallas muy angostas y muy anchas una
   última vez de punta a punta.

Conceptos/librerías: contraste de color (WCAG), navegación por teclado,
revisión con lector de pantalla.

---

**☐ HU-10.2 — README completo**

Paso a paso:
1. Escribir una descripción clara del proyecto: qué hace, para qué sirve, y
   el disclaimer de proyecto personal no oficial.
2. Documentar los pasos para correr el proyecto localmente: variables de
   entorno necesarias (referenciando `.env.example`), cómo correr
   migraciones y seed, cómo levantar el servidor de desarrollo.
3. Documentar cómo disparar una sincronización manual desde la UI, con una
   o dos capturas de las pantallas principales.
4. Incluir el enlace a la URL pública desplegada en Vercel.
5. Resumir brevemente el stack usado y por qué (podés apoyarte en la tabla
   de la sección 1 de este documento).

---

**☐ HU-10.3 — Publicación final**

Paso a paso:
1. Confirmar que `main` está en un estado estable y desplegado
   correctamente en producción.
2. Crear el tag `v1.0.0` sobre el último commit de `main`.
3. Redactar la publicación para LinkedIn/portfolio, enlazando el
   repositorio y la URL pública desplegada.
4. (Opcional) Agregar topics en GitHub (`typescript`, `react`, `nextjs`,
   `elections`, etc.) para mejorar su descubribilidad.

---

## 6. Riesgos y supuestos a validar durante la implementación

- **Tramos legales de bancas por electores (HU-02.2):** deben verificarse
  contra la normativa vigente antes de dar la historia por cerrada.
- **Formato de referencia (`departamentos.json`/`distritos.json`) para la
  elección municipal real:** estos JSON corresponden a elecciones internas
  partidarias (códigos 44/45). Cuando el TSJE publique el código de la
  elección municipal real, hay que confirmar que la estructura de referencia
  (departamento/distrito) se mantenga igual antes de reusar el seed de
  HU-03.3 tal cual.
- **Estabilidad del endpoint del TSJE:** al no ser una API documentada
  públicamente, el `fetch` server-side (HU-04.1) debe tratar cualquier
  cambio de forma como un error recuperable (vía la validación con Zod), no
  como algo que puede asumirse estable para siempre.
