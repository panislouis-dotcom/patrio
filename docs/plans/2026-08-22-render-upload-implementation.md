# Subir renders generados externamente — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir agregar un render a una propiedad subiendo un archivo (generado en otro software), en vez de generarlo vía OpenAI — el render subido se agrupa, elige, edita y borra exactamente igual que uno generado por la IA.

**Architecture:** Dos endpoints nuevos en el backend (`/renders/upload`, `/renders/from-plan/upload`) que reusan `renders_db.add_render` sin llamar al proveedor (`provider="upload"`, `model="manual"`). En el frontend, un botón "Subir render" nuevo en `RendersPanel` junto al de generar, con las mismas dos rutas de wiring que ya existen para generar (foto → `FotosPanel`/`PropertyDetailPage`; plano → `LevantamientoPanel`/`PropertyDetailPage`).

**Tech Stack:** FastAPI (Python) + psycopg, React + TypeScript + Vite, Vitest + Testing Library, pytest.

**Diseño ya aprobado:** ver `docs/plans/2026-08-22-render-upload-design.md`.

---

## Antes de empezar

Este worktree (`.worktrees/mejoras-renders`, branch `feat/mejoras-renders`) ya tiene:
- API corriendo en `http://localhost:8020` (verificado vía `/api/version`)
- Web corriendo en `http://localhost:5190`
- BD propia `patrio_mejoras_renders` (clon de `patrio`, con usuarios)
- Venv Python 3.10 en `.venv/`, `npm install` hecho en `app/web` y `app/e2e`

Todos los comandos de este plan asumen `cwd = /home/eduardo/Documents/repos/new-repos/patrio/.worktrees/mejoras-renders`.

---

### Task 1: Backend — endpoint de subida para renders de FOTO

**Files:**
- Modify: `app/api/routes/renders.py`
- Test: `app/api/tests/test_renders.py`

**Step 1: Write the failing tests**

Add near the top of `app/api/tests/test_renders.py`, right after the `source_image` fixture (after line 85), a new section:

```python
# ─── Subida manual (sin proveedor) ────────────────────────────────────────────

def test_uploading_a_render_for_a_photo_stores_it_without_calling_the_provider(
    client, test_property, source_image, monkeypatch,
):
    from api import renders

    def _boom(*args, **kwargs):
        raise AssertionError("subir un render no debe llamar al proveedor")
    monkeypatch.setattr(renders, "generate_image", _boom)

    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"sourceImageId": str(source_image["id"])},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sourceImageId"] == source_image["id"]
    assert body["provider"] == "upload"
    assert body["model"] == "manual"
    assert body["promptText"]  # nunca vacío: CHECK de la tabla


def test_an_uploaded_photo_render_can_be_chosen(client, test_property, source_image):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"sourceImageId": str(source_image["id"])},
    )
    render_id = r.json()["id"]
    chosen = client.put(f"/api/properties/{test_property['id']}/renders/{render_id}/choose")
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["isChosen"] is True


def test_uploading_a_render_for_a_photo_outside_the_property_is_422(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"sourceImageId": "999999"},
    )
    assert r.status_code == 422, r.text


def test_uploading_an_unsupported_file_type_is_415(client, test_property, source_image):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/upload",
        files={"file": ("render.txt", io.BytesIO(b"no es una imagen"), "text/plain")},
        data={"sourceImageId": str(source_image["id"])},
    )
    assert r.status_code == 415, r.text
```

**Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest app/api/tests/test_renders.py -k upload -v`
Expected: FAIL (`404 Not Found` on all four — the routes don't exist yet).

**Step 3: Write minimal implementation**

In `app/api/routes/renders.py`:

1. Add `import asyncio` as the first import (top of file, before `from typing import Literal`).
2. Right after the `router = APIRouter()` line, add:

```python
# Marca de un render que no nació de una llamada al proveedor, sino de una
# subida directa (p.ej. generado en otro software). `provider`/`model` son
# `text` libre en la tabla — no hace falta un enum ni una migración — y
# `prompt_text` no puede ir vacío (CHECK de la tabla), así que lleva un
# marcador fijo en vez de un prompt real que nunca existió.
UPLOAD_PROVIDER = "upload"
UPLOAD_MODEL = "manual"
UPLOAD_PROMPT_TEXT = "Subido manualmente"

