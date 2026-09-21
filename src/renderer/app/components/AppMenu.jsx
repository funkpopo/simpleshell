import * as React from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { intentPreloadProps } from "../appShellUtils.js";
import SettingsIcon from "@mui/icons-material/Settings";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import BugReportIcon from "@mui/icons-material/BugReport";
import FeedbackIcon from "@mui/icons-material/Feedback";
import InfoIcon from "@mui/icons-material/Info";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";

export default function AppMenu({
  anchorEl,
  open,
  handleClose,
  handleOpenSettings,
  t,
  handleOpenLogDirectory,
  handleExportDiagnostics,
  handleOpenFeedbackIssue,
  handleOpenAbout,
  handleExit,
}) {
  return (
    <Menu
      id="menu-appbar"
      anchorEl={anchorEl}
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      keepMounted
      transformOrigin={{
        vertical: "top",
        horizontal: "left",
      }}
      open={open}
      onClose={handleClose}
    >
      <MenuItem
        {...intentPreloadProps("settings")}
        onClick={handleOpenSettings}
      >
        <SettingsIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("menu.settings")}
      </MenuItem>
      <MenuItem onClick={handleOpenLogDirectory}>
        <FolderOpenIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("menu.openLogs")}
      </MenuItem>
      <MenuItem onClick={handleExportDiagnostics}>
        <BugReportIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("menu.exportDiagnostics")}
      </MenuItem>
      <MenuItem onClick={handleOpenFeedbackIssue}>
        <FeedbackIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("menu.feedback")}
      </MenuItem>
      <MenuItem
        {...intentPreloadProps("aboutDialog")}
        onClick={handleOpenAbout}
      >
        <InfoIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("menu.about")}
      </MenuItem>
      <MenuItem onClick={handleExit}>
        <ExitToAppIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("menu.exit")}
      </MenuItem>
    </Menu>
  );
}
