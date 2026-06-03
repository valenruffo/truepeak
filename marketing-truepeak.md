# True Peak — Manual de Marca, Planes y Estrategia de Marketing

Este documento consolida la identidad visual, la propuesta de valor y las estrategias comerciales de **True Peak** para optimizar la captación de sellos discográficos (B2B).

---

## 1. Identidad de Marca (Brand Identity)

True Peak proyecta una imagen tecnológica, minimalista, precisa y de calidad de estudio de audio. No es un juguete de inteligencia artificial generativa; es una **herramienta de ingeniería de audio de precisión** para profesionales.

### 1.1 Paleta de Colores (Diseño Oscuro por Defecto)
El sistema utiliza una interfaz oscura que emula un DAW (Digital Audio Workstation) moderno o software de estudio profesional:

| Elemento | Código HEX | Rol en la Interfaz | Significado Psicológico |
| :--- | :--- | :--- | :--- |
| **Fondo Principal** | `#09090b` | Fondo general de la app (Zinc muy oscuro) | Sobriedad, profundidad, enfoque en la música. |
| **Superficies / Tarjetas** | `#111114` | Contenedores, paneles Kanban y tarjetas | Separación limpia de la información. |
| **Acento Esmeralda** | `#10b981` | Botones de acción, estados exitosos, aprobación | Crecimiento, fluidez, pista aprobada. |
| **Acento Cian** | `#06b6d4` | Métricas técnicas secundarias, BPM, presets | Precisión digital, ciencia, análisis tecnológico. |
| **Alerta / Rechazo** | `#ef4444` | Tracks rechazados o advertencias técnicas | Acción rápida, parada, fuera de rango. |

### 1.2 Tipografía
La combinación tipográfica está diseñada para ser ultra-legible y con un toque tecnológico:
*   **Fuentes de Display / Títulos:** *Space Grotesk*. Aporta un look moderno, geométrico y futurista.
*   **Fuente de Cuerpo / Texto general:** *Inter*. La reina de la legibilidad en interfaces de usuario y paneles densos (Kanban).
*   **Fuente Monospace / Métricas:** *JetBrains Mono*. Se utiliza en valores de BPM, LUFS, fase y códigos para transmitir rigor numérico e ingeniería.

### 1.3 Logo
*   **Especificación Técnica:** Archivo cuadrado optimizado (redimensionado mediante Pillow a `512x512` píxeles en formato PNG optimizado).
*   **Concepto Visual:** Un círculo minimalista que representa la fase de una onda de audio combinada con el concepto del "pico" de volumen (True Peak). Debe ser simple, limpio y reconocible en tamaños reducidos (como avatar en la web de carga de demos).

---

## 2. Propuesta de Valor y Solución Técnica

### El Problema del Sello Discográfico
Los sellos de música electrónica reciben cientos de demos por semana a través de links de Dropbox, correos o mensajes de Instagram. El 80% de ese material es descartable de inmediato debido a:
1.  **Errores técnicos básicos:** Audio saturado (clipping), fase invertida (desaparece en sistemas de club mono).
2.  **Fuera de estilo:** Demos de Techno a 140 BPM enviadas a un sello de Deep House (122 BPM).
3.  **Falta de estructura:** Tracks sin volumen máster adecuado para DJ set.

Los A&R y dueños de sellos pierden horas de su día dándole "play" a música que técnicamente no califica.

### La Solución de True Peak
**True Peak** actúa como un **filtro inteligente y automatizado de pre-escucha**.
*   El productor sube su archivo original en alta calidad (WAV/FLAC/AIFF) a un enlace público personalizado del sello (ej: `truepeak.space/s/pedro`).
*   **Zero-Storage Lifecycle:** El sistema analiza las métricas de audio nativas, extrae BPM, LUFS (pyloudnorm), correlación de fase y tono musical (key) en segundos. Si el track cumple las reglas, se genera una vista previa en MP3 de 320kbps y se borra el WAV pesado inmediatamente para no saturar espacio. Si el track no califica, es rechazado automáticamente.
*   **Kanban Inbox:** Solo los demos que superan las pruebas de "Firma Sónica" del sello entran al buzón de entrada limpio del sello, listos para ser evaluados artísticamente.