# Mismo tope/lista que `upload_property_image` (routes/properties.py): un
# render subido es, para efectos de validación, un archivo arbitrario que
# viene de un humano — ni más ni menos peligroso que una foto real.
_ALLOWED_UPLOAD_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20 MB
```

3. Add the new endpoint right after `create_property_render` (before the `create_render_from_plan` def):

```python
@router.post("/api/properties/{property_id}/renders/upload", status_code=201,
             operation_id="property_renders_upload")
async def upload_property_render(
    property_id: int,
    file: UploadFile = File(...),
    sourceImageId: int = Form(...),
    _: dict = Depends(get_current_user),
):
    """Sube un render generado FUERA de este sistema y lo agrega a la biblioteca
    de la propiedad en el mismo grupo que uno generado aquí (`source_image_id`)
    — mismas acciones después: elegir, editar, borrar. Ver UPLOAD_PROVIDER
    arriba para por qué `provider`/`model`/`prompt_text` llevan marcadores fijos
    en vez de los valores reales que tendría un render de la IA."""
    if not properties.exists(property_id):
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if file.content_type not in _ALLOWED_UPLOAD_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    source = renders_db.source_image(property_id, sourceImageId)
    if source is None:
        raise HTTPException(status_code=422,
                            detail="La foto fuente no pertenece a esta propiedad")
    content = await file.read(_MAX_UPLOAD_SIZE + 1)
    if len(content) > _MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    if not content:
        raise HTTPException(status_code=422, detail="El archivo llegó vacío")
    content = await asyncio.to_thread(images.normalize_orientation, content)

    relative_path = f"properties/{property_id}/renders/{uuid4().hex}.png"
    try:
        storage.upload(relative_path, content, file.content_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="No se pudo guardar el render") from exc

    return renders_db.add_render(
        property_id=property_id,
        source_image_id=sourceImageId,
        file_path=relative_path,
        content_type=file.content_type,
        prompt_id=None,
        prompt_text=UPLOAD_PROMPT_TEXT,
        provider=UPLOAD_PROVIDER,
        model=UPLOAD_MODEL,
    )
```

**Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest app/api/tests/test_renders.py -k upload -v`
Expected: PASS (4 passed)

**Step 5: Run the full render test file to check no regression**

Run: `.venv/bin/pytest app/api/tests/test_renders.py -v`
Expected: all pass (same count as before + 4)

**Step 6: Commit**

```bash
git add app/api/routes/renders.py app/api/tests/test_renders.py
git commit -m "feat(renders): permite subir un render de foto sin pasar por el proveedor"
```

---

### Task 2: Backend — endpoint de subida para renders de PLANO

**Files:**
- Modify: `app/api/routes/renders.py`
- Test: `app/api/tests/test_renders.py`

**Step 1: Write the failing tests**

Add right after the Task 1 tests:

```python
def test_uploading_a_render_from_plan_groups_it_by_floor(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"variant": "original", "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sourceImageId"] is None
    assert body["sourcePlanPath"] is None  # no hubo plano de referencia: no lo vio la IA
    assert body["sourceVariant"] == "original"
    assert body["floorId"] == "floor-abc-123"
    assert body["provider"] == "upload"
    assert body["model"] == "manual"


def test_uploading_a_render_from_plan_with_an_invalid_variant_is_422(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"variant": "no-existe", "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    assert r.status_code == 422, r.text


def test_an_uploaded_plan_render_can_be_chosen(client, test_property):
    r = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan/upload",
        files={"file": ("render.png", io.BytesIO(_rect_png_bytes(64, 64)), "image/png")},
        data={"variant": "original", "floorId": "floor-abc-123", "floorName": "Planta Baja"},
    )
    render_id = r.json()["id"]
    chosen = client.put(f"/api/properties/{test_property['id']}/renders/{render_id}/choose")
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["isChosen"] is True
```

**Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest app/api/tests/test_renders.py -k plan_upload -v` (no matches — use `-k "from_plan_groups or invalid_variant or plan_render_can_be_chosen"` or simply rerun the whole `-k upload`)
Expected: FAIL with 404 on the three new tests.

**Step 3: Write minimal implementation**

Add right after `create_render_from_plan` (before `edit_property_render`):

```python
@router.post("/api/properties/{property_id}/renders/from-plan/upload", status_code=201,
             operation_id="property_renders_from_plan_upload")
async def upload_render_from_plan(
    property_id: int,
    file: UploadFile = File(...),
    variant: str = Form(...),
    floorId: str = Form(...),
    floorName: str = Form(...),
    _: dict = Depends(get_current_user),
):
    """Igual que `upload_property_render`, pero agrupado por piso+variante en vez
    de por foto — así se elige junto con los renders de plano generados por la
    IA. Sin `source_plan_path`: no hubo un plano de referencia que la IA haya
    visto, así que no hay nada que guardar ahí."""
    if not properties.exists(property_id):
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if file.content_type not in _ALLOWED_UPLOAD_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {file.content_type}")
    if variant not in renders_db.SOURCE_VARIANTS:
        raise HTTPException(status_code=422,
                            detail=f"variant debe ser uno de {', '.join(renders_db.SOURCE_VARIANTS)}")
    if not floorId.strip():
        raise HTTPException(status_code=422, detail="floorId no puede ir vacío")
    if not floorName.strip():
        raise HTTPException(status_code=422, detail="floorName no puede ir vacío")
    content = await file.read(_MAX_UPLOAD_SIZE + 1)
    if len(content) > _MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 20 MB)")
    if not content:
        raise HTTPException(status_code=422, detail="El archivo llegó vacío")
    content = await asyncio.to_thread(images.normalize_orientation, content)

    # La extensión sale del content_type ya validado contra _ALLOWED_UPLOAD_MIME
    # arriba, nunca del filename que manda el cliente — un filename es texto
    # arbitrario del atacante, y confiar en su extensión para nombrar el
    # archivo guardado (mientras storage.stream() sirve el Content-Type de
    # vuelta adivinándolo de esa misma extensión) es una vía de XSS
    # almacenado: Content-Type: image/png con filename: "evil.svg" guardaría
    # el archivo como .svg y se serviría de vuelta como image/svg+xml.
    # _UPLOAD_EXT_BY_MIME reusa la misma constante de Task 1 (mismo módulo):
    #
    # _UPLOAD_EXT_BY_MIME = {
    #     "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
    # }
    #
    # Nunca `.get()` con default: si file.content_type no estuviera en el
    # diccionario sería porque se desincronizó de _ALLOWED_UPLOAD_MIME, y eso
    # debe tronar como KeyError en dev, no devolver una extensión vacía.
    ext = _UPLOAD_EXT_BY_MIME[file.content_type]
    relative_path = f"properties/{property_id}/renders/{uuid4().hex}{ext}"
    try:
        storage.upload(relative_path, content, file.content_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="No se pudo guardar el render") from exc

    return renders_db.add_render(
        property_id=property_id,
        source_image_id=None,
        file_path=relative_path,
        content_type=file.content_type,
        prompt_id=None,
        prompt_text=UPLOAD_PROMPT_TEXT,
        provider=UPLOAD_PROVIDER,
        model=UPLOAD_MODEL,
        source_variant=variant,
        floor_id=floorId.strip(),
        floor_name=floorName.strip(),
    )
```

**Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest app/api/tests/test_renders.py -v`
Expected: all pass, including the 7 new ones from Tasks 1-2.

**Step 5: Commit**

```bash
git add app/api/routes/renders.py app/api/tests/test_renders.py
git commit -m "feat(renders): permite subir un render de plano agrupado por piso"
```

---

### Task 3: Frontend — funciones de API

**Files:**
- Modify: `app/web/src/lib/api.ts`

No test file for this task — `api.ts` functions are thin fetch wrappers, exercised indirectly by the RendersPanel/wiring tests in Tasks 4-6 (same pattern as `generatePropertyRender`/`generatePropertyRenderFromPlan`, which have no dedicated unit test either).

**Step 1: Add the two functions**

Right after `generatePropertyRender` (after line 232):

```ts
export async function uploadPropertyRender(
  id: number,
  req: { sourceImageId: number; file: File },
): Promise<PropertyRender> {
  const form = new FormData()
  form.append('file', req.file)
  form.append('sourceImageId', String(req.sourceImageId))
  const res = await authFetch(`${BASE}/api/properties/${id}/renders/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}
