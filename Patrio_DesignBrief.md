# PATRIO — Design Brief
**Producto público de PAGU Capital**
Versión 1.0 | Para uso en Claude Code

---

## Concepto Visual

Patrio es la puerta de entrada al mundo inmobiliario para personas que nunca han dado ese paso. El diseño debe transmitir tres cosas simultáneamente: **accesibilidad** (esto es para mí), **confianza** (estos saben lo que hacen) y **aspiración** (esto puede cambiar mi vida).

**Referencia principal:** circulomexicano.com — minimalismo editorial, mucho espacio blanco, tipografía con carácter, imágenes reales que hablan por sí solas.

**Anti-referencias:** evitar a toda costa el look de fintech genérica (azules corporativos, ilustraciones vectoriales de personajes), ni el look de portal inmobiliario tradicional (grids de propiedades, tablas de datos, colores primarios).

---

## Paleta de Color

```
Principal — Blanco puro
#FFFFFF  →  Fondo de todas las pantallas, base del wizard

Acento primario — Verde olivo fresco
#6B8A5E  →  Logo, botones primarios, highlights, iconos activos

Acento oscuro — Verde olivo profundo
#4A6741  →  Hover states, bordes sutiles, texto sobre verde claro

Texto principal — Casi negro cálido
#1A1A18  →  Títulos y texto de alto peso

Texto secundario — Gris medio
#6B6B68  →  Descripciones, etiquetas, helper text

Fondo alterno — Blanco cálido
#F8F7F4  →  Secciones alternas, cards de resultado, fondo del wizard

Borde sutil
#E8E5E0  →  Separadores, bordes de cards, inputs sin foco

Error / Alerta
#C0392B  →  Validaciones de formulario

```

---

## Tipografía

### Fuente de Títulos: **Playfair Display**
- Serif editorial con personalidad
- Transmite sofisticación y confianza sin ser rígida
- Usada en: títulos de sección, el nombre PATRIO, números grandes de resultado
- CDN: Google Fonts

### Fuente de Cuerpo: **Inter**
- Sans-serif geométrica, máxima legibilidad en pantalla
- Neutral, moderna, perfecta para preguntas del wizard y textos de apoyo
- Usada en: preguntas, opciones, descripciones, botones, navegación
- CDN: Google Fonts

```css
/* Import */
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');

/* Escala tipográfica */
--font-display: 'Playfair Display', Georgia, serif;
--font-body: 'Inter', system-ui, sans-serif;

--text-xs:    0.75rem;   /* 12px — etiquetas pequeñas */
--text-sm:    0.875rem;  /* 14px — helper text */
--text-base:  1rem;      /* 16px — cuerpo */
--text-lg:    1.125rem;  /* 18px — opciones del wizard */
--text-xl:    1.25rem;   /* 20px — subtítulos */
--text-2xl:   1.5rem;    /* 24px — títulos de paso */
--text-3xl:   1.875rem;  /* 30px — títulos de sección */
--text-4xl:   2.25rem;   /* 36px — títulos hero */
--text-5xl:   3rem;      /* 48px — números de resultado */
--text-hero:  4.5rem;    /* 72px — PATRIO en landing */
```

---

## Logo

**Wordmark únicamente. Sin símbolo.**

```
PATRIO

Fuente: Playfair Display, weight 700
Color: #6B8A5E sobre fondo blanco
Tracking (letter-spacing): 0.12em
Tamaño mínimo: 120px de ancho
```

**Variantes:**
- Principal: `#6B8A5E` sobre `#FFFFFF`
- Invertido: `#FFFFFF` sobre `#6B8A5E` (solo para fondos de color)
- Monocromático: `#1A1A18` sobre `#FFFFFF` (impresión)

**Lo que NUNCA hacer con el logo:**
- No agregar símbolo ni ícono junto al nombre
- No cambiar el tracking
- No usar sobre fondos de imagen sin overlay
- No usar tipografía diferente

---

## Espaciado y Layout

El espacio en blanco ES parte del diseño. No llenarlo es una decisión, no un descuido.

```css
/* Sistema de espaciado (base 8px) */
--space-1:  0.5rem;   /*  8px */
--space-2:  1rem;     /* 16px */
--space-3:  1.5rem;   /* 24px */
--space-4:  2rem;     /* 32px */
--space-6:  3rem;     /* 48px */
--space-8:  4rem;     /* 64px */
--space-12: 6rem;     /* 96px */
--space-16: 8rem;     /* 128px */

/* Máximos de contenido */
--max-wizard: 680px;   /* Ancho máximo del wizard */
--max-content: 900px;  /* Ancho máximo de contenido editorial */
--max-wide: 1200px;    /* Ancho máximo general */
```

