const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater, NsisUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");

// ---------------------------------------------------------------------------
// Engine artifact (Python runtime + CLIMADA). Hosted on a dedicated release
// tag, decoupled from app version tags, so app releases can be cleaned up
// without breaking engine bootstrap.
//
// KEEP IN SYNC with installer/installer.nsh (search ENGINE_RELEASE_TAG).
// When changing the engine, bump the tag here AND in the installer, then
// update ENGINE_SHA256 to match the new archive.
// ---------------------------------------------------------------------------
const ENGINE_RELEASE_TAG = "engine-v1";
const ENGINE_DOWNLOAD_URL = `https://github.com/gkalomalos/ERA-Project_RISK-WISE/releases/download/${ENGINE_RELEASE_TAG}/RiskWiseEngine.zip`;
const ENGINE_SHA256_URL = `${ENGINE_DOWNLOAD_URL}.sha256`;

global.pythonProcess = null;

const basePath = app.getAppPath();
let mainWindow;
let loaderWindow;
let userLogDir;
let userDataDir;

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

const updateLoaderMessage = (message) => {
  if (loaderWindow && !loaderWindow.isDestroyed()) {
    loaderWindow.webContents.executeJavaScript(`
      document.body.innerHTML = \`
        <div style="text-align: center; color: white; font-family: Arial, sans-serif;">
          <img src="gear-loader.svg" alt="loading..." style="width: 60px; height: 60px; margin-bottom: 12px;">
          <h3 style="margin: 0 0 6px 0; font-size: 15px;">Starting RISK WISE</h3>
          <p style="margin: 0; font-size: 12px;">${message}</p>
        </div>
      \`;
    `);
  }
};