```

Right after `generatePropertyRenderFromPlan` (after what is currently line 258):

```ts
export async function uploadPropertyRenderFromPlan(
  id: number,
  req: { file: File; variant: VariantKey; floorId: string; floorName: string },
): Promise<PropertyRender> {
  const form = new FormData()
  form.append('file', req.file)
  form.append('variant', req.variant)
  form.append('floorId', req.floorId)
  form.append('floorName', req.floorName)
  const res = await authFetch(`${BASE}/api/properties/${id}/renders/from-plan/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}
```

**Step 2: Typecheck**

Run: `cd app/web && npx tsc --noEmit`
Expected: no new errors (both functions use types already imported in this file: `PropertyRender`, `VariantKey`).

**Step 3: Commit**

```bash
git add app/web/src/lib/api.ts
git commit -m "feat(web): agrega uploadPropertyRender/uploadPropertyRenderFromPlan al cliente"
```

---

### Task 4: Frontend — botón "Subir render" en RendersPanel

**Files:**
- Modify: `app/web/src/components/detail/RendersPanel.tsx`
- Test: `app/web/src/components/detail/RendersPanel.test.tsx`

**Step 1: Write the failing tests**

Add near the end of `RendersPanel.test.tsx`, inside (or right after) the main `describe('RendersPanel', ...)` block:

```ts
describe('RendersPanel: subir un render sin generarlo', () => {
  function uploadInput(container: HTMLElement) {
    return container.querySelector('input[type="file"]') as HTMLInputElement
  }

  it('modo fotos: llama a onUpload con la foto seleccionada y el archivo', async () => {
    const onUpload = vi.fn().mockResolvedValue(renderRow(5))
    const { container } = render(<RendersPanel
      source="photos" images={[photo(10, 'fachada.jpg')]} prompts={prompts} renders={[]} base=""
      onGenerate={vi.fn()} onUpload={onUpload} onSavePrompt={vi.fn()} onDeleteRender={vi.fn()}
      onChoose={vi.fn()} onUnchoose={vi.fn()} />)

    fireEvent.click(screen.getByAltText('fachada.jpg'))
    const file = new File(['x'], 'externo.png', { type: 'image/png' })
    fireEvent.change(uploadInput(container), { target: { files: [file] } })

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith({ sourceImageId: 10, file }))
  })

  it('modo fotos: sin foto elegida, el botón de subir está deshabilitado', () => {
    render(<RendersPanel
      source="photos" images={[photo(10, 'fachada.jpg')]} prompts={prompts} renders={[]} base=""
      onGenerate={vi.fn()} onUpload={vi.fn()} onSavePrompt={vi.fn()} onDeleteRender={vi.fn()}
      onChoose={vi.fn()} onUnchoose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /SUBIR RENDER/i }).hasAttribute('disabled')).toBe(true)
  })

  it('sin onUpload, no se muestra el botón de subir', () => {
    render(<RendersPanel
      source="photos" images={[photo(10, 'fachada.jpg')]} prompts={prompts} renders={[]} base=""
      onGenerate={vi.fn()} onSavePrompt={vi.fn()} onDeleteRender={vi.fn()}
      onChoose={vi.fn()} onUnchoose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /SUBIR RENDER/i })).toBeNull()
  })

  it('modo plano: llama a onUploadPlan con el piso seleccionado y el archivo', async () => {
    const onUploadPlan = vi.fn().mockResolvedValue(planRenderRow(5))
    const cocina = planWithRooms(['Cocina'])
    const { container } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={1}
      onGeneratePlan={vi.fn()} onUploadPlan={onUploadPlan} />)

    fireEvent.click(screen.getByText(/^el plano$/i))
    const file = new File(['x'], 'externo.png', { type: 'image/png' })
    fireEvent.change(uploadInput(container), { target: { files: [file] } })

    await waitFor(() => expect(onUploadPlan).toHaveBeenCalledWith({
      floorId: cocina.id, floorName: cocina.name, file,
    }))
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd app/web && npx vitest run src/components/detail/RendersPanel.test.tsx -t "subir un render"`
Expected: FAIL — `onUpload`/`onUploadPlan` aren't valid props yet (TS) and no upload button/input exists.

**Step 3: Write minimal implementation**

In `app/web/src/components/detail/RendersPanel.tsx`:

1. Add to `PhotosProps` (after `onGenerate`):
```ts
  onUpload?: (req: { sourceImageId: number; file: File }) => Promise<PropertyRender>
```
and to its `never` list, add `onUploadPlan?: never`.

2. Add to `PlanProps` (after `onGeneratePlan`):
```ts
  onUploadPlan?: (req: { floorId: string; floorName: string; file: File }) => Promise<PropertyRender>
```
and to its `never` list, add `onUpload?: never`.

3. Inside `RendersPanel`, after the `onGeneratePlan` narrowing line:
```ts
  const onUpload = props.source === 'photos' ? props.onUpload : undefined
  const onUploadPlan = props.source === 'plan' ? props.onUploadPlan : undefined
```

4. Add state, next to the other `useState`s:
```ts
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
```
(add `useRef` to the existing `react` import line if not already there — it already is, line 1.)

5. Add a handler, right after the `generate` function:
```ts
  async function handleUploadFile(f: File) {
    setUploading(true); setError(null)
    try {
      if (usePlan && onUploadPlan) {
        await onUploadPlan({ floorId: selectedFloorId!, floorName: selectedFloorName!, file: f })
      } else if (onUpload && sourceId != null) {
        await onUpload({ sourceImageId: sourceId, file: f })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir el render')
    } finally { setUploading(false) }
  }

  function onUploadInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) void handleUploadFile(f)
  }
```

6. In the JSX, inside the `naming ? (...) : (...)` else-branch (the `<div style={{ display: 'flex', gap: spacing.sm }}>` that holds "Guardar como nuevo" and "GENERAR RENDER"), add the upload button + hidden input right after the generate button:
```tsx
          <button onClick={generate} disabled={busy || uploading || (!usePlan && sourceId == null) || !text.trim()} style={btn(true)}>
            {busy ? 'GENERANDO…' : 'GENERAR RENDER'}
          </button>
          {(onUpload || onUploadPlan) && (
            <>
              <input ref={uploadInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                     onChange={onUploadInputChange} />
              <button onClick={() => uploadInputRef.current?.click()}
                      disabled={busy || uploading || (!usePlan && sourceId == null)} style={btn(false)}>
                {uploading ? 'SUBIENDO…' : 'SUBIR RENDER'}
              </button>
            </>
          )}
```

7. Add a busy indicator for uploads, right after the existing `{busy && (...)}` block (in the "Renders generados" section):
```tsx
          {uploading && (
            <div style={{ border: `1px dashed ${colors.border}`, borderRadius: radius.sm,
                          padding: spacing.lg, textAlign: 'center', background: colors.surface }}>
              <p style={{ ...label, color: colors.primary }}>Subiendo render…</p>
            </div>
          )}
```

**Step 4: Run tests to verify they pass**

Run: `cd app/web && npx vitest run src/components/detail/RendersPanel.test.tsx`
Expected: all pass (existing tests + 4 new).

**Step 5: Typecheck**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors.

**Step 6: Commit**

```bash
git add app/web/src/components/detail/RendersPanel.tsx app/web/src/components/detail/RendersPanel.test.tsx
git commit -m "feat(web): botón para subir un render sin generarlo en RendersPanel"
```

---

### Task 5: Frontend — wiring en FotosPanel

**Files:**
- Modify: `app/web/src/components/detail/FotosPanel.tsx`
- Test: `app/web/src/components/detail/FotosPanel.test.tsx`

**⚠ Naming collision found during implementation (fixed here):** `FotosPanel.tsx` already has a REQUIRED prop `onUpload: (file: File, imageType: ImageType) => Promise<void>` (forwards to `PhotoGallery`, wired from `PropertyDetailPage.tsx` to `uploadPropertyImage`). The render-upload prop below CANNOT reuse that name — it needs a distinct one. Use `onUploadRender`, matching the name already used for `LevantamientoPanel` in Task 6. `FotosPanel` maps its own `onUploadRender` prop onto `RendersPanel`'s `onUpload` prop (the names differ only at the `FotosPanel` boundary — `RendersPanel`'s own `onUpload`/`onUploadPlan` props, from Task 4, are unaffected).

**Step 1: Write the failing test**

Add to `FotosPanel.test.tsx`, right after the existing `'reenvía onChoose/onUnchoose a RendersPanel...'` test (uses the file's own `setup()` helper, same convention):

```ts
it('reenvía onUploadRender a RendersPanel como onUpload', () => {
  const props = setup()
  fireEvent.click(screen.getByText('RENDERS'))
  expect(vi.mocked(RendersPanel)).toHaveBeenCalledWith(
    expect.objectContaining({ onUpload: props.onUploadRender }), {},
  )
})
```

This also needs `onUploadRender: vi.fn().mockResolvedValue(renderRow)` added to the `setup()` helper's default `props` object (next to `onGenerate`, near the top of the file) — otherwise `props.onUploadRender` is `undefined` and the assertion above is vacuous.

**Step 2: Run test to verify it fails**

Run: `cd app/web && npx vitest run src/components/detail/FotosPanel.test.tsx -t "reenvía onUploadRender"`
Expected: FAIL (TS error: `onUploadRender` not a valid prop on `FotosPanel`).

**Step 3: Write minimal implementation**

In `FotosPanel.tsx`:
1. Add to `Props` (after `onGenerate`):
```ts
  onUploadRender?: (req: { sourceImageId: number; file: File }) => Promise<PropertyRender>
```
2. Destructure it in the function signature (add `onUploadRender` next to `onGenerate`).
3. Forward it to `RendersPanel`'s `onUpload` prop: add `onUpload={onUploadRender}` next to `onGenerate={onGenerate}`. (Note: `RendersPanel`'s own prop is still named `onUpload` — only `FotosPanel`'s prop is renamed, to avoid colliding with its pre-existing photo-gallery `onUpload`.)

**Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/components/detail/FotosPanel.test.tsx`
Expected: all pass.

**Step 5: Commit**

```bash
git add app/web/src/components/detail/FotosPanel.tsx app/web/src/components/detail/FotosPanel.test.tsx
git commit -m "feat(web): reenvía onUploadRender de FotosPanel a RendersPanel"
```

---

### Task 6: Frontend — wiring en LevantamientoPanel

**Files:**
- Modify: `app/web/src/components/LevantamientoPanel.tsx`
- Test: `app/web/src/components/LevantamientoPanel.test.tsx`

**Step 1: Write the failing test**

`LevantamientoPanel.test.tsx` uses a shared `renderPanel(variant, geometry, onSave, over)` helper (see top of the file) whose `over` param currently accepts `renders`/`onGenerateRender`. Extend it to also accept `onUploadRender`, and pass it through to the rendered `<LevantamientoPanel>`:

```ts
// In the `over` type of renderPanel:
    onUploadRender?: (variant: VariantKey, req: { floorId: string; floorName: string; file: File })
      => Promise<PropertyRender>

// Inside renderPanel, next to the onGenerateRender resolution:
  const onUploadRender = over.onUploadRender ? vi.fn(over.onUploadRender) : undefined

// In buildElement's JSX, next to onGenerateRender={onGenerateRender}:
      onUploadRender={onUploadRender}

// In the return object, next to onGenerateRender:
  return {
    onSave, onReady, onGenerateRender, onUploadRender,
    rerenderWithGeometry: (geo: FloorPlanModel | null) => rerender(buildElement(geo)),
  }
```

Then add a new test in the `'LevantamientoPanel · selector de piso en RENDERS (Task 30)'` describe block (or a new describe block right after it), mirroring `'generar con el piso B seleccionado manda el id/nombre de B, no el de A'`:

```ts
it('subir un render en modo plano manda la variante y el piso seleccionado', async () => {
  const dos = dosPlantas()
  const uploadImpl = vi.fn().mockResolvedValue(planRenderRow(5, 'original'))
  const { container } = renderPanel('original', withVariant(null, 'original', dos), undefined,
    { onUploadRender: uploadImpl })

  fireEvent.click(screen.getByText('RENDERS'))
  fireEvent.click(screen.getByText('Planta Alta'))
  fireEvent.click(screen.getByText(/^el plano$/i))
  const file = new File(['x'], 'externo.png', { type: 'image/png' })
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })

  await waitFor(() => expect(uploadImpl).toHaveBeenCalled())
  const [variant, req] = uploadImpl.mock.calls[0]
  expect(variant).toBe('original')
  expect(req.floorId).toBe(dos.floors[1].id)
  expect(req.floorName).toBe('Planta Alta')
  expect(req.file).toBe(file)
})
```

Note: `renderPanel`'s `render(...)` call currently discards the `container` — check whether it already returns one; if not, capture it from `const { rerender, container } = render(buildElement(geometry))` and add `container` to the returned object so this test (and Task 4/7's pattern) can query the hidden file input.

**Step 2: Run test to verify it fails**

Run: `cd app/web && npx vitest run src/components/LevantamientoPanel.test.tsx -t "subir un render"`
Expected: FAIL (`onUploadRender` not a valid prop yet).

**Step 3: Write minimal implementation**

In `LevantamientoPanel.tsx`:
1. Add to `Props` (after `onGenerateRender`):
```ts
  onUploadRender?: (variant: VariantKey, req: { floorId: string; floorName: string; file: File })
    => Promise<PropertyRender>
