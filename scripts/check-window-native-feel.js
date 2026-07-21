const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

function assertNotContains(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
}

function assertBefore(source, earlierPattern, laterPattern, message) {
  const earlier = source.match(earlierPattern);
  assert.ok(earlier, `${message}: missing earlier pattern`);

  const later = source.match(laterPattern);
  assert.ok(later, `${message}: missing later pattern`);

  assert.ok(earlier.index < later.index, message);
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
const nativeSftpClientSource = readSource("src/core/utils/nativeSftpClient.js");
const ipcTraceSource = readSource("src/core/ipc/ipcTrace.js");
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
    /onOpenFiles:\s*\(callback\)[\s\S]*ipcRenderer\.on\(IPC_EVENT_CHANNELS\.APP_OPEN_FILES/,
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
  const uploadTransferSource = sliceBetween(
    fileManagerSource,
    "const runUploadTransfer = async",
    "const handleCopyAbsolutePath = async",
    "FileManager runUploadTransfer",
  );
  const downloadSource = sliceBetween(
    fileManagerSource,
    "const handleDownload = async",
    "// 修改 setError 的使用，使用通知系统",
    "FileManager handleDownload",
  );
  const downloadFolderSource = sliceBetween(
    fileManagerSource,
    "const handleDownloadFolder = async",
    "const handleDownloadSelection = useCallback",
    "FileManager handleDownloadFolder",
  );

  assertContains(
    preloadSource,
    /validateDroppedItems:\s*\(items\)\s*=>\s*ipcRenderer\.invoke\(IPC_REQUEST_CHANNELS\.FILE_VALIDATE_DROPPED_ITEMS,\s*items\)/,
    "Preload must expose local drop validation through IPC.",
  );

  assertContains(
    preloadSource,
    /checkDroppedUploadConflicts:\s*\(tabId,\s*targetFolder,\s*uploadData\)\s*=>\s*ipcRenderer\.invoke\(IPC_REQUEST_CHANNELS\.FILE_CHECK_DROPPED_UPLOAD_CONFLICTS/,
    "Preload must expose remote overwrite preflight through IPC.",
  );

  assertContains(
    preloadSource,
    /getPathForFile:\s*\(file\)\s*=>[\s\S]*webUtils\.getPathForFile\(file\)/,
    "Preload must expose Electron webUtils.getPathForFile for native file drops.",
  );

  assertContains(
    fileHandlersSource,
    /channel:\s*IPC_REQUEST_CHANNELS\.FILE_VALIDATE_DROPPED_ITEMS/,
    "Main process must register validateDroppedItems.",
  );

  assertContains(
    fileHandlersSource,
    /channel:\s*IPC_REQUEST_CHANNELS\.FILE_CHECK_DROPPED_UPLOAD_CONFLICTS/,
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
    /expectsDirectory\s*=\s*item\?\.isDirectory === true/,
    "Drop validation must verify renderer-declared directory items against local filesystem stats.",
  );

  assertContains(
    fileHandlersSource,
    /fs\.readdirSync\(resolvedPath\)/,
    "Drop validation must require dropped local folders to be enumerable.",
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

  assertContains(
    dragDropSource,
    /Array\.from\(e\.dataTransfer\.files \|\| \[\]\)/,
    "Renderer drop handler must read native File objects only to resolve Electron-backed local paths.",
  );

  assertContains(
    dragDropSource,
    /getDroppedFileLocalPath\(nativeFile\)/,
    "Dropped files must be converted to native local paths before upload.",
  );

  assertContains(
    dragDropSource,
    /nativeFiles\.length !== itemsArray\.length/,
    "Renderer drop handler must reject drops that cannot pair every entry with a native File object.",
  );

  assertContains(
    dragDropSource,
    /nativePathByName\.get\(entryName\)/,
    "Renderer drop handler must bind each top-level entry to a matching native local path by name.",
  );

  assertContains(
    dragDropSource,
    /duplicateNativeNames\.size > 0/,
    "Renderer drop handler must reject ambiguous duplicate top-level native item names.",
  );

  assertNotContains(
    dragDropSource,
    /getAsFile|file\.path/,
    "Renderer drop handler must not use browser File.path or DataTransferItem.getAsFile path sources.",
  );

  assertContains(
    dragUploadSource,
    /window\.terminalAPI\.validateDroppedItems/,
    "Dropped items must be validated by the main process before upload.",
  );

  assertContains(
    dragUploadSource,
    /window\.terminalAPI\.checkDroppedUploadConflicts/,
    "Dropped uploads must check remote overwrite conflicts before transfer.",
  );

  assertBefore(
    dragUploadSource,
    /const transferId = addTransferProgress\(/,
    /await window\.terminalAPI\.validateDroppedItems/,
    "Drag upload must create a transfer entry before main-process validation.",
  );

  assertBefore(
    dragUploadSource,
    /const transferId = addTransferProgress\(/,
    /await window\.terminalAPI\.checkDroppedUploadConflicts/,
    "Drag upload must keep the sidebar transfer icon active during remote conflict probing.",
  );

  assertContains(
    dragUploadSource,
    /fileManager\.transfer\.status\.preparingUpload/,
    "Drag upload must show a preparing upload transfer status immediately.",
  );

  assertContains(
    dragUploadSource,
    /fileManager\.transfer\.status\.uploading/,
    "Drag upload must switch the transfer entry to uploading once progress begins.",
  );

  assertContains(
    uploadTransferSource,
    /window\.terminalAPI\?\.uploadFolder[\s\S]*window\.terminalAPI\?\.uploadFile/,
    "Manual upload must route through the terminal upload IPC APIs.",
  );

  assertBefore(
    uploadTransferSource,
    /activeUploadTransferId = addTransferProgress\(/,
    /await api\(tabId, targetPath/,
    "Manual upload must create a transfer entry before invoking upload IPC.",
  );

  assertContains(
    uploadTransferSource,
    /fileManager\.transfer\.status\.preparingUpload/,
    "Manual upload must show a preparing upload transfer status immediately.",
  );

  assertBefore(
    downloadSource,
    /const transferId = addTransferProgress\(/,
    /await window\.terminalAPI\.downloadFile\(/,
    "Single file download must create a transfer entry before invoking download IPC.",
  );

  assertBefore(
    downloadSource,
    /batchTransferId = addTransferProgress\(/,
    /await window\.terminalAPI\.downloadFiles\(/,
    "Batch file download must create a transfer entry before invoking download IPC.",
  );

  assertBefore(
    downloadFolderSource,
    /const transferId = addTransferProgress\(/,
    /await window\.terminalAPI\.downloadFolder\(/,
    "Folder download must create a transfer entry before invoking download IPC.",
  );

  assertContains(
    downloadSource,
    /fileManager\.transfer\.status\.waitingForSaveLocation/,
    "Single file download must show an immediate waiting-for-save-location state.",
  );

  assertContains(
    downloadSource,
    /fileManager\.transfer\.status\.waitingForTargetFolder/,
    "Batch file download must show an immediate waiting-for-target-folder state.",
  );

  assertContains(
    downloadFolderSource,
    /fileManager\.transfer\.status\.waitingForTargetFolder/,
    "Folder download must show an immediate waiting-for-target-folder state.",
  );

  assertNotContains(
    fileManagerSource,
    /window\.dialogAPI\.showMessageBox/,
    "Remote overwrite confirmation must use the project-styled renderer dialog.",
  );

  assertContains(
    fileManagerSource,
    /const showConfirmDialog = useCallback\(/,
    "FileManager must provide an async project-styled confirmation dialog.",
  );

  assertContains(
    fileManagerSource,
    /confirmDialogResolveRef/,
    "Async confirmation dialogs must resolve the caller after user choice.",
  );

  assertContains(
    dragUploadSource,
    /await confirmDroppedUploadConflicts\(/,
    "Dropped uploads must await the project-styled overwrite confirmation.",
  );

  assertNotContains(
    dragUploadSource,
    /arrayBuffer|getAsFile|file\.path|chunks|isChunked/,
    "Drag upload must not use renderer memory buffers, browser file.path, or chunk payloads.",
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
    /const resolvedLocalPath = path\.resolve\(fileData\.localPath\)[\s\S]*await fsp\.stat\(resolvedLocalPath\)[\s\S]*await fsp\.access\(resolvedLocalPath,\s*fs\.constants\.R_OK\)[\s\S]*stats\.isFile\(\)/,
    "Dropped upload service must stat, read-check, and require regular local files.",
  );

  assertContains(
    filemanagementServiceSource,
    /if\s*\(!folderData\.localPath\)[\s\S]*拖放文件夹缺少可验证的本地路径/,
    "Dropped upload service must reject folders without localPath.",
  );

  assertContains(
    filemanagementServiceSource,
    /const resolvedLocalPath = path\.resolve\(folderData\.localPath\)[\s\S]*await fsp\.stat\(resolvedLocalPath\)[\s\S]*await fsp\.access\(resolvedLocalPath,\s*fs\.constants\.R_OK\)[\s\S]*stats\.isDirectory\(\)[\s\S]*await fsp\.readdir\(resolvedLocalPath\)/,
    "Dropped upload service must stat, read-check, require, and enumerate local folders.",
  );

  assertContains(
    filemanagementServiceSource,
    /requestedRemoteDirectories/,
    "Upload service must accept validated directory creation requests for folder drops.",
  );

  assertContains(
    filemanagementServiceSource,
    /if\s*\(tasks\.length === 0\)/,
    "Upload service must complete directory-only drops without creating file upload tasks.",
  );

  assertContains(
    filemanagementServiceSource,
    /const\s*\{\s*SESSION_CONFIG,\s*TRANSFER_CONFIG\s*\}\s*=\s*require\("\.\.\/sftp\/sftpConfig"\)/,
    "Upload service concurrency must use the centralized SFTP transfer limits.",
  );

  assertContains(
    filemanagementServiceSource,
    /TRANSFER_CONFIG\?\.PARALLEL_FILES_UPLOAD/,
    "Upload service must cap upload task concurrency with PARALLEL_FILES_UPLOAD.",
  );

  assertContains(
    filemanagementServiceSource,
    /SESSION_CONFIG\?\.MAX_SESSIONS_PER_TAB/,
    "Upload service must cap upload task concurrency with MAX_SESSIONS_PER_TAB.",
  );

  assertContains(
    filemanagementServiceSource,
    /_chooseConcurrency\(\s*tasks\.length,\s*totalBytes,\s*true,\s*"upload",?\s*\)/,
    "Dropped folder uploads must select upload-specific transfer concurrency.",
  );

  assertContains(
    fileHandlersSource,
    /normalizeDroppedFolderRelativePath\(folderData\)/,
    "Remote overwrite preflight must use structured folder descriptors.",
  );

  assertNotContains(
    filemanagementServiceSource,
    /_extractDroppedFileBuffer|upload-buffer|fileData\.data|fileData\.chunks|Buffer\.concat\(chunks\)/,
    "Dropped upload service must not keep renderer-buffer upload paths.",
  );
}

function testNativeSftpExpectedFailureLogging() {
  assertContains(
    nativeSftpClientSource,
    /function isExpectedNativeFailure\(value,\s*options = \{\}\)/,
    "Native SFTP client must support caller-declared expected failures.",
  );

  assertContains(
    nativeSftpClientSource,
    /options\.expectedFailure\(value\) === true/,
    "Native SFTP expected-failure predicates must decide from the native result payload.",
  );

  assertContains(
    nativeSftpClientSource,
    /normalizeLogLevel\(options\.expectedFailureLevel,\s*"DEBUG"\)/,
    "Native SFTP expected failures must default to DEBUG logging.",
  );

  assertContains(
    nativeSftpClientSource,
    /const status = expectedFailure \? "expected error" : "error"/,
    "Native SFTP logs must distinguish expected probing results from real errors.",
  );

  assertContains(
    fileHandlersSource,
    /expectedFailure:\s*isDroppedRemoteNotFound/,
    "Dropped upload conflict probing must declare remote not-found as an expected result.",
  );

  assertContains(
    fileHandlersSource,
    /expectedFailureLevel:\s*"DEBUG"/,
    "Dropped upload conflict probing must log remote not-found probes at DEBUG.",
  );
}

function testIpcTraceLogPolicy() {
  assertContains(
    ipcTraceSource,
    /"terminal:startSSH":\s*2000/,
    "startSSH must use a channel-specific slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /startDirectoryWatch:\s*1000/,
    "Directory watch startup must use a channel-specific slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /checkDroppedUploadConflicts:\s*5000/,
    "Dropped upload conflict checks must allow multi-path probing before logging as slow.",
  );

  assertContains(
    ipcTraceSource,
    /uploadDroppedFiles:\s*5000/,
    "Dropped uploads must allow transfer setup work before logging as slow.",
  );

  assertContains(
    ipcTraceSource,
    /uploadFile:\s*5000/,
    "Manual file uploads must use a transfer-aware slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /uploadFolder:\s*5000/,
    "Manual folder uploads must use a transfer-aware slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /downloadFile:\s*5000/,
    "Single file downloads must use a transfer-aware slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /downloadFiles:\s*5000/,
    "Batch downloads must use a transfer-aware slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /downloadFolder:\s*5000/,
    "Folder downloads must use a transfer-aware slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /createFolder:\s*1000/,
    "createFolder must use a channel-specific slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /moveFile:\s*1000/,
    "moveFile must use a channel-specific slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /deleteFile:\s*1000/,
    "deleteFile must use a channel-specific slow IPC threshold.",
  );

  assertContains(
    ipcTraceSource,
    /const failed = outcome\.success === false/,
    "IPC trace log level must distinguish failed outcomes from slow successful outcomes.",
  );

  assertContains(
    ipcTraceSource,
    /failed\s*\?\s*"WARN"\s*:\s*durationMs >= trace\.slowThresholdMs\s*\?\s*"INFO"\s*:\s*"DEBUG"/,
    "Successful slow IPC traces must log at INFO while WARN remains reserved for failures.",
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
    [
      "native sftp expected failure logging",
      testNativeSftpExpectedFailureLogging,
    ],
    ["ipc trace log policy", testIpcTraceLogPolicy],
    ["native list and scroll conventions", testNativeListAndScrollConventions],
  ];

  tests.forEach(([name, fn]) => {
    fn();
    console.log(`PASS ${name}`);
  });

  console.log(`\n${tests.length} window native-feel checks passed.`);
}

run();
