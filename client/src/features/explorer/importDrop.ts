export async function collectDropFiles(
  transfer: DataTransfer,
): Promise<{ name: string; file: File }[]> {
  const entries = Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length)
    return Array.from(transfer.files).map((file) => ({
      name: file.webkitRelativePath || file.name,
      file,
    }));
  const files: { name: string; file: File }[] = [];
  async function walk(entry: FileSystemEntry, parent = ""): Promise<void> {
    const name = parent + entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ name, file });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await walk(child, name + "/");
      }
    }
  }
  for (const entry of entries) await walk(entry);
  return files;
}
