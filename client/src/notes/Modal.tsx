import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({
  title,
  description,
  close,
  children
}: {
  title: string
  description: string
  close: () => void
  children: ReactNode
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content glass-modal">
          <div className="row spread">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label="닫기" className="icon-button">
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
