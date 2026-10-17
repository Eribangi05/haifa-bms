/* EduSmart School Timetable - desktop wrapper.
   Opens the single-file planner (app/school-timetable.html) in its own window. The planner works fully offline and
   keeps its data in this app's own storage; "Save backup" / "Open backup" inside the planner move it between computers. */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600,
    title: 'EduSmart School Timetable',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  const page = path.join(__dirname, 'app', 'school-timetable.html');
  win.loadFile(page);
  // the planner is the only page: external links open in the browser, never inside this window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
