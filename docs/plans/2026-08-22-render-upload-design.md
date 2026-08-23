# Subir renders generados externamente

**Fecha:** 2026-08-22
**Estado:** aprobado, pendiente de implementación

## Problema

Hoy `property_renders` sólo se llena vía `renders.generate_image` (OpenAI
`images.edit`). Si alguien genera un render en otro software (Midjourney,
Photoshop, lo que sea), no hay forma de meterlo al sistema — no puede
guardarse, elegirse (`is_chosen`) ni aparecer junto a los renders generados
por IA.

## Diseño

Dos endpoints nuevos, calcando la forma de los dos que ya generan renders
(`create_property_render` / `create_render_from_plan`), pero sin llamar a
OpenAI:

### Backend

- `POST /api/properties/{id}/renders/upload` — multipart: `file` +
  `sourceImageId` (Form). Igual que `create_property_render` pero sin la
  llamada al proveedor: normaliza orientación EXIF (`images.normalize_orientation`,
  el mismo tratamiento que cualquier otra subida), sube a `storage`, y llama a
  `renders_db.add_render(..., source_image_id=sourceImageId, provider="upload",
  model="manual", prompt_text="Subido manualmente", prompt_id=None)`.
- `POST /api/properties/{id}/renders/from-plan/upload` — multipart: `file` +
  `variant`/`floorId`/`floorName` (Form, misma validación que `from-plan`).
  Sin `source_plan_path` (no hay plano de referencia para una IA). Llama a
  `add_render` con `floor_id`/`floor_name`/`source_variant` para que agrupe
  igual que un render generado.

Ambos reusan `renders_db.add_render` sin tocar el schema — `provider` ya es
`text` libre, no un enum. `choose`/`unchoose`/`delete`/`list`/`edit` funcionan
gratis sobre un render subido: sólo leen `file_path`/`floor_id`/`source_image_id`,
sin importarles cómo nació el render.

Mismos guardas 404/422 que los endpoints de generación (propiedad no existe,
archivo vacío, variante inválida, piso vacío) — copiar la validación, no
inventar una nueva forma de error.

### Frontend

- `RendersPanel`: dos props opcionales nuevas en el union —
  `onUpload?: (req: { sourceImageId: number; file: File }) => Promise<void>`
  en `PhotosProps`, `onUploadPlan?: (req: { floorId: string; floorName: string;
  variant: VariantKey; file: File }) => Promise<void>` en `PlanProps`.
  Opcionales para no romper montajes/tests existentes que no las pasan.
- UI: input file oculto + botón "Subir render" junto al botón de generar.
  Al elegir archivo, llama al callback con los mismos `sourceImageId`/
  `floorId`/`floorName`/`variant` que ya están en scope para generar — sin
  campos nuevos que el usuario tenga que llenar.
- Reusa el mismo estado de carga/error que ya tiene el flujo de generar
  (`isGenerating` y el banner de error) — una subida en curso deshabilita los
  mismos botones, un fallo se ve en el mismo lugar.
- `api.ts`: `uploadPropertyRender(id, { sourceImageId, file })` y
  `uploadPropertyRenderFromPlan(id, { floorId, floorName, variant, file })` —
  arman `FormData` y postean a los endpoints nuevos, misma forma que
  `generatePropertyRenderFromPlan`.
- Wiring: `PropertyDetailPage.tsx` (junto a `onGenerate`, ~línea 1233) y
  `LevantamientoPanel.tsx` (junto a `onGeneratePlan`, ~línea 399), mismo patrón
  que ya usan esos callbacks (llamar, luego refrescar la lista de renders).

## Testing

- `test_renders.py`: caso feliz por endpoint (sube bytes, verifica
  `provider="upload"`/`model="manual"`, agrupa bien para `choose`) + los mismos
  404/422 que ya cubren los endpoints de generación. Sin mock de OpenAI —
  estos endpoints nunca lo llaman.
- `RendersPanel.test.tsx`: el botón de subir llama `onUpload`/`onUploadPlan`
  con los args correctos; ausente/no-op cuando la prop no se pasa.
- `FotosPanel.test.tsx` / `LevantamientoPanel.test.tsx`: un test cada uno
  confirmando que el callback se reenvía de la página hasta `RendersPanel`,
  igual que ya se prueba para `onGenerate`/`onGeneratePlan`.
- Verificación manual en el stack vivo del worktree: subir una imagen real
  contra una foto y contra un piso/plano, confirmar que aparece en la grilla,
  se puede elegir (estrella), y sobrevive un refresh.

## Fuera de alcance

- Sin caption/nota opcional para el render subido — no se pidió.
- Sin cambio de schema — `provider`/`model` ya son `text` libre.
