import { databaseApi } from '@renderer/features/database/api'
/**
 * DatabaseViewContainer - Routes to the active view (Table, Kanban, Timeline, Calendar)
 * and provides a view switcher in the header.
 *
 * Each child view manages its own data loading via useDatabaseView. The container
 * only owns the active view id state and persists it to SQLite via view IPC.
 */

import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import type { DatabaseCustomViewType } from '@shared/database'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'
import { ViewSwitcher } from './components/ViewSwitcher'
import { DatabaseTableView } from './DatabaseTableView'
import { DatabaseKanbanView } from './DatabaseKanbanView'
import { DatabaseCalendarView } from './DatabaseCalendarView'
import { DatabaseTimelineView } from './DatabaseTimelineView'

interface DatabaseViewContainerProps {
  databaseFolderPath: string
}

/** Convert an absolute folder path to the workspace-relative form stored in SQLite. */
function toRelativeFolderPath(rootPath: string, absolutePath: string): string {
  if (absolutePath === rootPath) return ''
  if (absolutePath.startsWith(`${rootPath}/`)) {
    return absolutePath.slice(rootPath.length + 1)
  }
  return absolutePath
}

export function DatabaseViewContainer({
  databaseFolderPath
}: DatabaseViewContainerProps): ReactElement {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const databases = useWorkspaceStore((s) => s.databases)

  const meta = useMemo(() => {
    if (!rootPath) return null
    const relative = toRelativeFolderPath(rootPath, databaseFolderPath)
    return databases.find((d) => d.folderPath === relative) ?? null
  }, [rootPath, databaseFolderPath, databases])

  const [switchingToViewId, setSwitchingToViewId] = useState<string | null>(null)
  const activeViewDefinition =
    meta?.views.find((view) => view.id === (switchingToViewId ?? meta.activeViewId)) ??
    meta?.views[0]
  const activeView = activeViewDefinition?.type ?? 'table'

  const replaceDatabaseInStore = useCallback(
    (databaseId: string, database: NonNullable<typeof meta>) => {
      useWorkspaceStore
        .getState()
        .setDatabases(
          useWorkspaceStore.getState().databases.map((d) => (d.id === databaseId ? database : d))
        )
    },
    []
  )

  const handleViewChange = useCallback(
    async (viewId: string) => {
      if (!rootPath || !meta || meta.activeViewId === viewId) return
      setSwitchingToViewId(viewId)
      try {
        const result = await databaseApi.databaseSetActiveView(rootPath, meta.id, viewId)
        if (result.success) {
          replaceDatabaseInStore(meta.id, result.database)
        }
      } finally {
        setSwitchingToViewId(null)
      }
    },
    [rootPath, meta, replaceDatabaseInStore]
  )

  const handleCreateView = useCallback(
    async (type: DatabaseCustomViewType) => {
      if (!rootPath || !meta) return
      const result = await databaseApi.databaseCreateView(rootPath, meta.id, type)
      if (result.success) {
        replaceDatabaseInStore(meta.id, result.database)
      }
    },
    [rootPath, meta, replaceDatabaseInStore]
  )

  const handleRenameView = useCallback(
    async (viewId: string, name: string) => {
      if (!rootPath || !meta) return
      const result = await databaseApi.databaseUpdateView(rootPath, meta.id, viewId, { name })
      if (result.success) {
        replaceDatabaseInStore(meta.id, result.database)
      }
    },
    [rootPath, meta, replaceDatabaseInStore]
  )

  const handleDeleteView = useCallback(
    async (viewId: string) => {
      if (!rootPath || !meta) return
      const result = await databaseApi.databaseDeleteView(rootPath, meta.id, viewId)
      if (result.success) {
        replaceDatabaseInStore(meta.id, result.database)
      }
    },
    [rootPath, meta, replaceDatabaseInStore]
  )

  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-text" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewSwitcher
        views={meta.views}
        activeViewId={switchingToViewId ?? meta.activeViewId}
        onViewChange={handleViewChange}
        onCreateView={handleCreateView}
        onRenameView={handleRenameView}
        onDeleteView={handleDeleteView}
      />
      <div className="flex-1 overflow-hidden">
        {switchingToViewId ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-text" />
          </div>
        ) : (
          <>
            {activeView === 'table' && (
              <DatabaseTableView
                key={activeViewDefinition?.id}
                databaseFolderPath={databaseFolderPath}
              />
            )}
            {activeView === 'kanban' && (
              <DatabaseKanbanView
                key={activeViewDefinition?.id}
                databaseFolderPath={databaseFolderPath}
              />
            )}
            {activeView === 'calendar' && (
              <DatabaseCalendarView
                key={activeViewDefinition?.id}
                databaseFolderPath={databaseFolderPath}
              />
            )}
            {activeView === 'timeline' && (
              <DatabaseTimelineView
                key={activeViewDefinition?.id}
                databaseFolderPath={databaseFolderPath}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
