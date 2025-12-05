const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");

global.pythonProcess = null;

const basePath = app.getAppPath();
let mainWindow;
let loaderWindow;
let userLogDir;

const isDevelopmentEnv = () => {
  return !app.isPackaged;
};

const cleanupPython = () => {
  if (global.pythonProcess && !global.pythonProcess.killed) {
    try {
      global.pythonProcess.kill();
      log.info("[electron] Python process terminated in cleanup");
    } catch (error) {
      log.error("[electron] error killing Python process in cleanup:", error);
    }
  }
  global.pythonProcess = null;
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, _commandLine, _workingDirectory) => {
    // If second instance is instantiated, the app focuses on the current window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Removed: avoid forcing GPU flags unless strictly needed.
// app.commandLine.appendSwitch("in-process-gpu");
if (app.getGPUFeatureStatus().gpu_compositing.includes("disabled")) {
  app.disableHardwareAcceleration();
}

app.whenReady().then(async () => {
  try {
    userLogDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(userLogDir, { recursive: true });
    log.transports.file.resolvePathFn = () => path.join(userLogDir, "app.log");
    log.transports.file.maxSize = 1024 * 1024;
    log.initialize();
    autoUpdater.logger = log;
    log.info(`Starting RISKWISE ${app.getVersion()}. Packaged: ${app.isPackaged}`);
  } catch (error) {
    console.error("Failed to initialize logging:", error);
  }

  createLoaderWindow();

  let pythonReady = false;

  // Start the Python backend process
  try {
    log.info("[electron] creating Python process...");
    global.pythonProcess = createPythonProcess();
    await waitForPythonProcessReady(global.pythonProcess);
    pythonReady = true;
  } catch (error) {
    log.error("[electron] Failed to start Python process:", error);
    pythonReady = false;

    // Show non-blocking warning to user
    dialog
      .showMessageBox({
        type: "warning",
        title: "RISKWISE Warning",
        message:
          "Application engine failed to start. Some features may not work correctly.\n\nLogs: " +
          userLogDir,
        buttons: ["Continue Anyway", "Exit"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 1) app.quit();
      });
  }

  // Clear temporary directory on startup
  if (pythonReady) {
    try {
      log.info("[electron] clearing temp directory...");
      await runPythonScript(mainWindow, "run_clear_temp_dir.py", {});
    } catch (error) {
      log.error("[electron] error clearing temp directory:", error);
    }
  } else {
    log.warn("[electron] skipping temp directory clear - Python not ready");
  }

  // Close loader window and open main window
  try {
    if (loaderWindow && !loaderWindow.isDestroyed()) {
      loaderWindow.close();
    }
    loaderWindow = null;
  } catch (error) {
    log.error("[electron] error closing loader window:", error);
  }

  // Check for updates (non-blocking)
  if (!isDevelopmentEnv()) {
    try {
      log.info("[electron] checking for updates...");
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "gkalomalos",
        repo: "ERA-Project_RISK-WISE",
        releaseType: "release",
      });

      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        log.error("[electron] updater check failed:", err);
      });
    } catch (error) {
      log.error("[electron] failed to initialize auto-updater:", error);
    }
  }

  createMainWindow();
});

const createLoaderWindow = () => {
  try {
    const iconPath = path.join(basePath, "build", "favicon.ico");

    loaderWindow = new BrowserWindow({
      height: 200,
      width: 300,
      center: true,
      alwaysOnTop: true,
      frame: false,
      resizable: false,
      autoHideMenuBar: true,
      icon: iconPath,
      webPreferences: {
        nodeIntegration: false,
      },
    });

    const loaderPath = path.join(basePath, "build", "loader.html");
    loaderWindow.loadFile(loaderPath);
  } catch (error) {
    log.error("[electron] failed to create loader window:", error);
  }
};

const waitForPythonProcessReady = (pythonProcess, timeoutMs = 300000) => {
  return new Promise((resolve, reject) => {
    if (!pythonProcess) {
      return reject(new Error("Application engine process handle is null"));
    }

    const handleData = (data) => {
      const message = data.toString().trim();
      try {
        const event = JSON.parse(message);
        if (event.type === "event" && event.name === "ready") {
          clearTimeout(timeout);
          pythonProcess.stdout.off("data", handleData);
          pythonProcess.off("error", onError);
          resolve();
        }
      } catch {
        // Ignore non-JSON output from Python
      }
    };

    const onError = (error) => {
      clearTimeout(timeout);
      pythonProcess.stdout.off("data", handleData);
      pythonProcess.off("error", onError);
      reject(error);
    };

    const timeout = setTimeout(() => {
      pythonProcess.stdout.off("data", handleData);
      pythonProcess.off("error", onError);
      reject(new Error(`Application engine did not respond within ${timeoutMs / 1000}s`));
    }, timeoutMs);

    pythonProcess.stdout.on("data", handleData);
    pythonProcess.on("error", onError);
  });
};

