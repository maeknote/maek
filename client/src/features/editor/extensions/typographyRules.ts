import { Extension, textInputRule } from "@tiptap/core";

export const TypographyRules = Extension.create({
  name: "typographyRules",

  addInputRules() {
    return [
      textInputRule({ find: /->$/, replace: "→" }),
      textInputRule({ find: /<-$/, replace: "←" }),
    ];
  },
});
