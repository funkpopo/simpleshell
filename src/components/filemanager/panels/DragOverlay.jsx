import { Box, Paper, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { darken, lighten } from "@mui/material/styles";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useTranslation } from "react-i18next";
export default function DragOverlay({ isDragging, selectedFile, currentPath }) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (!isDragging) return null;
  return (
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // 遮罩颜色随主题变化：用 lighten/darken 把颜色预先混成不透明色。
        // 注意：这里不能用 rgba 半透明色！侧边栏内容 Box 是独立合成层
        //（transform + contain: paint），遮罩又因 containerType: "size"
        // 被单独提升，Chromium 合成半透明遮罩时会透出 z-index 更低的其他
        // 侧边栏内容（与 Paper 级别注释踩过的坑相同）。
        backgroundColor:
          theme.palette.mode === "light"
            ? lighten(theme.palette.background.paper, 0.45)
            : darken(theme.palette.background.paper, 0.45),
        // 注意：此处不可加 backdropFilter，与 containerType: "size" 同用时
        // Chromium 的 backdrop root 会被破坏，导致遮罩后方渲染异常
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 1.5,
        boxSizing: "border-box",
        containerType: "size",
        zIndex: 1500,
        pointerEvents: "none",
      }}
    >
      <Paper
        elevation={4}
        sx={{
          boxSizing: "border-box",
          width: "fit-content",
          maxWidth: "100%",
          maxHeight: "100%",
          minWidth: 0,
          p: 2,
          backgroundColor: theme.palette.background.paper,
          border: `2px solid ${theme.palette.primary.main}`,
          borderRadius: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          overflow: "hidden",
          // 窄侧栏时压缩内边距与间距
          "@container (max-width: 320px)": {
            p: 1.25,
            gap: 1,
          },
          "@container (max-width: 240px)": {
            p: 1,
            gap: 0.75,
            borderRadius: 1.5,
          },
          "@container (max-height: 220px)": {
            p: 1,
            gap: 0.75,
          },
        }}
      >
        <UploadFileIcon
          sx={{
            fontSize: 48,
            color: theme.palette.primary.main,
            flexShrink: 0,
            "@container (max-width: 320px)": {
              fontSize: 36,
            },
            "@container (max-width: 240px)": {
              fontSize: 28,
            },
            "@container (max-height: 220px)": {
              fontSize: 28,
            },
          }}
        />
        <Typography
          variant="h6"
          sx={{
            color: theme.palette.primary.main,
            fontWeight: "medium",
            textAlign: "center",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            px: 0.5,
            lineHeight: 1.3,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            "@container (max-width: 320px)": {
              fontSize: "1rem",
            },
            "@container (max-width: 240px)": {
              fontSize: "0.875rem",
            },
          }}
        >
          {t("fileManager.messages.dragDropMessage")}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: theme.palette.text.secondary,
            textAlign: "center",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            px: 0.5,
            lineHeight: 1.4,
            overflowWrap: "anywhere",
            wordBreak: "break-all",
            // 超长路径限制行数，避免撑破覆盖层
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            "@container (max-width: 320px)": {
              fontSize: "0.75rem",
              WebkitLineClamp: 3,
            },
            "@container (max-width: 240px)": {
              fontSize: "0.7rem",
              WebkitLineClamp: 2,
            },
            "@container (max-height: 220px)": {
              WebkitLineClamp: 2,
            },
          }}
        >
          {selectedFile && selectedFile.isDirectory
            ? t("fileManager.messages.uploadToFolder", {
                folder: selectedFile.name,
              })
            : t("fileManager.messages.uploadToCurrentFolder") +
              `: ${currentPath}`}
        </Typography>
      </Paper>
    </Box>
  );
}
