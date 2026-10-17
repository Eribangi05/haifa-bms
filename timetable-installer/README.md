# EduSmart School Timetable - Windows installer

Wraps `app/school-timetable.html` (the standalone, offline planner) in an Electron window and builds a Windows installer.

## Build (on a Windows PC with Node.js LTS)
```powershell
cd timetable-installer
npm install
npm run dist
```
The installer is `dist\EduSmart School Timetable Setup 1.0.0.exe` (unsigned: SmartScreen shows "More info > Run anyway").

## Try it without installing
```powershell
npm start
```

## Updating the planner
Replace `app/school-timetable.html` with the newest build, raise `version` in `package.json`, then run `npm run dist` again.
