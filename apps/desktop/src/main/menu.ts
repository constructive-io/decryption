import { app, BrowserWindow, dialog, Menu, MenuItemConstructorOptions, shell } from 'electron';

import { backupVault, restoreVault } from './backup';
import { VaultService } from './vault-service';

const isMac = process.platform === 'darwin';

/**
 * The application menu. Backup lives here rather than only in Settings so it
 * is findable where people look for it, and so it works while the vault is
 * locked — the file is encrypted either way.
 */
export const buildMenu = (
  service: VaultService,
  getWindow: () => BrowserWindow | null,
  onLocked: () => void
): void => {
  const report = async (
    action: () => Promise<{ path: string | null; replaced?: string | null }>,
    describe: (result: { path: string; replaced?: string | null }) => {
      message: string;
      detail: string;
    }
  ): Promise<void> => {
    const window = getWindow();
    try {
      const result = await action();
      if (!result.path) return;
      const { message, detail } = describe({ path: result.path, replaced: result.replaced });
      const options = { type: 'info' as const, message, detail, buttons: ['OK'] };
      if (window) await dialog.showMessageBox(window, options);
      else await dialog.showMessageBox(options);
    } catch (err) {
      dialog.showErrorBox('dcrypt', err instanceof Error ? err.message : String(err));
    }
  };

  const backup: MenuItemConstructorOptions = {
    label: 'Back Up Vault…',
    accelerator: 'CmdOrCtrl+Shift+B',
    click: () =>
      void report(
        () => backupVault(service, getWindow()),
        ({ path }) => ({
          message: 'Vault backed up',
          detail: `Saved an encrypted copy to:\n${path}\n\nIt can only be opened with your master password, so it is safe to keep in iCloud Drive, OneDrive, Dropbox or on a USB stick.`,
        })
      ),
  };

  const restore: MenuItemConstructorOptions = {
    label: 'Restore from Backup…',
    click: () =>
      void report(
        async () => {
          const result = await restoreVault(service, getWindow());
          if (result.path) onLocked();
          return result;
        },
        ({ path, replaced }) => ({
          message: 'Vault restored',
          detail: [
            `Restored from:\n${path}`,
            replaced ? `\nThe vault it replaced was kept as:\n${replaced}` : '',
            '\nUnlock with the master password that backup was made with.',
          ].join('\n'),
        })
      ),
  };

  const lock: MenuItemConstructorOptions = {
    label: 'Lock Vault',
    accelerator: 'CmdOrCtrl+L',
    click: () => {
      void service.lock().then(onLocked);
    },
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        backup,
        restore,
        { type: 'separator' },
        lock,
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'dcrypt on GitHub',
          click: () => void shell.openExternal('https://github.com/constructive-io/decryption'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
