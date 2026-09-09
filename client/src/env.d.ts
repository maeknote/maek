declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  const plugin: (md: MarkdownIt, options?: unknown) => void;
  export default plugin;
}
interface Window {
  api: {
    readPreviewSource: (
      p: string,
    ) => Promise<
      | { success: true; bytes: ArrayBuffer; mime?: string }
      | { success: false; error: string }
    >;
    deleteFile: (p: string) => Promise<void>;
  };
}
