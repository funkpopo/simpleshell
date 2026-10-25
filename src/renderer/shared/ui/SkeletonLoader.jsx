import React, { memo } from "react";
import {
  Box,
  Paper,
  Skeleton,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  CONNECTION_ROW_HEIGHT,
  SIDEBAR_COMMAND_ROW_HEIGHT,
  SIDEBAR_ITEM_RADIUS,
  SIDEBAR_ROW_GAP_PX,
  sidebarContentAreaSx,
  sidebarContentSx,
  sidebarFooterSx,
  sidebarListAreaSx,
  sidebarPaperSx,
  sidebarSectionSx,
  sidebarTitleBarSx,
} from "./sidebarItemStyles";

// 宽度按行序轮换而不是随机生成：同一骨架每次渲染完全一致，
// 避免重渲染时占位条跳动，也便于与真实内容的视觉节奏对齐。
const PRIMARY_WIDTHS = ["68%", "52%", "80%", "60%", "74%", "46%", "64%", "56%"];
const SECONDARY_WIDTHS = ["42%", "34%", "50%", "38%", "46%", "30%"];
const pick = (list, index) => list[index % list.length];

// 基础骨架屏组件（设置页等非侧栏场景使用）
const SkeletonLoader = memo(
  ({
    type = "default",
    width = "100%",
    height = 20,
    variant = "rectangular",
    animation = undefined, // 使用主题默认动画
    lines = 1,
    spacing = 1,
    showAvatar = false,
    sx,
    ...props
  }) => {
    switch (type) {
      case "text":
        return (
          <Stack spacing={spacing}>
            {Array.from({ length: lines }, (_, index) => (
              <Skeleton
                key={index}
                variant="text"
                width={index === lines - 1 && lines > 1 ? "70%" : width}
                height={height}
                animation={animation}
                sx={sx}
                {...props}
              />
            ))}
          </Stack>
        );

      case "list":
        return (
          <Stack spacing={2}>
            {Array.from({ length: lines }, (_, index) => (
              <Stack
                key={index}
                direction="row"
                spacing={2}
                alignItems="center"
              >
                {showAvatar && (
                  <Skeleton
                    variant="circular"
                    width={24}
                    height={24}
                    animation={animation}
                    sx={sx}
                  />
                )}
                <Stack spacing={0.5} flex={1}>
                  <Skeleton
                    variant="text"
                    width={pick(PRIMARY_WIDTHS, index)}
                    height={16}
                    animation={animation}
                    sx={sx}
                  />
                  <Skeleton
                    variant="text"
                    width={pick(SECONDARY_WIDTHS, index)}
                    height={12}
                    animation={animation}
                    sx={sx}
                  />
                </Stack>
              </Stack>
            ))}
          </Stack>
        );

      default:
        return (
          <Skeleton
            variant={variant}
            width={width}
            height={height}
            animation={animation}
            sx={sx}
            {...props}
          />
        );
    }
  },
);

/* ------------------------------------------------------------------------ */
/* 侧栏列表骨架                                                             */
/* ------------------------------------------------------------------------ */

/**
 * 各侧栏列表行的骨架口径。尺寸取自对应真实行组件（行高、图标、行数、
 * 行尾操作），懒加载 fallback 与组件内的数据加载态共用同一份定义，
 * 保证 “chunk 下载 → 数据加载 → 内容” 三个阶段之间没有布局跳变。
 */
export const SIDEBAR_LIST_SKELETONS = {
  // 拖拽柄 + 协议图标 + 名称/地址双行（ConnectionListItem）
  connection: {
    rows: 10,
    rowHeight: CONNECTION_ROW_HEIGHT,
    gap: 0,
    leading: true,
    icon: "glyph",
    lines: 2,
    actions: 0,
  },
  // 单行等宽命令 + 发送/复制两个行尾按钮（CommandHistory）
  history: {
    rows: 12,
    rowHeight: SIDEBAR_COMMAND_ROW_HEIGHT,
    gap: SIDEBAR_ROW_GAP_PX,
    leading: false,
    icon: null,
    lines: 1,
    actions: 2,
  },
  // 名称 caption + 等宽命令 + 两个行尾按钮（ShortcutCommands）
  shortcut: {
    rows: 10,
    rowHeight: SIDEBAR_COMMAND_ROW_HEIGHT,
    gap: SIDEBAR_ROW_GAP_PX,
    leading: false,
    icon: null,
    lines: 2,
    captionFirst: true,
    actions: 2,
  },
  // 32px 图标块 + 名称/描述双行（LocalTerminalSidebar）
  localTerminal: {
    rows: 6,
    rowHeight: 52,
    gap: SIDEBAR_ROW_GAP_PX,
    leading: false,
    icon: "tile",
    lines: 2,
    actions: 0,
  },
};

