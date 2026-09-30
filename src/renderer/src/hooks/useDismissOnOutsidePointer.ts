import { useEffect, useRef, type RefObject } from 'react'

/**
 * Dismiss a floating layer when a press lands outside it.
 *
 * `refs` are the surfaces that belong to the layer: the panel itself and the
 * control that opened it. A press inside any of them keeps it open; everything
 * else closes it.
 *
 * This listens on `document` in the capture phase rather than painting a
 * full-viewport overlay. An overlay is fragile in exactly this workspace: a
 * `z-0` overlay loses to sibling panels that paint later (a `position: relative`
 * card), so clicks in the chat or notes panel never reach it; and one rendered
 * inside a `-webkit-app-region: drag` header can have its clicks eaten by window
 * dragging instead. A document listener sees the press wherever it lands.
 */
export function useDismissOnOutsidePointer(
  isOpen: boolean,
  refs: Array<RefObject<HTMLElement | null>>,
  onDismiss: () => void
): void {
  // Keep the latest refs without resubscribing every render: callers pass an
  // array literal, whose identity changes on each render.
  const refsRef = useRef(refs)
  useEffect(() => {
    refsRef.current = refs
  })

  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (refsRef.current.some((ref) => ref.current?.contains(target))) return
      onDismiss()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [isOpen, onDismiss])
}
