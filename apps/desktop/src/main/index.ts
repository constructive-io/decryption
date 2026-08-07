import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, powerMonitor, session, shell } from 'electron';
import * as path from 'path';

import { CHANNELS } from '../shared/api';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { VaultService } from './vault-service';

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;

const APP_ICON = nativeImage.createFromPath(
  path.join(__dirname, '../../resources/icon.png')
);

const service = new VaultService();

/** Minutes of user idle time before the vault locks itself. */
const AUTO_LOCK_MINUTES = 10;

const lockAndNotify = async (window: BrowserWindow | null): Promise<void> => {
  await service.lock();
  if (window && !window.isDestroyed()) {
    window.webContents.send(CHANNELS.lockedEvent);
  }
};

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // the menu carries Back Up Vault, so it stays visible on Windows and Linux
    autoHideMenuBar: false,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // never leak vault contents into screen captures
  window.setContentProtection(true);

  window.once('ready-to-show', () => window.show());

  // deny everything a password manager never needs
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    // external links (item URLs) open in the system browser, never in-app
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return window;
};

let mainWindow: BrowserWindow | null = null;
let idleTimer: NodeJS.Timeout | null = null;

const watchIdle = (): void => {
  idleTimer = setInterval(() => {
    if (powerMonitor.getSystemIdleTime() >= AUTO_LOCK_MINUTES * 60) {
      void lockAndNotify(mainWindow);
    }
  }, 30_000);
};

app.whenReady().then(() => {
  // local-only app: default-deny all outbound network requests from the renderer
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed =
      url.startsWith('file://') ||
      url.startsWith('devtools://') ||
      (DEV_SERVER_URL !== undefined && url.startsWith(DEV_SERVER_URL)) ||
      (DEV_SERVER_URL !== undefined && url.startsWith('ws://localhost'));
    callback({ cancel: !allowed });
  });

  if (process.platform === 'darwin' && !APP_ICON.isEmpty()) {
    app.dock?.setIcon(APP_ICON);
  }

  ipcMain.handle(CHANNELS.themeGetSystemDark, (): boolean => nativeTheme.shouldUseDarkColors);
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(CHANNELS.themeSystemChanged, nativeTheme.shouldUseDarkColors);
    }
  });

  registerIpc(service);
  buildMenu(service, () => mainWindow, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(CHANNELS.lockedEvent);
    }
  });
  mainWindow = createWindow();
  watchIdle();

  powerMonitor.on('suspend', () => void lockAndNotify(mainWindow));
  powerMonitor.on('lock-screen', () => void lockAndNotify(mainWindow));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  void service.lock().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});

app.on('before-quit', () => {
  if (idleTimer) clearInterval(idleTimer);
  void service.lock();
});