**Regla de oro:** cada sección necesita al menos `--space-12` (96px) de padding vertical. Si se siente con mucho aire, está bien.

---

## El Wizard — Comportamiento Visual

### Estructura de cada paso

```
┌─────────────────────────────────────┐
│  PATRIO           [Paso 3 de 8]     │  ← Header fijo, mínimo
│  ████████████░░░░░░░░░░             │  ← Barra de progreso verde olivo
├─────────────────────────────────────┤
│                                     │
│                                     │
│   [Pregunta grande, Playfair]       │  ← Centrado, mucho aire arriba
│   Descripción de apoyo opcional     │
│                                     │
│   ┌─────────────────────────┐       │
│   │  Opción A               │       │  ← Cards de selección
│   └─────────────────────────┘       │
│   ┌─────────────────────────┐       │
│   │  Opción B               │       │
│   └─────────────────────────┘       │
│                                     │
│              [Continuar →]          │  ← Botón al fondo, centrado
│                                     │
└─────────────────────────────────────┘
```

### Cards de opción (selección)
```css
/* Estado normal */
border: 1px solid #E8E5E0;
border-radius: 12px;
padding: 20px 24px;
background: #FFFFFF;
cursor: pointer;
transition: all 0.2s ease;

/* Hover */
border-color: #6B8A5E;
background: #F8F7F4;

/* Seleccionado */
border: 2px solid #6B8A5E;
background: #F8F7F4;
/* Punto verde a la izquierda o checkmark */
```

### Animación entre pasos
- Entrada: `fade in + slide up` sutil (20px, 300ms, ease-out)
- Salida: `fade out` (150ms)
- La barra de progreso se anima con `transition: width 400ms ease`

### Botón primario
```css
background: #6B8A5E;
color: #FFFFFF;
border-radius: 8px;
padding: 14px 32px;
font-family: Inter;
font-size: 1rem;
font-weight: 500;
letter-spacing: 0.02em;
border: none;
cursor: pointer;
transition: background 0.2s ease;

/* Hover */
background: #4A6741;
```

### Inputs numéricos (capital)
```css
border: 1px solid #E8E5E0;
border-radius: 8px;
padding: 16px 20px;
font-size: 1.5rem;
font-family: Inter;
color: #1A1A18;
width: 100%;

/* Focus */
border-color: #6B8A5E;
outline: none;
box-shadow: 0 0 0 3px rgba(107, 138, 94, 0.12);
```

---

## Pantalla de Resultados

Esta es la pantalla más importante. El usuario llega aquí y debe sentir que valió la pena.

### Jerarquía visual de métricas

```
┌──────────────────────────────────────────┐
│  Tu proyecto en [Ciudad]                 │  ← Subtítulo, Inter light
│  Casa renovada en 3 estudios             │  ← Tipo proyecto
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  $35,000                           │  │  ← NÚMERO GRANDE, Playfair
│  │  ingreso mensual estimado          │  │  ← Label pequeño, Inter
│  └────────────────────────────────────┘  │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  14.8%   │  │  6 años  │  │ $7.2M  │ │  ← Grid de métricas
│  │ Cap Rate │  │ se paga  │  │ a 10a  │ │
│  └──────────┘  └──────────┘  └────────┘ │
│                                          │
│  [Quiero hacer esto realidad →]          │  ← CTA verde
└──────────────────────────────────────────┘
```

### Cards de métricas secundarias
- Fondo `#F8F7F4`
- Número en Playfair Display, 36-48px, color `#6B8A5E`
- Label en Inter 12px, color `#6B6B68`
- Tooltip o texto expandible con definición de cada métrica

---

## Imágenes

### Estilo
- Fotografía real de inmuebles en Monterrey y Saltillo
- Planos y renders arquitectónicos limpios
- Nunca ilustraciones vectoriales genéricas
- Paleta de imagen: tonos cálidos, luz natural, espacios abiertos

### Uso
- Landing page: imagen hero de fondo con overlay blanco sutil (opacity 0.85)
- Pantalla de resultados: imagen contextual del tipo de proyecto seleccionado
- Hoja de ruta: iconos de línea simples, trazo fino, color `#6B8A5E`

### Placeholder para desarrollo
Usar imágenes de Unsplash con parámetros que evoquen el estilo correcto:
- `https://images.unsplash.com/photo-1600585154340-be6161a56a0c` — interiores modernos
- `https://images.unsplash.com/photo-1555636222-cae831e670b3` — arquitectura minimalista
- `https://images.unsplash.com/photo-1512917774080-9991f1c4c750` — exteriores residenciales

