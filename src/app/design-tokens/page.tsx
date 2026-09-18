/**
 * Página temporal para comparar visualmente los tokens de Tailwind contra
 * docs/escrutinio-design-system.html (HU-00.2). No forma parte de la
 * navegación del producto — se puede borrar una vez verificado, o dejarse
 * fuera de cualquier menú.
 *
 * Importante: todas las clases de Tailwind de esta página están escritas
 * como strings literales completos (nunca `` `bg-${var}` ``), porque
 * Tailwind v4 genera el CSS escaneando el código fuente en busca de esos
 * strings — no ejecuta el JS, así que una clase armada dinámicamente nunca
 * sería detectada.
 */

const surfaceSwatches = [
  { cls: "bg-surface-0", label: "surface-0" },
  { cls: "bg-surface-100", label: "surface-100" },
  { cls: "bg-surface-200", label: "surface-200" },
  { cls: "bg-surface-300", label: "surface-300" },
] as const;

const inkSamples = [
  { cls: "text-ink-900", label: "ink-900" },
  { cls: "text-ink-700", label: "ink-700" },
  { cls: "text-ink-500", label: "ink-500" },
] as const;

const stateSwatches = [
  { cls: "bg-accent-solid", label: "Accent (En vivo)" },
  { cls: "bg-positive-solid", label: "Positive (Electo)" },
  { cls: "bg-warning-solid", label: "Warning (Provisorio)" },
  { cls: "bg-info-solid", label: "Info" },
] as const;

const statusBadges = [
  { bgCls: "bg-status-provisorio-subtle", textCls: "text-status-provisorio-text", label: "Provisorio" },
  { bgCls: "bg-status-envivo-subtle", textCls: "text-status-envivo-text", label: "En vivo" },
  { bgCls: "bg-status-electo-subtle", textCls: "text-status-electo-text", label: "Electo" },
] as const;

const fallbackSwatches = [
  { cls: "bg-fallback-a", label: "fallback-a" },
  { cls: "bg-fallback-b", label: "fallback-b" },
  { cls: "bg-fallback-c", label: "fallback-c" },
  { cls: "bg-fallback-d", label: "fallback-d" },
  { cls: "bg-fallback-e", label: "fallback-e" },
] as const;

const radii = [
  { cls: "rounded-sm", label: "sm" },
  { cls: "rounded-md", label: "md" },
  { cls: "rounded-lg", label: "lg" },
  { cls: "rounded-full", label: "full" },
] as const;

const shadows = [
  { cls: "shadow-sm", label: "sm" },
  { cls: "shadow-md", label: "md" },
  { cls: "shadow-lg", label: "lg" },
] as const;

const spacingSamples = [
  { cls: "p-1", label: "p-1" },
  { cls: "p-2", label: "p-2" },
  { cls: "p-3", label: "p-3" },
  { cls: "p-4", label: "p-4" },
  { cls: "p-5", label: "p-5" },
  { cls: "p-6", label: "p-6" },
  { cls: "p-8", label: "p-8" },
  { cls: "p-10", label: "p-10" },
  { cls: "p-12", label: "p-12" },
  { cls: "p-16", label: "p-16" },
] as const;

function Swatch({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`h-16 w-full rounded-md border border-border ${colorClass}`} />
      <span className="font-mono text-xs text-ink-700">{label}</span>
    </div>
  );
}

export default function DesignTokensPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-12 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-4xl">
          Tokens de diseño — Escrutinio
        </h1>
        <p className="text-ink-700">
          Comparar esta página contra <code>docs/escrutinio-design-system.html</code>.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Superficies</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {surfaceSwatches.map((s) => (
            <Swatch key={s.label} colorClass={s.cls} label={s.label} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Tinta de texto</h2>
        <div className="grid grid-cols-3 gap-4">
          {inkSamples.map((s) => (
            <div key={s.label} className={`rounded-md bg-surface-100 p-4 ${s.cls}`}>
              {s.label}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Familias de estado</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stateSwatches.map((s) => (
            <Swatch key={s.label} colorClass={s.cls} label={s.label} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">StatusBadge (alias semánticos)</h2>
        <div className="flex flex-wrap gap-3">
          {statusBadges.map((s) => (
            <span
              key={s.label}
              className={`rounded-full px-3 py-1 text-sm font-medium ${s.bgCls} ${s.textCls}`}
            >
              {s.label}
            </span>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Colores de reserva (sin colLista)</h2>
        <div className="grid grid-cols-5 gap-4">
          {fallbackSwatches.map((s) => (
            <Swatch key={s.label} colorClass={s.cls} label={s.label} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Tipografía</h2>
        <p className="font-[family-name:var(--font-display)] text-2xl">
          Display — Newsreader
        </p>
        <p className="font-sans text-lg">Body/Sans — Public Sans</p>
        <p className="font-mono text-sm">Data/Mono — IBM Plex Mono — 132.736 votos</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Radios</h2>
        <div className="flex flex-wrap gap-4">
          {radii.map((r) => (
            <div
              key={r.label}
              className={`flex h-16 w-16 items-center justify-center bg-surface-200 text-xs ${r.cls}`}
            >
              {r.label}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Sombras</h2>
        <div className="flex flex-wrap gap-6">
          {shadows.map((s) => (
            <div
              key={s.label}
              className={`flex h-16 w-24 items-center justify-center rounded-md bg-surface-100 text-xs ${s.cls}`}
            >
              shadow-{s.label}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4 pb-16">
        <h2 className="text-xl font-semibold">Espaciado (escala por defecto de Tailwind)</h2>
        <div className="flex flex-wrap items-end gap-2">
          {spacingSamples.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <div className={`w-4 bg-accent-solid ${s.cls}`} />
              <span className="font-mono text-[10px] text-ink-500">{s.label}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
