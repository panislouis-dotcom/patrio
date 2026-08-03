# Lecciones

Patrones destilados de correcciones reales. Se revisan al empezar sesión.

---

## No arregles condicionalmente lo que sobra estructuralmente

**2026-08-03 · inversión total**

Ed vio un campo etiquetado `INVERSIÓN CAPTURADA` con el aviso
`NO SE USA: MANDA EL DESGLOSE` y preguntó qué era. Propuse **esconderlo** cuando no
aplicara: mostrarlo solo donde de verdad mandaba. Su respuesta:

> "no me gusta que haya 2 opciones quiero que todas se hagan de la misma manera.
> la manera en la que la inversion total se autocalcula"

**Por qué mi propuesta estaba mal**: traté el aviso como un problema de presentación.
No lo era. Un campo que necesita anunciar cuándo cuenta es el síntoma visible de que
el sistema tiene dos caminos para responder la misma pregunta. Esconderlo mejor
habría dejado intacto el costo real: la rama que elige entre los dos, el campo
`investmentBasis` que existía solo para confesar cuál se usó, las ~35 líneas que los
confrontaban cuando discrepaban, y la documentación de cuándo aplica cada uno.

**Cómo aplicarlo**: cuando un campo, bandera o rama tenga que explicar en qué
circunstancia importa, la primera pregunta no es *"¿cómo lo muestro mejor?"* sino
**"¿por qué existen dos caminos?"**. Antes de proponer una condicional, verifica si
el camino que queda puede expresar todo lo que decía el que sobra — aquí sí podía
(un total all-in de $9.5M es `purchase_price` con `acquisition_cost_pct = 0`), y por
eso borrarlo no costó ninguna capacidad. Si el camino que queda NO puede expresarlo,
entonces sí son dos cosas distintas y el problema es que comparten nombre.

Lo pide el `CLAUDE.md` del repo directo: *"Things should be done one way only."*

---

## Un comparador que asume identidad estable miente cuando el sistema la recicla

**2026-08-03 · prueba de no-movimiento**

Verifiqué que la migración 027 no moviera ningún número comparando la base de
inversión de las 18 propiedades **por id**, antes y después. Dos salieron como
"¡MOVIÓ!". No habían movido: la suite e2e borra y recrea sus dos fixtures, así que
vivían en ids nuevos y yo estaba buscando asientos vacíos.

**Cómo aplicarlo**: en pruebas de conservación, aparea por la llave que el sistema
NO recicla (aquí, el nombre). Y cuando un comparador reporte un fallo, descarta
primero que el fallo sea del comparador — sobre todo si los únicos casos que fallan
comparten una propiedad sospechosa (aquí, ser los dos que llevan `[SEED]`).

---

## Los defectos más caros no fallan: devuelven un cero

**2026-08-03 · fixture con `landPrice`**

Una fixture de e2e mandaba `landPrice`, nombre muerto desde la migración 025. El API
ignora los campos desconocidos en silencio, así que la propiedad nacía con costo 0 y
la prueba pasaba. Ninguna suite verde lo iba a encontrar: no había excepción que
atrapar, solo un cero indistinguible de un dato real. Lo destapó **endurecer el
contrato** (el gate nuevo exige `purchasePrice > 0`), no agregar una prueba.

Es la tercera vez en esta rama que el defecto más viejo vive donde un valor ausente
se disfraza de valor válido — antes fue `fmt.ts` imprimiendo `—` para un 0 legítimo.

**Cómo aplicarlo**: cada campo opcional es un lugar donde un typo pasa por dato
bueno. Cuando algo huela raro, la pregunta útil no es *"¿qué está fallando?"* sino
**"¿qué nunca se ha ejecutado, y qué se está aceptando en silencio?"**.
