/**
 * Static checks for P1 logical Command Blocks (model + gutter + prompt boundary).
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  collectWebTerminalSources,
  readSource,
} = require("./lib/webterminal-sources.js");

const ROOT = path.resolve(__dirname, "..");

const {
  COMMAND_BLOCK_STATUS,
  MAX_COMMAND_BLOCKS,
  createCommandBlock,
  completeCommandBlock,
  pruneCommandBlocks,
  disposeCommandBlocks,
  getAbsoluteCursorLine,
  mapBufferLineToViewport,
  isAlternateOrEditorBuffer,
} = require(path.join(
  ROOT,
  "src/components/web-terminal/blocks/commandBlockModel.js",
));

function createMockTerm({
  baseY = 0,
  cursorY = 2,
  viewportY = 0,
  rows = 24,
  type = "normal",
  screenHeight = 408,
  screenTop = 100,
  containerTop = 80,
} = {}) {
  const markers = [];
  const term = {
    rows,
    buffer: {
      active: {
        type,
        baseY,
        cursorY,
        viewportY,
      },
    },
    registerMarker(offset = 0) {
      const active = term.buffer.active;
      const marker = {
        line:
          (Number(active.baseY) || 0) +
          (Number(active.cursorY) || 0) +
          offset,
        isDisposed: false,
        dispose() {
          this.isDisposed = true;
        },
      };
      markers.push(marker);
      return marker;
    },
    element: {
      querySelector(sel) {
        if (sel === ".xterm-screen" || sel === ".xterm-viewport") {
          return {
            getBoundingClientRect() {
              return {
                top: screenTop,
                left: 10,
                width: 800,
                height: screenHeight,
              };
            },
          };
        }
        return null;
      },
    },
    __markers: markers,
    __containerRect: {
      top: containerTop,
      left: 0,
      width: 820,
      height: 500,
    },
  };
  return term;
}

function testStatusConstants() {
  assert.equal(COMMAND_BLOCK_STATUS.RUNNING, "running");
  assert.equal(COMMAND_BLOCK_STATUS.SUCCESS, "success");
  assert.ok(MAX_COMMAND_BLOCKS >= 50);
}

function testCreateAndCompleteBlock() {
  const term = createMockTerm({ baseY: 10, cursorY: 3 });
  assert.equal(getAbsoluteCursorLine(term), 13);

  const block = createCommandBlock(term, "  ls -la  ");
  assert.equal(block.command, "ls -la");
  assert.equal(block.status, COMMAND_BLOCK_STATUS.RUNNING);
  assert.equal(block.startLine, 13);
  assert.ok(block.startMarker);
  assert.equal(block.endLine, null);

  term.buffer.active.baseY = 12;
  term.buffer.active.cursorY = 5;
  const done = completeCommandBlock(block, term);
  assert.equal(done.status, COMMAND_BLOCK_STATUS.SUCCESS);
  assert.equal(done.endLine, 17);
  assert.ok(done.endedAt);
  assert.ok(done.endMarker);
}

function testPruneDisposedAndCap() {
  const term = createMockTerm();
  const blocks = [];
  for (let i = 0; i < 5; i += 1) {
    blocks.push(createCommandBlock(term, `cmd-${i}`));
  }
  blocks[0].startMarker.isDisposed = true;
  blocks[1].startMarker.isDisposed = true;

  const pruned = pruneCommandBlocks(blocks, { max: 2 });
  assert.equal(pruned.length, 2);
  assert.equal(pruned[0].command, "cmd-3");
  assert.equal(pruned[1].command, "cmd-4");

  disposeCommandBlocks(pruned);
  for (const block of pruned) {
    assert.equal(block.startMarker.isDisposed, true);
  }
}

function testViewportMappingAndAlternateHide() {
  const term = createMockTerm({
    viewportY: 10,
    rows: 10,
    screenHeight: 200,
    screenTop: 50,
    containerTop: 50,
  });
  const containerRect = term.__containerRect;

  const visible = mapBufferLineToViewport(term, 12, containerRect);
  assert.ok(visible);
  assert.equal(visible.visible, true);
  assert.equal(visible.rowInViewport, 2);

  const above = mapBufferLineToViewport(term, 0, containerRect);
  assert.equal(above, null);

  assert.equal(isAlternateOrEditorBuffer(term, false), false);
  assert.equal(isAlternateOrEditorBuffer(term, true), true);
  term.buffer.active.type = "alternate";
  assert.equal(isAlternateOrEditorBuffer(term, false), true);
}

function testSourcesWireBlocks() {
  const sources = collectWebTerminalSources([
    "src/components/web-terminal/blocks/commandBlockModel.js",
    "src/components/web-terminal/blocks/useCommandBlocks.js",
    "src/components/web-terminal/blocks/CommandBlockGutter.jsx",
  ]);
  const prompt = readSource("src/components/web-terminal/usePromptTracking.js");
  const webTerminal = readSource("src/components/WebTerminal.jsx");
  const css = readSource("src/styles/terminal.css");
  const theme = readSource("src/styles/theme-variables.css");

  assert.match(
    prompt,
    /onCommandStart/,
    "usePromptTracking must fire onCommandStart at submit boundary",
  );
  assert.match(
    prompt,
    /onCommandEnd/,
    "usePromptTracking must fire onCommandEnd when prompt returns",
  );
  assert.match(
    prompt,
    /commandBlockCallbacks/,
    "usePromptTracking must accept commandBlockCallbacks",
  );
  assert.match(
    webTerminal,
    /useCommandBlocks/,
    "WebTerminal must wire useCommandBlocks",
  );
  assert.match(
    webTerminal,
    /CommandBlockGutter/,
    "WebTerminal must render CommandBlockGutter",
  );
  assert.match(
    sources,
    /MAX_COMMAND_BLOCKS/,
    "block model must define retention cap",
  );
  assert.match(
    sources,
    /registerMarker/,
    "blocks must use xterm markers for line tracking",
  );
  assert.match(
    css,
    /\.command-block-gutter/,
    "terminal.css must style command block gutter",
  );
  assert.match(
    theme,
    /--terminal-block-gutter-width/,
    "theme tokens must include block gutter width",
  );
  assert.match(
    theme,
    /--terminal-block-running/,
    "theme tokens must include block status colors",
  );
}

function main() {
  testStatusConstants();
  testCreateAndCompleteBlock();
  testPruneDisposedAndCap();
  testViewportMappingAndAlternateHide();
  testSourcesWireBlocks();
  console.log("check-webterminal-command-blocks: ok");
}

main();
