import { z } from "zod";
import { RelPath } from "./contract";

export const EditorUiStateSchema = z.object({
  collapsedHeadings: z.record(
    RelPath.refine((value) => value !== "" && !value.split("/").includes("..")),
    z.array(z.string().max(8192)).max(10000),
  ).refine((value) => Object.keys(value).length <= 10000),
});
export type EditorUiState = z.infer<typeof EditorUiStateSchema>;
