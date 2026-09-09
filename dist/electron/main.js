const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 5000;
let serverProcess = null;
let mainWindow = null;

function getAppPaths() {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  return {
    dbPath: path.join(userData, 'codelens.db'),
    storagePath: path.join(userData, 'projects'),
  };
}

function startServer() {
  return new Promise((resolve) => {
    const { dbPath, storagePath } = getAppPaths();
    fs.mkdirSync(storagePath, { recursive: true });

    const env = {
      ...process.env,
      PORT: String(PORT),
      DATABASE_PATH: dbPath,
      STORAGE_PATH: storagePath,
      NODE_ENV: 'production',
      ELECTRON: '1',
    };

    const isPackaged = app.isPackaged;

    if (isPackaged) {
      // App empacotado: usa server.js compilado
      const serverJs = path.join(process.resourcesPath, 'server.js');
      serverProcess = spawn(process.execPath, [serverJs], { env, stdio: 'pipe' });
    } else {
      // Desenvolvimento: usa tsx
      const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');
      const serverTs = path.join(__dirname, '..', 'server.ts');
      serverProcess = spawn(tsxBin, [serverTs], { env, stdio: 'pipe', cwd: path.join(__dirname, '..') });
    }

    let resolved = false;

    function tryResolve() {
      if (!resolved) { resolved = true; resolve(); }
    }

    serverProcess.stdout.on('data', (data) => {
      const txt = data.toString();
      if (txt.includes('CodeLens') || txt.includes('running') || txt.includes('rodando')) {
        setTimeout(tryResolve, 500);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const txt = data.toString();
      if (txt.includes('rodando') || txt.includes('running') || txt.includes('5000')) {
        setTimeout(tryResolve, 500);
      }
    });

    serverProcess.on('error', () => tryResolve());

    // Fallback: abre em 5 segundos
    setTimeout(tryResolve, 5000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'CodeLens',
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Abrir links externos no browser padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  if (process.platform !== 'darwin') app.quit();
});