---

## Iconografía

- **Librería:** Lucide Icons (open source, trazo fino, muy limpio)
- **Tamaño estándar:** 20px en UI, 24px en cards, 32px en ilustraciones
- **Color:** `#6B8A5E` para activos, `#6B6B68` para inactivos
- **Estilo:** siempre outline (trazo), nunca filled/sólido

---

## Microcopy — Tono de Voz

El texto de la interfaz debe sonar como un amigo experto, no como un banco.

| ❌ Evitar | ✅ Usar |
|-----------|---------|
| "Complete el formulario" | "Cuéntanos sobre ti" |
| "Capital disponible" | "¿Con cuánto cuentas hoy?" |
| "Seleccione una opción" | "¿Cuál te describe mejor?" |
| "Proyecto viable identificado" | "Encontramos algo que puede funcionar para ti" |
| "Retorno sobre la inversión" | "Así crece tu dinero" |
| "Continuar al siguiente paso" | "Siguiente →" |
| "Enviar información" | "Hablar con PAGU Capital" |

**Reglas generales:**
- Tutear siempre. Nunca "usted".
- Oraciones cortas. Máximo 12 palabras por línea en el wizard.
- Los números siempre formateados: `$35,000` no `35000`
- Los porcentajes con un decimal: `14.8%` no `15%`

---

## Landing Page (antes del wizard)

### Estructura de secciones

```
1. Hero
   — Logo PATRIO
   — Headline: "Tu primera inversión inmobiliaria"
   — Subheadline: 1 línea, qué es Patrio
   — CTA: "Calcular mi proyecto →"
   — Imagen hero: edificio o espacio moderno MTY

2. Cómo funciona (3 pasos simplificados)
   — Icono + título + descripción corta
   — "Dinos cuánto tienes" / "Te mostramos qué puedes hacer" / "PAGU lo ejecuta"

3. Tipos de proyecto
   — 4 cards con imagen, nombre, rango de inversión y Cap Rate típico

4. Por qué PAGU Capital
   — Credenciales reales: proyectos ejecutados, Cap Rate logrado, años de experiencia

5. CTA final
   — Fondo verde olivo
   — "¿Listo para empezar?" + botón blanco

6. Footer mínimo
   — Logo + "Una iniciativa de PAGU Capital" + WhatsApp
```

---

## Responsive

- **Mobile first.** El wizard es principalmente una experiencia mobile.
- Breakpoints: `768px` (tablet), `1024px` (desktop)
- En mobile: padding lateral mínimo `24px`, botones full-width
- En desktop: wizard centrado con max-width `680px`, mucho aire a los lados

---

## Variables CSS Completas

```css
:root {
  /* Colores */
  --color-white:        #FFFFFF;
  --color-bg-warm:      #F8F7F4;
  --color-border:       #E8E5E0;
  --color-green:        #6B8A5E;
  --color-green-dark:   #4A6741;
  --color-green-light:  rgba(107, 138, 94, 0.12);
  --color-text:         #1A1A18;
  --color-text-mid:     #6B6B68;
  --color-error:        #C0392B;

  /* Tipografía */
  --font-display: 'Playfair Display', Georgia, serif;
  --font-body:    'Inter', system-ui, sans-serif;

  /* Espaciado */
  --space-1:  0.5rem;
  --space-2:  1rem;
  --space-3:  1.5rem;
  --space-4:  2rem;
  --space-6:  3rem;
  --space-8:  4rem;
  --space-12: 6rem;
  --space-16: 8rem;

  /* Bordes */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-full: 9999px;

  /* Sombras */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.10);

  /* Transiciones */
  --transition-fast:   150ms ease;
  --transition-normal: 300ms ease;
  --transition-slow:   500ms ease;
}
```

---

## Checklist para Claude Code

Antes de construir cualquier componente, verificar:

- [ ] ¿Usa las fuentes correctas? (Playfair para títulos, Inter para cuerpo)
- [ ] ¿El color de acento es exactamente `#6B8A5E`?
- [ ] ¿Hay suficiente espacio en blanco? (Si parece vacío, está bien)
- [ ] ¿El texto tutea al usuario?
- [ ] ¿Los números están formateados con `$` y comas?
- [ ] ¿El wizard tiene barra de progreso visible?
- [ ] ¿Las animaciones son suaves y no distraen?
- [ ] ¿Funciona bien en mobile (375px de ancho mínimo)?
- [ ] ¿El CTA final lleva a WhatsApp con mensaje pre-armado?

---

*Patrio — una iniciativa de PAGU Capital*
*Monterrey, Nuevo León*
