# EduSmart Lesson Plan Generator - Windows installer

An offline desktop app that drafts REB-format lesson plans for Primary 1 to 6 from the **2026-2027 REB schemes of work** and pupil books (the same data and generator as the Smart School App's lesson-plan screen, in its own window).

## Build the installer (Windows PC with Node.js LTS)
```powershell
cd lessonplan-installer
npm install
npm run dist
```
The installer is `dist\EduSmart-Lesson-Plan-Generator-Setup-1.0.0.exe` (unsigned: SmartScreen shows "More info > Run anyway"). Try without installing: `npm start`.

## Refresh the data (new REB documents, new content update)
The app bundles `app/lesson-plan-generator.html` (about 4.4 MB: 48 schemes of work, 4,105 book and teacher's-guide lessons, the generator and the logo). To rebuild it from the Smart School content tree and generator:
```powershell
cd lessonplan-installer\source
python make_data.py "C:\path\to\smart-school-app-android\app\src\main\assets\content"
python build.py "C:\path\to\smart-school-app-android\app\src\main\assets\renderer\lessonplan.js"
```
Defaults: both read the sibling `smart-school-app-android` folder. Needs Python 3 with `pillow`. Then raise `version` in `package.json` and run `npm run dist`.

## What the user sees
- A welcome screen, then a 4-step setup guide (school, teacher and usual class, how plans are built, finish). Reopen it with **Setup guide**.
- The REB lesson plan template in English, French or Kinyarwanda (it follows the subject), library of saved plans, "Plans for the whole unit", print / save as PDF, backup and restore.
- Plans are drafts to be reviewed and signed by the teacher.

## Notes
- Page references in plans say "PDF page N of the REB book", because the app's built-in reader does not exist here.
- About 4% of the scheme rows cover several lessons and keep a long combined title; edit the title after Auto-fill.
- The term calendar is 2026/2027 (`LP_CALENDAR` in the generator); update it for a new year.
