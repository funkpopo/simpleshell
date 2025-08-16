import React, { memo, useState, useEffect } from "react";
import useAutoCleanup from "../hooks/useAutoCleanup";
import { Box, Paper, Typography, IconButton, Divider } from "@mui/material";
import { styled } from "@mui/material/styles";
import WebTerminal from "./WebTerminal.jsx";

// 分屏容器样式
const SplitContainer = styled(Box)(({ theme, splitCount, paneSizes }) => {
  // 三标签特殊布局：上方两个终端，下方一个终端
  if (splitCount === 3) {
    return {
      display: "grid",
      width: "100%",
      height: "100%",
      gap: "2px",
      backgroundColor: theme.palette.divider,
      gridTemplateColumns: `${paneSizes?.leftWidth || 50}% ${100 - (paneSizes?.leftWidth || 50)}%`,
      gridTemplateRows: `${paneSizes?.topHeight || 50}% ${100 - (paneSizes?.topHeight || 50)}%`,
      gridTemplateAreas: `
        "top-left top-right"
        "bottom bottom"
      `,
    };
  }

  // 其他情况的动态布局
  return {
    display: "grid",
    width: "100%",
    height: "100%",
    gap: "2px",
    backgroundColor: theme.palette.divider,
    gridTemplateColumns:
      splitCount <= 2
        ? splitCount === 1
          ? "1fr"
          : `${paneSizes?.leftWidth || 50}% ${100 - (paneSizes?.leftWidth || 50)}%`
        : `${paneSizes?.leftWidth || 50}% ${100 - (paneSizes?.leftWidth || 50)}%`,
    gridTemplateRows:
      splitCount <= 2
        ? "1fr"
        : `${paneSizes?.topHeight || 50}% ${100 - (paneSizes?.topHeight || 50)}%`,
  };
});

// 可拖拽分隔条组件
const ResizeHandle = styled(Box)(({ theme, direction }) => ({
  position: "absolute",
  backgroundColor: "transparent",
  zIndex: 10,
  cursor: direction === "horizontal" ? "ew-resize" : "ns-resize",

  "&:hover": {
    backgroundColor: theme.palette.primary.main,
    opacity: 0.5,
  },

  "&:active": {
    backgroundColor: theme.palette.primary.main,
    opacity: 0.8,
  },

  // 水平分隔条（左右调整）
  ...(direction === "horizontal" && {
    right: -2,
    top: 0,
    width: 4,
    height: "100%",
  }),

  // 垂直分隔条（上下调整）
  ...(direction === "vertical" && {
    bottom: -2,
    left: 0,
    width: "100%",
    height: 4,
  }),
}));

// 可调整大小的分屏面板
const ResizableSplitPane = styled(Paper)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  position: "relative",
}));

// 单个分屏面板样式
const SplitPane = styled(Paper)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
}));

// 分屏头部
const SplitHeader = styled(Box)(({ theme, isActive }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: theme.spacing(0.5, 1),
  backgroundColor: isActive
    ? theme.palette.mode === "dark"
      ? "rgba(90, 202, 249, 0.15)"
      : "rgba(25, 118, 210, 0.08)"
    : theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.05)"
      : "rgba(0, 0, 0, 0.03)",
  borderBottom: `1px solid ${theme.palette.divider}`,
  minHeight: 32,
  cursor: "pointer",
  transition: "background-color 0.2s ease",
  "&:hover": {
    backgroundColor: isActive
      ? theme.palette.mode === "dark"
        ? "rgba(90, 202, 249, 0.2)"
        : "rgba(25, 118, 210, 0.12)"
      : theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.08)"
        : "rgba(0, 0, 0, 0.06)",
  },
}));

