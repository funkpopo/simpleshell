import React, { useRef, useCallback } from "react";
import useAutoCleanup, { useEffectWithCleanup } from "../hooks/useAutoCleanup";

/**
 * 示例组件，展示如何使用 useAutoCleanup 钩子
 * 用于防止内存泄漏
 */
export function ExampleComponentWithAutoCleanup() {
  const {
    addTimeout,
    addInterval,
    addEventListener,
    addResizeObserver,
    addMutationObserver,
    createAbortController,
    getStats,
  } = useAutoCleanup();

  const containerRef = useRef(null);
  const [counter, setCounter] = React.useState(0);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    // 1. 添加定时器 - 自动清理
    addTimeout(() => {
      // 这个定时器会在5秒后执行，组件卸载时自动清理
    }, 5000);

    // 2. 添加间隔定时器 - 自动清理
    const removeInterval = addInterval(() => {
      setCounter((prev) => prev + 1);
    }, 1000);

    // 3. 添加事件监听器 - 自动清理
    addEventListener(window, "resize", () => {
      // 窗口大小改变
    });

    // 4. 添加 ResizeObserver - 自动清理
    if (containerRef.current) {
      addResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          setDimensions({ width, height });
        }
      }, containerRef.current);
    }

    // 5. 使用 AbortController 处理异步请求 - 自动清理
    const controller = createAbortController();
    if (controller) {
      fetch("/api/data", { signal: controller.signal })
        .then((res) => res.json())
        .then((data) => {
          // Handle data
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            console.error(err);
          }
        });
    }

    // 可选：手动停止某个资源
    // setTimeout(() => {
    //   removeInterval(); // 手动停止间隔定时器
    // }, 10000);
  }, []);

  // 使用 useEffectWithCleanup - 更简洁的方式
  useEffectWithCleanup(
    (cleanup) => {
      // cleanup 对象包含所有清理方法
      cleanup.addInterval(() => {
        // 自动管理的定时器
      }, 2000);

      cleanup.addEventListener(document, "click", (e) => {
        // 点击事件
      });

      if (containerRef.current) {
        cleanup.addMutationObserver(
          (mutations) => {
            // DOM 变化
          },
          containerRef.current,
          { childList: true, subtree: true },
        );
      }

      // 返回额外的清理函数（可选）
      return () => {
        // 额外的清理逻辑
      };
    },
    [], // 依赖数组
  );

  // 获取统计信息
  const handleShowStats = useCallback(() => {
    const stats = getStats();
  }, [getStats]);

  return (
    <div ref={containerRef}>
      <h2>自动清理管理示例</h2>
      <p>计数器: {counter}</p>
      <p>
        容器尺寸: {dimensions.width} x {dimensions.height}
      </p>
      <button onClick={handleShowStats}>显示资源统计</button>
    </div>
  );
}

/**
 * 迁移指南示例：将现有组件迁移到使用 useAutoCleanup
 */

// 原始代码（有内存泄漏风险）
export function OldComponentWithLeaks() {
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    // ❌ 潜在的内存泄漏
    const timer = setInterval(() => {
      fetchData();
    }, 5000);

    // ❌ 没有清理事件监听器
    window.addEventListener("scroll", handleScroll);

    // ❌ 没有清理 ResizeObserver
    const observer = new ResizeObserver(handleResize);
    observer.observe(document.body);

    // ⚠️ 不完整的清理
    return () => {
      clearInterval(timer);
      // 忘记清理其他资源！
    };
  }, []);

  function fetchData() {
    /* ... */
  }
  function handleScroll() {
    /* ... */
  }
  function handleResize() {
    /* ... */
  }

  return <div>{/* ... */}</div>;
}

// 新代码（使用 useAutoCleanup，无内存泄漏）
export function NewComponentWithAutoCleanup() {
  const [data, setData] = React.useState(null);
  const { addInterval, addEventListener, addResizeObserver } = useAutoCleanup();

  React.useEffect(() => {
    // ✅ 自动清理
    addInterval(() => {
      fetchData();
    }, 5000);

    // ✅ 自动清理
    addEventListener(window, "scroll", handleScroll);

    // ✅ 自动清理
    addResizeObserver(handleResize, document.body);

    // 不需要手动清理！
  }, []);

  function fetchData() {
    /* ... */
  }
  function handleScroll() {
    /* ... */
  }
  function handleResize() {
    /* ... */
  }

  return <div>{/* ... */}</div>;
}

/**
 * 高级用法示例
 */
export function AdvancedUsageExample() {
  const { addTimeout, addCleanup, getStats } = useAutoCleanup();

  React.useEffect(() => {
    // 1. 条件性添加资源
    let removeTimer = null;
    if (someCondition) {
      removeTimer = addTimeout(() => {
        // 条件性定时器
      }, 3000);
    }

    // 2. 添加自定义清理逻辑
    const ws = new WebSocket("ws://localhost:8080");
    addCleanup(() => {
      ws.close();
      // WebSocket 已关闭
    });

    // 3. 动态管理资源
    const handleClick = () => {
      // 动态添加定时器
      const remove = addTimeout(() => {
        // 动态定时器执行
      }, 1000);

      // 可以立即或稍后移除
      // remove();
    };

    // 4. 监控资源使用
    const monitorInterval = addInterval(() => {
      const stats = getStats();
      if (stats.total > 100) {
        console.warn("资源使用过多:", stats);
      }
    }, 10000);

    return () => {
      // 可选：额外的清理逻辑
      // 组件清理完成
    };
  }, []);

  return <div>{/* ... */}</div>;
}

// 最佳实践总结
export const BestPractices = {
  // 1. 始终使用 useAutoCleanup 管理定时器、监听器和观察器
  // 2. 对于复杂的 effect，使用 useEffectWithCleanup
  // 3. 定期检查资源统计，避免资源泄漏
  // 4. 在开发环境中启用资源监控
  // 5. 对于长时间运行的组件，考虑清理旧资源
};

export default ExampleComponentWithAutoCleanup;
