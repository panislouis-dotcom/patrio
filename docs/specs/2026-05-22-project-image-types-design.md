# Project Image Types — Design Spec

**Date:** 2026-05-22  
**Status:** Approved · **superseded in part** (see note)  
**Scope:** Projects only (`prospect_images` untouched)

> **Superseded — 2026-08.** Prospects and projects were merged into a single
> `properties` entity with a status lifecycle. `project_images` and
> `prospect_images` are now one table, `property_images`, and its `image_type`
> stays `antes`/`despues` — every property has a gallery for its whole life,
> not just after the purchase. The gallery design
> below (filter bar, coloured badges, per-thumbnail toggle) is what shipped and
> still describes the UI; only the entity names and the two-table split are
> stale. See `app/.claude/skills/use-refigan.md` for the current model.

---

## Goal

Allow project images to be classified as **ANTES** or **DESPUÉS**. The gallery stays unified — one view with filter, colored badges, two upload buttons, and a per-thumbnail type toggle.

---

## Design Summary

The center column FOTOS tab gets:
- A filter bar: `TODAS | ANTES | DESPUÉS`
- A colored badge on the main image (orange = ANTES, green = DESPUÉS)
- A colored dot on each thumbnail (bottom-left)
- Two upload buttons in the thumbnail strip: `+ antes` and `+ después`
- A `⇄` icon on each thumbnail (visible on hover) to toggle the type without re-uploading

Existing images default to `'antes'` via the DB column default — no data migration needed.

---

## Data Model

### Migration: `012_project_image_type.sql`

```sql
-- migrate:up
ALTER TABLE project_images
  ADD COLUMN IF NOT EXISTS image_type TEXT NOT NULL DEFAULT 'antes'
  CHECK (image_type IN ('antes', 'despues'));

-- migrate:down
ALTER TABLE project_images
  DROP COLUMN IF EXISTS image_type;
```

The `DEFAULT 'antes'` covers all existing rows without a backfill.

---

## Backend

### `apps/api/db.py`

**`get_project_images`** — already does `SELECT *`, picks up the new column automatically. No change needed.

**`add_project_image`** — add `image_type` parameter:

```python
def add_project_image(
    project_id: int,
    file_path: str,
    file_name: str,
    content_type: str,
    image_type: str = 'antes',
) -> dict:
    with _conn() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "INSERT INTO project_images (project_id, file_path, file_name, content_type, image_type)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING *",
            (project_id, file_path, file_name, content_type, image_type),
        )
        return dict(cur.fetchone())
```

**`update_project_image_type`** — new function:

```python
def update_project_image_type(image_id: int, project_id: int, image_type: str) -> dict:
    with _conn() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "UPDATE project_images SET image_type = %s"
            " WHERE id = %s AND project_id = %s RETURNING *",
            (image_type, image_id, project_id),
        )
        row = cur.fetchone()
        if row is None:
            raise ValueError(f"Image {image_id} not found for project {project_id}")
        return dict(row)
```

### `apps/api/routes/projects.py`

**Upload route** — add `image_type` Form field:

```python
@router.post("/api/projects/{project_id}/images", status_code=201)
async def upload_project_image(
    project_id: int,
    file: UploadFile = File(...),
    image_type: str = Form(default='antes'),
    _: dict = Depends(get_current_user),
):
    # ... existing validation and file write unchanged ...
    if image_type not in ('antes', 'despues'):
        raise HTTPException(status_code=422, detail="image_type must be 'antes' or 'despues'")
    return add_project_image(project_id, relative_path, file.filename or "", file.content_type or "image/jpeg", image_type)
```

**New PATCH route** — flip image type:

```python
class ImageTypeUpdate(BaseModel):
    image_type: str

@router.patch("/api/projects/{project_id}/images/{image_id}", status_code=200)
async def update_project_image_type_route(
    project_id: int,
    image_id: int,
    body: ImageTypeUpdate,
    _: dict = Depends(get_current_user),
):
    if body.image_type not in ('antes', 'despues'):
        raise HTTPException(status_code=422, detail="image_type must be 'antes' or 'despues'")
    try:
        return update_project_image_type(image_id, project_id, body.image_type)
    except ValueError:
        raise HTTPException(status_code=404, detail="Image not found")
```

Import additions in `routes/projects.py`: `BaseModel` from `pydantic`; `update_project_image_type` from `api.db`.

---

## Frontend

### `apps/web/src/lib/types.ts`

Add `ImageType` union and `ProjectImage` interface. Keep `PropertyImage` unchanged (prospects still use it without image type).

```typescript
export type ImageType = 'antes' | 'despues'

export interface ProjectImage extends PropertyImage {
  imageType: ImageType
}
```

Update `Project.images` field type:

```typescript
export interface Project {
  // ...
  images: ProjectImage[]   // was: PropertyImage[]
  // ...
}
```

### `apps/web/src/lib/api.ts`

**`uploadProjectImage`** — add `imageType` parameter:

