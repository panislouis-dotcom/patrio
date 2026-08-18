import { useState } from 'react'
import type React from 'react'
import { colors, fonts } from '../../lib/theme'
import type { ImageType, PropertyImage, PropertyRender, RenderPrompt, RenderPromptKind } from '../../lib/types'
import { PhotoGallery } from '../PhotoGallery'
import { btn as photoBtn } from '../floorplanStyles'
import { RendersPanel } from './RendersPanel'

interface Props {
  images: PropertyImage[]
  base: string
  onUpload: (file: File, imageType: ImageType) => Promise<void>
  onDelete: (imageId: number) => Promise<void>
  onChangeType?: (imageId: number, next: ImageType) => Promise<void>
  onReorder?: (imageIds: number[]) => Promise<void>
  prompts: RenderPrompt[]
  renders: PropertyRender[]
  onGenerate: (req: { sourceImageId: number; promptId: number | null; promptText: string })
    => Promise<PropertyRender>
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  onSavePrompt: (p: { name: string; body: string; kind: RenderPromptKind }) => Promise<RenderPrompt>
  onDeleteRender: (renderId: number) => Promise<void>
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
}

type SubTab = 'galeria' | 'renders'

const SUB_TABS: readonly [SubTab, string][] = [['galeria', 'GALERÍA'], ['renders', 'RENDERS']]

// Mismo rótulo de tira que el selector de piso de `LevantamientoPanel`; ahí es
// un `const` local, no exportado, así que se repite el objeto en vez de sacar un
// módulo compartido por dos usos.
const label: React.CSSProperties = { fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary }

/**
 * FOTOS: GALERÍA (la obra, en fotos reales) y RENDERS (propuestas nacidas de esas
 * fotos). Sub-navegación interna en vez de dos pestañas de nivel superior — a
 * propósito calca el filtro ANTES/DESPUÉS de `PhotoGallery` (misma tira de
 * botones, mismo tono, misma esquina), porque es el mismo gesto: elegir qué ver
 * DENTRO de una sola sección, no saltar a otra.
 *
 * Monta `PhotoGallery` y `RendersPanel` (con `source="photos"`) sin tocar su
 * interior: esta es una cáscara de navegación, no un tercer lugar donde la
 * separación foto/render (probada exhaustivamente en `RendersPanel`) se pudiera
 * aflojar. Solo una vive a la vez —como en `MediaTabs`— así que cambiar de
 * sub-pestaña también descarta lo no confirmado de la otra (selección de
 * lightbox, prompt a medio escribir): mismo trato que ya tienen las pestañas
 * de nivel superior.
 */
export function FotosPanel({
  images, base, onUpload, onDelete, onChangeType, onReorder,
  prompts, renders, onGenerate, onEdit, onSavePrompt, onDeleteRender, onChoose, onUnchoose,
}: Props) {
  const [tab, setTab] = useState<SubTab>('galeria')
  // La foto cuyos renders se enseñan. Vive aquí —dueño de `images`— y no dentro
  // de `RendersPanel`, igual que el selector de piso vive en `LevantamientoPanel`.
  // Nada que ver con el escogedor de "Fuente" de `RendersPanel`: ese dice de qué
  // foto NACE un render nuevo; este, cuáles ya existentes se ENSEÑAN. Null =
  // todavía nadie eligió; abajo cae a la primera foto para no abrir en blanco.
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null)
  const shownImageId = selectedImageId ?? images[0]?.id ?? null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    padding: '4px 8px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        {SUB_TABS.map(([key, text], idx) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontFamily: fonts.label, fontSize: '7px', letterSpacing: '0.1em',
            padding: '3px 9px',
            border: `1px solid ${colors.border}`, marginLeft: idx === 0 ? 0 : '-1px',
            background: tab === key ? colors.surfaceAlt : 'transparent',
            color: tab === key ? colors.neutral : colors.secondary, cursor: 'pointer',
          }}>
            {text}
          </button>
        ))}
      </div>

      {tab === 'galeria' ? (
        <PhotoGallery images={images} base={base} onUpload={onUpload} onDelete={onDelete}
          onChangeType={onChangeType} onReorder={onReorder} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {images.length > 0 && (
            <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap',
                          padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
              <span style={label}>FOTO</span>
              {images.map(img => (
                <button key={img.id} onClick={() => setSelectedImageId(img.id)}
                  style={{ ...photoBtn(img.id === shownImageId), textTransform: 'none', letterSpacing: '0.04em',
                           fontFamily: fonts.sans, fontSize: '11px' }}>
                  {img.fileName}
                </button>
              ))}
            </div>
          )}
          <RendersPanel source="photos" images={images} prompts={prompts} renders={renders} base={base}
            selectedImageId={shownImageId}
            onGenerate={onGenerate} onEdit={onEdit} onSavePrompt={onSavePrompt} onDeleteRender={onDeleteRender}
            onChoose={onChoose} onUnchoose={onUnchoose} />
        </div>
      )}
    </div>
  )
}