```
2. Destructure `onUploadRender` in the component's props (next to `onGenerateRender`).
3. Add a callback next to `handleGeneratePlan`:
```ts
  const handleUploadPlan = useCallback(async (req: { floorId: string; floorName: string; file: File }) => {
    return onUploadRender!(variant, req)
  }, [variant, onUploadRender])
```
4. Pass it to the `RendersPanel` mount (the `source="plan"` one, around line 396-399):
```tsx
        prompts={prompts} renders={renders} onGeneratePlan={handleGeneratePlan}
        onUploadPlan={onUploadRender ? handleUploadPlan : undefined}
```

**Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/components/LevantamientoPanel.test.tsx`
Expected: all pass.

**Step 5: Commit**

```bash
git add app/web/src/components/LevantamientoPanel.tsx app/web/src/components/LevantamientoPanel.test.tsx
git commit -m "feat(web): reenvía la subida de renders de plano a onUploadRender"
```

---

### Task 7: Frontend — wiring final en PropertyDetailPage

**Files:**
- Modify: `app/web/src/components/PropertyDetailPage.tsx`
- Test: `app/web/src/components/PropertyDetailPage.test.tsx`

**Step 1: Write the failing test**

In `PropertyDetailPage.test.tsx`:
1. Add `uploadPropertyRenderFromPlan: vi.fn()` to the `vi.mock('../lib/api', ...)` block (next to `generatePropertyRenderFromPlan: vi.fn()`, around line 47) — same reasoning comment as the existing seam: without mocking it here, the test below would hit the real backend instead of testing the page's `{...req, variant}` wiring.
2. Add a test near the existing `'generar RENDERS desde el PLANEADO...'` test (around line 901), mirroring it exactly but for upload:

