import * as React from "react";
import {
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from "../../../../shared/domain/terminalScrollback.js";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Grid from "@mui/material/Grid";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import BugReportIcon from "@mui/icons-material/BugReport";
import ClearIcon from "@mui/icons-material/Clear";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ButtonBase from "@mui/material/ButtonBase";
import CheckIcon from "@mui/icons-material/Check";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import {
  openLogDirectory,
  exportDiagnostics,
} from "../../../shared/lib/diagnosticsActions.js";
import {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_PRESETS,
  normalizeTerminalThemeId,
} from "../../../../shared/settings/terminalThemePresets.js";
import {
  EDITOR_FONT_OPTIONS,
  TERMINAL_CURSOR_STYLE_OPTIONS,
  TERMINAL_FONT_WEIGHT_BOLD_OPTIONS,
} from "../../../../shared/settings/uiSettingsDefaults.js";
import {
  sectionCardSx,
  compactFieldSx,
  subSectionLabelSx,
  SettingsToggleRow,
} from "../components/SettingsSection.jsx";

export default function TerminalSettings({ initialValues, open, ref }) {
  const muiTheme = useTheme();
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const fontSizes = [
    { value: 12, label: t("settings.fontSizeLabels.small") },
    { value: 14, label: t("settings.fontSizeLabels.medium") },
    { value: 16, label: t("settings.fontSizeLabels.large") },
    { value: 18, label: t("settings.fontSizeLabels.xlarge") },
  ];
  const terminalFonts = [
    {
      value: "Fira Code",
      label: t("settings.fonts.fira-code"),
      description: t("settings.terminalFonts.firaCodeDescription"),
    },
    {
      value: "Space Mono",
      label: t("settings.fonts.space-mono"),
      description: t("settings.terminalFonts.spaceMonoDescription"),
    },
    {
      value: "Consolas",
      label: t("settings.fonts.consolas"),
      description: t("settings.terminalFonts.consolasDescription"),
    },
  ];
  const logLevels = [
    { value: "DEBUG", label: t("settings.logLevels.debug") },
    { value: "INFO", label: t("settings.logLevels.info") },
    { value: "WARN", label: t("settings.logLevels.warn") },
    { value: "ERROR", label: t("settings.logLevels.error") },
  ];
  const [editorFont, setEditorFont] = React.useState(
    initialValues.editorFont || "system",
  );
  const [terminalFont, setTerminalFont] = React.useState(
    initialValues.terminalFont,
  );
  const [terminalFontSize, setTerminalFontSize] = React.useState(
    initialValues.terminalFontSize,
  );
  const [terminalFontWeight, setTerminalFontWeight] = React.useState(
    initialValues.terminalFontWeight,
  );
  const [terminalFontWeightBold, setTerminalFontWeightBold] = React.useState(
    initialValues.terminalFontWeightBold,
  );
  const [terminalLineHeight, setTerminalLineHeight] = React.useState(
    initialValues.terminalLineHeight,
  );
  const [terminalTheme, setTerminalTheme] = React.useState(
    normalizeTerminalThemeId(initialValues.terminalTheme),
  );
  const [terminalLetterSpacing, setTerminalLetterSpacing] = React.useState(
    initialValues.terminalLetterSpacing,
  );
  const [terminalScrollbackLines, setTerminalScrollbackLines] = React.useState(
    initialValues.terminalScrollbackLines,
  );
  const [terminalCursorStyle, setTerminalCursorStyle] = React.useState(
    initialValues.terminalCursorStyle,
  );
  const [terminalCursorBlink, setTerminalCursorBlink] = React.useState(
    initialValues.terminalCursorBlink,
  );
  const [terminalCopyOnSelect, setTerminalCopyOnSelect] = React.useState(
    initialValues.terminalCopyOnSelect,
  );
  const [terminalRightClickSelectsWord, setTerminalRightClickSelectsWord] =
    React.useState(initialValues.terminalRightClickSelectsWord);
  const [terminalMiddleClickPaste, setTerminalMiddleClickPaste] =
    React.useState(initialValues.terminalMiddleClickPaste);
  const [terminalMacOptionIsMeta, setTerminalMacOptionIsMeta] = React.useState(
    initialValues.terminalMacOptionIsMeta,
  );
  const [commandHistoryMaxSize, setCommandHistoryMaxSize] = React.useState(
    initialValues.commandHistoryMaxSize,
  );
  const [commandHistoryMinLength, setCommandHistoryMinLength] = React.useState(
    initialValues.commandHistoryMinLength,
  );
  const [commandSuggestionsEnabled, setCommandSuggestionsEnabled] =
    React.useState(initialValues.commandSuggestionsEnabled);
  const [commandSuggestionLimit, setCommandSuggestionLimit] = React.useState(
    initialValues.commandSuggestionLimit,
  );
  const [defaultLocalShell, setDefaultLocalShell] = React.useState(
    initialValues.defaultLocalShell || "auto",
  );
  const [detectedShells, setDetectedShells] = React.useState([]);
  const [zmodemSaveDirectory, setZmodemSaveDirectory] = React.useState(
    initialValues.zmodemSaveDirectory || "",
  );
  const [logLevel, setLogLevel] = React.useState(initialValues.logLevel);
  const [maxFileSize, setMaxFileSize] = React.useState(
    initialValues.maxFileSize,
  );
  const [maxFiles, setMaxFiles] = React.useState(initialValues.maxFiles);
  const [compressOldLogs, setCompressOldLogs] = React.useState(
    initialValues.compressOldLogs,
  );
  const [cleanupIntervalDays, setCleanupIntervalDays] = React.useState(
    initialValues.cleanupIntervalDays,
  );
  const [backupRetentionDays, setBackupRetentionDays] = React.useState(
    initialValues.backupRetentionDays,
  );

  React.useEffect(() => {
    if (!open || !window.terminalAPI?.detectLocalTerminals) {
      return undefined;
    }
    let cancelled = false;
    window.terminalAPI
      .detectLocalTerminals({ refreshRuntimeStatus: false })
      .then((terminals) => {
        if (!cancelled && Array.isArray(terminals)) {
          setDetectedShells(terminals);
        }
      })
      .catch(() => {
        /* ignore detection errors in settings UI */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const localShellOptions = React.useMemo(() => {
    const seen = new Set(["auto"]);
    const options = [{ value: "auto", label: t("settings.localShellAuto") }];
    for (const terminal of detectedShells) {
      if (!terminal) continue;
      const value = String(
        terminal.id ||
          terminal.executable ||
          terminal.executablePath ||
          terminal.command ||
          terminal.name ||
          "",
      ).trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      options.push({
        value,
        label: terminal.name ? `${terminal.name} (${value})` : value,
      });
    }
    if (defaultLocalShell && !seen.has(defaultLocalShell)) {
      options.push({ value: defaultLocalShell, label: defaultLocalShell });
    }
    return options;
  }, [detectedShells, defaultLocalShell, t]);

  const getEditorFontLabel = (fontKey) => {
    switch (fontKey) {
      case "fira-code":
        return t("settings.fonts.fira-code");
      case "consolas":
        return t("settings.fonts.consolas");
      case "space-mono":
        return t("settings.fonts.space-mono");
      case "system":
      default:
        return t("settings.editorFonts.system");
    }
  };

  const getCursorStyleLabel = (styleKey) => {
    switch (styleKey) {
      case "underline":
        return t("settings.cursorStyles.underline");
      case "bar":
        return t("settings.cursorStyles.bar");
      case "block":
      default:
        return t("settings.cursorStyles.block");
    }
  };

  const getTerminalThemeLabel = (presetId) => {
    switch (presetId) {
      case "one-dark":
        return t("settings.terminalThemePresets.oneDark");
      case "dracula":
        return t("settings.terminalThemePresets.dracula");
      case "nord":
        return t("settings.terminalThemePresets.nord");
      case "tokyo-night":
        return t("settings.terminalThemePresets.tokyoNight");
      case "catppuccin-mocha":
        return t("settings.terminalThemePresets.catppuccinMocha");
      case "catppuccin-latte":
        return t("settings.terminalThemePresets.catppuccinLatte");
      case "gruvbox-dark":
        return t("settings.terminalThemePresets.gruvboxDark");
      case "solarized-dark":
        return t("settings.terminalThemePresets.solarizedDark");
      case "solarized-light":
        return t("settings.terminalThemePresets.solarizedLight");
      case "default-auto":
      default:
        return t("settings.terminalThemePresets.defaultAuto");
    }
  };

  const getTerminalThemeModeLabel = (appearance) => {
    switch (appearance) {
      case "light":
        return t("settings.terminalThemeModes.light");
      case "dark":
        return t("settings.terminalThemeModes.dark");
      case "auto":
      default:
        return t("settings.terminalThemeModes.auto");
    }
  };

  const handleBrowseZmodemDir = async () => {
    try {
      const result = await window.dialogAPI?.showOpenDialog?.({
        properties: ["openDirectory", "createDirectory"],
      });
      if (!result || result.canceled) return;
      const pickedPath = Array.isArray(result.filePaths)
        ? result.filePaths[0]
        : null;
      if (pickedPath) {
        setZmodemSaveDirectory(pickedPath);
      }
    } catch {
      /* ignore canceled or unavailable dialog */
    }
  };
  const handleTerminalFontChange = (event) => {
    setTerminalFont(event.target.value);
  };
  const handleTerminalFontSizeChange = (event, newValue) => {
    setTerminalFontSize(newValue);
  };
  const handleTerminalFontWeightChange = (event, newValue) => {
    setTerminalFontWeight(newValue);
  };
  const handleLogLevelChange = (event) => {
    setLogLevel(event.target.value);
  };
  const handleMaxFileSizeChange = (event) => {
    const value = event.target.value;
    // 确保输入的是数字，且大于0
    if (!isNaN(value) && Number(value) > 0) {
      setMaxFileSize(Number(value));
    }
  };
  const handleOpenLogDirectory = () =>
    openLogDirectory({ t, showSuccess, showError });
  const handleExportDiagnostics = () =>
    exportDiagnostics({ t, showSuccess, showError });
  React.useImperativeHandle(ref, () => ({
    getUISettings: () => ({
      editorFont: EDITOR_FONT_OPTIONS.includes(editorFont)
        ? editorFont
        : "system",
      terminalFont,
      terminalFontSize,
      terminalFontWeight,
      terminalFontWeightBold: TERMINAL_FONT_WEIGHT_BOLD_OPTIONS.includes(
        Number(terminalFontWeightBold),
      )
        ? Number(terminalFontWeightBold)
        : 700,
      terminalLineHeight: Math.min(
        1.4,
        Math.max(
          1.0,
          Math.round((Number(terminalLineHeight) || 1.0) * 100) / 100,
        ),
      ),
      terminalTheme: normalizeTerminalThemeId(
        terminalTheme || DEFAULT_TERMINAL_THEME,
      ),
      terminalLetterSpacing: Math.min(
        4,
        Math.max(-2, Math.round((Number(terminalLetterSpacing) || 0) * 2) / 2),
      ),
      terminalScrollbackLines: normalizeTerminalScrollbackLines(
        terminalScrollbackLines,
      ),
      terminalCursorStyle: TERMINAL_CURSOR_STYLE_OPTIONS.includes(
        terminalCursorStyle,
      )
        ? terminalCursorStyle
        : "block",
      terminalCursorBlink: Boolean(terminalCursorBlink),
      terminalCopyOnSelect: Boolean(terminalCopyOnSelect),
      terminalRightClickSelectsWord: Boolean(terminalRightClickSelectsWord),
      terminalMiddleClickPaste: Boolean(terminalMiddleClickPaste),
      terminalMacOptionIsMeta: Boolean(terminalMacOptionIsMeta),
      commandHistoryMaxSize: Math.min(
        10000,
        Math.max(100, Math.round(Number(commandHistoryMaxSize) || 1000)),
      ),
      commandHistoryMinLength: Math.min(
        10,
        Math.max(1, Math.round(Number(commandHistoryMinLength) || 3)),
      ),
      commandSuggestionsEnabled: Boolean(commandSuggestionsEnabled),
      commandSuggestionLimit: Math.min(
        30,
        Math.max(3, Math.round(Number(commandSuggestionLimit) || 10)),
      ),
      defaultLocalShell: String(defaultLocalShell || "auto").trim() || "auto",
      zmodem: {
        saveDirectory: String(zmodemSaveDirectory || "").trim(),
      },
      backupRetentionDays,
    }),
    saveLogs: async () => {
      if (window.terminalAPI?.saveLogSettings) {
        const clampedMaxFiles = Math.min(
          50,
          Math.max(1, Math.round(Number(maxFiles) || 5)),
        );
        const logSettings = {
          level: logLevel,
          // 将MB转换为字节
          maxFileSize: maxFileSize * 1024 * 1024,
          maxFiles: clampedMaxFiles,
          compressOldLogs: Boolean(compressOldLogs),
          cleanupIntervalDays: cleanupIntervalDays,
        };
        await window.terminalAPI.saveLogSettings(logSettings);
      }
    },
  }));
  return (
    <Grid container spacing={2}>
      {/* Left: Terminal */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.terminalFontSectionTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>{t("settings.terminalFontFamily")}</InputLabel>
              <Select
                value={terminalFont}
                onChange={handleTerminalFontChange}
                label={t("settings.terminalFontFamily")}
              >
                {terminalFonts.map((font) => (
                  <MenuItem key={font.value} value={font.value}>
                    <Typography style={{ fontFamily: font.value }}>
                      {font.label}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={compactFieldSx}>
            <Typography variant="subtitle2" gutterBottom>
              {t("settings.terminalFontSizeLabel")}
            </Typography>
            <Box sx={{ px: 1 }}>
              <Slider
                value={terminalFontSize}
                onChange={handleTerminalFontSizeChange}
                step={null}
                marks={fontSizes.map((size) => ({
                  value: size.value,
                  label: size.label,
                }))}
                min={12}
                max={18}
                size="small"
              />
            </Box>
          </Box>

          <Box sx={compactFieldSx}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                mb: 0.5,
              }}
            >
              <Typography variant="subtitle2">
                {t("settings.fontWeight")}
              </Typography>
              <TextField
                slotProps={{
                  htmlInput: {
                    min: 300,
                    max: 1000,
                    style: { textAlign: "center", padding: "2px 6px" },
                  },
                }}
                value={terminalFontWeight}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setTerminalFontWeight(val);
                }}
                size="small"
                type="number"
                sx={{ width: 72 }}
              />
            </Box>
            <Box sx={{ px: 1 }}>
              <Slider
                value={terminalFontWeight}
                onChange={handleTerminalFontWeightChange}
                min={300}
                max={1000}
                size="small"
              />
            </Box>
          </Box>

          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>{t("settings.fontWeightBoldLabel")}</InputLabel>
              <Select
                value={terminalFontWeightBold}
                onChange={(e) =>
                  setTerminalFontWeightBold(Number(e.target.value))
                }
                label={t("settings.fontWeightBoldLabel")}
              >
                {TERMINAL_FONT_WEIGHT_BOLD_OPTIONS.map((weight) => (
                  <MenuItem key={weight} value={weight}>
                    {weight}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={compactFieldSx}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="subtitle2">
                {t("settings.terminalLineHeight")}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {Number(terminalLineHeight || 1.0).toFixed(2)}
              </Typography>
            </Box>
            <Box sx={{ px: 1 }}>
              <Slider
                value={terminalLineHeight}
                onChange={(_event, value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setTerminalLineHeight(Math.round(Number(next) * 100) / 100);
                }}
                min={1.0}
                max={1.4}
                step={0.05}
                marks={[
                  { value: 1.0, label: "1.0" },
                  { value: 1.2, label: "1.2" },
                  { value: 1.4, label: "1.4" },
                ]}
                size="small"
                valueLabelDisplay="auto"
              />
            </Box>
          </Box>

          <Box sx={compactFieldSx}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="subtitle2">
                {t("settings.terminalLetterSpacingLabel")}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {Number(terminalLetterSpacing || 0).toFixed(1)}
              </Typography>
            </Box>
            <Box sx={{ px: 1 }}>
              <Slider
                value={Number(terminalLetterSpacing) || 0}
                onChange={(_event, value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setTerminalLetterSpacing(Math.round(Number(next) * 2) / 2);
                }}
                min={-2}
                max={4}
                step={0.5}
                marks={[
                  { value: -2, label: "-2" },
                  { value: 0, label: "0" },
                  { value: 2, label: "2" },
                  { value: 4, label: "4" },
                ]}
                size="small"
                valueLabelDisplay="auto"
              />
            </Box>
          </Box>

          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>{t("settings.editorFontLabel")}</InputLabel>
              <Select
                value={editorFont}
                onChange={(e) => setEditorFont(e.target.value)}
                label={t("settings.editorFontLabel")}
              >
                {EDITOR_FONT_OPTIONS.map((font) => (
                  <MenuItem key={font} value={font}>
                    {getEditorFontLabel(font)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box>
            <TextField
              slotProps={{
                htmlInput: {
                  min: MIN_TERMINAL_SCROLLBACK_LINES,
                  max: MAX_TERMINAL_SCROLLBACK_LINES,
                  step: 1000,
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.terminalScrollbackLines")}
              value={terminalScrollbackLines}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v)) {
                  setTerminalScrollbackLines(v);
                }
              }}
            />
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.terminalThemeSectionTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            {t("settings.terminalThemeLabel")}
          </Typography>
          <Box
            role="radiogroup"
            aria-label={t("settings.terminalThemeLabel")}
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 1,
            }}
          >
            {TERMINAL_THEME_PRESETS.map((preset) => {
              const selected = terminalTheme === preset.id;
              const activeSwatch =
                preset.id === DEFAULT_TERMINAL_THEME &&
                muiTheme.palette.mode === "light" &&
                preset.swatchLight
                  ? preset.swatchLight
                  : preset.swatch;
              const label = getTerminalThemeLabel(preset.id);
              return (
                <ButtonBase
                  key={preset.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTerminalTheme(preset.id)}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    textAlign: "left",
                    p: 0.75,
                    borderRadius: 1,
                    border: "1.5px solid",
                    borderColor: selected ? "primary.main" : "divider",
                    bgcolor: selected ? "action.selected" : "background.paper",
                    transition:
                      "border-color 140ms ease, background-color 140ms ease",
                    "&:hover": {
                      borderColor: selected ? "primary.main" : "text.secondary",
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      px: 0.75,
                      py: 0.625,
                      mb: 0.5,
                      borderRadius: 0.75,
                      bgcolor: activeSwatch.background,
                      border: "1px solid rgba(128,128,128,0.22)",
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.4,
                      }}
                    >
                      <Typography
                        component="span"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          lineHeight: 1,
                          color: activeSwatch.foreground,
                        }}
                      >
                        ~ $
                      </Typography>
                      <Box
                        component="span"
                        sx={{
                          width: 4,
                          height: 10,
                          borderRadius: 0.25,
                          bgcolor: activeSwatch.cursor,
                        }}
                      />
                    </Box>
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 0.3 }}
                    >
                      {activeSwatch.ansi.map((hex, idx) => (
                        <Box
                          key={idx}
                          component="span"
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            bgcolor: hex,
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 0.5,
                      minWidth: 0,
                    }}
                  >
                    <Typography
                      variant="caption"
                      noWrap
                      sx={{
                        fontWeight: selected ? 600 : 500,
                        color: "text.primary",
                      }}
                    >
                      {label}
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.25,
                        flexShrink: 0,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: "0.62rem",
                          color: "text.secondary",
                        }}
                      >
                        {getTerminalThemeModeLabel(preset.appearance)}
                      </Typography>
                      {selected && (
                        <CheckIcon
                          sx={{ fontSize: 13, color: "primary.main" }}
                        />
                      )}
                    </Box>
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.terminalInteractionTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>{t("settings.cursorStyleLabel")}</InputLabel>
              <Select
                value={terminalCursorStyle}
                onChange={(e) => setTerminalCursorStyle(e.target.value)}
                label={t("settings.cursorStyleLabel")}
              >
                {TERMINAL_CURSOR_STYLE_OPTIONS.map((styleOpt) => (
                  <MenuItem key={styleOpt} value={styleOpt}>
                    {getCursorStyleLabel(styleOpt)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <SettingsToggleRow
            id="settings-terminal-cursor-blink"
            noDivider
            label={t("settings.cursorBlinkLabel")}
            checked={terminalCursorBlink}
            onChange={(e) => setTerminalCursorBlink(e.target.checked)}
          />
          <SettingsToggleRow
            id="settings-terminal-copy-on-select"
            label={t("settings.copyOnSelectLabel")}
            checked={terminalCopyOnSelect}
            onChange={(e) => setTerminalCopyOnSelect(e.target.checked)}
          />
          <SettingsToggleRow
            id="settings-terminal-right-click-word"
            label={t("settings.rightClickSelectsWordLabel")}
            checked={terminalRightClickSelectsWord}
            onChange={(e) => setTerminalRightClickSelectsWord(e.target.checked)}
          />
          <SettingsToggleRow
            id="settings-terminal-middle-click-paste"
            label={t("settings.middleClickPasteLabel")}
            checked={terminalMiddleClickPaste}
            onChange={(e) => setTerminalMiddleClickPaste(e.target.checked)}
          />
          <SettingsToggleRow
            id="settings-terminal-mac-option-meta"
            label={t("settings.macOptionIsMetaLabel")}
            checked={terminalMacOptionIsMeta}
            onChange={(e) => setTerminalMacOptionIsMeta(e.target.checked)}
          />
        </Box>
      </Grid>

      {/* Right: Command History + Local Shell + Logs */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.commandHistorySectionTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 100, max: 10000, step: 50 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.commandHistoryMaxSizeLabel")}
              value={commandHistoryMaxSize}
              onChange={(e) => setCommandHistoryMaxSize(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 1, max: 10, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.commandHistoryMinLengthLabel")}
              value={commandHistoryMinLength}
              onChange={(e) => setCommandHistoryMinLength(e.target.value)}
            />
          </Box>
          <SettingsToggleRow
            id="settings-command-suggestions-enabled"
            noDivider
            label={t("settings.commandSuggestionsEnabledLabel")}
            checked={commandSuggestionsEnabled}
            onChange={(e) => setCommandSuggestionsEnabled(e.target.checked)}
          />
          <Box sx={{ mt: 1 }}>
            <TextField
              slotProps={{ htmlInput: { min: 3, max: 30, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.commandSuggestionLimitLabel")}
              value={commandSuggestionLimit}
              onChange={(e) => setCommandSuggestionLimit(e.target.value)}
              disabled={!commandSuggestionsEnabled}
            />
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.localShellAndTransferTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>{t("settings.defaultLocalShellLabel")}</InputLabel>
              <Select
                value={defaultLocalShell}
                onChange={(e) => setDefaultLocalShell(e.target.value)}
                label={t("settings.defaultLocalShellLabel")}
              >
                {localShellOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              fullWidth
              size="small"
              label={t("settings.zmodemSaveDirectoryLabel")}
              placeholder={t("settings.zmodemSaveDirectoryPlaceholder")}
              value={zmodemSaveDirectory}
              onChange={(e) => setZmodemSaveDirectory(e.target.value)}
              slotProps={{
                input: {
                  endAdornment: zmodemSaveDirectory ? (
                    <InputAdornment position="end">
                      <Tooltip title={t("settings.clearDirectory")}>
                        <IconButton
                          size="small"
                          aria-label={t("settings.clearDirectory")}
                          onClick={() => setZmodemSaveDirectory("")}
                        >
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={handleBrowseZmodemDir}
              sx={{ flexShrink: 0, minHeight: 40 }}
            >
              {t("settings.browseDirectory")}
            </Button>
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.logSettingsTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>{t("settings.logLevelLabel")}</InputLabel>
              <Select
                value={logLevel}
                label={t("settings.logLevelLabel")}
                onChange={handleLogLevelChange}
              >
                {logLevels.map((level) => (
                  <MenuItem key={level.value} value={level.value}>
                    {level.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.megabytesShort")}
                    </InputAdornment>
                  ),
                },
                htmlInput: { min: 1 },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.logFileSizeLimitLabel")}
              value={maxFileSize}
              onChange={handleMaxFileSizeChange}
            />
          </Box>

          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 1, max: 50, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.logMaxFilesLabel")}
              value={maxFiles}
              onChange={(e) => setMaxFiles(e.target.value)}
            />
          </Box>

          <Box sx={compactFieldSx}>
            <SettingsToggleRow
              id="settings-compress-old-logs"
              noDivider
              label={t("settings.logCompressOldLogsLabel")}
              checked={compressOldLogs}
              onChange={(e) => setCompressOldLogs(e.target.checked)}
            />
          </Box>

          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.logCleanupIntervalLabel")}
              value={cleanupIntervalDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) {
                  setCleanupIntervalDays(v);
                }
              }}
            />
          </Box>

          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 1, max: 365 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.backupRetentionLabel")}
              value={backupRetentionDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) {
                  setBackupRetentionDays(v);
                }
              }}
            />
          </Box>

          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<FolderOpenIcon />}
              onClick={handleOpenLogDirectory}
            >
              {t("settings.openLogDirectory")}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<BugReportIcon />}
              onClick={handleExportDiagnostics}
            >
              {t("settings.exportDiagnostics")}
            </Button>
          </Box>
        </Box>
      </Grid>
    </Grid>
  );
}
