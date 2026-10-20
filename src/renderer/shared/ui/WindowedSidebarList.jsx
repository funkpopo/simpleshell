import { Fragment, memo, useCallback, useState } from "react";
import { List, useDynamicRowHeight } from "react-window";

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

// Measure visible rows so wrapped paths, errors and expanded transfer cards keep
// their natural height. Small lists retain the surrounding panel's scrollbar.
export default function WindowedSidebarList({
  items,
  renderItem,
  getItemKey,
  estimatedRowHeight = 64,
  className,
}) {
  const [width, setWidth] = useState(0);
  const rowHeight = useDynamicRowHeight({
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

  if (items.length < 30) {
    return items.map((item, index) => (
      <Fragment key={getItemKey(item, index)}>
        {renderItem(item, index)}
      </Fragment>
    ));
  }

  return (
    <List
      className={["app-scrollbar", className].filter(Boolean).join(" ")}
      style={LIST_STYLE}
      rowCount={items.length}
      rowHeight={rowHeight}
      rowProps={{ items, renderItem, getItemKey }}
      rowKey={rowKey}
      rowComponent={SidebarRow}
      overscanCount={4}
      onResize={handleResize}
    />
  );
}