```typescript
export async function uploadProjectImage(
  projectId: number,
  file: File,
  imageType: ImageType = 'antes',
): Promise<ProjectImage> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('image_type', imageType)
  const res = await authFetch(`${BASE}/api/projects/${projectId}/images`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(await res.text())
  return res.json()   // server already returns camelCase keys via _snake_to_camel
}
```

**`updateProjectImageType`** — new function:

```typescript
export async function updateProjectImageType(
  projectId: number,
  imageId: number,
  imageType: ImageType,
): Promise<ProjectImage> {
  const res = await authFetch(`${BASE}/api/projects/${projectId}/images/${imageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_type: imageType }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()   // server already returns camelCase keys
}
```

### `apps/web/src/components/ProjectPhotoGallery.tsx` — new component

A project-specific gallery that replaces `PhotoGallery` in `ProjectDetailPage`. `PhotoGallery` stays unchanged for prospects.

**Props:**

```typescript
interface Props {
  images: ProjectImage[]
  base: string
  onUpload: (file: File, imageType: ImageType) => Promise<void>
  onDelete: (imageId: number) => Promise<void>
  onFlipType: (imageId: number, newType: ImageType) => Promise<void>
}
```

**Internal state:**

```typescript
const [filter, setFilter] = useState<'all' | ImageType>('all')
const [selected, setSelected] = useState(0)
const [lightbox, setLightbox] = useState(false)
const [uploading, setUploading] = useState<ImageType | null>(null)
const [flipping, setFlipping] = useState<number | null>(null)   // imageId being toggled
```

**Filtered images:**

```typescript
const visible = filter === 'all' ? images : images.filter(img => img.imageType === filter)
```

The `selected` index resets to 0 when `filter` changes (via `useEffect`).

**Filter bar** (above the main photo area):

```
TODAS | ANTES | DESPUÉS
```
Pill-group style buttons. Active state: `colors.neutral` text + `#151f15` background.

**Main image badge** — absolute-positioned top-left:
- ANTES: orange tint (`#d4891a`)
- DESPUÉS: green tint (`colors.primary`)

**Thumbnail strip layout:**

```
[thumb][thumb][thumb] ... [+ antes][+ después]
```

Each thumbnail:
- Colored dot bottom-left (orange = antes, green = después)
- `×` delete button top-right (always visible, same as current `PhotoGallery`)
- `⇄` flip button top-right adjacent to `×`, visible on hover (CSS `:hover` on parent)
  - Clicking `⇄` calls `onFlipType(img.id, img.imageType === 'antes' ? 'despues' : 'antes')`
  - While `flipping === img.id`, show spinner `…` instead of `⇄`

Two upload buttons at the end of the strip:
- `+ antes` — dashed border, orange-tinted
- `+ después` — dashed border, green-tinted
- Each has its own hidden `<input type="file">` ref
- While `uploading === 'antes'` or `uploading === 'despues'`, disable that button and show `…`

**Lightbox** — identical to current `PhotoGallery` lightbox, operates on `visible` images.

### `apps/web/src/components/ProjectDetailPage.tsx`

Replace `PhotoGallery` usage with `ProjectPhotoGallery`:

```typescript
import { ProjectPhotoGallery } from './ProjectPhotoGallery'

// In JSX (center column, FOTOS tab):
<ProjectPhotoGallery
  images={project.images}
  base={BASE}
  onUpload={async (file, imageType) => {
    const img = await uploadProjectImage(project.id, file, imageType)
    setProject(p => p ? { ...p, images: [...p.images, img] } : p)
  }}
  onDelete={async (imageId) => {
    await deleteProjectImage(project.id, imageId)
    setProject(p => p ? { ...p, images: p.images.filter(i => i.id !== imageId) } : p)
  }}
  onFlipType={async (imageId, newType) => {
    const updated = await updateProjectImageType(project.id, imageId, newType)
    setProject(p => p ? { ...p, images: p.images.map(i => i.id === imageId ? updated : i) } : p)
  }}
/>
```

Remove the `PhotoGallery` import from `ProjectDetailPage`. The `PhotoGallery` import in `ProspectDetailPage` is unchanged.

---

## What Does NOT Change

- `PhotoGallery.tsx` — untouched
- `ProspectDetailPage.tsx` — untouched
- `prospect_images` table — untouched
- `PropertyImage` interface — untouched
- All existing tests — no behavior change for non-image routes

---

## Verification

```bash
# 1. Apply migration
make migrate   # or: dbmate up

# 2. TypeScript
cd apps/web && npx tsc --noEmit

# 3. API tests
PYTHONPATH=.:apps .venv/bin/pytest apps/api/tests/ -q

# 4. Manual — in ProjectDetailPage:
#    - Upload a photo via "+ antes" → badge shows ANTES, dot is orange
#    - Upload a photo via "+ después" → badge shows DESPUÉS, dot is green
#    - Filter to ANTES → only orange-dot photos visible
#    - Filter to DESPUÉS → only green-dot photos visible
#    - Hover a thumbnail → ⇄ visible; click → type flips, dot color changes
#    - Reload page → types persist
#    - ProspectDetailPage gallery still works normally (no regression)
```
