# Prospecto a la medida — elegir secciones y subsecciones

**Objetivo:** al dar click en `📄 PROSPECTO`, abrir un menú con checkboxes para elegir
qué entra al PDF: qué propiedades y qué tan detallada es cada página de oportunidad.

## Decisiones (confirmadas con Eduardo)

1. **Subsecciones = las dos cosas**: propiedades individuales Y bloques de contenido.
2. **Favoritos = el default, el menú = el ajuste**: el menú lista SOLO las favoritas,
   todas palomeadas. Despalomear afecta a ESTE PDF, no a la estrella. La estrella
   sigue siendo "mi portafolio de siempre"; el menú es "esta vez, esto".
3. **La selección se recuerda** entre sesiones (localStorage), con botón de restaurar.

## Las dos decisiones de diseño que importan

### A. Se guardan las EXCLUSIONES, no las inclusiones

Guardar "lo que sí quiero" se rompe solo: marcas una propiedad nueva como favorita,
generas el PDF, y no aparece — porque no estaba en la lista guardada de hace un mes.
Falla en silencio, que es justo lo que este documento no debe hacer.

Guardando "lo que apagué", todo lo nuevo entra por default. La lista guardada se
poda contra las favoritas actuales al abrir el menú: si despalomeas una propiedad de
favoritos y la vuelves a palomear, regresa incluida (una exclusión vieja no la
esconde para siempre).

### B. Las secciones NO necesitan su propio booleano

`Track Record`, `En Desarrollo` y `Oportunidades` son *derivadas* de qué propiedades
entran: si ninguna propiedad en desarrollo entra, la sección desaparece sola.
El checkbox de la sección en el menú es puro azúcar de UI (palomea/despalomea a sus
hijas), no un dato que viaje al API. Eso deja el contrato del API mínimo y sin dos
maneras de decir lo mismo.

Solo las tres páginas que NO dependen de propiedades llevan booleano propio:
Portada, Resumen de portafolio, Cierre.

## Contrato del API

`POST /api/documents/prospectus` — hoy no recibe body. Pasa a recibir uno OPCIONAL;
sin body, el comportamiento es idéntico al de hoy (todo entra). Esa es la garantía de
compatibilidad y se prueba explícitamente.

```python
class ProspectusOptions(BaseModel):
    # None = todas las favoritas (el default de hoy). Una lista NARROWS sobre las
    # favoritas: nunca mete algo que no esté marcado, solo saca.
    propertyIds: list[int] | None = None
    # Las tres páginas sin propiedad detrás
    cover: bool = True
    portfolioSummary: bool = True
    closing: bool = True
    # Qué lleva CADA página de oportunidad (aplica a todas por igual)
    opportunityFees: bool = True       # fila de comisiones/totales del fondo
    opportunityGallery: bool = True    # galería de fotos
    opportunityPlans: bool = True      # "Plano y propuesta"
    opportunityRenders: bool = True    # "Fotos y propuesta"
    opportunityBudget: bool = True     # "Presupuesto de obra"
```

Los 5 bloques mapean 1:1 a llamadas que ya existen en `prospectus_html.py`
(`_opportunity_fees_metrics`, `_strip`, y las tres `detail-section` de
`_opportunity_detail`) — no hay que inventar cortes nuevos en el documento.

**Siempre entran** (no son negociables, son el pitch): banda con nombre/dirección,
foto principal, columnas Financieros/Propiedad, y la fila de proyección
(plazo, venta, ganancia, cap rate, rendimiento).

## Tareas

### Backend
- [ ] `ProspectusOptions` en `routes/documents.py`, body opcional en el endpoint
- [ ] Filtrar favoritas por `propertyIds` cuando venga (intersección, nunca unión)
- [ ] Pasar los flags a `build_prospectus_html(...)`
- [ ] `build_prospectus_html`: parámetro de opciones; saltar portada/resumen/cierre
- [ ] `_opportunity()`: recibir los 5 flags y omitir cada bloque
- [ ] `_opportunity_detail()`: recibir plans/renders/budget
- [ ] 400 con frase legible si la selección deja el PDF vacío
- [ ] Tests: sin body == comportamiento de hoy; cada flag apaga lo suyo y NADA más;
      `propertyIds` filtra; selección vacía → 400

