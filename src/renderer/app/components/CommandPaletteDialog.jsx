import * as React from "react";
import PropTypes from "prop-types";
import Dialog from "../../shared/ui/AccessibleDialog.jsx";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import InputAdornment from "@mui/material/InputAdornment";
import SearchIcon from "@mui/icons-material/Search";
import { useTranslation } from "react-i18next";
import {
  COMMAND_PALETTE_CATEGORIES,
  buildCommandPaletteItems,
  loadPaletteMru,
  rankCommandPaletteItems,
  recordPaletteMru,
} from "../lib/commandPalette.js";

export default function CommandPaletteDialog({
  open,
  onClose,
  onExecuteItem,
  tabs = [],
  panes = {},
  splitLayouts = {},
  connections = [],
  activeSession = null,
  broadcastBarOpen = false,
  darkMode = true,
  canMonitorCurrentSession = false,
  isSshConnected = false,
  closedTabsCount = 0,
  restoreFocusRef = null,
}) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [localTerminals, setLocalTerminals] = React.useState([]);
  const [shortcutCommands, setShortcutCommands] = React.useState([]);
  const [mruIds, setMruIds] = React.useState([]);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) {
      return undefined;
    }
    setQuery("");
    setCategory("all");
    setSelectedIndex(0);
    setMruIds(loadPaletteMru());

    let cancelled = false;

    if (window.terminalAPI?.detectLocalTerminals) {
      window.terminalAPI
        .detectLocalTerminals({ refreshRuntimeStatus: false })
        .then((list) => {
          if (!cancelled && Array.isArray(list)) {
            setLocalTerminals(list);
          }
        })
        .catch(() => {});
    }

    if (window.terminalAPI?.getShortcutCommands) {
      window.terminalAPI
        .getShortcutCommands()
        .then((res) => {
          const list = res?.data?.commands;
          if (!cancelled && Array.isArray(list)) {
            setShortcutCommands(list);
          }
        })
        .catch(() => {});
    }

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus?.();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  const allItems = React.useMemo(
    () =>
      buildCommandPaletteItems({
        t,
        tabs,
        panes,
        splitLayouts,
        connections,
        localTerminals,
        shortcutCommands,
        activeSession,
        broadcastBarOpen,
        darkMode,
        canMonitorCurrentSession,
        isSshConnected,
        closedTabsCount,
      }),
    [
      t,
      tabs,
      panes,
      splitLayouts,
      connections,
      localTerminals,
      shortcutCommands,
      activeSession,
      broadcastBarOpen,
      darkMode,
      canMonitorCurrentSession,
      isSshConnected,
      closedTabsCount,
    ],
  );

  const rankedItems = React.useMemo(
    () =>
      rankCommandPaletteItems(allItems, {
        query,
        category,
        mruIds,
        t,
      }),
    [allItems, query, category, mruIds, t],
  );

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query, category]);

  React.useEffect(() => {
    if (selectedIndex >= rankedItems.length && rankedItems.length > 0) {
      setSelectedIndex(rankedItems.length - 1);
    }
  }, [rankedItems.length, selectedIndex]);

  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const activeRow = listRef.current.querySelector(
      `[data-palette-index="${selectedIndex}"]`,
    );
    activeRow?.scrollIntoView?.({ block: "nearest" });
  }, [open, selectedIndex]);

  const handleSelectItem = React.useCallback(
    (item) => {
      if (!item || item.disabled) return;
      if (item.payload?.kind !== "quickConnect") {
        setMruIds(recordPaletteMru(item.id));
      }
      onClose?.("execute");
      onExecuteItem?.(item);
    },
    [onClose, onExecuteItem],
  );

  const handleInputKeyDown = React.useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (rankedItems.length === 0) return;
        setSelectedIndex((prev) => (prev + 1) % rankedItems.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (rankedItems.length === 0) return;
        setSelectedIndex(
          (prev) => (prev - 1 + rankedItems.length) % rankedItems.length,
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        const chosen = rankedItems[selectedIndex];
        if (chosen && !chosen.disabled) {
          handleSelectItem(chosen);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose?.("escape");
      }
    },
    [handleSelectItem, onClose, rankedItems, selectedIndex],
  );

  const categoryLabels = React.useMemo(
    () => ({
      all: t("commandPalette.categories.all"),
      tabs: t("commandPalette.categories.tabs"),
      connections: t("commandPalette.categories.connections"),
      shells: t("commandPalette.categories.shells"),
      panels: t("commandPalette.categories.panels"),
      snippets: t("commandPalette.categories.snippets"),
      actions: t("commandPalette.categories.actions"),
    }),
    [t],
  );

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.("dismiss")}
      initialFocusRef={inputRef}
      restoreFocusRef={restoreFocusRef}
      maxWidth="sm"
      fullWidth
      aria-label={t("commandPalette.title")}
      slotProps={{
        paper: {
          sx: {
            mt: "8vh",
            verticalAlign: "top",
            overflow: "hidden",
            borderRadius: "var(--radius-md, 6px)",
            border: "1px solid var(--color-border)",
          },
        },
      }}
    >
      <Box
        sx={{
          p: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t("commandPalette.placeholder")}
          slotProps={{
            htmlInput: {
              "aria-label": t("commandPalette.placeholder"),
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Typography variant="caption" color="text.secondary">
                    Esc
                  </Typography>
                </InputAdornment>
              ),
            },
          }}
        />
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 0.5,
          }}
        >
          {COMMAND_PALETTE_CATEGORIES.map((cat) => (
            <Chip
              key={cat}
              size="small"
              label={categoryLabels[cat]}
              color={category === cat ? "primary" : "default"}
              variant={category === cat ? "filled" : "outlined"}
              onClick={() => setCategory(cat)}
            />
          ))}
        </Box>
      </Box>

      <List
        ref={listRef}
        dense
        sx={{
          maxHeight: 380,
          overflowY: "auto",
          py: 0.5,
        }}
      >
        {rankedItems.length === 0 ? (
          <Box sx={{ py: 4, px: 2, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {t("commandPalette.empty")}
            </Typography>
          </Box>
        ) : (
          rankedItems.slice(0, 60).map((item, idx) => (
            <ListItemButton
              key={item.id}
              data-palette-index={idx}
              selected={idx === selectedIndex}
              disabled={Boolean(item.disabled)}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => handleSelectItem(item)}
              sx={{
                mx: 0.75,
                borderRadius: 1,
                py: 0.75,
                gap: 1,
              }}
            >
              <ListItemText
                primary={item.title}
                secondary={item.subtitle || null}
                slotProps={{
                  primary: {
                    variant: "body2",
                    noWrap: true,
                    sx: { fontWeight: 500 },
                  },
                  secondary: {
                    variant: "caption",
                    noWrap: true,
                  },
                }}
              />
              {item.badge ? (
                <Chip size="small" label={item.badge} variant="outlined" />
              ) : null}
              {item.categoryLabel ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flexShrink: 0 }}
                >
                  {item.categoryLabel}
                </Typography>
              ) : null}
              {item.shortcut ? (
                <Chip
                  size="small"
                  label={item.shortcut}
                  variant="outlined"
                  sx={{ fontFamily: "monospace", fontSize: "0.7rem" }}
                />
              ) : null}
            </ListItemButton>
          ))
        )}
      </List>
    </Dialog>
  );
}

CommandPaletteDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onExecuteItem: PropTypes.func.isRequired,
  tabs: PropTypes.array,
  panes: PropTypes.object,
  splitLayouts: PropTypes.object,
  connections: PropTypes.array,
  activeSession: PropTypes.object,
  broadcastBarOpen: PropTypes.bool,
  darkMode: PropTypes.bool,
  canMonitorCurrentSession: PropTypes.bool,
  isSshConnected: PropTypes.bool,
  closedTabsCount: PropTypes.number,
  restoreFocusRef: PropTypes.object,
};
