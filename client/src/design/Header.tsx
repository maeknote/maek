import type { HTMLAttributes } from 'react'

// maeknote-app shared Header: h-12, px-4, structure-line divider.
export function Header({
  className = '',
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <header className={`maek-header ${className}`} {...props} />
}