---

## 3. Estructura de Planes de Suscripción (Tiers)

Ofrecemos un modelo SaaS escalable según el volumen del sello discográfico:

| Característica | Plan Free | Plan Indie (Boutique) | Plan Pro (Label Pro) |
| :--- | :--- | :--- | :--- |
| **Precio Mensual** | $0 | **$29 USD** | **$79 USD** |
| **Límite de Tracks/mes** | 10 demos recibidas | 100 demos recibidas | 1000 demos recibidas |
| **Emails de Feedback/mes** | 0 (Bloqueado) | 100 correos | 500 correos |
| **Retención de Archivos HQ** | 0 días (Borrado inmediato) | 7 días (WAV disponible para descarga) | 14 días (WAV disponible para descarga) |
| **Límite Almacenamiento HQ** | Máx. 10 tracks aprobados a la vez | Sin límite dentro de los 7 días | Sin límite dentro de los 14 días |
| **Generación de Emails** | No disponible | Incluido | Incluido |
| **Integraciones Sociales** | Básicas | Completas (Instagram/SoundCloud) | Completas + Personalización visual |

---

## 4. Estrategia de Marketing y Ventas (Go-to-Market)

Para vender un software B2B como True Peak, la clave no es vender "features técnicos", sino **vender tiempo recuperado y profesionalismo**.

### 4.1 Público Objetivo (Target Audience)
1.  **Label Managers / Dueños de Sellos Pequeños y Medianos:** Que manejan todo solos (A&R, marketing, distribución) y no tienen tiempo físico para escuchar 40 demos semanales.
2.  **Sellos de Clubes / Colectivos de DJs:** Que buscan música de alta fidelidad técnica que pueda sonar en un sistema de sonido Funktion-One sin romperlo.
3.  **Sellos Consolidados (Pro):** Que necesitan un sistema ordenado de Kanban CRM para que su equipo de A&R no duplique tareas escuchando los mismos archivos.

### 4.2 Ángulos de Venta Clave (Marketing Angles)
*   **Ángulo 1: "Recuperá 5 horas de tu fin de semana".**
    *   *Mensaje:* Dejá de descargar gigabytes de archivos de WeTransfer o Dropbox solo para darte cuenta en 5 segundos de que la mezcla está rota o fuera de tempo. True Peak lo hace por vos.
*   **Ángulo 2: "El guardián de tu sistema de sonido".**
    *   *Mensaje:* Asegurá la calidad técnica de tu sello discográfico antes de mandar a masterizar. Filtra tracks con fase desfasada o volumen saturado automáticamente.
*   **Ángulo 3: "La bandeja de entrada profesional que tu sello merece".**
    *   *Mensaje:* Reemplaza el caos del mail por un Kanban de CRM musical. Responde a los productores con feedback técnico personalizado generado por IA en dos clics.

---

## 5. Plantillas de Venta y Prospección (Cold Outreach Scripts)

### 5.1 Correo de Prospección en Frío (Cold Email Pitch)
**Asunto:** [Nombre del Sello] + ¿Cuántas demos de baja calidad borraron esta semana?