const downloadAndInstallEngine = async (_loaderWindow) => {
  const engineRoot = process.env.LOCALAPPDATA;
  if (!engineRoot) {
    throw new Error("Failed to resolve LOCALAPPDATA environment variable");
  }

  const enginePath = path.join(engineRoot, "RiskWiseEngine");
  const pythonExecutable = path.join(enginePath, "python.exe");
  const archivePath = path.join(engineRoot, "RiskWiseEngine.zip");

  // Check if already installed
  if (fs.existsSync(pythonExecutable)) {
    log.info("[electron] Python engine already installed at:", enginePath);
    return pythonExecutable;
  }

  log.info("[electron] Python engine not found, downloading...");
  log.info("[electron] Archive will be downloaded to:", archivePath);

  try {
    updateLoaderMessage("RISK WISE Engine is missing. Downloading...");

    // Use electron's net module
    const { net } = require("electron");
    const engineUrl = ENGINE_DOWNLOAD_URL;

    await new Promise((resolve, reject) => {
      const request = net.request(engineUrl);
      const file = fs.createWriteStream(archivePath);

      request.on("response", (response) => {
        const totalBytes = parseInt(response.headers["content-length"], 10);
        let downloadedBytes = 0;

        log.info(`[electron] Starting download, size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          file.write(chunk);

          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);

          // Update UI every 10%
          if (
            Math.floor(percent / 10) >
            Math.floor((((downloadedBytes - chunk.length) / totalBytes) * 100) / 10)
          ) {
            updateLoaderMessage(`Downloading engine... ${percent}%`);
            log.info(`[electron] Downloaded: ${percent}%`);
          }
        });

        response.on("end", () => {
          file.end();
          file.close();
          log.info("[electron] Download complete, file size:", fs.statSync(archivePath).size);
          resolve();
        });

        response.on("error", (err) => {
          file.close();
          if (fs.existsSync(archivePath)) {
            fs.unlinkSync(archivePath);
          }
          reject(err);
        });
      });

      request.on("error", (err) => {
        file.close();
        if (fs.existsSync(archivePath)) {
          fs.unlinkSync(archivePath);
        }
        reject(err);
      });

      request.end();
    });

    // Verify download
    if (!fs.existsSync(archivePath)) {
      throw new Error("Archive file not found after download");
    }

    const archiveSize = fs.statSync(archivePath).size;
    log.info(`[electron] Archive downloaded: ${(archiveSize / 1024 / 1024).toFixed(2)} MB`);

    if (archiveSize < 10 * 1024 * 1024) {
      throw new Error(
        `Archive too small (${(archiveSize / 1024 / 1024).toFixed(2)} MB) - download failed`
      );
    }

    updateLoaderMessage("Verifying engine archive...");
    log.info("[electron] fetching expected SHA-256 from:", ENGINE_SHA256_URL);

    const expectedSha256 = await new Promise((resolve, reject) => {
      const req = net.request(ENGINE_SHA256_URL);
      let body = "";
      req.on("response", (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SHA-256 sidecar returned HTTP ${res.statusCode}`));
          return;
        }
        res.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => resolve(body.trim().toLowerCase()));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });

    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new Error(`Malformed SHA-256 sidecar contents: ${expectedSha256.slice(0, 80)}`);
    }

    const crypto = require("crypto");
    const actualSha256 = await new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(archivePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });

    if (actualSha256 !== expectedSha256) {
      log.error(
        `[electron] engine SHA-256 mismatch. expected=${expectedSha256} actual=${actualSha256}`
      );
      try {
        fs.unlinkSync(archivePath);
      } catch {
        /* best-effort cleanup */
      }
      throw new Error(
        "Engine archive integrity check failed (SHA-256 mismatch). The download may be corrupted or tampered. Please retry."
      );
    }
    log.info("[electron] engine SHA-256 verified:", actualSha256);

    updateLoaderMessage("Extracting engine files...");
    log.info("[electron] Starting extraction...");

    // Extract archive
    const { execSync } = require("child_process");

    // Clean and create engine directory
    if (fs.existsSync(enginePath)) {
      log.info("[electron] Removing existing engine directory");
      fs.rmSync(enginePath, { recursive: true, force: true });
    }
    fs.mkdirSync(enginePath, { recursive: true });

    // Extract using tar
    log.info("[electron] Extracting to:", enginePath);
    const extractCmd = `tar -xf "${archivePath}" -C "${enginePath}"`;

    execSync(extractCmd, { stdio: "pipe" });

    // Check extracted contents
    const extracted = fs.readdirSync(enginePath);
    log.info("[electron] Extracted top-level items:", extracted);

    // If archive contains a single directory, flatten structure
    if (extracted.length === 1 && fs.statSync(path.join(enginePath, extracted[0])).isDirectory()) {
      const subDir = path.join(enginePath, extracted[0]);
      log.info("[electron] Flattening nested directory:", subDir);

      const items = fs.readdirSync(subDir);

      for (const item of items) {
        const srcPath = path.join(subDir, item);
        const destPath = path.join(enginePath, item);
        fs.renameSync(srcPath, destPath);
      }

      fs.rmdirSync(subDir);
      log.info("[electron] Structure flattened");
    }

    // Clean up archive
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
      log.info("[electron] Cleaned up archive file");
    }

    // Verify installation
    if (!fs.existsSync(pythonExecutable)) {
      const contents = fs.readdirSync(enginePath).slice(0, 10);
      log.error("[electron] python.exe not found. Directory contains:", contents);
      throw new Error(`Installation incomplete - python.exe not found at: ${pythonExecutable}`);
    }

    updateLoaderMessage("Engine installed successfully!");
    log.info("[electron] Python engine installed successfully");

    return pythonExecutable;
  } catch (error) {
    log.error("[electron] Failed to download/install Python engine:", error);

    dialog.showErrorBox(
      "Installation Error",
      `Failed to install RISK WISE engine.\n\nError: ${error.message}\n\nPlease check:\n- Internet connection\n- Available disk space (~2 GB)\n- Antivirus not blocking download\n\nLogs: ${userLogDir}`
    );

    throw error;
  }
};