const MergedTabContent = memo(
  ({ mergedTabs, terminalInstances, currentTabId }) => {
    // 添加布局更新状态，用于触发终端适配
    const [layoutUpdateKey, setLayoutUpdateKey] = useState(0);

    // 分屏中当前活跃的标签页（用于右侧面板切换）
    const [activeSplitTabId, setActiveSplitTabId] = useState(null);

    // 分屏大小状态
    const [paneSizes, setPaneSizes] = useState({
      leftWidth: 50, // 左侧面板宽度百分比
      topHeight: 50, // 上侧面板高度百分比
    });

    // 拖拽状态
    const [isDragging, setIsDragging] = useState(false);
    const [dragType, setDragType] = useState(null); // 'horizontal' | 'vertical'

    // 使用自动清理Hook
    const { addEventListener, addTimeout } = useAutoCleanup();

    // 处理分屏头部点击，切换活跃标签页
    const handleSplitHeaderClick = (tabId) => {
      setActiveSplitTabId(tabId);

      // 触发自定义事件，通知App组件更新右侧面板的目标标签页
      window.dispatchEvent(
        new CustomEvent("activeSplitTabChanged", {
          detail: {
            activeTabId: tabId,
            timestamp: Date.now(),
          },
        }),
      );
    };

    // 处理拖拽开始
    const handleMouseDown = (e, type) => {
      e.preventDefault();
      setIsDragging(true);
      setDragType(type);
      document.body.style.cursor =
        type === "horizontal" ? "ew-resize" : "ns-resize";
      document.body.style.userSelect = "none";
    };

    // 处理拖拽移动
    const handleMouseMove = (e) => {
      if (!isDragging || !dragType) return;

      const container = document.querySelector("[data-split-container]");
      if (!container) return;

      const rect = container.getBoundingClientRect();

      if (dragType === "horizontal") {
        const newLeftWidth = ((e.clientX - rect.left) / rect.width) * 100;
        setPaneSizes((prev) => ({
          ...prev,
          leftWidth: Math.max(20, Math.min(80, newLeftWidth)),
        }));
      } else if (dragType === "vertical") {
        const newTopHeight = ((e.clientY - rect.top) / rect.height) * 100;
        setPaneSizes((prev) => ({
          ...prev,
          topHeight: Math.max(20, Math.min(80, newTopHeight)),
        }));
      }
    };

    // 处理拖拽结束
    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragType(null);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        // 触发终端大小调整
        addTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, 100);
      }
    };

    // 添加全局事件监听
    useEffect(() => {
      if (isDragging) {
        // 使用 addEventListener 自动管理事件监听器，组件卸载时自动清理
        addEventListener(document, "mousemove", handleMouseMove);
        addEventListener(document, "mouseup", handleMouseUp);
      }
    }, [isDragging, dragType, addEventListener, handleMouseMove, handleMouseUp]);

    // 初始化活跃标签页状态
    useEffect(() => {
      if (mergedTabs && mergedTabs.length > 1) {
        if (!activeSplitTabId) {
          // 默认选择第一个标签页作为活跃标签页
          const firstTabId = mergedTabs[0]?.id;
          setActiveSplitTabId(firstTabId);

          // 立即触发事件通知App组件
          if (firstTabId) {
            window.dispatchEvent(
              new CustomEvent("activeSplitTabChanged", {
                detail: {
                  activeTabId: firstTabId,
                  timestamp: Date.now(),
                },
              }),
            );
          }
        } else {
          // 检查当前活跃标签是否在新的分屏标签列表中
          const isActiveTabInMerged = mergedTabs.find(
            (tab) => tab.id === activeSplitTabId,
          );
          if (!isActiveTabInMerged) {
            const firstTabId = mergedTabs[0]?.id;
            setActiveSplitTabId(firstTabId);

            if (firstTabId) {
              window.dispatchEvent(
                new CustomEvent("activeSplitTabChanged", {
                  detail: {
                    activeTabId: firstTabId,
                    timestamp: Date.now(),
                  },
                }),
              );
            }
          }
        }
      } else if (mergedTabs && mergedTabs.length === 1) {
        // 单个标签页时，重置活跃状态
        setActiveSplitTabId(null);

        // 通知App组件清除活跃分屏标签页
        window.dispatchEvent(
          new CustomEvent("activeSplitTabChanged", {
            detail: {
              activeTabId: null,
              timestamp: Date.now(),
            },
          }),
        );
      }
    }, [mergedTabs]); // 移除activeSplitTabId依赖，避免无限循环

    // 监听分屏布局变化事件，进行布局调整而不是重新创建终端
    useEffect(() => {
      const handleSplitLayoutChanged = (event) => {
        const { type, targetTabId, mainTabId, splitTabs, timestamp } =
          event.detail || {};

        // 检查是否与当前标签相关
        const isRelated =
          targetTabId === currentTabId ||
          mainTabId === currentTabId ||
          (splitTabs && splitTabs.some((tab) => tab.id === currentTabId));

        if (isRelated) {
          // 触发布局更新，但不强制重新创建终端
          setLayoutUpdateKey((prev) => prev + 1);

          // 延迟触发resize事件，确保DOM布局已更新
          addTimeout(() => {
            window.dispatchEvent(new Event("resize"));

            // 如果是分屏操作，需要通知所有相关终端进行尺寸适配
            if (mergedTabs && mergedTabs.length > 0) {
              mergedTabs.forEach((tab) => {
                if (tab && tab.id) {
                  // 触发特定于标签的resize事件
                  window.dispatchEvent(
                    new CustomEvent("terminalResize", {
                      detail: {
                        tabId: tab.id,
                        layoutType: type,
                        timestamp: timestamp,
                      },
                    }),
                  );
                }
              });
            }

            // 如果是拆分操作，额外触发强制刷新
            if (type === "split" && splitTabs) {
              splitTabs.forEach((tab) => {
                if (tab && tab.id) {
                  window.dispatchEvent(
                    new CustomEvent("tabChanged", {
                      detail: {
                        tabId: tab.id,
                        forceRefresh: true,
                        timestamp: timestamp,
                      },
                    }),
                  );
                }
              });
            }
          }, 100);
        }
      };

      // 使用 addEventListener 自动管理事件监听器，组件卸载时自动清理
      addEventListener(window, "splitLayoutChanged", handleSplitLayoutChanged);
    }, [currentTabId, mergedTabs, addEventListener]);

    // 当合并状态改变时，仅进行布局调整
    useEffect(() => {
      if (mergedTabs && mergedTabs.length > 1) {
        // 延迟触发布局调整，确保DOM已经更新
        addTimeout(() => {
          setLayoutUpdateKey((prev) => prev + 1);

          // 触发resize事件通知终端进行尺寸适配
          window.dispatchEvent(new Event("resize"));

          // 为每个标签触发特定的resize事件
          mergedTabs.forEach((tab) => {
            if (tab && tab.id) {
              window.dispatchEvent(
                new CustomEvent("terminalResize", {
                  detail: {
                    tabId: tab.id,
                    layoutType: "layout-change",
                    timestamp: Date.now(),
                  },
                }),
              );
            }
          });
        }, 100);

        return () => clearTimeout(timer);
      }
    }, [mergedTabs]);

    if (!mergedTabs || mergedTabs.length <= 1) {
      // 单个标签页，直接渲染
      const tab = mergedTabs?.[0] || null;
      if (!tab || !terminalInstances[tab.id]) return null;

      return (
        <WebTerminal
          key={`${tab.id}-single`} // 使用稳定的key，避免重新创建
          tabId={tab.id}
          refreshKey={terminalInstances[`${tab.id}-refresh`]}
          usePowershell={tab.type !== "ssh" && terminalInstances.usePowershell}
          sshConfig={
            tab.type === "ssh" ? terminalInstances[`${tab.id}-config`] : null
          }
          isActive={true}
        />
      );
    }

    // 多个标签页，显示分屏
    const validTabs = mergedTabs.filter(
      (tab) => tab && terminalInstances[tab.id],
    );

    return (
      <SplitContainer
        splitCount={validTabs.length}
        paneSizes={paneSizes}
        data-split-container
      >
        {validTabs.map((tab, index) => {
          // 三标签特殊布局处理
          if (validTabs.length === 3) {
            let gridArea;
            switch (index) {
              case 0:
                gridArea = "top-left";
                break;
              case 1:
                gridArea = "top-right";
                break;
              case 2:
                gridArea = "bottom";
                break;
              default:
                gridArea = "";
            }

            return (
              <ResizableSplitPane
                key={`${tab.id}-split`}
                elevation={1}
                sx={{
                  gridArea: gridArea,
                  ...(index === 2 && { gridColumn: "1 / -1" }), // 下方终端填满宽度
                }}
              >
                <SplitHeader
                  isActive={activeSplitTabId === tab.id}
                  onClick={() => handleSplitHeaderClick(tab.id)}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, fontSize: "0.75rem" }}
                  >
                    {tab.label}
                  </Typography>
                </SplitHeader>

                <Box sx={{ flex: 1, overflow: "hidden", position: "relative" }}>
                  <WebTerminal
                    key={`${tab.id}-multi`} // 使用稳定的key，避免重新创建
                    tabId={tab.id}
                    refreshKey={
                      terminalInstances[`${tab.id}-refresh`] || layoutUpdateKey
                    }
                    usePowershell={
                      tab.type !== "ssh" && terminalInstances.usePowershell
                    }
                    sshConfig={
                      tab.type === "ssh"
                        ? terminalInstances[`${tab.id}-config`]
                        : null
                    }
                    isActive={true}
                  />
                </Box>

                {/* 添加拖拽分隔条 */}
                {index === 0 && (
                  <ResizeHandle
                    direction="horizontal"
                    onMouseDown={(e) => handleMouseDown(e, "horizontal")}
                  />
                )}
                {index < 2 && (
                  <ResizeHandle
                    direction="vertical"
                    onMouseDown={(e) => handleMouseDown(e, "vertical")}
                  />
                )}
              </ResizableSplitPane>
            );
          }

          // 其他情况保持原有渲染逻辑
          return (
            <ResizableSplitPane key={`${tab.id}-split`} elevation={1}>
              {" "}
              {/* 使用稳定的key */}
              <SplitHeader
                isActive={activeSplitTabId === tab.id}
                onClick={() => handleSplitHeaderClick(tab.id)}
              >
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ flex: 1, fontSize: "0.75rem" }}
                >
                  {tab.label}
                </Typography>
              </SplitHeader>
              <Box sx={{ flex: 1, overflow: "hidden", position: "relative" }}>
                <WebTerminal
                  key={`${tab.id}-multi`} // 使用稳定的key，避免重新创建
                  tabId={tab.id}
                  refreshKey={
                    terminalInstances[`${tab.id}-refresh`] || layoutUpdateKey
                  }
                  usePowershell={
                    tab.type !== "ssh" && terminalInstances.usePowershell
                  }
                  sshConfig={
                    tab.type === "ssh"
                      ? terminalInstances[`${tab.id}-config`]
                      : null
                  }
                  isActive={true}
                />
              </Box>
              {/* 添加拖拽分隔条 */}
              {validTabs.length === 2 && index === 0 && (
                <ResizeHandle
                  direction="horizontal"
                  onMouseDown={(e) => handleMouseDown(e, "horizontal")}
                />
              )}
              {validTabs.length === 4 && (
                <>
                  {(index === 0 || index === 2) && (
                    <ResizeHandle
                      direction="horizontal"
                      onMouseDown={(e) => handleMouseDown(e, "horizontal")}
                    />
                  )}
                  {index < 2 && (
                    <ResizeHandle
                      direction="vertical"
                      onMouseDown={(e) => handleMouseDown(e, "vertical")}
                    />
                  )}
                </>
              )}
            </ResizableSplitPane>
          );
        })}
      </SplitContainer>
    );
  },
);

MergedTabContent.displayName = "MergedTabContent";

export default MergedTabContent;