```ts
it('subir un render desde el PLANEADO llama a uploadPropertyRenderFromPlan con variant: "planned" y el piso', async () => {
  const plannedFloor = emptyFloorGraph('Planta Planeada')
  const v3: FloorPlanModel = {
    schemaVersion: 3,
    variants: {
      original: { slab_m: 0.15, activeFloor: 0, floors: [emptyFloorGraph('Planta Original')] },
      planned: { slab_m: 0.15, activeFloor: 0, floors: [plannedFloor] },
    },
  }
  vi.mocked(api.fetchPropertyGeometry).mockResolvedValueOnce(v3)
  vi.mocked(api.uploadPropertyRenderFromPlan).mockResolvedValueOnce(renderFromPlan('planned'))
  await renderPage(BASE_PROPERTY)

  fireEvent.click(screen.getByText('PLANO DE PROYECTO'))
  expect(await screen.findByText('Planta Planeada')).not.toBeNull()

  fireEvent.click(screen.getByText('RENDERS'))
  fireEvent.click(await screen.findByText(/^el plano$/i))
  const file = new File(['x'], 'externo.png', { type: 'image/png' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })

  await waitFor(() => expect(api.uploadPropertyRenderFromPlan).toHaveBeenCalled())
  const [id, req] = vi.mocked(api.uploadPropertyRenderFromPlan).mock.calls[0]
  expect(id).toBe(7)
  expect(req.variant).toBe('planned')
  expect(req.floorId).toBe(plannedFloor.id)
  expect(req.floorName).toBe('Planta Planeada')
})
```

