import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { getMimeType, isImageFile } from "../lib/filePreviewTypes.js";
import useBinaryPreview from "../hooks/useBinaryPreview.js";
import BinaryPreviewDialog from "./BinaryPreviewDialog.jsx";

export default function MediaPreview(props) {
  const { file, path } = props;
  const { t } = useTranslation();
  const fullPath = path === "/" ? "/" + file.name : path + "/" + file.name;
  const supported = isImageFile(file.name);
  return supported ? (
    <ImagePreview {...props} fullPath={fullPath} />
  ) : (
    <BinaryPreviewDialog
      {...props}
      fullPath={fullPath}
      loading={false}
      releaseCache={async () => {}}
      error={t("filePreview.errors.binaryPreviewBlocked")}
    >
      <Typography>{t("filePreview.unsupportedPreview")}</Typography>
    </BinaryPreviewDialog>
  );
}

function ImagePreview(props) {
  const { file, tabId, fullPath } = props;
  const preview = useBinaryPreview({ file, tabId, fullPath });
  return (
    <BinaryPreviewDialog {...props} {...preview}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
          overflow: "hidden",
          p: 2,
        }}
      >
        <img
          src={`data:${getMimeType(file.name)};base64,${preview.content}`}
          alt={file.name}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </Box>
    </BinaryPreviewDialog>
  );
}
