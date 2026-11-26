import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "**/.venv/**", "**/node_modules/**"] },
  ...tseslint.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: "error" }, rules: {
    eqeqeq: "error", "no-constant-condition": "error", "no-unused-vars": "off",
  } },
  { files: ["**/*.mjs"], rules: { "no-unused-vars": "error" } },
];
