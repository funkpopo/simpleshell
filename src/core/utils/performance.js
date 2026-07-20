export const debounce = (func, wait, immediate = false) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(this, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(this, args);
  };
};

const throttle = (func, limit) => {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

export const createResizeObserver = (element, callback, options = {}) => {
  const { debounceTime = 50, throttleTime = 0 } = options;

  let processedCallback = callback;

  // 应用防抖或节流
  if (debounceTime > 0) {
    processedCallback = debounce(callback, debounceTime);
  } else if (throttleTime > 0) {
    processedCallback = throttle(callback, throttleTime);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      processedCallback({ width, height, element: entry.target });
    }
  });

  if (element) {
    observer.observe(element);
  }

  return {
    disconnect: () => observer.disconnect(),
    observe: (newElement) => observer.observe(newElement),
    unobserve: (targetElement) => observer.unobserve(targetElement),
  };
};

export const isElementVisible = (element) => {
  if (!element) return false;

  // 检查元素及其所有父元素的可见性
  let current = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    current = current.parentElement;
  }

  // 检查元素是否在视口内
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};
