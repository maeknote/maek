import type { UiState, ViewGroup } from "@shared/workspace";

/**
 * Open Tabs composition. A view group is one Open Tabs entry; an open file may
 * belong to several groups at once (its own entry and any number of splits),
 * but never to both panes of the same split.
 */

let viewGroupSequence = 0;
export function newViewGroupId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `view:${uuid}` : `view:${Date.now()}:${++viewGroupSequence}`;
}
export function singleViewGroup(tabId: string): ViewGroup {
  return { id: newViewGroupId(), kind: "single", tabId };
}
export function groupTabIds(group: ViewGroup): string[] {
  return group.kind === "single" ? [group.tabId] : [group.left, group.right];
}
export function groupActiveTabId(group: ViewGroup): string {
  return group.kind === "single"
    ? group.tabId
    : group.active === "left"
      ? group.left
      : group.right;
}

/**
 * The group a file-level activation should land on: the active group when it
 * already shows the file, then the file's own entry, then any split holding it.
 */
export function groupForTab(
  groups: ViewGroup[],
  activeGroupId: string | null,
  tabId: string,
): ViewGroup | undefined {
  const holding = groups.filter((group) => groupTabIds(group).includes(tabId));
  return (
    holding.find((group) => group.id === activeGroupId) ??
    holding.find((group) => group.kind === "single") ??
    holding[0]
  );
}

/**
 * Drops references to files that are no longer open. A split that loses one
 * side shrinks to the remaining file's entry. Duplicate single entries for the
 * same file collapse to one, preferring `keepGroupId` so the active entry
 * survives.
 */
export function normalizeViewGroups(
  groups: ViewGroup[],
  available: ReadonlySet<string>,
  keepGroupId?: string | null,
): ViewGroup[] {
  const shrunk: ViewGroup[] = [];
  for (const group of groups) {
    if (group.kind === "single") {
      if (available.has(group.tabId)) shrunk.push(group);
      continue;
    }
    const left = available.has(group.left) ? group.left : null;
    const right = available.has(group.right) ? group.right : null;
    if (left && right && left !== right) shrunk.push(group);
    else if (left || right)
      shrunk.push({ id: group.id, kind: "single", tabId: (left ?? right)! });
  }
  const kept = new Map<string, string>();
  for (const group of shrunk) {
    if (group.kind !== "single") continue;
    if (!kept.has(group.tabId) || group.id === keepGroupId)
      kept.set(group.tabId, group.id);
  }
  return shrunk.filter(
    (group) => group.kind !== "single" || kept.get(group.tabId) === group.id,
  );
}

/** Rebuilds the stored composition for the currently open files. */
export function groupsFromUi(
  tabIds: string[],
  ui: Pick<UiState, "viewGroups" | "split" | "activeViewGroupId">,
): ViewGroup[] {
  const available = new Set(tabIds);
  const groups = normalizeViewGroups(
    ui.viewGroups ?? [],
    available,
    ui.activeViewGroupId,
  );
  // v1 migration: retain the current split as one group when no v2 layout was
  // stored. The remaining files become single groups in their current order.
  if (!groups.length && ui.split?.left && ui.split?.right &&
      available.has(ui.split.left) && available.has(ui.split.right) &&
      ui.split.left !== ui.split.right) {
    groups.push({
      id: newViewGroupId(), kind: "split", left: ui.split.left, right: ui.split.right,
      active: ui.split.active, ratio: ui.split.ratio,
    });
  }
  const shown = new Set(groups.flatMap(groupTabIds));
  for (const id of tabIds) {
    if (!shown.has(id)) groups.push(singleViewGroup(id));
  }
  return groups;
}

export function remapViewGroups(
  groups: ViewGroup[],
  replace: (id: string) => string,
): ViewGroup[] {
  return groups.map((group) => group.kind === "single"
    ? { ...group, tabId: replace(group.tabId) }
    : { ...group, left: replace(group.left), right: replace(group.right) });
}
