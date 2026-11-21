/** Config package payload merging and local config persistence helpers. */
function createPayloadMergeMethods({
  configService,
  MAX_MERGED_COMMAND_HISTORY,
}) {
  return {
    /**
     * 将导入载荷写回本地配置
     */
    _applyImportedPayload(payload, { mode, sections }) {
      const sectionFilter =
        sections === undefined || sections === null
          ? null
          : new Set(this._normalizeSections(sections));
      const imported = payload.sections || {};
      const applied = [];

      const shouldApply = (section) =>
        sectionFilter === null || sectionFilter.has(section);

      if (imported.connections !== undefined && shouldApply("connections")) {
        if (mode === "replace") {
          configService.saveConnections(imported.connections || []);
          configService.saveTopConnections(imported.topConnections || []);
          configService.saveLastConnections(imported.lastConnections || []);
        } else {
          const currentConnections = configService.loadConnections();
          configService.saveConnections(
            this._mergeConnectionTrees(
              currentConnections,
              imported.connections || [],
            ),
          );
          const currentTop = configService.loadTopConnections();
          configService.saveTopConnections(
            this._mergeConnectionTrees(
              currentTop,
              imported.topConnections || [],
            ),
          );
          const currentLast = configService.loadLastConnections();
          configService.saveLastConnections(
            this._mergeConnectionTrees(
              currentLast,
              imported.lastConnections || [],
            ),
          );
        }
        applied.push("connections");
      }

      if (imported.aiSettings !== undefined && shouldApply("aiSettings")) {
        const importedSettings = imported.aiSettings || {};
        if (mode === "replace") {
          configService.saveAISettings(importedSettings);
        } else {
          const currentSettings = configService.loadAISettings() || {};
          configService.saveAISettings({
            ...currentSettings,
            ...importedSettings,
            configs: this._mergeById(
              currentSettings.configs,
              importedSettings.configs,
            ),
          });
        }
        applied.push("aiSettings");
      }

      if (imported.uiSettings !== undefined && shouldApply("uiSettings")) {
        const importedUI = { ...(imported.uiSettings || {}) };
        delete importedUI.windowBounds;
        if (mode === "replace") {
          configService.saveUISettings(importedUI);
        } else {
          const currentUI = configService.loadUISettings() || {};
          configService.saveUISettings({ ...currentUI, ...importedUI });
        }
        applied.push("uiSettings");
      }

      if (
        imported.shortcutCommands !== undefined &&
        shouldApply("shortcutCommands")
      ) {
        const importedCommands = imported.shortcutCommands || {};
        if (mode === "replace") {
          configService.saveShortcutCommands(importedCommands);
        } else {
          const currentCommands = configService.loadShortcutCommands() || {};
          configService.saveShortcutCommands({
            ...currentCommands,
            ...importedCommands,
          });
        }
        applied.push("shortcutCommands");
      }

      if (
        Array.isArray(imported.commandHistory) &&
        shouldApply("commandHistory")
      ) {
        if (mode === "replace") {
          configService.saveCommandHistory(imported.commandHistory);
        } else {
          const currentHistory = configService.loadCommandHistory() || [];
          configService.saveCommandHistory(
            this._mergeCommandHistory(currentHistory, imported.commandHistory),
          );
        }
        applied.push("commandHistory");
      }

      if (Array.isArray(imported.portForwards) && shouldApply("portForwards")) {
        if (mode === "replace") {
          configService.savePortForwards(imported.portForwards);
        } else {
          const currentForwards = configService.loadPortForwards() || [];
          configService.savePortForwards(
            this._mergeById(currentForwards, imported.portForwards),
          );
        }
        applied.push("portForwards");
      }

      return applied;
    },

    /**
     * 按 id 合并两个列表（导入项覆盖同 id 的现有项，其余保留）
     */
    _mergeById(currentItems, importedItems) {
      const current = Array.isArray(currentItems) ? currentItems : [];
      const imported = Array.isArray(importedItems) ? importedItems : [];
      if (imported.length === 0) {
        return current;
      }

      const merged = new Map();
      current.forEach((item) => {
        if (item && typeof item === "object" && item.id !== undefined) {
          merged.set(item.id, item);
        } else {
          merged.set(Symbol("anonymous"), item);
        }
      });
      imported.forEach((item) => {
        if (item && typeof item === "object" && item.id !== undefined) {
          merged.set(item.id, item);
        } else {
          merged.set(Symbol("anonymous"), item);
        }
      });
      return Array.from(merged.values());
    },

    /**
     * 按 id 递归合并连接树（组内同样按 id 合并）
     */
    _mergeConnectionTrees(currentItems, importedItems) {
      const mergeLevel = (current, imported) => {
        const currentList = Array.isArray(current) ? current : [];
        const importedList = Array.isArray(imported) ? imported : [];
        if (importedList.length === 0) {
          return currentList;
        }

        const importedById = new Map();
        const appended = [];
        importedList.forEach((item) => {
          if (item && typeof item === "object" && item.id) {
            importedById.set(item.id, item);
          } else {
            appended.push(item);
          }
        });

        const result = currentList.map((item) => {
          if (!item || typeof item !== "object") {
            return item;
          }
          const replacement = item.id ? importedById.get(item.id) : null;
          if (replacement) {
            importedById.delete(item.id);
            // 组节点递归合并，保证只存在于本机的子连接不丢失
            if (
              item.type === "group" &&
              replacement.type === "group" &&
              Array.isArray(item.items)
            ) {
              return {
                ...replacement,
                items: mergeLevel(item.items, replacement.items || []),
              };
            }
            return replacement;
          }
          if (item.type === "group" && Array.isArray(item.items)) {
            return {
              ...item,
              items: mergeLevel(item.items, []),
            };
          }
          return item;
        });

        // 导入项中现有树里没有的（含未在新位置命中的组）追加到末尾
        importedList.forEach((item) => {
          if (item && typeof item === "object" && item.id) {
            if (importedById.has(item.id)) {
              result.push(item);
            }
          } else {
            // appended 里的匿名项在此处不再重复追加（已在前面收集）
          }
        });
        appended.forEach((item) => result.push(item));

        return result;
      };

      return mergeLevel(currentItems, importedItems);
    },

    _mergeCommandHistory(currentHistory, importedHistory) {
      const merged = new Map();
      const addAll = (history) => {
        if (!Array.isArray(history)) {
          return;
        }
        history.forEach((entry) => {
          if (!entry || typeof entry !== "object") {
            return;
          }
          const key = typeof entry.command === "string" ? entry.command : null;
          if (!key) {
            return;
          }
          const existing = merged.get(key);
          if (!existing) {
            merged.set(key, { ...entry, command: key });
          } else {
            const next = { ...existing };
            if ((Number(entry.count) || 0) > (Number(existing.count) || 0)) {
              // 导入记录使用次数更高：整体覆盖（含各自字段）
              Object.assign(next, entry);
            } else if (
              (Number(entry.timestamp) || 0) > (Number(existing.timestamp) || 0)
            ) {
              // 本地 count 更高：仅采纳导入记录更新的时间戳，
              // 保证按时间排序/截断时反映真实的“最近使用”
              next.timestamp = entry.timestamp;
            }
            next.command = key;
            merged.set(key, next);
          }
        });
      };
      addAll(currentHistory);
      addAll(importedHistory);
      // 容量上限：保留最近的 MAX_MERGED_COMMAND_HISTORY 条，避免历史无限膨胀。
      // Map 插入序 ≠ 时间序（当前设备尾部 + 导入记录），
      // 先按 timestamp 倒序排序再截断，才是时间意义上的“最近”
      const mergedList = Array.from(merged.values());
      mergedList.sort(
        (a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0),
      );
      return mergedList.slice(0, MAX_MERGED_COMMAND_HISTORY);
    },
  };
}

module.exports = createPayloadMergeMethods;
