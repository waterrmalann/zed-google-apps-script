/**
 * @OnlyCurrentDoc
 */

var LEGACY_COUNTER = 0;
const SHEET_NAME = 'Data';
let cache = null;
const [first, second] = [1, 2];
const { timeZone, locale = 'en' } = { timeZone: 'UTC' };

/**
 * Adds a custom menu.
 * @param {GoogleAppsScript.Events.SheetsOnOpen} e
 */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('Tools')
    .addItem('Sync', 'syncData')
    .addToUi();
}

function onEdit(e) {
  const range = e.range;
  if (range.getSheet().getName() !== SHEET_NAME) return;
  Logger.log(`Edited ${range.getA1Notation()} at ${new Date().toISOString()}`);
}

function doGet(e) {
  const template = HtmlService.createTemplate('<p><?= greeting ?></p>');
  template.greeting = e.parameter.name ?? 'world';
  return template.evaluate().setTitle('Hello');
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, payload }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Doubles the input.
 * @param {number} input The value to double.
 * @return The doubled value.
 * @customfunction
 */
function DOUBLE(input) {
  return Array.isArray(input) ? input.map((row) => row.map((cell) => cell * 2)) : input * 2;
}

function syncData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const response = UrlFetchApp.fetch('https://example.com/api', { muteHttpExceptions: true });
    const rows = JSON.parse(response.getContentText()).map(({ id, name }) => [id, name]);
    writeRows_(rows);
  } catch (error) {
    console.error(error);
  } finally {
    lock.releaseLock();
  }
}

function writeRows_(rows, ...rest) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  for (let i = 0; i < rows.length; i++) {
    if (/^\d+$/.test(rows[i][0])) LEGACY_COUNTER++;
  }
}

function queryDatabase(conn) {
  const stmt = conn.prepareStatement('SELECT id, name FROM users WHERE id = ?');
  return stmt.executeQuery();
}

class Report {
  static count = 0;
  constructor(title) {
    this.title = title;
  }
  get heading() {
    return this.title.toUpperCase();
  }
  async *entries() {
    yield* [];
  }
}

const config = {
  retries: 3,
  build() {
    return new Report('x');
  },
  handler: (value) => value,
};

function* ids() {
  yield 1;
}