### Frontend
- [ ] `ProspectusMenu.tsx` — panel anclado al botón (patrón de `TabBar` settings:
      `getBoundingClientRect` + cerrar al click afuera), `maxHeight` + scroll
- [ ] Árbol: sección (padre) → propiedades (hijas), + bloques bajo Oportunidades
- [ ] Padre palomea/despalomea hijas; estado indeterminado si están mezcladas
- [ ] Persistencia de exclusiones en localStorage + poda contra favoritas actuales
- [ ] Botón "Restaurar todo"
- [ ] `GENERAR PDF` deshabilitado si no queda nada seleccionado
- [ ] `generateProspectus(options)` en `lib/api.ts` manda el body
- [ ] Tests del componente: agrupado por sección, padre↔hijas, persistencia,
      restaurar, propiedad nueva entra por default (la regla de la sección A)

### Verificación
- [ ] Suite backend + frontend en verde
- [ ] PDF real generado con varias combinaciones, revisado visualmente
- [ ] Confirmar que "sin selección guardada" produce el MISMO PDF que hoy

## Review

Hecho. Backend 681 pruebas, frontend 706, `tsc` limpio.

**Lo que cambió respecto al plan, y por qué:**

1. **El guard de selección vacía no incluye `portfolioSummary`.** El plan decía
   "sin propiedades Y sin portada/resumen/cierre". Pero el resumen NO imprime
   nada sin propiedades (resume el track record), así que
   `{propertyIds: [], cover: false, closing: false, portfolioSummary: true}`
   habría pasado el guard literal y devuelto un PDF genuinamente en blanco —
   justo el caso que el guard existe para negar. Quedó
   `not favorites and not (cover or closing)`.

2. **Bug de frontera atrapado en revisión:** el front y el back opinaban
   distinto sobre ese mismo caso. El botón `GENERAR` sí contaba el resumen como
   página, así que se habilitaba para una combinación que el servidor rechazaba
   con 400. Se alineó el front al back y se fijó con una prueba que nombra el
   caso, para que las dos reglas no vuelvan a separarse.

3. **Los bloques se cortan en el origen, no borrando HTML ya armado.**
   `opportunityPlans=False` produce `rows = []`, `opportunityBudget=False`
   produce `budget = {}`. Así cada decisión río abajo —¿existe la sección?,
   ¿el presupuesto fuerza salto de página?— corre el mismo camino que ya corría
   cuando el dato simplemente no estaba. El salto de página del presupuesto
   salió gratis: la condición `if (plan_html or photos_html)` ya lo contemplaba.

4. **El recorte por `propertyIds` corre ANTES de enriquecer** (imágenes,
   renders, planos): lo que no va al PDF no se descarga ni se dibuja.

**Falsa alarma descartada:** se sospechó que una favorita archivada podía
colarse al PDF. No: `get_properties()` ya nace con `include_archived=False`.

**Verificación con PDFs reales** (no solo pruebas): sin cuerpo = 10 páginas;
sin presupuesto = 8; sin planos ni renders = 8; sin portada ni cierre = 8;
`propertyIds:[5]` = 5 páginas con solo esa propiedad; `propertyIds:[999]`
(no favorita) = 2 páginas sin ninguna propiedad colada — la intersección
aguanta. Los dos guards devuelven 400 con frase legible. Revisado a ojo que una
página con bloques apagados no deja huecos ni encabezados huérfanos.

**Pendiente, a propósito:** `plano_js.render_plan_sheets` sigue lanzando
Chromium aunque `opportunityPlans=False`. Es el único trabajo desperdiciado que
queda; se dejó fuera para no ampliar el radio del cambio.
