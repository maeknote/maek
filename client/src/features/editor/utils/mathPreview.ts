import katex from "katex";

export function renderMathPreview(
  latex: string,
  options?: { displayMode?: boolean },
): { html: string | null; error: string | null } {
  if (!latex.trim()) {
    return { html: null, error: null };
  }

  try {
    return {
      html: katex.renderToString(latex, {
        displayMode: options?.displayMode ?? false,
        throwOnError: true,
        strict: "ignore",
      }),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid LaTeX";
    return { html: null, error: message };
  }
}
