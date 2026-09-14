import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Atom,
  Award,
  Bell,
  Bookmark,
  BookOpen,
  Box,
  Brain,
  Briefcase,
  Brush,
  Bug,
  Building2,
  Calculator,
  Calendar,
  CalendarDays,
  Camera,
  ChartBar,
  ChartPie,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Cloud,
  Code,
  Coffee,
  Copy,
  Cpu,
  Database,
  Factory,
  FileCode,
  Files,
  FileText,
  Fingerprint,
  Flag,
  FlaskConical,
  Folder,
  Gift,
  GitBranch,
  GitPullRequest,
  GraduationCap,
  GanttChart,
  Globe,
  Hammer,
  HardDrive,
  Headphones,
  Heart,
  Home,
  Hourglass,
  Image,
  Inbox,
  Kanban,
  Key,
  Library,
  Lightbulb,
  Landmark,
  Layers,
  Link,
  ListChecks,
  Lock,
  Map,
  Mail,
  MessageCircle,
  Mic,
  Microscope,
  Music,
  NotebookText,
  Palette,
  Paintbrush,
  Package,
  PenTool,
  Phone,
  Pin,
  Plane,
  Presentation,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  Shapes,
  Shield,
  ShoppingBag,
  Sigma,
  Sparkles,
  Star,
  Tag,
  Target,
  Terminal,
  Timer,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Truck,
  Utensils,
  Users,
  Wallet,
  WandSparkles,
  Video,
  Wifi,
  Wrench
} from 'lucide-react'
export type FolderIconId = string; export type FolderIconColor = string; export interface FolderAppearance { icon: string; iconColor: string; }
const KEY_COLOR_PRESETS: {id: string, label: string, value: string}[] = [
  { id: 'red', label: 'Maek Red', value: '#C04E3E' },
  { id: 'blue', label: 'Blue', value: '#3E6BC0' },
  { id: 'green', label: 'Green', value: '#3E8C5C' },
  { id: 'purple', label: 'Purple', value: '#6B3EC0' },
  { id: 'orange', label: 'Orange', value: '#C07A3E' },
  { id: 'pink', label: 'Pink', value: '#C03E7A' },
];

export const FOLDER_APPEARANCE_VERSION = 1

export interface FolderIconPreset {
  id: FolderIconId
  label: string
  icon: LucideIcon
}

export interface FolderIconSection {
  title: string
  icons: FolderIconPreset[]
}

