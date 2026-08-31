/**
 * postinstall 补丁：修复 @xterm/xterm 渲染器竞态崩溃。
 *
 * 问题（xterm 6.x beta，含 6.1.0-beta.167 ~ beta.304）：
 * RenderService.dimensions 的 getter 直接返回 `this._renderer.value.dimensions`，
 * 而渲染器注册（open 时 setRenderer）与卸载（dispose / WebGL↔DOM 渲染器切换）存在窗口期。
 * 此期间 Viewport._sync（自定义滚动条）通过 addRefreshCallback 排队的刷新回调一旦触发，
 * 就会读到 `undefined.dimensions` 并抛出
 * "TypeError: Cannot read properties of undefined (reading 'dimensions')"。
 *
 * 修复：getter 加可选链，无渲染器时返回零尺寸兜底对象（fit 插件与内部消费方均可安全处理 0 尺寸），
 * 避免在终端打开前 / 销毁后的刷新回调中崩溃。
 *
 * 脚本幂等：已打过补丁的文件直接跳过；目标片段缺失（未来版本已改写）时仅告警不阻断安装。
 * 由 package.json 的 postinstall 钩子自动执行。
 */
const fs = require("fs");
const path = require("path");

const TARGET = "get dimensions(){return this._renderer.value.dimensions}";
const PATCHED =
  "get dimensions(){const e=this._renderer.value?.dimensions;if(e)return e;return{css:{canvas:{width:0,height:0},cell:{width:0,height:0}},device:{canvas:{width:0,height:0},cell:{width:0,height:0},char:{width:0,height:0}}}}";

const files = [
  path.join(
    __dirname,
    "..",
    "node_modules",
    "@xterm",
    "xterm",
    "lib",
    "xterm.js",
  ),
  path.join(
    __dirname,
    "..",
    "node_modules",
    "@xterm",
    "xterm",
    "lib",
    "xterm.mjs",
  ),
];

let patchedCount = 0;
let skippedCount = 0;
let missingCount = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.warn(`[patch-xterm] 跳过（文件不存在）: ${file}`);
    missingCount += 1;
    continue;
  }

  const source = fs.readFileSync(file, "utf8");

  if (source.includes(PATCHED)) {
    skippedCount += 1;
    continue;
  }

  if (!source.includes(TARGET)) {
    console.warn(
      `[patch-xterm] 警告: ${file} 中未找到目标片段，@xterm/xterm 版本可能已变化，请人工确认竞态是否已在上游修复`,
    );
    missingCount += 1;
    continue;
  }

  fs.writeFileSync(file, source.replace(TARGET, PATCHED));
  patchedCount += 1;
  console.log(`[patch-xterm] 已修补: ${file}`);
}

if (missingCount > 0) {
  // 不阻断安装，但给出醒目提示
  console.warn(
    `[patch-xterm] 完成: ${patchedCount} 个文件已修补, ${skippedCount} 个已跳过（先前已修补）, ${missingCount} 个未匹配`,
  );
} else {
  console.log(
    `[patch-xterm] 完成: ${patchedCount} 个文件已修补, ${skippedCount} 个已跳过（先前已修补）`,
  );
}
