const js = require("@eslint/js");
const globals = require("globals");
const babelParser = require("@babel/eslint-parser");
const reactPlugin = require("eslint-plugin-react");

module.exports = [
  {
    ignores: [
      ".webpack/**",
      ".webpack_cache/**",
      "config-backups/**",
      "diagnostics/**",
      "dist/**",
      "docs/**",
      "installer/**",
      "log/**",
      "node_modules/**",
      "out/**",
      "temp/**",
      "transfernative/**/target/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-react"],
        },
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: "readonly",
        MAIN_WINDOW_WEBPACK_ENTRY: "readonly",
      },
    },
    plugins: {
      react: reactPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      "no-control-regex": "off",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "react/display-name": "off",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
    },
  },
];
