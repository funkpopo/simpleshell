import React from "react";
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Divider from "@mui/material/Divider";
import { alpha, useTheme } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { useTranslation } from "react-i18next";

const optionToggleSx = {
  px: 0.75,
  py: 0.25,
  minWidth: 28,
  height: 26,
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: 0.2,
  textTransform: "none",
  border: "none !important",
  borderRadius: "6px !important",
  color: "text.secondary",
  "&.Mui-selected": {
    color: "primary.main",
    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
  },
  "&.Mui-selected:hover": {
    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.22),
  },
};

const WebTerminalSearchOverlay = ({
  isActive,
  showSearchBar,
  searchTerm,
  searchResults,
  noMatchFound,
  caseSensitive,
  useRegex,
  wholeWord,
  onOpenSearch,
  onCloseSearch,
  onSearchTermChange,
  onSearchNext,
  onSearchPrevious,
  onToggleCaseSensitive,
  onToggleRegex,
  onToggleWholeWord,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const isDark = theme.palette.mode === "dark";

  if (!isActive && !showSearchBar) {
    return null;
  }

  if (!showSearchBar) {
    return (
      <Tooltip title={t("webTerminal.search.open")}>
        <IconButton
          size="small"
          className="terminal-search-icon-btn search-icon-btn"
          onClick={onOpenSearch}
          aria-label={t("webTerminal.search.open")}
          sx={{
            color: "text.secondary",
            bgcolor: (muiTheme) =>
              alpha(
                muiTheme.palette.background.paper,
                isDark ? 0.72 : 0.88,
              ),
            border: 1,
            borderColor: "divider",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            boxShadow: isDark
              ? "0 4px 14px rgba(0,0,0,0.35)"
              : "0 4px 14px rgba(20,24,32,0.12)",
            "&:hover": {
              color: "primary.main",
              borderColor: (muiTheme) =>
                alpha(muiTheme.palette.primary.main, 0.4),
              bgcolor: (muiTheme) =>
                alpha(muiTheme.palette.primary.main, isDark ? 0.12 : 0.08),
            },
            "& svg": {
              fontSize: 18,
            },
          }}
        >
          <SearchIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  const countLabel = noMatchFound
    ? t("webTerminal.search.noMatches")
    : searchResults.count > 0
      ? `${searchResults.current}/${searchResults.count}`
      : "";

  return (
    <Paper
      elevation={0}
      className="terminal-search-anchor search-bar"
      role="search"
      aria-label={t("webTerminal.search.open")}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        py: 0.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: noMatchFound
          ? alpha(theme.palette.error.main, 0.55)
          : "var(--terminal-search-glass-border)",
        bgcolor: "var(--terminal-search-glass-bg)",
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: isDark
          ? "0 8px 28px rgba(0,0,0,0.42)"
          : "0 8px 28px rgba(20,24,32,0.14)",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        "&:focus-within": {
          borderColor: (muiTheme) =>
            noMatchFound
              ? muiTheme.palette.error.main
              : alpha(muiTheme.palette.primary.main, 0.55),
          boxShadow: (muiTheme) =>
            `0 8px 28px ${
              isDark ? "rgba(0,0,0,0.48)" : "rgba(20,24,32,0.16)"
            }, 0 0 0 1px ${alpha(
              noMatchFound
                ? muiTheme.palette.error.main
                : muiTheme.palette.primary.main,
              0.28,
            )}`,
        },
      }}
    >
      <SearchIcon
        sx={{
          fontSize: 18,
          color: "text.secondary",
          ml: 0.25,
          flexShrink: 0,
        }}
      />
      <InputBase
        value={searchTerm}
        onChange={(event) => onSearchTermChange(event.target.value)}
        placeholder={t("webTerminal.search.placeholder")}
        autoFocus
        inputProps={{
          "aria-label": t("webTerminal.search.placeholder"),
          spellCheck: false,
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
              onSearchPrevious();
            } else {
              onSearchNext();
            }
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCloseSearch();
          }
        }}
        sx={{
          ml: 0.5,
          flex: 1,
          minWidth: searchTerm ? 140 : 180,
          maxWidth: 240,
          fontSize: "0.875rem",
          color: "text.primary",
          "& .MuiInputBase-input": {
            py: 0.4,
            px: 0.5,
          },
        }}
      />

      {searchTerm ? (
        <Typography
          variant="caption"
          sx={{
            color: noMatchFound ? "error.main" : "text.secondary",
            minWidth: 44,
            textAlign: "center",
            whiteSpace: "nowrap",
            px: 0.5,
            userSelect: "none",
          }}
        >
          {countLabel}
        </Typography>
      ) : null}

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />

      <ToggleButtonGroup size="small" exclusive={false} sx={{ gap: 0.25 }}>
        <Tooltip title={t("webTerminal.search.caseSensitive")}>
          <ToggleButton
            value="case"
            selected={caseSensitive}
            onChange={onToggleCaseSensitive}
            aria-label={t("webTerminal.search.caseSensitive")}
            sx={optionToggleSx}
          >
            Aa
          </ToggleButton>
        </Tooltip>
        <Tooltip title={t("webTerminal.search.wholeWord")}>
          <ToggleButton
            value="word"
            selected={wholeWord}
            onChange={onToggleWholeWord}
            aria-label={t("webTerminal.search.wholeWord")}
            sx={optionToggleSx}
          >
            W
          </ToggleButton>
        </Tooltip>
        <Tooltip title={t("webTerminal.search.regex")}>
          <ToggleButton
            value="regex"
            selected={useRegex}
            onChange={onToggleRegex}
            aria-label={t("webTerminal.search.regex")}
            sx={optionToggleSx}
          >
            .*
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />

      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Tooltip title={t("webTerminal.search.previous")}>
          <span>
            <IconButton
              size="small"
              onClick={onSearchPrevious}
              disabled={!searchTerm || noMatchFound}
              aria-label={t("webTerminal.search.previous")}
              sx={{ color: "text.secondary" }}
            >
              <NavigateBeforeIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("webTerminal.search.next")}>
          <span>
            <IconButton
              size="small"
              onClick={onSearchNext}
              disabled={!searchTerm || noMatchFound}
              aria-label={t("webTerminal.search.next")}
              sx={{ color: "text.secondary" }}
            >
              <NavigateNextIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("webTerminal.search.close")}>
          <IconButton
            size="small"
            onClick={onCloseSearch}
            aria-label={t("webTerminal.search.close")}
            sx={{ color: "text.secondary" }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  );
};

WebTerminalSearchOverlay.propTypes = {
  isActive: PropTypes.bool,
  showSearchBar: PropTypes.bool.isRequired,
  searchTerm: PropTypes.string.isRequired,
  searchResults: PropTypes.shape({
    count: PropTypes.number.isRequired,
    current: PropTypes.number.isRequired,
  }).isRequired,
  noMatchFound: PropTypes.bool.isRequired,
  caseSensitive: PropTypes.bool,
  useRegex: PropTypes.bool,
  wholeWord: PropTypes.bool,
  onOpenSearch: PropTypes.func.isRequired,
  onCloseSearch: PropTypes.func.isRequired,
  onSearchTermChange: PropTypes.func.isRequired,
  onSearchNext: PropTypes.func.isRequired,
  onSearchPrevious: PropTypes.func.isRequired,
  onToggleCaseSensitive: PropTypes.func.isRequired,
  onToggleRegex: PropTypes.func.isRequired,
  onToggleWholeWord: PropTypes.func.isRequired,
};

WebTerminalSearchOverlay.defaultProps = {
  caseSensitive: false,
  useRegex: false,
  wholeWord: false,
};

export default React.memo(WebTerminalSearchOverlay);