**Step 2: Run test to verify it fails**

Run: `cd app/web && npx vitest run src/components/PropertyDetailPage.test.tsx -t "subir un render desde el PLANEADO"`
Expected: FAIL (`onUploadRender` never passed to `LevantamientoPanel`, so no upload button renders / `api.uploadPropertyRenderFromPlan` never called).

**Step 3: Write minimal implementation**

In `PropertyDetailPage.tsx`:
1. Add `uploadPropertyRender, uploadPropertyRenderFromPlan` to the import from `../lib/api` (same line as `generatePropertyRender, generatePropertyRenderFromPlan`, around line 8).
2. Right after the `onGenerateRender` function (around line 330), add:
```ts
  /** Análogo a `onGenerateRender`, pero para la subida directa: mismo spread
   * `{...req, variant}`, mismo seam. */
  async function onUploadRender(
    variant: VariantKey,
    req: { floorId: string; floorName: string; file: File },
  ): Promise<PropertyRender> {
    const created = await uploadPropertyRenderFromPlan(propertyId, { ...req, variant })
    setRenders(prev => [created, ...prev])
    return created
  }
```
3. In the FotosPanel mount (around line 1233), right after the `onGenerate={...}` block, add (note the prop name is `onUploadRender`, per Task 5's fix — `FotosPanel` has its own pre-existing `onUpload` for photo-gallery uploads, unrelated to this one):
```tsx
                  onUploadRender={async req => {
                    const created = await uploadPropertyRender(p.id, req)
                    setRenders(prev => [created, ...prev])
                    return created
                  }}
```
4. In BOTH `<LevantamientoPanel>` mounts (`levantamiento-original` and `levantamiento-planeado`, around lines 1265 and 1288), add `onUploadRender={onUploadRender}` next to `onGenerateRender={onGenerateRender}`.

**Step 4: Run test to verify it passes**

Run: `cd app/web && npx vitest run src/components/PropertyDetailPage.test.tsx`
Expected: all pass.

**Step 5: Typecheck the whole frontend**

Run: `cd app/web && npx tsc --noEmit`
Expected: no errors.

**Step 6: Commit**

```bash
git add app/web/src/components/PropertyDetailPage.tsx app/web/src/components/PropertyDetailPage.test.tsx
git commit -m "feat(web): conecta la subida de renders en la ficha de propiedad"
```

---

### Task 8: Verificación manual en el stack vivo

**No code changes** — this task confirms the feature end-to-end against the worktree's already-running instance (API `:8020`, web `:5190`).

**Step 1: Run the full test suites once more**

```bash
.venv/bin/pytest app/api/tests/ -v
cd app/web && npm run test
```
Expected: everything green.

**Step 2: Manual check — photo render upload**

1. Open `http://localhost:5190`, log in as `delagarzaguerra@gmail.com` (see project memory for the password).
2. Open any property with at least one photo → FOTOS → RENDERS.
3. Pick a photo, click "SUBIR RENDER", choose any local image file.
4. Confirm: the uploaded image appears as a new render card, labelled with today's date and `manual` as the model; clicking ★ stars it; refreshing the page keeps it starred.

**Step 3: Manual check — plan render upload**

1. On the same property, open PLANO ORIGINAL (or PLANO DE PROYECTO) → RENDERS.
2. Click "El plano" to select the floor source, then "SUBIR RENDER", choose a file.
3. Confirm: it appears grouped under the current floor, can be starred, and (if the floor set has 2+ floors) does not leak into the "Sin piso identificado" section.

**Step 4: Report back**

Summarize pass/fail for both manual checks before considering this plan done.

---

## Fuera de alcance (igual que en el diseño)

- Sin caption/nota opcional para el render subido.
- Sin cambio de schema.
- Sin endpoint de "reemplazar" un render existente por una subida — esto agrega uno nuevo, como cualquier render.
