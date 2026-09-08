import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react'

// Native field behavior with maeknote-app semantic input tokens.
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`maek-input ${className}`} {...props} />
})
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = '', ...props }, ref) {
  return <select ref={ref} className={`maek-input ${className}`} {...props} />
})
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={`maek-input ${className}`} {...props} />
})
