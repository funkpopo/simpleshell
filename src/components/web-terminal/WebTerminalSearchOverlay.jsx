import React from "react";
import PropTypes from "prop-types";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { useTranslation } from "react-i18next";

/**
 * Search overlay UI keeps the pre-d52c38e visual design (search-bar CSS).
 * Case / regex / whole-word toggles are functional controls only.
 */
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

  if (!isActive && !showSearchBar) {
    return null;
  }

  if (!showSearchBar) {
    return (
      <Tooltip title={t("webTerminal.search.open")}>
        <IconButton
          size="small"
          className="search-icon-btn"
          onClick={onOpenSearch}
          sx={{
            padding: "4px",
            color:
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.7) !important"
                : "rgba(0, 0, 0, 0.7) !important",
            "&:hover": {
              color:
                theme.palette.mode === "dark"
                  ? "white !important"
                  : "rgba(0, 0, 0, 0.9) !important",
            },
            "& svg": {
              fontSize: "18px",
              color: "inherit !important",
            },
          }}
          aria-label={t("webTerminal.search.open")}
        >
          <SearchIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  const toggleButtonSx = {
    minWidth: 28,
    height: 24,
    padding: "0 4px",
    marginLeft: "2px",
    fontSize: "11px",
    fontWeight: 700,
    lineHeight: 1,
    borderRadius: "4px",
    border: "1px solid transparent",
    cursor: "default",
    fontFamily: "inherit",
  };

  const inactiveToggleSx = {
    ...toggleButtonSx,
    color:
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.7)"
        : "rgba(0, 0, 0, 0.7)",
    background: "transparent",
    opacity: 0.75,
  };

  const activeToggleSx = {
    ...toggleButtonSx,
    color: theme.palette.mode === "dark" ? "#fff" : "rgba(0, 0, 0, 0.9)",
    background:
      theme.palette.mode === "dark"
        ? "rgba(88, 166, 255, 0.25)"
        : "rgba(88, 166, 255, 0.18)",
    borderColor:
      theme.palette.mode === "dark"
        ? "rgba(88, 166, 255, 0.45)"
        : "rgba(88, 166, 255, 0.4)",
    opacity: 1,
  };

  return (
    <div className="search-bar">
      <input
        type="text"
        className="search-input"
        value={searchTerm}
        onChange={(event) => onSearchTermChange(event.target.value)}
        placeholder={t("webTerminal.search.placeholder")}
        autoFocus
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
        style={{
          borderColor: noMatchFound ? "red" : undefined,
          width: searchTerm ? "150px" : "200px",
        }}
      />
      {searchTerm && (
        <div
          style={{
            color: noMatchFound ? "#ff6b6b" : "#aaa",
            margin: "0 8px",
            fontSize: "12px",
            whiteSpace: "nowrap",
            minWidth: "50px",
            textAlign: "center",
          }}
        >
          {noMatchFound
            ? t("webTerminal.search.noMatches")
            : searchResults.count > 0
              ? `${searchResults.current}/${searchResults.count}`
              : ""}
        </div>
      )}
      <Tooltip title={t("webTerminal.search.caseSensitive")}>
        <button
          type="button"
          className="search-button"
          aria-label={t("webTerminal.search.caseSensitive")}
          aria-pressed={caseSensitive}
          onClick={onToggleCaseSensitive}
          style={caseSensitive ? activeToggleSx : inactiveToggleSx}
        >
          Aa
        </button>
      </Tooltip>
      <Tooltip title={t("webTerminal.search.wholeWord")}>
        <button
          type="button"
          className="search-button"
          aria-label={t("webTerminal.search.wholeWord")}
          aria-pressed={wholeWord}
          onClick={onToggleWholeWord}
          style={wholeWord ? activeToggleSx : inactiveToggleSx}
        >
          W
        </button>
      </Tooltip>
      <Tooltip title={t("webTerminal.search.regex")}>
        <button
          type="button"
          className="search-button"
          aria-label={t("webTerminal.search.regex")}
          aria-pressed={useRegex}
          onClick={onToggleRegex}
          style={useRegex ? activeToggleSx : inactiveToggleSx}
        >
          .*
        </button>
      </Tooltip>
      <Tooltip title={t("webTerminal.search.previous")}>
        <span>
          <IconButton
            size="small"
            onClick={onSearchPrevious}
            className="search-button"
            disabled={!searchTerm || noMatchFound}
            aria-label={t("webTerminal.search.previous")}
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
            className="search-button"
            disabled={!searchTerm || noMatchFound}
            aria-label={t("webTerminal.search.next")}
          >
            <NavigateNextIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("webTerminal.search.close")}>
        <IconButton
          size="small"
          onClick={onCloseSearch}
          className="search-button"
          aria-label={t("webTerminal.search.close")}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </div>
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
