// Mechanical replacements emitted as apply_patch operations.
import fs from 'node:fs'
const changes=JSON.parse(process.argv[2])
let patch='*** Begin Patch\n'
for(const [file,replacements] of Object.entries(changes)){
 const old=fs.readFileSync(file,'utf8').trimEnd();let next=old
 for(const [from,to] of replacements){if(!next.includes(from))throw new Error(`Missing text in ${file}: ${from}`);next=next.replaceAll(from,to)}
 patch+=`*** Update File: ${file}\n@@\n`+old.split('\n').map(l=>'-'+l).join('\n')+'\n'+next.split('\n').map(l=>'+'+l).join('\n')+'\n'
}
process.stdout.write(patch+'*** End Patch')
