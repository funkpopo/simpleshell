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
      "native-services/**/target/**",
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
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mui/icons-material",
              message:
                "Import individual icons by subpath so tests and builds do not load the entire icon catalogue.",
            },
          ],
        },
      ],
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
  {
    files: ["src/renderer/**/*.{js,jsx}"],
    languageOptions: {
      globals: {
        ...Object.fromEntries(
          Object.keys(globals.node).map((name) => [name, "off"]),
        ),
        ...globals.browser,
        ...globals.commonjs,
        process: "readonly", // Webpack's compile-time NODE_ENV replacement.
      },
    },
  },
  {
    files: [
      "src/preload/**/*.js",
      "src/shared/startupTheme.js",
      "scripts/fixtures/*renderer*.{js,jsx}",
      "tests/**/*.{js,jsx}",
    ],
    languageOptions: { globals: { ...globals.browser } },
  },
];
