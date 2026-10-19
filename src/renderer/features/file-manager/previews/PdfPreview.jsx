import { useState } from "react";
import {
  Box,
  ButtonGroup,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useTranslation } from "react-i18next";
import useBinaryPreview from "../hooks/useBinaryPreview.js";
import BinaryPreviewDialog from "./BinaryPreviewDialog.jsx";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const decodePdf = (content) => {
  const binary = atob(content);
  return {
    data: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  };
};

export default function PdfPreview(props) {
  const { file, path, tabId } = props;
  const { t } = useTranslation();
  const fullPath = path === "/" ? "/" + file.name : path + "/" + file.name;
  const preview = useBinaryPreview({
    file,
    tabId,
    fullPath,
    transform: decodePdf,
  });
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const pdfData = preview.content;
  const controls = (
    <>
      <ButtonGroup size="small" variant="outlined">
        <Tooltip title={t("filePreview.previousPage")}>
          <span>
            <IconButton
              aria-label={t("filePreview.previousPage")}
              onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
              disabled={pageNumber <= 1}
              size="small"
            >
              <NavigateBeforeIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("filePreview.nextPage")}>
          <span>
            <IconButton
              aria-label={t("filePreview.nextPage")}
              onClick={() =>
                setPageNumber((page) => Math.min(numPages || 1, page + 1))
              }
              disabled={pageNumber >= (numPages || 1)}
              size="small"
            >
              <NavigateNextIcon />
            </IconButton>
          </span>
        </Tooltip>
      </ButtonGroup>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ px: 0.5, whiteSpace: "nowrap" }}
      >
        {t("filePreview.pageStatus", {
          page: pageNumber,
          total: numPages || 0,
        })}
      </Typography>
      <ButtonGroup size="small" variant="outlined">
        <Tooltip title={t("filePreview.zoomIn")}>
          <span>
            <IconButton
              aria-label={t("filePreview.zoomIn")}
              onClick={() => setScale((value) => Math.min(value + 0.2, 3))}
              disabled={scale >= 3}
              size="small"
            >
              <ZoomInIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("filePreview.zoomOut")}>
          <span>
            <IconButton
              aria-label={t("filePreview.zoomOut")}
              onClick={() => setScale((value) => Math.max(value - 0.2, 0.5))}
              disabled={scale <= 0.5}
              size="small"
            >
              <ZoomOutIcon />
            </IconButton>
          </span>
        </Tooltip>
      </ButtonGroup>
    </>
  );
  return (
    <BinaryPreviewDialog
      {...props}
      {...preview}
      fullPath={fullPath}
      pdf
      controls={controls}
    >
      <Box
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          sx={{
            flex: "1 1 auto",
            overflow: "auto",
            p: 2,
            bgcolor: "grey.100",
            "& .react-pdf__Document": {
              width: "fit-content",
              margin: "0 auto",
            },
          }}
        >
          {pdfData && (
            <Document
              file={pdfData}
              onLoadSuccess={({ numPages }) => {
                setNumPages(numPages);
                setPageNumber(1);
              }}
              onLoadError={(error) =>
                preview.setError(
                  t("filePreview.errors.pdfLoadFailed", {
                    error: error.message,
                  }),
                )
              }
              loading={
                <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                  <CircularProgress />
                </Box>
              }
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer
                renderAnnotationLayer
              />
            </Document>
          )}
        </Box>
      </Box>
    </BinaryPreviewDialog>
  );
}
