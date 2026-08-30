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

---

## Una salvedad sobre el estado ajeno caduca; el commit donde la escribes, no

**2026-08-03 · «esta ruta no está commiteada» — sí lo estaba**

Un agente cerró un commit advirtiendo que el endpoint que su cliente llama vivía
solo en el árbol de trabajo. **Ya estaba commiteado**, tres minutos antes, por su
dueño. La advertencia nació falsa.

El error no fue medir mal: fue medir **temprano**. Un `git status` leído al
empezar la tarea mostró esos archivos sucios, y esa observación viajó intacta
hasta el mensaje del commit una hora después. Con varios agentes sobre un mismo
checkout, **el estado ajeno cambia mientras trabajas** — es la misma familia que
[[el índice de git es estado compartido]].

Lo que lo vuelve caro es dónde acabó escrita: un chat equivocado lo corrige el
mensaje siguiente; **un mensaje de commit es permanente y no se reescribe** —
rebasar un árbol con trabajo de otros en vuelo cuesta más que la frase que
arregla. Hoy la historia del repo dice algo que no era cierto.

**Cómo aplicarlo**: una afirmación NEGATIVA sobre trabajo ajeno («no existe»,
«no está commiteado», «todavía no lo expone») tiene fecha de caducidad de
minutos. Si va a un artefacto permanente, **vuelve a medirla justo antes de
escribirla**, no cuando la descubriste. Y si solo necesitas avisar, dilo en un
mensaje —que se corrige— en vez de en un commit —que no.

Corolario del mismo día: la duda vale en las dos direcciones. Cuatro veces se
reportó como pendiente algo ya hecho, y también llegaron reportes de errores ya
arreglados. **Antes de actuar sobre el reporte de otro —o sobre el propio de
hace una hora— vuelve a medir.**

---

## Un comentario que describe lo que hace OTRO archivo se pudre sin que nada falle

**2026-08-30 · «la calculadora se retira» — llevaba 25 días sin retirarse**

`67e05bf` (2026-08-05) volvió a atar la liga viva métricas→presupuesto: desde ese
commit, editar los m² de la ficha reprecia el presupuesto entero. No tocó ninguna de
las dos frases que lo negaban, escritas cada una en un archivo distinto del código
que describían:

- `app/README.md:36` — «it is the calculator that produces that first line and then
  **retires**».
- `db/schema.sql:1031` — «El API ya no la lee ni la escribe».

**Nada falló.** No hay prueba que compare una oración con una rama, ni compilador que
enumere los usos de un párrafo. Las dos siguieron leyéndose como verdad.

**Lo que costó**: al abrir este trabajo diagnostiqué sobre esas frases y le dije a Ed
que el acoplamiento *ya estaba quitado*. Tuve que retractarme. La prosa no me hizo
perder tiempo: me hizo dar una respuesta equivocada sobre su propio sistema, que es
más caro. Es la misma familia que [[Una salvedad sobre el estado ajeno caduca]] —una
afirmación cierta el día que se escribe y que nadie vuelve a medir—, solo que aquí el
«estado ajeno» es otro archivo del mismo repo.

**Y NO FUERON DOS: FUERON SEIS**, todas encontradas en este mismo trabajo. Además de
las dos de arriba, `app/.claude/skills/generate-prospectus.md` rotulaba
`constructionCostPerSqm` como «derived, display-only», un comentario de
`app/api/tests/conftest.py` afirmaba que ese campo no era escribible,
`properties_db.py:658` decía que no hacía falta que estuviera, y
`prospectus_html.py:954` describía la maquetación del presupuesto en términos de un
residuo —«la mayoría: una sola línea Otros, por detallar»— que ya no existía.

Cuatro de las seis —`db/schema.sql:1031`, la skill, el `conftest.py` y
`properties_db.py:658`— describen **el mismo campo**, cada una desde un archivo
distinto, **ninguna desde el archivo que lo gobierna**, y las cuatro estaban
equivocadas al mismo tiempo. Ese es el número que hay que mirar: no «se nos pasó un
comentario», sino que la descripción de un campo se replicó en cuatro lugares que
nadie puede mantener a la vez.

**Cómo aplicarlo**, dos reglas:

1. **Una frase sobre código que vive en otro archivo es una pista, nunca evidencia.**
   Si vas a diagnosticar, decidir o citarla, abre primero el código que describe. Vale
   para el README, para el `COMMENT ON COLUMN`, para la skill y para tu propio
   comentario de hace un mes.
2. **Cambiar un comportamiento no termina en sus llamadores.** Antes de cerrar,
   `grep` del NOMBRE de lo que moviste —`construction_cost_per_sqm`, `set_total`,
   `is_residual`— sobre `*.md`, `*.sql`, las skills y los comentarios, no solo sobre
   el código que lo invoca. Los llamadores los encuentra el compilador; las oraciones
   no las encuentra nadie más que tú.

---

## Un dump se parece a su base de datos, incluida la parte que nadie migró

**2026-08-30 · el `COMMENT ON SCHEMA public` que borraba la 054**

`db/schema.sql` es un dump, así que hereda cómo se construyó la base de la que sale.
Una base recién hecha con `CREATE DATABASE` se lleva el `COMMENT ON SCHEMA public`
de `template1`, y el dump salía con un hunk que **quitaba**
`COMMENT ON SCHEMA public IS ''` — un cambio que nadie hizo y que ninguna migración
explica. Regenerarlo desde una base rehecha como la rehace `make reset-db`
(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`) reproduce el archivo commiteado
exacto, con la delta limitada a los objetos de la migración.

El diff pasó por dos revisores y una suite verde. Lo que lo atrapó fue leer el
artefacto contra la delta que se esperaba de él.

**Cómo aplicarlo**: regenera `db/schema.sql` **solo** desde una base construida con
la receta de `make reset-db`, y si el diff trae un hunk que no puedes atribuir a una
migración, lo que está mal es el método del dump, no el esquema. La regla general:
**una base de scratch no sustituye a la receta real** — difiere justo en lo que no se
te ocurrió revisar, y el dump es donde eso sale a la superficie. Mismo consejo que
cierra [[Verde en local puede significar «contaminado», no «correcto»]]: cuando un
entorno da un resultado y otro da otro, compara sus recetas antes de teorizar.
