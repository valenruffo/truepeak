"use client";

export default function GuidePage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-4 md:px-6" style={{ color: "#fafafa" }}>
      <h1 className="text-2xl font-bold mb-2">Cómo usar True Peak AI</h1>
      <p className="text-sm text-muted mb-8">Guía paso a paso para sacarle el máximo provecho a tu sello.</p>

      {/* Paso 1 */}
      <div className="mb-8 p-5 rounded" style={{ background: "#0c0c0e", border: "1px solid #27272a" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>1</span>
          <h2 className="text-lg font-semibold">Compartí tu link de demos</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Andá a <strong style={{ color: "#10b981" }}>Link</strong> en el menú. Ahí vas a encontrar la URL pública de tu sello. 
          Copiala y compartila con productores en redes sociales, bio de Instagram, grupos de WhatsApp, donde quieras.
          <br /><br />
          Esa página tiene tu logo, nombre del sello y un formulario para que te envíen tracks en WAV, FLAC o AIFF. 
          También podés personalizar el título y la descripción desde <strong style={{ color: "#10b981" }}>Link</strong>.
        </p>
      </div>

      {/* Paso 2 */}
      <div className="mb-8 p-5 rounded" style={{ background: "#0c0c0e", border: "1px solid #27272a" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>2</span>
          <h2 className="text-lg font-semibold">Configurá tu firma sónica</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Andá a <strong style={{ color: "#10b981" }}>Firma sónica</strong>. Acá le decís a la IA qué tipo de música buscás:
        </p>
        <div className="mt-3 space-y-2 text-sm text-muted">
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>Rango de BPM:</strong> El tempo que esperás (ej: 120-128 para house).</span>
          </div>
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>LUFS objetivo:</strong> El volumen integrado (ej: -14 LUFS es estándar de streaming). Cuanto más negativo, más dinámico; cuanto más cercano a 0, más comprimido.</span>
          </div>
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>Duración máx.:</strong> Descarta automáticamente tracks muy largos (ej: sets de 2 horas).</span>
          </div>
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>Escalas preferidas:</strong> Las escalas musicales que buscás. El análisis detecta la escala del track automáticamente.</span>
          </div>
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>Reglas de auto-rechazo:</strong> Si el track tiene fase invertida, LUFS fuera de rango o tempo incorrecto, se rechaza solo y ni lo ves en la bandeja.</span>
          </div>
        </div>
      </div>

      {/* Paso 3 */}
      <div className="mb-8 p-5 rounded" style={{ background: "#0c0c0e", border: "1px solid #27272a" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>3</span>
          <h2 className="text-lg font-semibold">Revisá las demos</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Andá a <strong style={{ color: "#10b981" }}>Demos</strong>. Acá ves todas las submissions que recibiste:
          <br /><br />
          <strong>Pendientes</strong> (cyan) → tracks nuevos que pasaron los filtros automáticos.<br />
          <strong>Aprobados</strong> (verde) → los que ya escuchaste y te gustaron.<br />
          <strong>Rechazados</strong> (rojo) → los que descartaste.<br /><br />
          En cada demo podés: escuchar (▶), ver métricas (BPM, LUFS, fase, escala, duración), 
          aprobar, rechazar, descargar el archivo original (⬇), y eliminar (🗑).
        </p>
      </div>

      {/* Paso 4 */}
      <div className="mb-8 p-5 rounded" style={{ background: "#0c0c0e", border: "1px solid #27272a" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>4</span>
          <h2 className="text-lg font-semibold">Contactá a los productores</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Andá a <strong style={{ color: "#10b981" }}>CRM</strong>. Ahí aparecen automáticamente todos los productores cuyos tracks aprobaste o rechazaste.
          <br /><br />
          Elegí un contacto, seleccioná una plantilla de email (rechazo, aprobación, seguimiento) y 
          personalizá el mensaje. El email se envía desde <strong>tu sello</strong> y las respuestas llegan a 
          <strong>tu correo personal</strong>.
          <br /><br />
          Tip: desde Demos podés saltar al CRM con el link 📧 al lado del productor, y viceversa.
        </p>
      </div>

      {/* Calidad de audio */}
      <div className="mb-8 p-5 rounded" style={{ background: "#0c0c0e", border: "1px solid #10b98130" }}>
        <h2 className="text-lg font-semibold mb-3" style={{ color: "#10b981" }}>🎵 Calidad de audio</h2>
        <div className="space-y-2 text-sm text-muted">
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>Reproductor web:</strong> MP3 320kbps — calidad óptima para escucha rápida sin consumir datos.</span>
          </div>
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>Descarga:</strong> Formato original HQ (WAV, FLAC, AIFF) — el archivo exacto que subió el productor, sin compresión.</span>
          </div>
          <div className="flex gap-2">
            <span style={{ color: "#10b981" }}>▪</span>
            <span><strong>Almacenamiento:</strong> Límite de 10 demos HQ simultáneas. Eliminá las que no uses para liberar espacio (contador en sidebar).</span>
          </div>
        </div>
      </div>

      {/* Glosario */}
      <div className="p-5 rounded" style={{ background: "#0c0c0e", border: "1px solid #27272a" }}>
        <h2 className="text-lg font-semibold mb-3">📖 Glosario de métricas</h2>
        <div className="space-y-3 text-sm text-muted">
          <div>
            <strong style={{ color: "#fafafa" }}>BPM</strong> — Beats Per Minute. El tempo del track. House suele andar en 120-128, techno en 125-135.
          </div>
          <div>
            <strong style={{ color: "#fafafa" }}>LUFS</strong> — Loudness Units Full Scale. Mide el volumen percibido. -14 LUFS es el estándar de Spotify. 
            Un track a -8 LUFS va a sonar mucho más fuerte pero con menos dinámica.
          </div>
          <div>
            <strong style={{ color: "#fafafa" }}>Correlación de fase</strong> — Mide si el audio stereo está en fase (1.0 = perfecto, -1.0 = invertido, 0 = mono). 
            Valores bajos o negativos pueden causar cancelación en sistemas mono (clubs, phones).
          </div>
          <div>
            <strong style={{ color: "#fafafa" }}>Escala musical</strong> — La escala detectada (ej: Am, Fm, G). Útil para saber si el track encaja con el catálogo de tu sello.
          </div>
          <div>
            <strong style={{ color: "#fafafa" }}>Duración</strong> — Largo del track en minutos:segundos. Combinado con el filtro de duración máxima en Firma Sónica.
          </div>
        </div>
      </div>
    </div>
  );
}