export const FOLDER_ICON_SECTIONS: FolderIconSection[] = [
  {
    title: 'General',
    icons: [
      { id: 'star', label: 'Favorites', icon: Star },
      { id: 'bookmark', label: 'Saved', icon: Bookmark },
      { id: 'flag', label: 'Priority', icon: Flag },
      { id: 'tag', label: 'Tagged', icon: Tag },
      { id: 'archive', label: 'Archive', icon: Archive },
      { id: 'inbox', label: 'Inbox', icon: Inbox },
      { id: 'pin', label: 'Pinned', icon: Pin },
      { id: 'bell', label: 'Notifications', icon: Bell },
      { id: 'alert', label: 'Alert', icon: TriangleAlert },
      { id: 'checkCircle', label: 'Done', icon: CircleCheck },
      { id: 'trophy', label: 'Wins', icon: Trophy },
      { id: 'award', label: 'Awards', icon: Award },
      { id: 'rocket', label: 'Launch', icon: Rocket },
      { id: 'sparkles', label: 'Special', icon: Sparkles },
      { id: 'search', label: 'Search', icon: Search },
      { id: 'settings', label: 'Settings', icon: Settings }
    ]
  },
  {
    title: 'Life',
    icons: [
      { id: 'home', label: 'Home', icon: Home },
      { id: 'heart', label: 'Personal', icon: Heart },
      { id: 'calendar', label: 'Calendar', icon: Calendar },
      { id: 'clock', label: 'Time', icon: Clock },
      { id: 'map', label: 'Places', icon: Map },
      { id: 'plane', label: 'Travel', icon: Plane },
      { id: 'coffee', label: 'Coffee', icon: Coffee },
      { id: 'utensils', label: 'Food', icon: Utensils },
      { id: 'gift', label: 'Gifts', icon: Gift },
      { id: 'shopping', label: 'Shopping', icon: ShoppingBag }
    ]
  },
  {
    title: 'Knowledge',
    icons: [
      { id: 'school', label: 'School', icon: GraduationCap },
      { id: 'book', label: 'Reading', icon: BookOpen },
      { id: 'library', label: 'Library', icon: Library },
      { id: 'notes', label: 'Notes', icon: NotebookText },
      { id: 'writing', label: 'Writing', icon: PenTool },
      { id: 'idea', label: 'Ideas', icon: Lightbulb },
      { id: 'brain', label: 'Research', icon: Brain },
      { id: 'microscope', label: 'Lab', icon: Microscope },
      { id: 'flask', label: 'Science', icon: FlaskConical },
      { id: 'calculator', label: 'Math', icon: Calculator },
      { id: 'sigma', label: 'Formula', icon: Sigma },
      { id: 'atom', label: 'Physics', icon: Atom }
    ]
  },
  {
    title: 'Work',
    icons: [
      { id: 'work', label: 'Work', icon: Briefcase },
      { id: 'team', label: 'Team', icon: Users },
      { id: 'meeting', label: 'Meetings', icon: Presentation },
      { id: 'tasks', label: 'Tasks', icon: ClipboardList },
      { id: 'goals', label: 'Goals', icon: Target },
      { id: 'finance', label: 'Finance', icon: Wallet },
      { id: 'building', label: 'Company', icon: Building2 },
      { id: 'factory', label: 'Operations', icon: Factory },
      { id: 'landmark', label: 'Institution', icon: Landmark },
      { id: 'chartBar', label: 'Reports', icon: ChartBar },
      { id: 'chartPie', label: 'Analytics', icon: ChartPie },
      { id: 'trendingUp', label: 'Growth', icon: TrendingUp },
      { id: 'listChecks', label: 'Checklist', icon: ListChecks },
      { id: 'clipboardCheck', label: 'Review', icon: ClipboardCheck },
      { id: 'kanban', label: 'Kanban', icon: Kanban },
      { id: 'timeline', label: 'Timeline', icon: GanttChart },
      { id: 'calendarDays', label: 'Schedule', icon: CalendarDays },
      { id: 'timer', label: 'Timer', icon: Timer },
      { id: 'hourglass', label: 'Waiting', icon: Hourglass },
      { id: 'mail', label: 'Mail', icon: Mail }
    ]
  },
  {
    title: 'Tech',
    icons: [
      { id: 'code', label: 'Code', icon: Code },
      { id: 'terminal', label: 'Terminal', icon: Terminal },
      { id: 'database', label: 'Database', icon: Database },
      { id: 'tools', label: 'Tools', icon: Wrench },
      { id: 'design', label: 'Design', icon: Palette },
      { id: 'media', label: 'Media', icon: Image },
      { id: 'folder', label: 'Folder', icon: Folder },
      { id: 'fileText', label: 'Documents', icon: FileText },
      { id: 'fileCode', label: 'Code Files', icon: FileCode },
      { id: 'files', label: 'Files', icon: Files },
      { id: 'copy', label: 'Copies', icon: Copy },
      { id: 'link', label: 'Links', icon: Link },
      { id: 'globe', label: 'Web', icon: Globe },
      { id: 'message', label: 'Messages', icon: MessageCircle },
      { id: 'send', label: 'Send', icon: Send },
      { id: 'phone', label: 'Calls', icon: Phone },
      { id: 'video', label: 'Video', icon: Video },
      { id: 'mic', label: 'Audio', icon: Mic },
      { id: 'camera', label: 'Camera', icon: Camera },
      { id: 'music', label: 'Music', icon: Music },
      { id: 'headphones', label: 'Listening', icon: Headphones },
      { id: 'brush', label: 'Brush', icon: Brush },
      { id: 'paintbrush', label: 'Paint', icon: Paintbrush },
      { id: 'shapes', label: 'Shapes', icon: Shapes },
      { id: 'layers', label: 'Layers', icon: Layers },
      { id: 'wand', label: 'Magic', icon: WandSparkles },
      { id: 'cpu', label: 'CPU', icon: Cpu },
      { id: 'server', label: 'Server', icon: Server },
      { id: 'hardDrive', label: 'Storage', icon: HardDrive },
      { id: 'cloud', label: 'Cloud', icon: Cloud },
      { id: 'wifi', label: 'Network', icon: Wifi },
      { id: 'bug', label: 'Bugs', icon: Bug },
      { id: 'gitBranch', label: 'Branches', icon: GitBranch },
      { id: 'gitPullRequest', label: 'Pull Requests', icon: GitPullRequest },
      { id: 'shield', label: 'Security', icon: Shield },
      { id: 'lock', label: 'Locked', icon: Lock },
      { id: 'key', label: 'Keys', icon: Key },
      { id: 'fingerprint', label: 'Identity', icon: Fingerprint },
      { id: 'hammer', label: 'Build', icon: Hammer },
      { id: 'package', label: 'Packages', icon: Package },
      { id: 'box', label: 'Box', icon: Box },
      { id: 'truck', label: 'Delivery', icon: Truck }
    ]
  }
]

export const FOLDER_ICON_PRESETS = FOLDER_ICON_SECTIONS.flatMap((section) => section.icons)

export const FOLDER_ICON_MAP = FOLDER_ICON_PRESETS.reduce(
  (acc, preset) => {
    acc[preset.id] = preset.icon
    return acc
  },
  {} as Record<FolderIconId, LucideIcon>
)

export const FOLDER_ICON_COLOR_OPTIONS: Array<{
  id: FolderIconColor
  label: string
  value: string
}> = [
  { id: 'accent', label: 'Use Key Color', value: 'var(--color-maek-red)' },
  ...KEY_COLOR_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    value: preset.value
  }))
]

export function getFolderIconColorValue(color: FolderIconColor): string {
  if (color === 'accent') return 'var(--color-maek-red)'
  return KEY_COLOR_PRESETS.find((preset) => preset.id === color)?.value ?? 'var(--color-maek-red)'
}

export function normalizeFolderAppearance(
  appearance: Partial<FolderAppearance> | null | undefined
): FolderAppearance | null {
  if (!appearance?.icon || !FOLDER_ICON_MAP[appearance.icon]) return null
  const iconColor = appearance.iconColor ?? 'accent'
  const color = FOLDER_ICON_COLOR_OPTIONS.some((option) => option.id === iconColor)
    ? iconColor
    : 'accent'
  return { icon: appearance.icon, iconColor: color }
}

export function toWorkspaceRelativeFolderPath(rootPath: string, folderPath: string): string | null {
  const normalizedRoot = rootPath.replace(/\/+$/, '')
  const normalizedPath = folderPath.replace(/\/+$/, '')
  if (normalizedPath === normalizedRoot) return ''
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) return null
  return normalizedPath.slice(normalizedRoot.length + 1)
}
