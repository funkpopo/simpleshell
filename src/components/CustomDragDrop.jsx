import React from 'react';
import { Droppable as OriginalDroppable } from 'react-beautiful-dnd';

// 创建 Droppable 的包装器组件，使用 JavaScript 默认参数替代 defaultProps
export const Droppable = ({ 
  children, 
  isDropDisabled = false, 
  direction = 'vertical', 
  type = 'DEFAULT',
  ignoreContainerClipping = false,
  ...props 
}) => {
  return (
    <OriginalDroppable 
      isDropDisabled={isDropDisabled}
      direction={direction}
      type={type}
      ignoreContainerClipping={ignoreContainerClipping}
      {...props}
    >
      {(provided, snapshot) => children(provided, snapshot)}
    </OriginalDroppable>
  );
};

// 如果需要，可以添加其他包装器组件
export * from 'react-beautiful-dnd'; 