app.whenReady().then(async () => {
  try {
    userLogDir = path.join(app.getPath("userData"), "logs");
    userDataDir = app.getPath("userData");
    log.info("[electron] user data dir:", userDataDir);
    log.info("[electron] user log dir:", userLogDir);
    fs.mkdirSync(userLogDir, { recursive: true });
    log.transports.file.resolvePathFn = () => path.join(userLogDir, "app.log");
    log.transports.file.maxSize = 1024 * 1024;
    log.initialize();
    autoUpdater.logger = log;
    log.info(`Starting RISKWISE ${app.getVersion()}. Packaged: ${app.isPackaged}`);
  } catch (error) {
    console.error("Failed to initialize logging:", error);
  }

  // Configure auto-updater BEFORE any other startup logic
  if (!isDevelopmentEnv()) {
    try {
      log.info("[electron] configuring auto-updater...");

      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.allowDowngrade = false;
      autoUpdater.allowPrerelease = false;

      autoUpdater.setFeedURL({
        provider: "github",
        owner: "gkalomalos",
        repo: "ERA-Project_RISK-WISE",
        releaseType: "release",
      });

      if (NsisUpdater.prototype.verifySignature) {
        NsisUpdater.prototype.verifySignature = async () => null;
        log.warn("[electron] Signature verification disabled (self-signed certificate)");
      }

      log.info(
        "[electron] auto-updater configured (autoDownload=false, autoInstallOnAppQuit=false)"
      );
    } catch (error) {
      log.error("[electron] failed to configure auto-updater:", error);
    }
  }

  createLoaderWindow();

  // Give loader window time to render
  await new Promise((resolve) => setTimeout(resolve, 100));

  updateLoaderMessage("Initializing application...");

  let pythonReady = false;

  // Start the Python backend process
  try {
    updateLoaderMessage("Starting application engine...");
    log.info("[electron] creating Python process...");
    global.pythonProcess = await createPythonProcess();

    updateLoaderMessage("Waiting for engine to be ready...");
    await waitForPythonProcessReady(global.pythonProcess);
    pythonReady = true;
  } catch (error) {
    log.error("[electron] Failed to start Python process:", error);
    pythonReady = false;

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
      updateLoaderMessage("Clearing temporary files...");
      log.info("[electron] clearing temp directory...");
      await runPythonScript(null, "run_clear_temp_dir.py", {});
    } catch (error) {
      log.error("[electron] error clearing temp directory:", error);
    }
  } else {
    log.warn("[electron] skipping temp directory clear - Python not ready");
  }

  updateLoaderMessage("Loading application...");

  // Close loader window and open main window
  try {
    if (loaderWindow && !loaderWindow.isDestroyed()) {
      loaderWindow.close();
    }
    loaderWindow = null;
  } catch (error) {
    log.error("[electron] error closing loader window:", error);
  }

  createMainWindow();

  // Check for updates AFTER main window is created
  if (!isDevelopmentEnv()) {
    try {
      log.info("[electron] checking for updates...");
      autoUpdater.checkForUpdates().catch((err) => {
        log.error("[electron] updater check failed:", err);
      });
    } catch (error) {
      log.error("[electron] failed to check for updates:", error);
    }
  }
});

const createLoaderWindow = () => {
  try {
    const iconPath = path.join(basePath, "build", "icon.ico");

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
    const iconPath = path.join(basePath, "build", "icon.ico");

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

        if (rawData.trim() === "") {
          boundary = buffer.indexOf("\n");
          continue;
        }

        let response;
        try {
          response = JSON.parse(rawData);
        } catch {
          log.warn(`[python:stdout] ${rawData}`);
          boundary = buffer.indexOf("\n");
          continue;
        }

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
          return;
        }

        boundary = buffer.indexOf("\n");
      }
    };

    global.pythonProcess.stdout.on("data", handleData);
  });
};

