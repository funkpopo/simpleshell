const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

function assertNotContains(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing start marker`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing end marker`);

  return source.slice(start, end);
}

const windowManagerSource = readSource("src/core/window/windowManager.js");
const appSource = readSource("src/app.jsx");
const mainSource = readSource("src/main.js");
const desktopIntegrationSource = readSource(
  "src/core/app/desktopIntegration.js",
);
const appIndexSource = readSource("src/core/app/index.js");
const appCleanupSource = readSource("src/core/app/appCleanup.js");
const settingsHandlersSource = readSource(
  "src/core/ipc/handlers/settingsHandlers.js",
);
const configServiceSource = readSource("src/services/configService.js");
const settingsSource = readSource("src/components/Settings.jsx");
const globalCssSource = readSource("src/styles/global.css");
const fileManagerSource = readSource("src/components/FileManager.jsx");
const fileHandlersSource = readSource("src/core/ipc/handlers/fileHandlers.js");
const filemanagementServiceSource = readSource(
  "src/modules/filemanagement/filemanagementService.js",
);
const preloadSource = readSource("src/preload.js");
const commandSuggestionSource = readSource(
  "src/components/CommandSuggestion.jsx",
);
const connectionManagerSource = readSource(
  "src/components/ConnectionManager.jsx",
);
const customTabSource = readSource("src/components/CustomTab.jsx");

