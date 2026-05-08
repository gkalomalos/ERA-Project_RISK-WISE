const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  clearTempDir: () => ipcRenderer.invoke("clear-temp-dir"),
  fetchTempDir: () => ipcRenderer.invoke("fetch-temp-dir"),
  fetchReportDir: () => ipcRenderer.invoke("fetch-report-dir"),
  isDevelopmentEnv: () => ipcRenderer.invoke("is-development-env"),
  send: (channel, data) => ipcRenderer.send(channel, data),
  subscribeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
  saveScreenshot: (blob, filePath) => ipcRenderer.invoke("save-screenshot", { blob, filePath }),
  copyFile: (sourcePath, destinationPath) =>
    ipcRenderer.invoke("copy-file", { sourcePath, destinationPath }),
  copyFolder: (sourceFolder, destinationFolder) =>
    ipcRenderer.invoke("copy-folder", { sourceFolder, destinationFolder }),
  openReport: (reportPath) => ipcRenderer.invoke("open-report", reportPath),
});

contextBridge.exposeInMainWorld("api", {
  runPythonScript: async ({ scriptName, data }) => {
    return await ipcRenderer.invoke("runPythonScript", { scriptName, data });
  },
});