const ROW_BASE_SX = {
  display: "flex",
  alignItems: "center",
  boxSizing: "border-box",
  mx: 0.75,
  borderRadius: SIDEBAR_ITEM_RADIUS,
  overflow: "hidden",
};
const LEADING_SX = {
  width: 20,
  mr: 0.25,
  display: "flex",
  justifyContent: "center",
  flexShrink: 0,
};
const GLYPH_SLOT_SX = { width: 24, flexShrink: 0, display: "flex" };
const TILE_SLOT_SX = { width: 40, flexShrink: 0, display: "flex" };
const TEXT_SX = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 0.75,
};
const ACTIONS_SX = { display: "flex", gap: 0.75, ml: 1, flexShrink: 0 };

const SkeletonListRow = memo(function SkeletonListRow({ index, preset }) {
  const { rowHeight, gap, leading, icon, lines, captionFirst, actions } =
    preset;
  const primary = (
    <Skeleton
      key="primary"
      variant="rounded"
      width={pick(PRIMARY_WIDTHS, index)}
      height={11}
    />
  );
  const secondary =
    lines > 1 ? (
      <Skeleton
        key="secondary"
        variant="rounded"
        width={pick(SECONDARY_WIDTHS, index + 2)}
        height={9}
      />
    ) : null;
  const paddingLeft = leading ? 0.5 : icon === "tile" ? 2 : 1;
  return (
    <Box
      sx={[
        ROW_BASE_SX,
        { height: rowHeight, mb: `${gap}px`, pl: paddingLeft, pr: 1 },
      ]}
    >
      {leading ? (
        <Box sx={LEADING_SX}>
          <Skeleton variant="rounded" width={8} height={14} />
        </Box>
      ) : null}
      {leading ? <Box sx={{ width: 12, flexShrink: 0 }} /> : null}
      {icon === "glyph" ? (
        <Box sx={GLYPH_SLOT_SX}>
          <Skeleton variant="rounded" width={18} height={18} />
        </Box>
      ) : null}
      {icon === "tile" ? (
        <Box sx={TILE_SLOT_SX}>
          <Skeleton variant="rounded" width={32} height={32} />
        </Box>
      ) : null}
      <Box sx={TEXT_SX}>
        {captionFirst ? [secondary, primary] : [primary, secondary]}
      </Box>
      {actions > 0 ? (
        <Box sx={ACTIONS_SX}>
          {Array.from({ length: actions }, (_, actionIndex) => (
            <Skeleton
              key={actionIndex}
              variant="circular"
              width={18}
              height={18}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
});

/**
 * 侧栏列表骨架。`variant` 取 SIDEBAR_LIST_SKELETONS 中的口径，
 * `rows` 可覆盖行数。仅渲染行本身，外层滚动/内边距由调用方的列表区提供。
 */
export const SidebarListSkeleton = memo(function SidebarListSkeleton({
  variant = "connection",
  rows,
}) {
  const { t } = useTranslation();
  const preset =
    SIDEBAR_LIST_SKELETONS[variant] || SIDEBAR_LIST_SKELETONS.connection;
  const rowCount = rows ?? preset.rows;
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t("common.loading")}
      sx={{ flexShrink: 0, overflow: "hidden" }}
    >
      {Array.from({ length: rowCount }, (_, index) => (
        <SkeletonListRow key={index} index={index} preset={preset} />
      ))}
    </Box>
  );
});

/* ------------------------------------------------------------------------ */
/* 文件管理器骨架                                                           */
/* ------------------------------------------------------------------------ */

// 与 FileList 行保持一致：40px 行高 + 4px 间距，列表 4px 内边距，20px 图标
const FILE_ROW_SX = {
  height: 40,
  px: 1.5,
  display: "flex",
  alignItems: "center",
  borderRadius: SIDEBAR_ITEM_RADIUS,
  boxSizing: "border-box",
  "&:not(:last-child)": { mb: `${SIDEBAR_ROW_GAP_PX}px` },
};

export const FileManagerSkeleton = memo(function FileManagerSkeleton({
  rows = 12,
  message,
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={message || t("common.loading")}
      sx={{
        p: 0.5,
        width: "100%",
        minWidth: 0,
        height: "100%",
        flex: 1,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {message ? (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ display: "block", px: 1.5, pt: 0.5, pb: 1 }}
        >
          {message}
        </Typography>
      ) : null}
      {Array.from({ length: rows }, (_, index) => (
        <Box key={index} sx={FILE_ROW_SX}>
          <Box sx={{ width: 20, mr: 0.75, flexShrink: 0, display: "flex" }}>
            <Skeleton variant="rounded" width={20} height={18} />
          </Box>
          <Box sx={TEXT_SX}>
            <Skeleton
              variant="rounded"
              width={pick(PRIMARY_WIDTHS, index)}
              height={11}
            />
            <Skeleton
              variant="rounded"
              width={pick(SECONDARY_WIDTHS, index)}
              height={8}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
});

/* ------------------------------------------------------------------------ */
/* 卡片 / 表单类侧栏骨架                                                    */
/* ------------------------------------------------------------------------ */

const CARD_HEADER_SX = {
  display: "flex",
  alignItems: "center",
  gap: 0.75,
  px: 1.25,
  minHeight: 32,
};

const SkeletonCardHeader = ({ index }) => (
  <Box sx={CARD_HEADER_SX}>
    <Skeleton variant="circular" width={18} height={18} />
    <Skeleton
      variant="rounded"
      width={pick(SECONDARY_WIDTHS, index)}
      height={11}
      sx={{ flex: "0 1 auto" }}
    />
    <Box sx={{ flex: 1 }} />
    <Skeleton variant="rounded" width={12} height={12} />
  </Box>
);

/** 资源监控：系统信息卡展开，其余卡片折叠（与默认展开状态一致） */
export const ResourceMonitorSkeleton = memo(function ResourceMonitorSkeleton() {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t("resourceMonitor.loading")}
      sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Paper key={index} elevation={2} sx={{ borderRadius: 1 }}>
          <SkeletonCardHeader index={index} />
          {index < 3 ? (
            <Box
              sx={{
                px: 1.25,
                pb: 1.25,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {Array.from({ length: index === 0 ? 3 : 2 }, (_, line) => (
                <Skeleton
                  key={line}
                  variant="rounded"
                  width={pick(PRIMARY_WIDTHS, index + line)}
                  height={11}
                />
              ))}
              {index > 0 ? (
                <Skeleton variant="rounded" width="100%" height={6} />
              ) : null}
            </Box>
          ) : null}
        </Paper>
      ))}
    </Box>
  );
});

/** IP 查询结果：两组信息卡 + 地图占位 */
export const IpQueryResultSkeleton = memo(function IpQueryResultSkeleton({
  mapHeight = 200,
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t("common.loading")}
      sx={{ p: 2 }}
    >
      <Skeleton variant="text" width={120} height={28} />
      <Paper elevation={2} sx={{ p: 2, borderRadius: 1, mb: 2 }}>
        <Skeleton variant="text" width="60%" height={22} />
        <Skeleton variant="text" width="40%" height={22} />
      </Paper>
      <Skeleton variant="text" width={120} height={28} />
      <Paper elevation={2} sx={{ p: 2, borderRadius: 1 }}>
        <Skeleton variant="text" width="50%" height={20} />
        <Skeleton variant="text" width="40%" height={20} />
        <Skeleton variant="text" width="30%" height={20} />
      </Paper>
      <Box sx={{ mt: 2, height: mapHeight }}>
        <Skeleton variant="rounded" width="100%" height="100%" />
      </Box>
    </Box>
  );
});

/** 端口转发规则卡片（与规则卡片的边框、内边距一致） */
export const ForwardingRulesSkeleton = memo(function ForwardingRulesSkeleton({
  rows = 3,
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t("common.loading")}
      sx={{ display: "flex", flexDirection: "column", gap: 1 }}
    >
      {Array.from({ length: rows }, (_, index) => (
        <Box
          key={index}
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            p: 1,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Skeleton
              variant="rounded"
              width={pick(SECONDARY_WIDTHS, index)}
              height={12}
            />
            <Box sx={{ flex: 1 }} />
            <Skeleton variant="rounded" width={44} height={18} />
          </Box>
          <Skeleton
            variant="rounded"
            width={pick(PRIMARY_WIDTHS, index)}
            height={10}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.75 }}>
            {Array.from({ length: 3 }, (_, button) => (
              <Skeleton
                key={button}
                variant="circular"
                width={22}
                height={22}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
});

const FormSkeleton = () => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, px: 1 }}>
    <Skeleton variant="rounded" width="35%" height={12} />
    <Skeleton variant="rounded" width="100%" height={6} />
    {Array.from({ length: 4 }, (_, index) => (
      <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Skeleton variant="rounded" width={16} height={16} />
        <Skeleton
          variant="rounded"
          width={pick(SECONDARY_WIDTHS, index)}
          height={11}
        />
      </Box>
    ))}
    <Skeleton variant="rounded" width="100%" height={36} />
    <Skeleton variant="rounded" width="100%" height={40} />
  </Box>
);

/* ------------------------------------------------------------------------ */
/* 懒加载 fallback 外壳                                                     */
/* ------------------------------------------------------------------------ */

const SearchSection = ({ theme, children }) => (
  <Box sx={sidebarSectionSx(theme)}>
    <Skeleton variant="rounded" width="100%" height={36} />
    {children}
  </Box>
);

const ButtonsSection = ({ theme }) => (
  <Box
    sx={[
      sidebarSectionSx(theme),
      { display: "flex", justifyContent: "flex-end", gap: 1 },
    ]}
  >
    <Skeleton variant="rounded" width={92} height={28} />
    <Skeleton variant="rounded" width={72} height={28} />
  </Box>
);

const TabsSection = ({ theme }) => (
  <Box
    sx={{
      height: 40,
      flexShrink: 0,
      display: "flex",
      borderBottom: `1px solid ${theme.palette.divider}`,
    }}
  >
    {[0, 1].map((index) => (
      <Box
        key={index}
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Skeleton variant="rounded" width="45%" height={12} />
      </Box>
    ))}
  </Box>
);

const FooterSection = ({ theme }) => (
  <Box sx={sidebarFooterSx(theme)}>
    <Skeleton variant="rounded" width={96} height={10} />
  </Box>
);

const FileToolbarSection = ({ theme }) => (
  <Box
    sx={{
      px: 1.5,
      py: 1,
      display: "flex",
      flexDirection: "column",
      gap: 1,
      flexShrink: 0,
      borderBottom: `1px solid ${theme.palette.divider}`,
    }}
  >
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} variant="circular" width={26} height={26} />
      ))}
    </Box>
    <Skeleton variant="rounded" width="100%" height={32} />
  </Box>
);

const IpFormSection = ({ theme }) => (
  <Box
    sx={{
      p: 2,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      gap: 1,
      borderBottom: `1px solid ${theme.palette.divider}`,
    }}
  >
    <Skeleton variant="rounded" width="80%" height={10} />
    <Skeleton variant="rounded" width="100%" height={40} />
    <Box sx={{ display: "flex", gap: 1 }}>
      <Skeleton variant="rounded" height={36} sx={{ flex: 1 }} />
      <Skeleton variant="rounded" height={36} sx={{ flex: 1 }} />
    </Box>
  </Box>
);

/** fallback 中各侧栏标题栏以下的结构，镜像真实组件的分区 */
const renderLazySkeletonBody = (variant, theme) => {
  switch (variant) {
    case "connection":
      return (
        <>
          <ButtonsSection theme={theme} />
          <SearchSection theme={theme} />
          <Box sx={sidebarListAreaSx}>
            <SidebarListSkeleton variant="connection" />
          </Box>
        </>
      );
    case "history":
      return (
        <>
          <SearchSection theme={theme}>
            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
              <Skeleton variant="rounded" width={96} height={28} />
              <Skeleton variant="rounded" width={80} height={28} />
            </Box>
          </SearchSection>
          <Box sx={sidebarListAreaSx}>
            <SidebarListSkeleton variant="history" />
          </Box>
          <FooterSection theme={theme} />
        </>
      );
    case "shortcut":
      return (
        <>
          <SearchSection theme={theme} />
          <TabsSection theme={theme} />
          <Box sx={sidebarListAreaSx}>
            <SidebarListSkeleton variant="shortcut" />
          </Box>
          <FooterSection theme={theme} />
        </>
      );
    case "localTerminal":
      return (
        <>
          <SearchSection theme={theme} />
          <Box sx={sidebarListAreaSx}>
            <SidebarListSkeleton variant="localTerminal" />
          </Box>
          <FooterSection theme={theme} />
        </>
      );
    case "file":
      return (
        <>
          <FileToolbarSection theme={theme} />
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <FileManagerSkeleton />
          </Box>
        </>
      );
    case "resource":
      return (
        <Box sx={sidebarContentAreaSx}>
          <ResourceMonitorSkeleton />
        </Box>
      );
    case "ipAddress":
      return (
        <>
          <IpFormSection theme={theme} />
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <IpQueryResultSkeleton />
          </Box>
        </>
      );
    case "security":
      return (
        <>
          <TabsSection theme={theme} />
          <Box sx={sidebarContentAreaSx}>
            <FormSkeleton />
          </Box>
        </>
      );
    case "forwarding":
      return (
        <Box
          sx={[
            sidebarContentAreaSx,
            { display: "flex", flexDirection: "column", gap: 1 },
          ]}
        >
          <Skeleton variant="rounded" width="100%" height={40} />
          <Box sx={{ borderBottom: 1, borderColor: "divider" }} />
          <ForwardingRulesSkeleton />
        </Box>
      );
    default:
      return (
        <>
          <SearchSection theme={theme} />
          <Box sx={sidebarListAreaSx}>
            <SidebarListSkeleton variant="connection" />
          </Box>
        </>
      );
  }
};

/**
 * 动态模块下载期间使用的统一侧栏外壳。
 *
 * 外层尺寸、表面和滑入行为刻意与 SidebarPanel 保持一致，避免各业务骨架按
 * 内容最小宽度布局，或在模块就绪后突然切换背景和运动轨迹；标题栏以下的
 * 分区（工具条、标签页、列表、状态栏）逐一镜像对应的真实侧栏。
 */
export const SidebarLazySkeleton = memo(
  ({ open = false, variant = "list", loadingLabel }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    return (
      <Paper
        aria-busy="true"
        aria-label={loadingLabel || t("common.loading")}
        sx={{
          ...sidebarPaperSx(theme),
          position: "relative",
        }}
        elevation={theme.palette.mode === "dark" ? 1 : 0}
      >
        <Box sx={sidebarContentSx(theme, open)}>
          <Box sx={sidebarTitleBarSx(theme)}>
            <Skeleton variant="rounded" width="42%" height={14} />
            <Skeleton variant="circular" width={22} height={22} />
          </Box>
          {renderLazySkeletonBody(variant, theme)}
        </Box>
      </Paper>
    );
  },
);

export const SettingsSkeleton = memo(() => {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mb: 2, display: "block" }}
      >
        {t("common.skeleton.settings")}
      </Typography>
      {Array.from({ length: 4 }, (_, sectionIndex) => (
        <Box key={sectionIndex} sx={{ mb: 3 }}>
          <SkeletonLoader type="text" width="30%" height={20} />
          <Box sx={{ mt: 1 }}>
            <SkeletonLoader type="list" lines={2} />
          </Box>
        </Box>
      ))}
    </Box>
  );
});

SkeletonLoader.displayName = "SkeletonLoader";

export default SkeletonLoader;
