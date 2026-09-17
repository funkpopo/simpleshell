import { Box, TextField, InputAdornment } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FolderIcon from "@mui/icons-material/Folder";
import { useTranslation } from "react-i18next";
export default function Breadcrumbs({
  pathInput,
  handlePathInputChange,
  handlePathInputSubmit,
  pathInputSubmitOnCompositionEndRef,
  handlePathInputCompositionEnd,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.75,
        overflow: "hidden",
        borderBottom: `1px solid ${theme.palette.divider}`,
        zIndex: 1,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        backgroundColor: theme.palette.background.paper,
      }}
    >
      <TextField
        size="small"
        variant="outlined"
        value={pathInput}
        onChange={handlePathInputChange}
        onKeyDown={handlePathInputSubmit}
        onCompositionStart={() => {
          pathInputSubmitOnCompositionEndRef.current = false;
        }}
        onCompositionEnd={handlePathInputCompositionEnd}
        placeholder={t("fileManager.enterPath")}
        slotProps={{
          input: {
            style: {
              fontSize: "1.0rem",
            },
            startAdornment: (
              <InputAdornment position="start">
                <FolderIcon color="action" fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          "& .MuiOutlinedInput-root": {
            borderRadius: 1.5,
            "& fieldset": {
              borderColor: theme.palette.divider,
            },
            "&:hover fieldset": {
              borderColor: theme.palette.primary.main,
            },
            "&.Mui-focused fieldset": {
              borderColor: theme.palette.primary.main,
            },
          },
        }}
      />
    </Box>
  );
}
