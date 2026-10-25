import { Fragment, memo, useCallback, useState } from "react";
import { List, useDynamicRowHeight } from "react-window";

/** 低于该行数时直接渲染，避免虚拟化的测量与定位开销 */
export const SIDEBAR_WINDOWING_THRESHOLD = 30;

const LIST_STYLE = { flex: "1 1 0", minHeight: 0, width: "100%" };
const ROW_STYLE = {
  width: "100%",
  boxSizing: "border-box",
  display: "flow-root",
};

const SidebarRow = memo(function SidebarRow({
  index,
  style,
  ariaAttributes,
  items,
  renderItem,
}) {
  return (
    <div {...ariaAttributes} style={{ ...style, ...ROW_STYLE }}>
      {renderItem(items[index], index)}
    </div>
  );
});

/**
 * 侧栏通用窗口化列表。
 *
 * - 传入 `rowHeight`（数字或 `(index, rowProps) => number`）时使用固定行高，
 *   不做逐行测量，适用于命令、连接等等高行；
 * - 省略时测量可见行，保证换行路径、错误信息、展开的传输卡片保持自然高度。
 *
 * 行数少于 `threshold` 时直接渲染到调用方的滚动容器；否则 List 以 flex
 * 填满父容器（父容器需为纵向 flex 且高度受限），无需额外测量容器高度。
 */
export default function WindowedSidebarList({
  items,
  renderItem,
  getItemKey,
  rowHeight,
  estimatedRowHeight = 64,
  threshold = SIDEBAR_WINDOWING_THRESHOLD,
  overscanCount = 4,
  className,
}) {
  const [width, setWidth] = useState(0);
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: estimatedRowHeight,
    key: `${width}:${items.length}`,
  });
  const handleResize = useCallback(({ width: nextWidth }) => {
    setWidth(nextWidth);
  }, []);
  const rowKey = useCallback(
    (index, data) => data.getItemKey(data.items[index], index),
    [],
  );

  if (items.length < threshold) {
    return items.map((item, index) => (
      <Fragment key={getItemKey(item, index)}>
        {renderItem(item, index)}
      </Fragment>
    ));
  }

  const fixedRowHeight = rowHeight !== undefined;

  return (
    <List
      className={["app-scrollbar", className].filter(Boolean).join(" ")}
      style={LIST_STYLE}
      rowCount={items.length}
      rowHeight={fixedRowHeight ? rowHeight : dynamicRowHeight}
      rowProps={{ items, renderItem, getItemKey }}
      rowKey={rowKey}
      rowComponent={SidebarRow}
      overscanCount={overscanCount}
      onResize={fixedRowHeight ? undefined : handleResize}
    />
  );
}
