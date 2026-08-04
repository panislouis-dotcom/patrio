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

## Con varios agentes en un mismo checkout, el índice de git es estado compartido

**2026-08-04 · el barrido de espejos que aterrizó en el commit ajeno**

Un agente montó su commit quirúrgicamente: puso al índice solo sus hunks y dejó el
resto del archivo en el árbol para no barrer el trabajo a medias de otro. Entre su
`git add` y su `git commit` pasaron segundos — y en esa ventana **otro agente
commiteó, y se llevó el índice**. Sus 141 líneas de pruebas de contrato viven hoy
bajo un título que dice `docs(skills)`.

La técnica era correcta en aislamiento y es exactamente la que no se debe usar aquí:
`git add` sin commit inmediato deja estado global que cualquiera puede consumir.

**Cómo aplicarlo**: con varios agentes sobre un checkout, `add` y `commit` van en la
MISMA operación, sin ventana entre ellos. Para trabajo que de verdad se solapa en los
mismos archivos, worktrees separados (`isolation: "worktree"`) — el repo ya tiene el
patrón en `.worktrees/`.

**Y no reescribas historia para arreglarlo.** Un commit mal titulado cuesta que
alguien no encuentre una explicación; un rebase sobre un árbol con trabajo en vuelo
cuesta el trabajo de otro. La asimetría es obvia una vez que se ve.

Es la misma forma que [[patrio-espejos-escritos-a-mano]] y que los otros defectos de
esta semana: **algo que funciona porque nadie más lo toca, y deja de funcionar en
silencio cuando alguien más lo toca.**

---

## Verde en local puede significar «contaminado», no «correcto»

**2026-08-03 · el Chromium que le faltaba al API en CI**

El e2e del prospecto en PDF llevaba 14 horas rojo en CI y verde en local. En este
repo viven DOS Playwright: el de Node maneja el navegador de las pruebas, y el de
Python —dentro del API— imprime el PDF. Cada versión fija su propio build de
Chromium (Node 1.59 pide `chromium-1217`; Python pide `chromium-1228`), y CI solo
instalaba el de Node.

**Por qué pasaba en local**: mi máquina tenía TRES builds acumulados de versiones
distintas, y alguno servía. Local no era un entorno más permisivo — era uno
**contaminado por su propia historia**. CI acierta al empezar limpio.

**Cómo aplicarlo**: cuando algo pase en local y falle en CI, la hipótesis por
defecto no es «CI está mal configurado» sino **«local tiene algo que nadie
instaló a propósito»**. Y antes de arreglar, reproduce la condición limpia
—aquí, una carpeta de navegadores con solo el build de Node— para no empujar una
corazonada. El `Dockerfile` ya hacía lo correcto: cuando un entorno funciona y
otro no, compara sus recetas antes de teorizar.

---

## Un fallo que no nombra su causa cuesta más que el fallo

**2026-08-03 · «Timeout esperando el evento download»**

El único síntoma del problema anterior era *«Timeout 20000ms exceeded while
waiting for event "download"»*. Esa frase nombra **lo que no pasó**, no por qué:
la descarga nunca ocurrió porque el endpoint devolvió un error que la prueba
nunca miró. Horas de diagnóstico escondidas tras un mensaje genérico.

**Cómo aplicarlo**: cuando una prueba espera un EFECTO (una descarga, un
elemento, un archivo), que vigile también la CAUSA (la respuesta HTTP, el código
de salida). Si el efecto no llega, el reporte debe decir el 500 y su cuerpo, no
un timeout. Vale para cualquier espera: **afirmar sobre el efecto es suficiente
cuando pasa, y es inútil cuando falla.**

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

---

## Una prueba escrita de memoria se pone de acuerdo consigo misma

**2026-08-03 · `lineCount` leído como `lines` en el catálogo de obra**

El cliente leía `t.lines` de la lista de plantillas. El servidor manda `lineCount`,
y lo manda con ese nombre a propósito: en el DETALLE de una plantilla `lines` es el
ARREGLO de renglones, y un campo que es número en la lista y lista en el detalle es
una trampa que ya se había quitado del lado del servidor. El cliente la volvió a
tender. La pantalla habría pintado «undefined RENGLONES».

**Había una prueba sobre esa pantalla, y pasaba.** Su fixture repetía el mismo
nombre equivocado, así que afirmaba que el código estaba de acuerdo consigo mismo.
Es la misma familia que `landPrice`: no falla nada, solo aparece un dato inventado.

Lo que sí lo encontró fue **corregir el TIPO contra el servidor**. Al arreglarlo,
salió de golpe en los cinco lugares donde vivía — incluido el de producción, que la
prueba tapaba.

**Cómo aplicarlo**: un fixture escrito a mano es una segunda copia del contrato, y
las dos copias se equivocan juntas. Antes de escribir la prueba, **lee el nombre en
el código que sirve el dato**, no en el mensaje que lo describe ni en la memoria. Y
cuando algo del contrato se corrija, corrige el TIPO primero: el compilador enumera
los usos, que es lo que una prueba por definición no hace.

**Corolario, cobrado tres veces el mismo día**: `vitest` verde no dice que el árbol
compile. `noUnusedLocals` está encendido, así que la suite puede pasar mientras
`npm run build` falla. **`npx tsc --noEmit` va en la misma vuelta que las pruebas,
antes de cada commit** — si no, la señal verde afirma más de lo que verificó.