// Create a long-running Python process
const createPythonProcess = async () => {
  const scriptPath = path.join(basePath, "backend", "app.py");

  // Engine is installed under %LOCALAPPDATA%\RiskWiseEngine\python.exe
  const engineRoot = process.env.LOCALAPPDATA;
  if (!engineRoot) {
    throw new Error("Failed to resolve LOCALAPPDATA environment variable");
  }

  const enginePath = path.join(engineRoot, "RiskWiseEngine");
  let pythonExecutable = path.join(enginePath, "python.exe");

  // Download and install engine if missing
  if (!fs.existsSync(pythonExecutable)) {
    log.info("[electron] Python engine not found, initiating download...");
    pythonExecutable = await downloadAndInstallEngine(loaderWindow);
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error("Python script not found at: " + scriptPath);
  }

  try {
    const py = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        LOG_DIR: userLogDir,
        RISKWISE_USER_DATA: userDataDir,
      },
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
  return path.join(userDataDir, "data", "temp");
});

ipcMain.handle("fetch-report-dir", () => {
  return path.join(userDataDir, "data", "reports");
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
ipcMain.handle("save-screenshot", async (_event, { blob, filePath }) => {
  try {
    const buffer = Buffer.from(blob, "base64");
    const dir = path.dirname(filePath);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);

    log.info("[electron] screenshot saved:", filePath);
    return { success: true, filePath };
  } catch (error) {
    log.error("[electron] failed to save screenshot:", error);
    return { success: false, error: error.message };
  }
});

// Handle folder copy request
ipcMain.handle("copy-folder", async (_event, { sourceFolder, destinationFolder }) => {
  try {
    fs.mkdirSync(destinationFolder, { recursive: true });
    const files = fs.readdirSync(sourceFolder);

    for (const file of files) {
      const sourcePath = path.join(sourceFolder, file);
      const destinationPath = path.join(destinationFolder, file);
      fs.copyFileSync(sourcePath, destinationPath);
    }

    log.info("[electron] folder copied:", sourceFolder, "->", destinationFolder);
    return { success: true, destinationFolder };
  } catch (error) {
    log.error("[electron] failed to copy folder:", error);
    return { success: false, error: error.message };
  }
});

// Handle copy file from temp folder request
ipcMain.handle("copy-file", async (_event, { sourcePath, destinationPath }) => {
  try {
    const dir = path.dirname(destinationPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);

    log.info("[electron] file copied:", sourcePath, "->", destinationPath);
    return { success: true, destinationPath };
  } catch (error) {
    log.error("[electron] failed to copy file:", error);
    return { success: false, error: error.message };
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
  log.info("[electron] reloading RISK WISE renderer...");

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

autoUpdater.on("update-available", async (info) => {
  log.info("[electron] update available:", info?.version);

  try {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Update Available",
      message: `A new version (${info?.version ?? "unknown"}) is available. Download now?`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      log.info("[electron] user accepted download");
      autoUpdater.downloadUpdate().catch((err) => {
        log.error("[electron] downloadUpdate failed:", err);
        dialog.showErrorBox("Update Error", "Failed to download update: " + err.message);
      });
    } else {
      log.info("[electron] user declined download - will prompt on next start");
    }
  } catch (error) {
    log.error("[electron] failed to show update dialog:", error);
  }
});

autoUpdater.on("update-downloaded", async () => {
  log.info("[electron] update downloaded successfully");

  try {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Update Ready",
      message: "Update has been downloaded. Restart now to install?",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      log.info("[electron] user accepted installation - restarting");
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    } else {
      log.info("[electron] user declined installation - will prompt on next start");
      // User chose "Later" - the update stays cached and will be prompted again on next launch
      // No need to clear cache here - electron-updater handles re-prompting
    }
  } catch (error) {
    log.error("[electron] failed to show update ready dialog:", error);
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

autoUpdater.on("error", (err) => {
  // Don't show dialog to user - just log it
  log.error("[electron] AutoUpdater error:", err);
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
