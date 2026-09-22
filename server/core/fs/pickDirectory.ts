import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {PickDirectoryResult} from '@shared/contract'
import {registerWorkspace,toRef} from '../../workspaces'
const run=promisify(execFile)
let pending:Promise<PickDirectoryResult>|null=null
async function pick():Promise<PickDirectoryResult>{
 if(process.platform!=='darwin')return {status:'fallback',reason:'The native folder picker requires macOS'}
 try {
  const {stdout}=await run('osascript',['-e','tell application "Finder"','-e','activate','-e','return POSIX path of (choose folder with prompt "Choose your notes folder")','-e','end tell']);
  if(!stdout.trim())return {status:'canceled'};
  return {status:'ok',workspace:toRef(await registerWorkspace(stdout.trim()))};
 }catch(error){const message=String((error as {stderr?:string}).stderr??error);if(message.includes('-128')||message.includes('User canceled'))return {status:'canceled'};return {status:'fallback',reason:message.trim()}}
}
export async function pickDirectory():Promise<PickDirectoryResult>{
 if(pending)return pending;
 pending=pick();try{return await pending}finally{pending=null}
}
