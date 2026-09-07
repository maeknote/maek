import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PickDirectoryResult } from '@shared/contract'
import { registerWorkspace, toRef } from '../workspaces'

const run = promisify(execFile)

/**
 * Native folder dialog, spawned by the server (3A).
 *
 * The browser cannot do this: File System Access API is Chromium-only and
 * hands back a FileSystemDirectoryHandle, never an absolute path — and an
 * absolute path is exactly what the workspace registry needs. The server is on
 * the same machine as the display, so it can ask the OS instead. That deletes
 * an entire server-side directory-browser UI: start location, hidden files,
 * pagination, symlinks, permission denials and favourites all become the OS's
 * problem.
 *
 * Boundary: this only holds while server and screen are the same machine. Over
 * LAN the dialog appears on the server's display, and the path-input fallback
 * becomes the only usable entry point.
 */

const PROMPT = '노트 폴더를 선택하세요'

type DialogOutcome =
  | { kind: 'picked'; path: string }
  | { kind: 'canceled' }
  | { kind: 'unavailable'; reason: string }

async function pickOnDarwin(): Promise<DialogOutcome> {
  try {
    // `choose folder` is a StandardAdditions command, so it needs no
    // accessibility/automation permission grant.
    const { stdout } = await run('osascript', [
      '-e',
      `POSIX path of (choose folder with prompt "${PROMPT}")`
    ])
    const picked = stdout.trim()
    if (!picked) return { kind: 'unavailable', reason: '다이얼로그가 경로를 반환하지 않았습니다' }
    return { kind: 'picked', path: picked }
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? '')
    // Cancel is exit 1 with "User canceled." on stderr (-128).
    if (stderr.includes('User canceled') || stderr.includes('-128')) {
      return { kind: 'canceled' }
    }
    return { kind: 'unavailable', reason: stderr.trim() || String(err) }
  }
}

async function pickOnLinux(): Promise<DialogOutcome> {
  const candidates: Array<{ bin: string; args: string[] }> = [
    { bin: 'zenity', args: ['--file-selection', '--directory', `--title=${PROMPT}`] },
    { bin: 'kdialog', args: ['--getexistingdirectory', '.', '--title', PROMPT] }
  ]

  let lastReason = '사용 가능한 폴더 다이얼로그가 없습니다 (zenity / kdialog)'
  for (const { bin, args } of candidates) {
    try {
      const { stdout } = await run(bin, args)
      const picked = stdout.trim()
      if (picked) return { kind: 'picked', path: picked }
      return { kind: 'canceled' }
    } catch (err) {
      // The binary is missing — try the next one.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        lastReason = `${bin}을(를) 찾을 수 없습니다`
        continue
      }
      // The binary ran and exited non-zero: that is the cancel signal.
      return { kind: 'canceled' }
    }
  }
  return { kind: 'unavailable', reason: lastReason }
}

async function pickOnWindows(): Promise<DialogOutcome> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
    `$d.Description = '${PROMPT}';`,
    "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath } else { exit 1 }"
  ].join(' ')

  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
    const picked = stdout.trim()
    if (!picked) return { kind: 'canceled' }
    return { kind: 'picked', path: picked }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'unavailable', reason: 'powershell.exe를 찾을 수 없습니다' }
    }
    return { kind: 'canceled' }
  }
}

async function openDialog(): Promise<DialogOutcome> {
  switch (process.platform) {
    case 'darwin':
      return pickOnDarwin()
    case 'linux':
      return pickOnLinux()
    case 'win32':
      return pickOnWindows()
    default:
      return { kind: 'unavailable', reason: `지원하지 않는 플랫폼입니다: ${process.platform}` }
  }
}

export async function pickDirectory(): Promise<PickDirectoryResult> {
  const outcome = await openDialog()

  switch (outcome.kind) {
    case 'canceled':
      return { status: 'canceled' }
    case 'unavailable':
      // Headless, SSH, or no dialog binary → the client shows a path input.
      return { status: 'fallback', reason: outcome.reason }
    case 'picked': {
      const ws = await registerWorkspace(outcome.path)
      return { status: 'ok', workspace: toRef(ws) }
    }
  }
}
