const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
    const win = new BrowserWindow({
        width: 1600,
        height: 960,
        minWidth: 1200,
        minHeight: 700,
        backgroundColor: '#161618',
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
    });

    win.loadFile('index.html');

    ipcMain.on('win-min', () => win.minimize());
    ipcMain.on('win-max', () => win.isMaximized() ? win.unmaximize() : win.maximize());
    ipcMain.on('win-close', () => win.close());

    // Save exported video
    ipcMain.handle('save-video', async (_e, arrayBuffer) => {
        const { filePath } = await dialog.showSaveDialog(win, {
            defaultPath: 'animation.webm',
            filters: [{ name: 'WebM Video', extensions: ['webm'] }],
        });
        if (!filePath) return { cancelled: true };
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
        return { saved: true, filePath };
    });

    ipcMain.handle('save-json', async (_e, json) => {
        const { filePath } = await dialog.showSaveDialog(win, {
            defaultPath: 'scene.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!filePath) return { cancelled: true };
        fs.writeFileSync(filePath, json);
        return { saved: true };
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