const createMainWindow = () => {
  try {
    const iconPath = path.join(basePath, "build", "favicon.ico");

    mainWindow = new BrowserWindow({
      minHeight: 720,
      minWidth: 1280,
      frame: false,
      resizable: true,
      autoHideMenuBar: true,
      thickFrame: true,
      icon: iconPath,
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        enableRemoteModule: false,
        preload: path.join(basePath, "build", "preload.js"),
        webSecurity: true,
        // Disable Node integration in the renderer process for security and compatibility.
        // With nodeIntegration: true, libraries like use-sync-external-store may try to
        // resolve React via CommonJS require(), which breaks in a Vite/ESM build.
        // Setting this to false ensures React (and other frontend libs) run in a proper
        // browser-like environment and forces all backend access through preload.js.
        nodeIntegration: false,
      },
    });

    mainWindow.show();
    mainWindow.maximize();
    mainWindow.loadFile(path.join(basePath, "build", "index.html"));

    if (isDevelopmentEnv()) {
      mainWindow.webContents.openDevTools();
    }

    // Pipe renderer console messages into unified log
    mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      const lvl = level === 2 ? "warn" : level === 3 ? "error" : "info";
      const text = `[renderer] ${message} (${sourceId}:${line})`;
      if (lvl === "warn") log.warn(text);
      else if (lvl === "error") log.error(text);
      else log.info(text);
    });
  } catch (error) {
    log.error("[electron] failed to create main window:", error);

    // Critical error - show dialog and quit
    dialog.showErrorBox(
      "Startup Error",
      "Failed to create main window. Error: " + error.message + "\n\nLogs at: " + userLogDir
    );
    app.quit();
  }
};

const runPythonScript = (mainWindow, scriptName, data) => {
  return new Promise((resolve, reject) => {
    if (!global.pythonProcess || global.pythonProcess.killed) {
      return reject(new Error("Python process is not running"));
    }

    let buffer = "";
    const message = { scriptName, data };

    try {
      global.pythonProcess.stdin.write(JSON.stringify(message) + "\n");
    } catch (error) {
      return reject(error);
    }

    const handleData = (dataChunk) => {
      buffer += dataChunk.toString();
      let boundary = buffer.indexOf("\n");

      while (boundary !== -1) {
        const rawData = buffer.substring(0, boundary);
        buffer = buffer.substring(boundary + 1);

        if (rawData.trim().startsWith("{") || rawData.trim().startsWith("[")) {
          try {
            const response = JSON.parse(rawData);
            if (response.type === "progress") {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("progress", response);
              }
            } else {
              global.pythonProcess.stdout.off("data", handleData);
              if (response.success) {
                resolve(response.result);
              } else {
                reject(new Error(response.error));
              }
            }
          } catch (error) {
            global.pythonProcess.stdout.off("data", handleData);
            log.error("Error parsing Python stdout:", error.message);
            reject(error);
          }
        }

        boundary = buffer.indexOf("\n");
      }
    };

    global.pythonProcess.stdout.on("data", handleData);
  });
};

// Create a long-running Python process
const createPythonProcess = () => {
  const scriptPath = path.join(basePath, "backend", "app.py");

  // Engine is installed under APPDATA by the NSIS installer:
  // %APPDATA%\RiskWiseEngine\climada_env\python.exe
  const engineRoot = app.getPath("appData");
  const enginePath = path.join(engineRoot, "RiskWiseEngine", "climada_env");
  const pythonExecutable = path.join(enginePath, "python.exe");

  if (!fs.existsSync(pythonExecutable)) {
    throw new Error("Python executable not found at: " + pythonExecutable);
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error("Python script not found at: " + scriptPath);
  }

  try {
    const py = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, LOG_DIR: userLogDir },
    });

    py.on("error", (error) => log.error("Python spawn error:", error.message));
    py.on("exit", (code, signal) => log.warn("Python exited. Code:", code, "Signal:", signal));
    py.stderr.on("data", (data) => log.error(`[python] ${data.toString().trim()}`));

    log.info("[electron] Python process spawned with PID:", py.pid);
    return py;
  } catch (error) {
    log.error("[electron] error during Python process creation:", error);
    throw error;
  }
};

