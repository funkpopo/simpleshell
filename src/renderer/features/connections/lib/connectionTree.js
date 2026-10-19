const getConnectionTimestamp = (connection) => {
  if (!connection) {
    return null;
  }
  return (
    connection.updatedAt ??
    connection.modifiedAt ??
    connection.lastUpdated ??
    connection.lastModified ??
    connection.timestamp ??
    connection.meta?.updatedAt ??
    null
  );
};

const getConnectionVersion = (connection) => {
  if (!connection) {
    return "";
  }

  const timestamp = getConnectionTimestamp(connection);
  if (timestamp) {
    return String(timestamp);
  }

  if (connection.type === "group") {
    return [
      connection.name || "",
      connection.expanded ? "1" : "0",
      (connection.items || []).length,
    ].join("|");
  }

  const proxySignature = connection.proxy
    ? [
        connection.proxy.type || "",
        connection.proxy.host || "",
        connection.proxy.port ?? "",
        connection.proxy.username || "",
        connection.proxy.password || "",
        connection.proxy.useDefault ? "1" : "0",
      ].join("|")
    : "";

  return [
    connection.name || "",
    connection.host || "",
    connection.port ?? "",
    connection.username || "",
    connection.protocol || "",
    connection.connectionType || "",
    connection.authType || "",
    connection.privateKeyPath || "",
    connection.agentPath || "",
    connection.agentForward ? "1" : "0",
    connection.os || "",
    connection.password || "",
    proxySignature,
  ].join("|");
};

export const areConnectionListsEqual = (prevList = [], nextList = []) => {
  if (prevList === nextList) {
    return true;
  }

  if (!Array.isArray(prevList) || !Array.isArray(nextList)) {
    return false;
  }

  if (prevList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < prevList.length; index += 1) {
    const prev = prevList[index];
    const next = nextList[index];

    if (!prev || !next) {
      return false;
    }

    if (
      (prev.id || "") !== (next.id || "") ||
      (prev.type || "") !== (next.type || "")
    ) {
      return false;
    }

    if (getConnectionVersion(prev) !== getConnectionVersion(next)) {
      return false;
    }

    const prevChildren = prev.items || [];
    const nextChildren = next.items || [];

    if (
      (prevChildren.length > 0 || nextChildren.length > 0) &&
      !areConnectionListsEqual(prevChildren, nextChildren)
    ) {
      return false;
    }
  }

  return true;
};

const cloneConnectionNode = (node) => {
  if (!node || typeof node !== "object") {
    return node;
  }

  const cloned = {
    ...node,
  };

  if (node.proxy && typeof node.proxy === "object") {
    cloned.proxy = { ...node.proxy };
  }

  if (Array.isArray(node.items)) {
    cloned.items = node.items.map(cloneConnectionNode);
  }

  return cloned;
};

export const cloneConnectionList = (list = []) => list.map(cloneConnectionNode);

/**
 * 创建连接树对象身份稳定器。
 *
 * dedupe/sort 每次都会重建节点对象，导致 React.memo 的列表行 props 身份
 * 全部失效、分组展开/收起时整棵列表重渲染。稳定器按与
 * areConnectionListsEqual 相同的版本口径（getConnectionVersion），
 * 在内容未变化时复用上一次的对象身份（分组还会递归比对子项身份），
 * 使未受影响的行在 memo 比对时直接跳过重渲染。
 */
export const createConnectionStabilizer = () => {
  const cache = new Map();

  return function stabilize(items) {
    if (!Array.isArray(items)) {
      return items;
    }

    const seen = new Set();

    const walk = (list) => {
      const next = new Array(list.length);

      for (let index = 0; index < list.length; index += 1) {
        const item = list[index];

        if (!item || typeof item !== "object") {
          next[index] = item;
          continue;
        }

        const isGroup = item.type === "group";
        let childItems = null;

        if (isGroup && Array.isArray(item.items)) {
          childItems = walk(item.items);
        }

        const version = getConnectionVersion(item);
        const key = `${item.type || "unknown"}:${item.id ?? ""}`;
        seen.add(key);

        const cached = cache.get(key);
        const childrenUnchanged =
          !isGroup ||
          !Array.isArray(item.items) ||
          (cached !== undefined &&
            Array.isArray(cached.item?.items) &&
            cached.item.items.length === childItems.length &&
            cached.item.items.every(
              (child, childIndex) => child === childItems[childIndex],
            ));

        if (cached !== undefined && cached.version === version && childrenUnchanged) {
          next[index] = cached.item;
          continue;
        }

        const stable =
          isGroup && Array.isArray(item.items)
            ? { ...item, items: childItems }
            : item;
        cache.set(key, { version, item: stable });
        next[index] = stable;
      }

      // 始终返回 next：元素已替换为稳定身份，父节点的子项比对按元素逐一进行，
      // 不依赖数组自身身份
      return next;
    };

    const result = walk(items);

    // 清理已删除节点，避免缓存随增删无限增长
    for (const key of cache.keys()) {
      if (!seen.has(key)) {
        cache.delete(key);
      }
    }

    return result;
  };
};

