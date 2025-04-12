/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import React from 'react';
import './index.css';
// 导入 xterm 样式
import '@xterm/xterm/css/xterm.css';
// 导入自定义样式
import './styles/terminal.css';
// 导入 React 应用
import App from './app.jsx';
import { createRoot } from 'react-dom/client';

// 在 DOM 加载完成后渲染 React 应用
document.addEventListener('DOMContentLoaded', () => {
  // 创建 React 根节点并渲染应用
  const root = createRoot(document.getElementById('root'));
  root.render(<App />);
  
  console.log('React 应用已渲染');
});
