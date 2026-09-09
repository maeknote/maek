import { Table } from "@tiptap/extension-table";

export const MaekTable = Table.extend({
  name: "table",

  addOptions() {
    return {
      resizable: false, // Disable manual column resizing (auto-adjust based on content)
      HTMLAttributes: {
        class: "maek-table",
      },
      handleWidth: 5,
      cellMinWidth: 25,
      View: null,
      lastColumnResizable: true,
      allowTableNodeSelection: false,
      renderWrapper: true,
    };
  },
});
