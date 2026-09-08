import { forwardRef, type ButtonHTMLAttributes } from 'react'
// maeknote-app Button variants adapted from Tailwind to the same token CSS.
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | 'default'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'ghost'
    | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className = '', variant = 'ghost', size, type = 'button', ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={`maek-button maek-button-${variant} ${size ? `maek-button-${size}` : ''} ${className}`}
        {...props}
      />
    )
  }
)
