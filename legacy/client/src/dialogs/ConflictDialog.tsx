import * as Dialog from '@radix-ui/react-dialog'
import type { ConflictReason } from '@shared/contract'

export interface ConflictDialogProps {
  reason: ConflictReason | null
  fileName: string
  onReload: () => void
  onOverwrite: () => void
  onRecreate: () => void
  onCloseTab: () => void
  onCancel: () => void
}

/**
 * The 409 answer surface (T13 / A11Y-2).
 *
 * Every branch here can destroy work, so the ordering rules are load-bearing:
 *   - the SAFE action is first in the DOM and carries autoFocus, so Enter can
 *     never be the destructive one
 *   - Esc cancels — it picks neither branch, and the edit stays in the buffer
 *   - Radix supplies the focus trap and returns focus to the invoker on close
 */
export function ConflictDialog({
  reason,
  fileName,
  onReload,
  onOverwrite,
  onRecreate,
  onCloseTab,
  onCancel
}: ConflictDialogProps) {
  const changed = reason === 'changed'

  return (
    <Dialog.Root open={reason !== null} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-subtle bg-overlay p-5 shadow-[var(--shadow-floating)] backdrop-blur-xl"
          aria-describedby="conflict-desc"
        >
          <Dialog.Title className="text-[15px] font-semibold text-primary">
            {changed ? '파일이 밖에서 바뀌었습니다' : '파일이 사라졌습니다'}
          </Dialog.Title>

          <Dialog.Description id="conflict-desc" className="mt-2 text-[13px] leading-relaxed text-muted">
            {changed ? (
              <>
                <span className="font-mono text-primary">{fileName}</span>이(가) 이 앱 밖에서
                수정되었습니다. 지금 저장하면 그 변경이 사라집니다.
              </>
            ) : (
              <>
                <span className="font-mono text-primary">{fileName}</span>이(가) 삭제되었거나
                이동했습니다. 편집 중인 내용은 그대로 남아 있습니다.
              </>
            )}
          </Dialog.Description>

          {/* Safe action first — DOM order is the tab order. */}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {changed ? (
              <>
                <button autoFocus type="button" className="btn btn-primary" onClick={onReload}>
                  다시 불러오기
                </button>
                <button type="button" className="btn btn-danger" onClick={onOverwrite}>
                  덮어쓰기
                </button>
              </>
            ) : (
              <>
                <button autoFocus type="button" className="btn btn-primary" onClick={onRecreate}>
                  이 위치에 다시 만들기
                </button>
                <button type="button" className="btn" onClick={onCloseTab}>
                  탭 닫기
                </button>
              </>
            )}
            <Dialog.Close asChild>
              <button type="button" className="btn btn-ghost">
                취소
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
