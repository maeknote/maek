import { FolderOpen, ChevronsUpDown } from 'lucide-react'
import { Button, type ButtonProps } from './Button'

// FolderSelector trigger from maeknote-app's explorer, independent of Electron.
export function FolderSelector({
  name,
  path,
  ...props
}: ButtonProps & { name: string; path?: string }) {
  return (
    <Button className="folder-selector" title={path} {...props}>
      <FolderOpen />
      <span>{name}</span>
      <ChevronsUpDown />
    </Button>
  )
}
