# Renders — diseño

Fecha: 2026-08-03 · Rama: `feat/renders` · Base: `origin/main` (lo que corre en QA)

## Qué se pidió

Una pestaña RENDERS junto a MAPA / FOTOS / PLANO que tome una de las fotos
subidas y genere un render a partir de ella, con una biblioteca de prompts que
traiga defaults y crezca con el uso.

## Decisiones

| Decisión | Elegido | Por qué |
|---|---|---|
| Proveedor de imagen | **OpenAI `images.edit`** | Claude lee imágenes, no las genera. Se verificó contra la API vigente, no de memoria. |
| Modelo | **`gpt-image-2`** | Probado contra la API real: conserva vanos y volumetría y devuelve fotorrealismo. |
| Elección de foto | **Manual** | Eduardo cura. Elimina la llamada de visión, su costo y su latencia. |
| Biblioteca | **Presets sembrados + edición + guardar propios** | Crece con lo que funciona; los sembrados son piso, no techo. |

## La decisión central: un render no es una foto

Una foto es **evidencia de lo que hay**. Un render es **una propuesta de lo que
podría haber**. Por eso el render no entra a `property_images` como un
`image_type` más:

`image_type` (`general | antes | despues`) es el eje de **la obra**. Meter
`'render'` ahí cruza un segundo eje —real contra generado— dentro del primero,
y el modo de falla es caro y concreto: **un render impreso en el prospecto en la
casilla de «después» es una tergiversación de la propiedad frente a un
inversionista.** Es la misma clase de mentira que el esquema ya se niega a decir
cuando devuelve `NULL` en vez de un cero inventado.

Tabla propia entonces, no por duplicar la entidad imagen, sino porque el render
carga procedencia que una fotografía nunca tiene. Los bytes siguen guardándose
por `storage.py`: **dos tipos de registro, un solo mecanismo de almacenamiento.**

### Tres garantías que se sostienen solas

1. **`prompt_text` se congela al generar.** Con solo `prompt_id`, editar un
   prompt haría que el render de ayer citara el texto de hoy. Desnormalizar aquí
   es correcto: es historia, y la historia no cambia. *(probado en
   `test_editing_a_prompt_does_not_rewrite_history`)*
2. **`source_image_id` es `ON DELETE SET NULL`.** Borrar la foto no destruye el
   render que ya se enseñó; pierde la liga. *(probado en
   `test_deleting_the_source_photo_keeps_the_render`, y verificado en vivo)*
3. **La cláusula estructural vive en el código, no en cada prompt.** Si cada
   prompt tuviera que repetir «conserva la geometría», tarde o temprano uno no
   lo haría — y ese render sería de otra casa. `compose_prompt()` la añade a
   todos por igual. *(probado en `test_the_structural_clause_is_appended_to_every_prompt`)*

En la UI la garantía se vuelve visible: todo render se muestra marcado
**«Propuesta · no es una foto»** y con el prompt que lo produjo.

## Piezas

```
db/migrations/028_renders.sql   render_prompts + property_renders + 6 sembrados
app/api/renders.py              única costura con OpenAI + cláusula estructural
app/api/renders_db.py           persistencia
app/api/routes/renders.py       endpoints
app/web/.../RendersPanel.tsx    la pestaña
app/web/.../MediaTabs.tsx       4ª pestaña
```

Los sembrados nombran especies de `plantas_regionales.md` (mezquite,
anacahuita, agave verde, lechuguilla, salvia azul, zacate búfalo): un render con
pasto inglés vende un jardín que se muere en el primer agosto de Monterrey.

## Lo que se aprendió probando contra la API real

- **`gpt-image-2` rechaza `input_fidelity`** con `400
  invalid_input_fidelity_model`. Es un parámetro de la familia gpt-image-1. No
  se manda salvo que se configure `OPENAI_INPUT_FIDELITY` a propósito.
- **`input_fidelity: high` apega el resultado al ESTILO del origen, no solo a su
  geometría.** Sobre una imagen plana devolvió una ilustración plana en vez de
  una foto. Útil sobre fotografías reales; contraproducente sobre planos.
- **Un `except Exception` con mensaje bonito escondió el 400 que decía
  exactamente qué parámetro sobraba.** El mensaje del proveedor ahora viaja tal
  cual al cliente.

## Configuración

```
OPENAI_API_KEY=        # requerida para renders
OPENAI_IMAGE_MODEL=    # opcional, default gpt-image-2
OPENAI_INPUT_FIDELITY= # opcional, solo modelos gpt-image-1
```

Sin llave la app arranca igual y el endpoint responde **502 con motivo**: los
renders son opcionales, la ficha no depende de ellos.

> Falta agregar `OPENAI_API_KEY` al secreto de QA/prod en `edg-infra`. Sin eso,
> la pestaña carga y la generación devuelve 502.

## Verificación

- `pytest`: 380 pasan (17 nuevas de renders)
- `vitest`: 233 pasan (9 nuevas)
- `tsc --noEmit`: limpio
- Migración 028 aplicada a la BD de dev del worktree; los 6 sembrados leídos vía API
- **Render real generado extremo a extremo** contra OpenAI: HTTP 201, imagen
  fotorrealista con mezquite, agaves y grava, procedencia completa en la fila
- Verificado en vivo: el render no aparece en la galería de fotos, y borrar la
  foto original lo deja vivo con `sourceImageId = null`
