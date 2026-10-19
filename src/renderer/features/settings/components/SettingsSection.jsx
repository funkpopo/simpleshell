import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";

export const sectionCardSx = {
  p: 1.5,
  borderRadius: 1.5,
  border: "1px solid",
  borderColor: "divider",
  bgcolor: (theme) =>
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.03)"
      : "rgba(17, 24, 39, 0.025)",
};

const sectionTitleRowSx = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  mb: 1,
};

export const compactFieldSx = {
  mb: 1,
};

// 滑块行标签统一列宽，保证同卡片内多条 Slider 左边缘对齐
export const sliderLabelSx = {
  minWidth: 52,
  fontSize: "0.8rem",
  flexShrink: 0,
};

/** 卡片标题行：图标 + 标题 + 可选右侧操作（安全/数据同步/反馈卡片共用） */
export const SectionCardHeader = ({
  icon: Icon = null,
  title,
  iconColor = "primary.main",
  actions = null,
}) => (
  <Box sx={sectionTitleRowSx}>
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {Icon ? <Icon sx={{ color: iconColor }} /> : null}
      <Typography variant="subtitle1">{title}</Typography>
    </Box>
    {actions}
  </Box>
);

export const subSectionLabelSx = {
  fontSize: "0.7rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "text.secondary",
  mb: 0.75,
  mt: 1.5,
  "&:first-of-type": { mt: 0 },
};

export const SettingsToggleRow = ({
  id,
  label,
  description,
  checked,
  onChange,
}) => (
  <Box
    sx={{
      minWidth: 0,
      pt: 1.25,
      borderTop: "1px solid",
      borderColor: "divider",
      display: "flex",
      flexDirection: "column",
      gap: 0.5,
    }}
  >
    <FormControlLabel
      labelPlacement="start"
      control={
        <Switch
          checked={checked}
          onChange={onChange}
          size="small"
          slotProps={{ input: { "aria-describedby": `${id}-description` } }}
          sx={{ flexShrink: 0 }}
        />
      }
      label={
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            minWidth: 0,
            fontWeight: 500,
            overflowWrap: "anywhere",
          }}
        >
          {label}
        </Typography>
      }
      sx={{
        m: 0,
        width: "100%",
        gap: 1.5,
        justifyContent: "space-between",
      }}
    />
    <Typography
      id={`${id}-description`}
      component="p"
      variant="caption"
      color="text.secondary"
      sx={{ m: 0, display: "block", lineHeight: 1.6, overflowWrap: "anywhere" }}
    >
      {description}
    </Typography>
  </Box>
);
