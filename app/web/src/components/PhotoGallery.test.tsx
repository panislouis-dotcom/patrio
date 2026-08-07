import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PhotoGallery, type GalleryImage } from './PhotoGallery'

const IMAGES: GalleryImage[] = [
  { id: 1, filePath: 'a1.jpg', imageType: 'antes' },
  { id: 2, filePath: 'a2.jpg', imageType: 'antes' },
  { id: 3, filePath: 'd1.jpg', imageType: 'despues' },
]

const noop = async () => {}

function renderGallery(props: Partial<Parameters<typeof PhotoGallery>[0]> = {}) {
  const onReorder = vi.fn(async () => {})
  const { container } = render(
    <PhotoGallery images={IMAGES} base="http://t" onUpload={noop} onDelete={noop}
      onChangeType={noop} onReorder={onReorder} {...props} />,
  )
  // Las flechas solo existen mientras el mouse está encima de esa miniatura. La
  // foto abierta arriba comparte el src, así que la miniatura se distingue por
  // su tamaño fijo.
  const hover = (filePath: string) => {
    const thumb = [...container.querySelectorAll<HTMLImageElement>(`img[src$="${filePath}"]`)]
      .find(img => img.style.width === '52px')!
    fireEvent.mouseEnter(thumb.parentElement!)
  }
  return { onReorder, hover }
}

describe('PhotoGallery · orden de las fotos', () => {
  it('manda el orden de TODAS las fotos, no solo el del grupo que se movió', () => {
    const { onReorder, hover } = renderGallery()
    hover('a1.jpg')
    fireEvent.click(screen.getByTitle('Mover a la derecha'))
    expect(onReorder).toHaveBeenCalledWith([2, 1, 3])
  })

  it('mueve la foto dentro de su grupo sin tocar el otro', () => {
    const { onReorder, hover } = renderGallery()
    hover('a2.jpg')
    fireEvent.click(screen.getByTitle('Mover a la izquierda'))
    expect(onReorder).toHaveBeenCalledWith([2, 1, 3])
  })

  it('apaga la flecha en el borde del grupo, para que una foto no salte de sección', () => {
    // La última "antes" tiene una vecina en la tira (la primera "despues"),
    // pero no en su grupo: su ▶ va apagada.
    const { hover } = renderGallery()
    hover('a2.jpg')
    expect(screen.getByTitle('Mover a la derecha').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTitle('Mover a la izquierda').hasAttribute('disabled')).toBe(false)

    hover('a1.jpg')
    expect(screen.getByTitle('Mover a la izquierda').hasAttribute('disabled')).toBe(true)
  })

  it('deja las dos flechas apagadas cuando la foto está sola en su grupo', () => {
    const { hover } = renderGallery()
    hover('d1.jpg')
    expect(screen.getByTitle('Mover a la izquierda').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTitle('Mover a la derecha').hasAttribute('disabled')).toBe(true)
  })

  it('no ofrece reordenar cuando la galería no clasifica', () => {
    const { hover } = renderGallery({ onChangeType: undefined })
    hover('a1.jpg')
    expect(screen.queryByTitle('Mover a la derecha')).toBeNull()
  })
})
