// Test helper: choose a date in the app's calendar picker the way a person does (open the field, step years and months, tap the day).
const EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export async function pickDate(page, testID, iso) {
  const [y, m] = iso.split('-').map(Number);
  await page.getByTestId(testID).click();
  for (let i = 0; i < 60; i++) {
    const m2 = /^(\w+) (\d{4})$/.exec((await page.getByTestId('cal-title').innerText()).trim()); if (!m2) throw new Error('calendar title not found');
    const cy = Number(m2[2]), cm = EN.indexOf(m2[1]) + 1;
    if (cy === y && cm === m) break;
    if (cy !== y && Math.abs(cy - y) >= 1) await page.getByTestId(cy < y ? 'cal-next-year' : 'cal-prev-year').click();
    else await page.getByTestId(cm < m ? 'cal-next' : 'cal-prev').click();
  }
  await page.getByTestId(`cal-day-${iso}`).click();
}
export async function pickTime(page, testID, hm) {
  const [h, m] = hm.split(':').map(Number);
  await page.getByTestId(testID).click(); await page.getByTestId(`time-h-${h}`).click(); await page.getByTestId(`time-m-${m}`).click(); await page.getByTestId('time-done').click();
}
