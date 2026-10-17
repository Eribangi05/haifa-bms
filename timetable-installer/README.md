# EduSmart School Timetable - Windows installer

Wraps `app/school-timetable.html` (the standalone, offline planner) in an Electron window and builds a Windows installer.

## Build (on a Windows PC with Node.js LTS)
```powershell
cd timetable-installer
npm install
npm run dist
```
The installer is `dist\EduSmart-School-Timetable-Setup-1.0.0.exe` (unsigned: SmartScreen shows "More info > Run anyway").

## Try it without installing
```powershell
npm start
```

## Updating the planner
Replace `app/school-timetable.html` with the newest build, raise `version` in `package.json`, then run `npm run dist` again.

## What the user sees
- Installer: Rwanda-colour welcome and finish pages (flag-proportion bands, EduSmart mark), choose-folder page, desktop and Start-menu shortcuts, launches the app when finished.
- First launch: a full-screen welcome (Set up my school / Try the example school / Open a backup), then a 7-step setup guide: School, Levels, School day, Classes, Teachers, Rooms, Finish. Reopen it any time with the **Setup guide** button.
- Installer images are generated from the brand mark (`build/installerSidebar.bmp`, `installerHeader.bmp`); replace them to rebrand.
