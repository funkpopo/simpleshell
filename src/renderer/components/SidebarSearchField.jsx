import React, { forwardRef } from "react";
import PropTypes from "prop-types";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { getSearchFieldMotionSx } from "../utils/searchFieldStyles";
import { SIDEBAR_ITEM_RADIUS } from "./sidebarItemStyles";

/**
 * 侧栏统一搜索框：固定高度、前缀图标、clear、可选快捷键 hint。
 */
const SidebarSearchField = forwardRef(function SidebarSearchField(
  {
    value,
    onChange,
    onClear,
    placeholder,
    inputRef,
    showShortcutHint = true,
    shortcutHint = "Ctrl+/",
    enableScale = false,
    sx,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const { t } = useTranslation();
  const hasValue = Boolean(value);

  const handleClear = (event) => {
    event?.preventDefault?.();
    if (onClear) {
      onClear();
      return;
    }
    if (onChange) {
      onChange({ target: { value: "" } });
    }
  };

  return (
    <TextField
      ref={ref}
      inputRef={inputRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      variant="outlined"
      size="small"
      fullWidth
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
          </InputAdornment>
        ),
        endAdornment: (
          <InputAdornment position="end" sx={{ gap: 0.25 }}>
            {hasValue ? (
              <Tooltip title={t("common.clearSearch")}>
                <IconButton
                  size="small"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleClear}
                  edge="end"
                  aria-label={t("common.clearSearch")}
                  sx={{ p: 0.35 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : showShortcutHint ? (
              <Typography
                component="span"
                variant="caption"
                sx={{
                  color: "text.disabled",
                  fontSize: "0.65rem",
                  lineHeight: 1,
                  px: 0.5,
                  userSelect: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {shortcutHint}
              </Typography>
            ) : null}
          </InputAdornment>
        ),
      }}
      sx={[
        getSearchFieldMotionSx(theme, {
          borderRadius: SIDEBAR_ITEM_RADIUS,
          enableScale,
        }),
        {
          "& .MuiOutlinedInput-root": {
            height: 36,
            fontSize: "0.875rem",
          },
          "& .MuiOutlinedInput-input": {
            py: 0.75,
          },
        },
        sx,
      ]}
      {...rest}
    />
  );
});

SidebarSearchField.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  onClear: PropTypes.func,
  placeholder: PropTypes.string,
  inputRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.any }),
  ]),
  showShortcutHint: PropTypes.bool,
  shortcutHint: PropTypes.string,
  enableScale: PropTypes.bool,
  sx: PropTypes.object,
};

SidebarSearchField.displayName = "SidebarSearchField";

export default SidebarSearchField;
