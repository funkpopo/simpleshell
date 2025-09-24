import React, { memo } from "react";
import { Box, Paper, Typography, TextField, Button } from "@mui/material";
import FilePermissionEditor from "../FilePermissionEditor.jsx";
import { useTranslation } from "react-i18next";

// 对话框基础样式
const DialogOverlay = ({ children }) => (
  <Box
    sx={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1300,
    }}
  >
    {children}
  </Box>
);

// 重命名对话框
export const RenameDialog = memo(
  ({
    open,
    newName,
    filePermissions,
    onNewNameChange,
    onPermissionChange,
    onSubmit,
    onClose,
  }) => {
    const { t } = useTranslation();

    if (!open) return null;

    return (
      <DialogOverlay>
        <Paper
          sx={{
            width: "90%",
            maxWidth: 600,
            maxHeight: "80vh",
            p: 3,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            overflow: "auto",
          }}
        >
          <Typography variant="subtitle1">编辑文件/文件夹</Typography>
          <form onSubmit={onSubmit}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                fullWidth
                label="新名称"
                value={newName}
                onChange={(e) => onNewNameChange(e.target.value)}
                autoFocus
                variant="outlined"
                size="small"
              />

              <FilePermissionEditor
                permissions={filePermissions}
                onChange={onPermissionChange}
              />

              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-end",
                  mt: 2,
                  gap: 1,
                }}
              >
                <Button onClick={onClose} color="inherit" size="small">
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="small"
                >
                  {t("common.save")}
                </Button>
              </Box>
            </Box>
          </form>
        </Paper>
      </DialogOverlay>
    );
  },
);

RenameDialog.displayName = "RenameDialog";

// 创建文件夹对话框
export const CreateFolderDialog = memo(
  ({ open, folderName, onFolderNameChange, onSubmit, onClose }) => {
    const { t } = useTranslation();

    if (!open) return null;

    return (
      <DialogOverlay>
        <Paper
          sx={{
            width: "80%",
            maxWidth: 400,
            p: 2,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Typography variant="subtitle1">
            {t("fileManager.createFolder")}
          </Typography>
          <form onSubmit={onSubmit}>
            <TextField
              fullWidth
              label={t("fileManager.createFolder")}
              value={folderName}
              onChange={(e) => onFolderNameChange(e.target.value)}
              autoFocus
              variant="outlined"
              size="small"
            />
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                mt: 2,
                gap: 1,
              }}
            >
              <Button onClick={onClose} color="inherit" size="small">
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                size="small"
              >
                {t("common.save")}
              </Button>
            </Box>
          </form>
        </Paper>
      </DialogOverlay>
    );
  },
);

CreateFolderDialog.displayName = "CreateFolderDialog";

// 创建文件对话框
export const CreateFileDialog = memo(
  ({ open, fileName, onFileNameChange, onSubmit, onClose }) => {
    const { t } = useTranslation();

    if (!open) return null;

    return (
      <DialogOverlay>
        <Paper
          sx={{
            width: "80%",
            maxWidth: 400,
            p: 2,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Typography variant="subtitle1">
            {t("fileManager.createFile")}
          </Typography>
          <form onSubmit={onSubmit}>
            <TextField
              fullWidth
              label={t("fileManager.createFile")}
              value={fileName}
              onChange={(e) => onFileNameChange(e.target.value)}
              autoFocus
              variant="outlined"
              size="small"
            />
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                mt: 2,
                gap: 1,
              }}
            >
              <Button onClick={onClose} color="inherit" size="small">
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                size="small"
              >
                {t("common.save")}
              </Button>
            </Box>
          </form>
        </Paper>
      </DialogOverlay>
    );
  },
);

CreateFileDialog.displayName = "CreateFileDialog";

// 统一导出
const FileManagerDialogs = {
  RenameDialog,
  CreateFolderDialog,
  CreateFileDialog,
};

export default FileManagerDialogs;