ipcMain.handle("runPythonScript", async (_evt, { scriptName, data }) => {
  try {
    if (!global.pythonProcess || global.pythonProcess.killed) {
      log.error("[electron] Python process not available for script:", scriptName);
      return {
        success: false,
        error: "Python backend is not running. Please restart the application.",
      };
    }

    const result = await runPythonScript(mainWindow, scriptName, data);
    return { success: true, result };
  } catch (error) {
    log.error("[electron] runPythonScript error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("is-development-env", () => {
  return !app.isPackaged;
});

ipcMain.handle("fetch-temp-dir", () => {
  const tempFolderPath = path.join(app.getAppPath(), "data", "temp");
  return tempFolderPath;
});

ipcMain.handle("fetch-report-dir", () => {
  const reportFolderPath = path.join(app.getAppPath(), "data", "reports");
  return reportFolderPath;
});

ipcMain.handle("fetch-log-dir", () => {
  return userLogDir || path.join(app.getPath("userData"), "logs");
});

// Handle clear temporary directory request
ipcMain.handle("clear-temp-dir", async () => {
  try {
    if (!global.pythonProcess || global.pythonProcess.killed) {
      log.error("[electron] Python process not available for clearing temp dir");
      return {
        success: false,
        error: "Python backend is not running",
      };
    }

    const scriptName = "run_clear_temp_dir.py";
    const data = {};
    const result = await runPythonScript(mainWindow, scriptName, data);
    log.info("[electron] Temporary directory cleared:", result.message);
    return { success: true, result };
  } catch (error) {
    log.error("[electron] Failed to clear temporary directory:", error);
    return { success: false, error: error.message };
  }
});

// Handle save screenshot request
ipcMain.handle("save-screenshot", async (event, { blob, filePath }) => {
  try {
    const buffer = Buffer.from(blob, "base64");
    const dir = path.dirname(filePath);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);

    event.sender.send("save-screenshot-reply", { success: true, filePath });
    log.info("[electron] screenshot saved:", filePath);
  } catch (error) {
    log.error("[electron] failed to save screenshot:", error);
    event.sender.send("save-screenshot-reply", { success: false, error: error.message });
  }
});

// Handle folder copy request
ipcMain.handle("copy-folder", async (event, { sourceFolder, destinationFolder }) => {
  try {
    fs.mkdirSync(destinationFolder, { recursive: true });
    const files = fs.readdirSync(sourceFolder);

    for (const file of files) {
      const sourcePath = path.join(sourceFolder, file);
      const destinationPath = path.join(destinationFolder, file);
      fs.copyFileSync(sourcePath, destinationPath);
    }

    event.sender.send("copy-folder-reply", { success: true, destinationFolder });
    log.info("[electron] folder copied:", sourceFolder, "->", destinationFolder);
  } catch (error) {
    log.error("[electron] failed to copy folder:", error);
    event.sender.send("copy-folder-reply", { success: false, error: error.message });
  }
});

// Handle copy file from temp folder request
ipcMain.handle("copy-file", async (event, { sourcePath, destinationPath }) => {
  try {
    const dir = path.dirname(destinationPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);

    event.sender.send("copy-file-reply", { success: true, destinationPath });
    log.info("[electron] file copied:", sourcePath, "->", destinationPath);
  } catch (error) {
    log.error("[electron] failed to copy file:", error);
    event.sender.send("copy-file-reply", { success: false, error: error.message });
  }
});

ipcMain.handle("open-report", async (_event, reportPath) => {
  try {
    await shell.openPath(reportPath);
    log.info("[electron] opened report:", reportPath);
  } catch (error) {
    log.error("[electron] failed to open report:", error);
  }
});

ipcMain.on("minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on("shutdown", () => {
  log.info("[electron] shutting down application...");
  cleanupPython();
  app.quit();
});

ipcMain.on("reload", async () => {
  log.info("[electron] reload CLIMADA App...");

  if (global.pythonProcess && !global.pythonProcess.killed) {
    try {
      const result = await runPythonScript(mainWindow, "run_clear_temp_dir.py", {});
      log.info("[electron] Temporary directory cleared:", result.message);
    } catch (error) {
      log.error("[electron] failed to clear temporary directory:", error);
    }
  } else {
    log.warn("[electron] skipping temp clear on reload - Python not running");
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
});

// Auto-update event handlers
autoUpdater.on("update-not-available", () => {
  log.info("[electron] no update available");
});

autoUpdater.on("download-progress", (p) => {
  log.info(`[electron] downloading ${p.percent.toFixed(1)}% (${p.transferred}/${p.total})`);
});

autoUpdater.on("update-available", () => {
  log.info("[electron] update available");
  try {
    dialog.showMessageBox({
      type: "info",
      title: "Update available",
      message: "A new version is available and will be downloaded in the background.",
    });
  } catch (error) {
    log.error("[electron] failed to show update dialog:", error);
  }
});

autoUpdater.on("update-downloaded", () => {
  log.info("[electron] update downloaded");
  try {
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready",
        message: "Update downloaded. Restart now to apply?",
        buttons: ["Restart", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  } catch (error) {
    log.error("[electron] failed to show update ready dialog:", error);
  }
});

autoUpdater.on("error", (err) => {
  log.error("[electron] AutoUpdater error:", err);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", () => {
  log.info("[electron] terminating Python process before app quits...");
  cleanupPython();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// extra safety: handle crashes / signals
process.on("uncaughtException", (err) => {
  log.error("[electron] uncaughtException:", err);
  cleanupPython();
  app.quit();
});

process.on("unhandledRejection", (reason) => {
  log.error("[electron] unhandledRejection:", reason);
  cleanupPython();
  app.quit();
});

process.on("SIGINT", () => {
  log.info("[electron] SIGINT received");
  cleanupPython();
  app.quit();
});

process.on("SIGTERM", () => {
  log.info("[electron] SIGTERM received");
  cleanupPython();
  app.quit();
});
