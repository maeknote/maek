import fs from 'node:fs'
const source='/Users/yoonchul/dev/maeknote-app/src/renderer/'
const files=['features/search/index.ts','features/search/utils/highlightMatch.tsx','features/editor/components/FilePicker.tsx','features/editor/components/note-picker/NotePicker.tsx']
let patch='*** Begin Patch\n'
for(const file of files){
 let text=fs.readFileSync(source+file,'utf8').trimEnd()
 if(file.endsWith('highlightMatch.tsx'))text=text.replace('const [s, e] = merged[i]','const [s, e] = merged[i]!')
 if(file.endsWith('/FilePicker.tsx')){
  text=text.replace("import { useSearchableFiles, useWorkspaceStore } from '../../explorer/stores/workspaceStore'","import {useStore} from '../../../store'")
   .replace("import { resolveTabOpenPayload } from '../utils/openFileTab'\n",'')
   .replace("import { useTabStore } from '../stores/tabStore'\n",'')
   .replace("from '../../../../shared/types'","from '@shared/types'")
   .replace('const files = useSearchableFiles()',"const nodes = useStore(s=>s.nodes)\n  const files = useMemo(()=>nodes.filter(n=>!n.isDir),[nodes])")
   .replace("const rootPath = useWorkspaceStore((s) => s.rootPath)","const rootPath = '.'")
   .replace(/  const setFileOpenIntent[^\n]+\n/,'').replace(/  const setSelectedFile[^\n]+\n/,'')
   .replace(/  const handleSelect = useCallback\([\s\S]*?\n  \)\n\n  \/\/ Keyboard navigation/,"  const handleSelect = useCallback(async(file:FileNode)=>{await useStore.getState().openFile(file.id);onClose()},[onClose])\n\n  // Keyboard navigation")
   .replace('Search, AudioLines, File, Folder, Table, X','Search, File, X')
   .replace(/const Icon = file.isMeeting[\s\S]*?: File\n/,"const Icon = File\n")
   .replace('data-file-item','data-file-item role="option" aria-selected={isFocused}')
   .replace('placeholder="Search files..."','placeholder="Search files..." aria-label="Search files"')
 }
 if(file.endsWith('/NotePicker.tsx')){
  text=text.replace("import { useSearchableFiles, useWorkspaceStore } from '../../../explorer/stores/workspaceStore'","import {useStore} from '../../../../store'")
  .replace('const files = useSearchableFiles()','const files = useStore(s=>s.nodes)')
  .replace('const rootPath = useWorkspaceStore((s) => s.rootPath)',"const rootPath = '.'")
 }
 patch+=`*** Add File: client/src/${file}\n`+text.split('\n').map(l=>'+'+l).join('\n')+'\n'
}
process.stdout.write(patch+'*** End Patch')