function testStartupAndWindowLifecycle() {
  assertContains(
    windowManagerSource,
    /show:\s*false/,
    "Main BrowserWindow must start hidden to avoid empty-frame startup flicker.",
  );

  assertContains(
    windowManagerSource,
    /backgroundColor/,
    "Main BrowserWindow must set a startup background color that matches the saved theme.",
  );

  assertContains(
    windowManagerSource,
    /ready-to-show/,
    "Main BrowserWindow must wait for ready-to-show before becoming visible.",
  );

  assertContains(
    windowManagerSource,
    /windowBounds/,
    "Main BrowserWindow must persist and restore window bounds.",
  );

  assertContains(
    appSource,
    /event\.detail\s*===\s*2/,
    "Top bar should handle double-click maximize/restore for frameless Windows behavior.",
  );

  assertContains(
    mainSource,
    /installDesktopIntegration\(\)/,
    "Main process must install desktop integration during app startup.",
  );

  assertContains(
    mainSource,
    /attachDesktopWindowIntegration\(mainWindow\)/,
    "Created BrowserWindow instances must receive native desktop window integration.",
  );

  assertContains(
    mainSource,
    /app\.on\("activate"[\s\S]*showPrimaryWindow\(\{\s*createWindow:\s*createMainWindow\s*\}\)/,
    "macOS activate must delegate to primary-window restoration instead of creating a duplicate.",
  );

  assertContains(
    desktopIntegrationSource,
    /function showPrimaryWindow[\s\S]*mainWindow\.isMinimized\(\)[\s\S]*mainWindow\.restore\(\)[\s\S]*mainWindow\.show\(\)[\s\S]*mainWindow\.focus\(\)/,
    "Primary-window restoration must restore, show, and focus the existing window.",
  );

  assertContains(
    mainSource,
    /app\.on\("second-instance"[\s\S]*handleSecondInstance\(commandLine,\s*\{\s*createWindow:\s*createMainWindow\s*\}\)/,
    "Second-instance launches must focus the existing app and route system-opened local files.",
  );

  assertContains(
    mainSource,
    /app\.on\("open-file"[\s\S]*event\.preventDefault\(\)[\s\S]*handleSystemOpenFiles\(\[filePath\],\s*\{\s*createWindow:\s*createMainWindow\s*\}\)/,
    "macOS Dock/Finder file-open events must be handled by the native shell.",
  );

  assertNotContains(
    mainSource,
    /app\.on\("before-quit",\s*async/,
    "before-quit must synchronously prevent the default quit before async cleanup begins.",
  );

  assertContains(
    mainSource,
    /app\.on\("before-quit",\s*\(event\)\s*=>[\s\S]*beforeCleanup:\s*\(\)\s*=>\s*aiWorkerManager\.terminateAIWorker\(\)/,
    "App quit must terminate the AI worker inside the controlled cleanup lifecycle.",
  );

  assertContains(
    appCleanupSource,
    /event\.preventDefault\(\)[\s\S]*await beforeCleanup\(\)[\s\S]*await this\.performCleanup\(ipcSetup\)[\s\S]*this\.app\.quit\(\)/,
    "App cleanup must block quit, run caller cleanup, release app resources, then quit.",
  );
}

function testDesktopIntegrationIsNativeAndExplicit() {
  assertContains(
    appIndexSource,
    /attachDesktopWindowIntegration/,
    "App module must export desktop window integration.",
  );

  assertContains(
    appIndexSource,
    /installDesktopIntegration/,
    "App module must export desktop integration installer.",
  );

  assertContains(
    appIndexSource,
    /handleSecondInstance/,
    "App module must export second-instance desktop handling.",
  );

  assertContains(
    appIndexSource,
    /handleSystemOpenFiles/,
    "App module must export system local-file open handling.",
  );

  assertContains(
    appIndexSource,
    /showPrimaryWindow/,
    "App module must export primary-window restoration.",
  );

  assertContains(
    desktopIntegrationSource,
    /DEFAULT_DESKTOP_INTEGRATION[\s\S]*trayEnabled:\s*false/,
    "Tray icon must be disabled by default and enabled only by user choice.",
  );

  assertContains(
    desktopIntegrationSource,
    /DEFAULT_DESKTOP_INTEGRATION[\s\S]*closeToTray:\s*false/,
    "Close-to-tray must be disabled by default.",
  );

  assertContains(
    desktopIntegrationSource,
    /if\s*\(\s*tray\s*\|\|\s*!desktopIntegrationSettings\.trayEnabled\s*\)/,
    "Tray creation must be guarded by the user trayEnabled setting.",
  );

  assertContains(
    desktopIntegrationSource,
    /desktopIntegrationSettings\.trayEnabled\s*&&\s*desktopIntegrationSettings\.closeToTray\s*&&\s*!isQuitting/,
    "Close-to-tray must require trayEnabled, closeToTray, and a non-quitting lifecycle.",
  );

  assertContains(
    desktopIntegrationSource,
    /throw new Error\(`Tray icon is not available:/,
    "Tray setup must fail explicitly when the required tray icon is missing.",
  );

  assertContains(
    desktopIntegrationSource,
    /new Tray\(image\.resize\(\{\s*width:\s*16,\s*height:\s*16\s*\}\)\)/,
    "Tray creation must use an Electron Tray with a real native image.",
  );

  assertContains(
    desktopIntegrationSource,
    /mainWindow\.setMinimumSize\(\s*800,\s*560\s*\)/,
    "Main window must have a native minimum size floor.",
  );

  assertContains(
    desktopIntegrationSource,
    /webContents\.on\("context-menu"/,
    "Renderer text context menus must be handled by the native shell.",
  );

  assertContains(
    desktopIntegrationSource,
    /Menu\.buildFromTemplate\([\s\S]*role:\s*"copy"[\s\S]*role:\s*"paste"[\s\S]*role:\s*"selectAll"/,
    "Native context menu must use Electron menu roles for standard editing commands.",
  );

  assertContains(
    desktopIntegrationSource,
    /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/,
    "Windows app user model id must be registered for taskbar identity.",
  );

  assertContains(
    desktopIntegrationSource,
    /app\.dock\.show\(\)/,
    "macOS Dock identity must be kept visible for normal desktop app behavior.",
  );

  assertContains(
    desktopIntegrationSource,
    /app\.on\("will-quit"[\s\S]*destroyTray\(\)/,
    "Tray resources must be destroyed when the app quits.",
  );

  assertContains(
    settingsHandlersSource,
    /applyDesktopIntegrationSettings\(settings\?\.desktopIntegration \|\| \{\}\)/,
    "Saving UI settings must immediately apply desktop integration changes.",
  );

  assertContains(
    configServiceSource,
    /desktopIntegration:\s*\{[\s\S]*trayEnabled:\s*\{\s*type:\s*"boolean",\s*default:\s*false\s*\}[\s\S]*closeToTray:\s*\{\s*type:\s*"boolean",\s*default:\s*false\s*\}/,
    "Desktop integration config schema must include trayEnabled and closeToTray defaults.",
  );

  assertNotContains(
    settingsSource,
    /nativeContextMenu|fileDropValidation|respectReducedMotion/,
    "Native context menu, drop validation, and reduced-motion compliance must not be user-disableable alternate behavior.",
  );
}

function testSystemOpenFilesAreNativeAndExplicit() {
  assertContains(
    desktopIntegrationSource,
    /const pendingOpenFiles = \[\]/,
    "System-opened local files must be queued until the renderer is ready.",
  );

  assertContains(
    desktopIntegrationSource,
    /function normalizeLocalOpenFilePath[\s\S]*fs\.existsSync\(resolvedPath\)/,
    "System-opened paths must be resolved and verified by the main process.",
  );

  assertContains(
    desktopIntegrationSource,
    /resolvedPath === path\.resolve\(process\.execPath\)/,
    "Second-instance command lines must not treat the app executable as a user-opened file.",
  );

  assertContains(
    desktopIntegrationSource,
    /Notification\.isSupported\(\)[\s\S]*new Notification/,
    "System-opened local files must surface through the OS notification center.",
  );

  assertContains(
    desktopIntegrationSource,
    /safeSendToRenderer\("app:open-files"/,
    "Validated system-opened local files must be sent to the renderer through a declared event.",
  );

  assertContains(
    desktopIntegrationSource,
    /webContents\.once\("did-finish-load",\s*flushPendingOpenFiles\)/,
    "Queued system-opened local files must flush after the renderer finishes loading.",
  );

  assertContains(
    desktopIntegrationSource,
    /extractLocalOpenFilePaths\(commandLine\)/,
    "Second-instance handling must extract verified local file paths.",
  );

  assertContains(
    preloadSource,
    /onOpenFiles:\s*\(callback\)[\s\S]*ipcRenderer\.on\("app:open-files"/,
    "Preload must expose system-opened local files to the renderer.",
  );

  assertContains(
    appSource,
    /handleDesktopOpenFiles[\s\S]*t\("app\.openFilesReceived"/,
    "Renderer must visibly acknowledge system-opened local file requests.",
  );
}

function testReducedMotionIsGlobal() {
  assertContains(
    globalCssSource,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    "Global CSS must honor prefers-reduced-motion.",
  );

  assertContains(
    globalCssSource,
    /animation-duration:\s*0\.01ms\s*!important/,
    "Reduced motion mode must effectively disable animations.",
  );

  assertContains(
    globalCssSource,
    /transition-duration:\s*0\.01ms\s*!important/,
    "Reduced motion mode must effectively disable transitions.",
  );

  assertContains(
    globalCssSource,
    /scroll-behavior:\s*auto\s*!important/,
    "Reduced motion mode must disable smooth scrolling.",
  );
}

function testDragAndDropUsesNativeValidatedLocalPaths() {
  const dragDropSource = sliceBetween(
    fileManagerSource,
    "const handleDrop = useCallback",
    "useEffect(() =>",
    "FileManager handleDrop",
  );
  const dragUploadSource = sliceBetween(
    fileManagerSource,
    "const handleDroppedItems = useCallback",
    "const handleDrop = useCallback",
    "FileManager handleDroppedItems",
  );

  assertContains(
    preloadSource,
    /validateDroppedItems:\s*\(items\)\s*=>\s*ipcRenderer\.invoke\("validateDroppedItems",\s*items\)/,
    "Preload must expose local drop validation through IPC.",
  );

  assertContains(
    preloadSource,
    /checkDroppedUploadConflicts:\s*\(tabId,\s*targetFolder,\s*uploadData\)\s*=>\s*ipcRenderer\.invoke\([\s\S]*"checkDroppedUploadConflicts"/,
    "Preload must expose remote overwrite preflight through IPC.",
  );

  assertContains(
    preloadSource,
    /getPathForFile:\s*\(file\)\s*=>[\s\S]*webUtils\.getPathForFile\(file\)/,
    "Preload must expose Electron webUtils.getPathForFile for native file drops.",
  );

  assertContains(
    fileHandlersSource,
    /channel:\s*"validateDroppedItems"/,
    "Main process must register validateDroppedItems.",
  );

  assertContains(
    fileHandlersSource,
    /channel:\s*"checkDroppedUploadConflicts"/,
    "Main process must register checkDroppedUploadConflicts.",
  );

  assertContains(
    fileHandlersSource,
    /fs\.statSync\(resolvedPath\)[\s\S]*fs\.accessSync\(resolvedPath,\s*fs\.constants\.R_OK\)/,
    "Dropped local items must be stat'ed and read-checked in the main process.",
  );

  assertContains(
    fileHandlersSource,
    /stats\.isDirectory\(\)/,
    "Drop validation must distinguish local folders.",
  );

  assertContains(
    fileHandlersSource,
    /reason:\s*"missing-local-path"/,
    "Drop validation must reject items without a verifiable native local path.",
  );

  assertContains(
    fileHandlersSource,
    /"permission-denied"/,
    "Drop validation must identify unreadable permission failures.",
  );

  assertContains(
    fileHandlersSource,
    /nativeSftpClient\.getFilePermissions\([\s\S]*candidate\.remotePath/,
    "Remote overwrite preflight must check remote candidate paths before upload.",
  );

  assertContains(
    fileHandlersSource,
    /isDroppedRemoteNotFound\(result \|\| \{\}\)/,
    "Remote overwrite preflight must treat only explicit not-found responses as no conflict.",
  );

  assertContains(
    dragDropSource,
    /item\.kind === "string"/,
    "Renderer drop handler must reject remote paths, text, and browser virtual strings.",
  );

  assertContains(
    dragDropSource,
    /item\.webkitGetAsEntry\?\.\(\)/,
    "Renderer drop handler must use native file-system entries for file and folder drops.",
  );

  assertNotContains(
    dragDropSource,
    /getAsFile|getAsEntry/,
    "Renderer drop handler must not fall back to browser File objects without native paths.",
  );

  assertContains(
    dragUploadSource,
    /getDroppedFileLocalPath\(file\)/,
    "Dropped files must be converted to native local paths before upload.",
  );

  assertContains(
    dragUploadSource,
    /window\.terminalAPI\.validateDroppedItems/,
    "Dropped items must be validated by the main process before upload.",
  );

  assertContains(
    dragUploadSource,
    /window\.terminalAPI\.checkDroppedUploadConflicts/,
    "Dropped uploads must check remote overwrite conflicts before transfer creation.",
  );

  assertContains(
    fileManagerSource,
    /window\.dialogAPI\.showMessageBox/,
    "Remote overwrite confirmation must use a native message box.",
  );

  assertNotContains(
    dragUploadSource,
    /arrayBuffer|getAsFile|file\.path|chunks|isChunked/,
    "Drag upload must not fall back to renderer memory buffers, browser file.path, or chunk payloads.",
  );

  assertContains(
    filemanagementServiceSource,
    /Upload entry requires a validated localPath/,
    "Upload service must require validated local paths for upload entries.",
  );

  assertContains(
    filemanagementServiceSource,
    /if\s*\(!fileData\.localPath\)[\s\S]*拖放文件缺少可验证的本地路径/,
    "Dropped upload service must reject files without localPath.",
  );

  assertContains(
    filemanagementServiceSource,
    /await fsp\.stat\(fileData\.localPath\)[\s\S]*await fsp\.access\(fileData\.localPath,\s*fs\.constants\.R_OK\)[\s\S]*stats\.isFile\(\)/,
    "Dropped upload service must stat, read-check, and require regular local files.",
  );

  assertNotContains(
    filemanagementServiceSource,
    /_extractDroppedFileBuffer|upload-buffer|fileData\.data|fileData\.chunks|Buffer\.concat\(chunks\)/,
    "Dropped upload service must not keep renderer-buffer upload paths.",
  );
}

function testNativeListAndScrollConventions() {
  assertContains(
    commandSuggestionSource,
    /scrollIntoView\([\s\S]*behavior:\s*"auto"/,
    "Command suggestion selection must not use smooth-scroll behavior.",
  );

  assertNotContains(
    commandSuggestionSource,
    /behavior:\s*"smooth"/,
    "Command suggestion selection must not use smooth-scroll behavior.",
  );

  assertNotContains(
    commandSuggestionSource,
    /cursor:\s*"pointer"/,
    "Command suggestion rows must keep the native list-row cursor.",
  );

  assertNotContains(
    fileManagerSource,
    /cursor:\s*"pointer"/,
    "File list rows must keep the native list-row cursor.",
  );

  assertNotContains(
    customTabSource,
    /cursor:\s*"pointer"/,
    "Tab drag hover rows must keep the native cursor.",
  );

  assertNotContains(
    `${commandSuggestionSource}\n${fileManagerSource}\n${connectionManagerSource}`,
    /transition:\s*"all\b/,
    "Native-feel UI surfaces must use explicit transition properties instead of transition: all.",
  );
}

function run() {
  const tests = [
    ["startup and window lifecycle", testStartupAndWindowLifecycle],
    [
      "desktop integration is native and explicit",
      testDesktopIntegrationIsNativeAndExplicit,
    ],
    [
      "system-opened local files are native and explicit",
      testSystemOpenFilesAreNativeAndExplicit,
    ],
    ["global reduced motion", testReducedMotionIsGlobal],
    [
      "drag and drop uses native validated local paths",
      testDragAndDropUsesNativeValidatedLocalPaths,
    ],
    ["native list and scroll conventions", testNativeListAndScrollConventions],
  ];

  tests.forEach(([name, fn]) => {
    fn();
    console.log(`PASS ${name}`);
  });

  console.log(`\n${tests.length} window native-feel regression checks passed.`);
}

run();