> Hola [Nombre del Label Manager/Fundador],
>
> Te escribo porque sigo de cerca los lanzamientos de **[Nombre del Sello]** (increíble el último release de [Nombre de algún artista reciente del sello]).
>
> Como dueño de sello, sé que el tiempo de escucha es sagrado. El problema es que el 80% de los demos que te llegan por correo, Instagram o WeTransfer no cumplen con la calidad técnica mínima: tracks saturados, fuera de tu rango de BPM, o con problemas graves de fase que arruinarían un set de club.
>
> Creamos **True Peak** específicamente para resolver esto. Es un portal de carga privado para tu sello que:
> 1. Analiza el WAV original en segundos (BPM, LUFS, correlación estéreo).
> 2. Filtra y rechaza automáticamente los archivos que no coinciden con tus requisitos de estilo o mezcla.
> 3. Te organiza los demos aptos en un tablero visual limpio, convirtiendo tus WAVs a MP3s livianos para pre-escucha al instante.
>
> Habilitamos una prueba gratuita para sellos independientes. ¿Te interesa que te arme un portal personalizado como `truepeak.space/s/[nombre-de-sello]` para que lo pruebes sin compromiso?
>
> Un abrazo,
>
> **[Tu Nombre]**  
> Fundador, True Peak  
> `truepeak.space`

---

### 5.2 Pitch de Instagram / Redes Sociales (Short DM Script)
Este mensaje está optimizado para los DMs de Instagram de sellos discográficos, donde la atención es mínima:

> "¡Buenas, [Nombre del Sello]! 👋 ¿Reciben demos por acá?
>
> Sé que les deben inundar el buzón con links rotos de Dropbox o archivos pesados que no van con su sonido.
>
> Diseñamos un portal de carga privada para sellos que auto-analiza el WAV del productor al subirlo (mide BPM, volumen LUFS, fase estéreo) y les filtra la basura técnica antes de que tengan que darle play.
>
> Les armé una demo rápida para que vean cómo queda su bandeja de entrada automatizada. ¿Les puedo mandar el link?"

---

## 6. Manejo de Objeciones (Objection Handling)

| Objeción del Cliente | Respuesta Estratégica |
| :--- | :--- |
| *"Prefiero escuchar todo yo mismo porque puedo perderme un hit."* | *"Totalmente comprensible. Pero True Peak no juzga el arte, solo la física básica del sonido. Si un track tiene la fase invertida en 180°, va a sonar horrible en el club. Nosotros te limpiamos los tracks técnicamente inviables para que pongas tu oído de A&R solo en las canciones con potencial real."* |
| *"Ya tengo un formulario de Google Form gratuito."* | *"Los Google Forms se llenan de links que expiran (WeTransfer de 7 días), archivos corruptos y no te dan ninguna información visual de antemano. Con True Peak, escuchás el demo en streaming directo con nuestro reproductor nativo, ves las métricas de un vistazo y respondés al productor directamente desde la app."* |
| *"El almacenamiento de archivos WAV pesados me va a salir caro."* | *"Esa es la magia. True Peak procesa los archivos con una política de 'Cero Almacenamiento'. El WAV pesado se analiza y se elimina inmediatamente después de procesarse, quedándonos solo con un MP3 ultra liviano de 320kbps. Solo retenemos los WAV originales de los tracks preseleccionados por los días de tu plan."* |

---

## 7. Plan de Marketing de Contenidos (Inbound Marketing)

Para posicionarnos como referentes de la escena discográfica, debemos educar:

1.  **Artículos de Blog / Hilos de Twitter (X):**
    *   *Ejemplo 1:* "Por qué el 90% de los demos enviados a sellos de techno son rechazados (Análisis técnico de fase y volumen)".
    *   *Ejemplo 2:* "El setup perfecto para exportar tu demo: Headroom y LUFS recomendados por sellos profesionales".
2.  **Herramienta Gratuita de Atracción (Lead Magnet):**
    *   Crear una sub-página `truepeak.space/check` donde cualquier productor pueda arrastrar su track de forma gratuita y recibir un "reporte rápido de mastering / firma sónica". Al final del reporte, si el track cumple con estándares profesionales, le sugerimos: *"Tu track está técnicamente perfecto. ¿Querés enviarlo a sellos asociados a True Peak?"* (Ganamos productores para la plataforma y sellos interesados en el flujo de demos premium).
