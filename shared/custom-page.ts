import { z } from "zod";

const ModulePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0") && !value.includes("\\"), {
    message: "Module paths must use forward slashes",
  })
  .refine((value) => !value.startsWith("/") && !/^[a-zA-Z]:/.test(value), {
    message: "Module paths must be relative",
  })
  .refine(
    (value) =>
      !value
        .split("/")
        .some((segment) => segment === ".." || segment === ".maek"),
    { message: "Module paths cannot leave the module or use .maek" },
  );

export const CustomPageResource = z.object({
  path: ModulePath,
  format: z.enum(["json", "text"]),
  access: z.enum(["read", "read-write"]).default("read"),
  maxBytes: z.number().int().min(1).max(8 * 1024 * 1024).default(1024 * 1024),
  backup: z
    .object({ keep: z.number().int().min(0).max(100).default(20) })
    .default({ keep: 20 }),
});

export const CustomPageManifest = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    title: z.string().min(1).max(120),
    entry: ModulePath,
    assetsRoot: ModulePath.default("."),
    resources: z.record(
      z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
      CustomPageResource,
    ),
  })
  .refine((value) => Object.keys(value.resources).length <= 64, {
    message: "A custom page can declare at most 64 resources",
  });

export type CustomPageManifest = z.infer<typeof CustomPageManifest>;
export type CustomPageResource = z.infer<typeof CustomPageResource>;

export type CustomPageMountResult =
  | { kind: "static" }
  | {
      kind: "custom-page";
      mountId: string;
      mountPath: string;
      pageId: string;
      title: string;
    };

export interface CustomPageWrite {
  resource: string;
  baseVersion: string;
  content: unknown;
}

export interface CustomPageTransactionResult {
  ok: true;
  versions: Record<string, string>;
}
