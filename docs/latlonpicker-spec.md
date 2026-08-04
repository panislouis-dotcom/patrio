# LatLonPicker — Design Spec

**Date:** 2026-05-17
**Status:** Approved · **entity names superseded** (see note)

> **Superseded — 2026-08.** Prospects and projects were merged into a single
> `properties` entity with a status lifecycle. The components named below no
> longer exist under those names: `SmartProspectModal` → `SmartPropertyModal`,
> `ProspectDetailPage` + `ProjectDetailPage` → one `PropertyDetailPage`,
> `ProspectForm` → `PropertyForm`, `ProspectMap` → `PropiedadesMap`. The
> `LatLonPicker` design itself shipped as specified and is unchanged.

## Context

Lat/lon coordinates are central to the app — every prospect and project needs them for the map view. Currently there are two problems:

1. **SmartProspectModal** (AI image-parse flow) shows lat/lon from geocoding as a read-only badge. The user cannot see or edit the coordinates before saving.
2. **ProspectDetailPage** and **ProjectDetailPage** expose lat/lon as plain number inputs with no spatial feedback — you can type a number but you can't see where it is on a map.

`ProspectForm` has a working map picker (click to place), but it's implemented inline and not reused anywhere.

The goal: a single shared `LatLonPicker` component that provides text-input editing plus an optional map picker, used consistently across all surfaces where lat/lon can be modified.

---

## Component: `LatLonPicker`

**File:** `apps/web/src/components/LatLonPicker.tsx`

### Props

```tsx
interface Props {
  lat: number
  lon: number
  onChange: (lat: number, lon: number) => void
}
```

### Behavior

**Always rendered:**
- Two number inputs in a `1fr 1fr` grid: LATITUD and LONGITUD
- Inputs are editable by typing at any time
- A toggle button below: `📍 ABRIR MAPA` / `CERRAR MAPA`

**When map is open:**
- A ~200px tall `MapContainer` (react-leaflet) renders below the button
- OpenStreetMap tiles (same as the rest of the app — no API key needed)
- A `CircleMarker` at the current coordinates (Monterrey fallback `[25.6866, -100.3161]` when `lat === 0 && lon === 0`)
- A `MapClickHandler` (using `useMapEvents`) — clicking any point on the map calls `onChange(lat, lng)` instantly, no confirm/cancel step
- Typing in the inputs while the map is open moves the `CircleMarker` to the new position

**Styling:** follows the app's `fieldInput` pattern (transparent background, `borderBottom` only, `fonts.label` for labels). Toggle button uses the app's ghost button style.

### Leaflet icon fix

The existing `ProspectMap.tsx` already imports Leaflet but does not use default markers (it uses `CircleMarker`). `LatLonPicker` will also use `CircleMarker` — no icon path fix required.

---

## Integration Points

### 1. SmartProspectModal

**File:** `apps/web/src/components/SmartProspectModal.tsx`

**Change:** Add `lat`/`lon` state (both `number`, initial value `0`). Sync them from `parsed` via a `useEffect([parsed])` — when `parsed` arrives after the AI call, set `setLat(parsed.latitude ?? 0)` and `setLon(parsed.longitude ?? 0)`. Replace the current read-only geo badge (lines ~456–470) with `<LatLonPicker lat={lat} lon={lon} onChange={(lat, lon) => { setLat(lat); setLon(lon) }} />`. On save, pass `lat`/`lon` state to `createProspect` instead of `parsed?.latitude ?? 0`.

The geocoding that already runs in `parse_prospect.py` will auto-populate the inputs when it succeeds. If it fails (address too vague), the inputs show `0` and the user can set the pin manually.

### 2. ProspectDetailPage

**File:** `apps/web/src/components/ProspectDetailPage.tsx`

**Change:** The lat/lon fields are currently rendered as generic number inputs inside a `fields.map()` loop (lines ~437–438). Extract them from that array and render `<LatLonPicker>` in their place. Wire `onChange` to call `handleEdit('latitude', lat)` and `handleEdit('longitude', lon)`. The existing "GUARDAR ▸" save flow is unchanged — the picker just feeds the `edits` state like any other field.

### 3. ProjectDetailPage

**File:** `apps/web/src/components/ProjectDetailPage.tsx`

**Change:** Same pattern as ProspectDetailPage. The lat/lon fields are at lines ~469–470 inside a similar fields array. Extract and replace with `<LatLonPicker>`, wired to the project's edit handler.

### 4. ProspectForm (refactor)

**File:** `apps/web/src/components/ProspectForm.tsx`

**Change:** ProspectForm has its own inline map picker (the `MapClickHandler` component defined locally, lines ~46–49). Replace with `<LatLonPicker>` for consistency. The local `MapClickHandler` component can be deleted.

---

## Data Flow Summary

```
User types in input ──────────────────────────────► onChange(lat, lon)
                                                          │
User clicks on map ──► MapClickHandler.onPlace(lat,lon) ─┘
                                                          │
                                              parent state updates
                                                          │
                                              CircleMarker repositions (if map open)
                                              Inputs reflect new values
```

No backend changes — coordinates continue to be stored as `latitude`/`longitude` floats on `prospects` and `projects`.

---

## Files Modified

| File | Change |
|---|---|
| `apps/web/src/components/LatLonPicker.tsx` | NEW — shared picker component |
| `apps/web/src/components/SmartProspectModal.tsx` | Add lat/lon state, replace geo badge with LatLonPicker |
| `apps/web/src/components/ProspectDetailPage.tsx` | Extract lat/lon fields, replace with LatLonPicker |
| `apps/web/src/components/ProjectDetailPage.tsx` | Extract lat/lon fields, replace with LatLonPicker |
| `apps/web/src/components/ProspectForm.tsx` | Replace inline MapClickHandler with LatLonPicker |

---

## Verification

1. **SmartProspectModal:** Upload a listing image → parse → review step shows LATITUD/LONGITUD inputs prefilled from geocoding → open map → pin appears at correct location → click elsewhere → inputs update → save → prospect map shows pin at new location
2. **SmartProspectModal (geocoding fails):** Parse image with vague address → inputs show `0` → user can click map to set location manually
3. **ProspectDetailPage:** Open existing prospect with coordinates → left panel shows LatLonPicker with current values → open map → pin at correct location → click new location → inputs update → GUARDAR → map in central panel updates
4. **ProjectDetailPage:** Same as ProspectDetailPage for a project record
5. **ProspectForm:** Create new prospect via manual form → LatLonPicker works identically to before
6. **Typing:** With map open, type a new lat value → pin moves to new position
7. **TypeScript:** `npx tsc --noEmit` passes with zero errors
