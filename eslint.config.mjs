import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: true,
          allowNumber: false,
          allowNullableObject: false,
        },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": "off",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    ignores: [
      "**/*.js",
      "**/*.mjs",
      "vitest.config.mts",
      "worker-configuration.d.ts",
      "test/**/*.ts", // TODO
    ],
  },
);