export const dedupeConnectionsById = (list = []) => {
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }

  const seen = new Set();
  const deduped = [];

  list.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const itemId = item.id || "";
    const dedupeKey = `${item.type || "unknown"}:${itemId}`;
    if (itemId && seen.has(dedupeKey)) {
      return;
    }
    if (itemId) {
      seen.add(dedupeKey);
    }

    if (item.type === "group" && Array.isArray(item.items)) {
      deduped.push({
        ...item,
        items: dedupeConnectionsById(item.items),
      });
      return;
    }

    deduped.push(item);
  });

  return deduped;
};

export const ROOT_CONTAINER_ID = "connection-list";
export const getGroupContainerId = (groupId) => `group-container-${groupId}`;
export const CONNECTION_LIST_VIRTUALIZATION_THRESHOLD = 200;
export const CONNECTION_MANAGER_ROW_DATA_ATTR = "data-connection-manager-item";

/** 复制到剪贴板的主机地址（去掉尾部 :port，保留 [IPv6] 形式） */
export const getHostForClipboard = (connection) => {
  const raw = String(connection?.host ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end > 0) {
      return raw.slice(0, end + 1);
    }
    return raw;
  }
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > 0) {
    const after = raw.slice(lastColon + 1);
    if (/^\d+$/.test(after)) {
      return raw.slice(0, lastColon);
    }
  }
  return raw;
};

// IP地址排序辅助函数
const parseIpAddress = (ipString) => {
  if (!ipString) return null;

  // 移除端口号（如果有的话）
  const ipWithoutPort = ipString.split(":")[0];

  // 支持IPv4格式
  const ipv4Parts = ipWithoutPort.split(".");
  if (ipv4Parts.length === 4) {
    const numericParts = ipv4Parts.map((part) => parseInt(part, 10));
    if (numericParts.every((num) => !isNaN(num) && num >= 0 && num <= 255)) {
      // 将IPv4转换为数字以便比较
      return (
        numericParts[0] * 16777216 +
        numericParts[1] * 65536 +
        numericParts[2] * 256 +
        numericParts[3]
      );
    }
  }

  // 如果不是有效的IP地址，返回null
  return null;
};

export const sortConnectionsByIp = (connections) => {
  if (!Array.isArray(connections) || connections.length === 0) {
    return connections;
  }

  return [...connections].sort((a, b) => {
    // 分组类型始终按名称排序
    if (a.type === "group" && b.type === "group") {
      return (a.name || "").localeCompare(b.name || "");
    }

    // 分组始终在连接之前
    if (a.type === "group") return -1;
    if (b.type === "group") return 1;

    // 对于连接，按IP地址排序
    const ipA = parseIpAddress(a.host);
    const ipB = parseIpAddress(b.host);

    // 如果两个都有有效的IP地址，按数值排序
    if (ipA !== null && ipB !== null) {
      return ipA - ipB;
    }

    // 有效IP地址排在前面
    if (ipA !== null) return -1;
    if (ipB !== null) return 1;

    // 如果都不是有效IP，按主机名字符串排序
    return (a.host || "").localeCompare(b.host || "");
  });
};

export const countVisibleItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  return items.reduce((total, item) => {
    if (!item || typeof item !== "object") {
      return total;
    }

    if (item.type === "group") {
      const children = item.expanded ? countVisibleItems(item.items || []) : 0;
      return total + 1 + children;
    }

    return total + 1;
  }, 0);
};
