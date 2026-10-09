// Tabs keep their screens mounted (hidden) so state survives a tab switch; a text query would therefore also match hidden copies.
// Tests only ever interact with what the user can see, so every locator is narrowed to visible elements.
export function visibleOnly(page) {
  for (const m of ['getByText', 'getByLabel', 'getByTestId', 'getByPlaceholder', 'getByRole']) {
    const orig = page[m].bind(page);
    page[m] = (...a) => orig(...a).filter({ visible: true });
  }
  return page;
}
