// Emits an apply_patch patch; source files remain untouched.
import fs from 'node:fs'
import path from 'node:path'
const source = '/Users/yoonchul/dev/maeknote-app/src/renderer'
const selections = ['shared/design', 'shared/hooks', 'shared/components/Button.tsx', 'shared/components/Header.tsx', 'shared/components/PanelIcon.tsx', 'shared/components/MenuItem.tsx', 'shared/components/FloatingMenu.tsx', 'shared/components/Toast', 'lib/utils.ts', 'lib/pathUtils.ts', 'features/editor/extensions', 'features/editor/styles', 'features/editor/types.ts', 'features/editor/components/table', 'features/editor/components/code-block', 'features/editor/components/math-block', 'features/editor/components/math-inline', 'features/editor/components/slash-menu', 'features/editor/components/image', 'features/editor/components/preview/utils.ts', 'features/editor/components/HeadingRail.tsx', 'features/editor/components/TitleBar.tsx', 'features/editor/components/FrontmatterPanel.tsx', 'features/editor/components/frontmatter', 'features/editor/components/bubble-toolbar/LinkInput.tsx', 'features/editor/stores/tableStore.ts', 'features/editor/stores/imageResizeStore.ts', 'features/editor/stores/notePickerStore.ts', 'features/editor/stores/headingCollapseStore.ts', 'features/editor/hooks/useHeadingCollapseSync.ts', 'features/editor/utils/displayName.ts', 'features/editor/utils/frontmatter.ts', 'features/editor/utils/frontmatterYaml.ts', 'features/explorer/components/FolderSelector.tsx', 'features/search/utils/fuzzySearch.ts']
const files = []
function walk(rel) { const p = path.join(source, rel); if (!fs.existsSync(p)) return; if (fs.statSync(p).isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(rel, n)); else files.push(rel) }
selections.forEach(walk)
let patch = '*** Begin Patch\n'
for (const rel of files) {
 const content = fs.readFileSync(path.join(source, rel), 'utf8')
 patch += `*** Add File: client/src/${rel}\n` + content.split('\n').map(l => '+' + l).join('\n') + '\n'
}
const tailwind = fs.readFileSync('/Users/yoonchul/dev/maeknote-app/tailwind.config.js','utf8').replaceAll('./src/renderer/', './client/src/').replace('./client/src/index.html','./client/index.html')
patch += '*** Add File: tailwind.config.js\n' + tailwind.split('\n').map(l => '+'+l).join('\n') + '\n*** End Patch'
if (process.argv.includes('--deps')) {
 const old = fs.readFileSync('package.json', 'utf8')
 const p = JSON.parse(old)
 const lock = JSON.parse(fs.readFileSync('/Users/yoonchul/dev/maeknote-app/package-lock.json', 'utf8'))
 for (const [k,v] of Object.entries(lock.packages)) if(k.startsWith('node_modules/@tiptap/') && !k.slice(13).includes('/node_modules/')) p.dependencies[k.slice(13)] = v.version
 Object.assign(p.dependencies, {'tiptap-markdown':'0.9.0','react-arborist':'3.4.3',zustand:'5.0.10',lowlight:'3.3.0','fuse.js':'7.3.0','@floating-ui/dom':'^1.7.5','@radix-ui/react-slot':'^1.2.4','class-variance-authority':'^0.7.1',clsx:'^2.1.1','tailwind-merge':'^3.4.0','prosemirror-markdown':'^1.13.2','markdown-it':'^14.1.0','markdown-it-task-lists':'^2.1.1',chokidar:'5.0.0',dompurify:'^3.3.3'})
 Object.assign(p.devDependencies,{tailwindcss:'3.4.19',autoprefixer:'^10.4.23','@types/markdown-it':'^14.1.2','@types/markdown-it-task-lists':'^2.1.0'})
 patch = '*** Begin Patch\n*** Update File: package.json\n@@\n'+old.trimEnd().split('\n').map(l=>'-'+l).join('\n')+'\n'+JSON.stringify(p,null,2).split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch'
}
process.stdout.write(patch)
