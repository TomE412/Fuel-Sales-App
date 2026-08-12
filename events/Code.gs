// ============================================================
// SKELSEE EVENT PLANNER — Apps Script backend
// Thin JSON API in front of this spreadsheet. Deploy as a Web App
// (Execute as: Me, Who has access: Anyone) and paste the deployed
// /exec URL + API_TOKEN into /events/index.html. See SETUP.md.
// ============================================================

var CATEGORY_TABS = ['FloorPlan', 'SeatingPlan', 'Budget', 'GuestList', 'Vendors', 'RunSheet', 'Notes'];

var SCHEMA = {
  Events:     ['EventID', 'EventName', 'EventType', 'EventDate', 'VenueName', 'VenueAddress', 'ClientName', 'ClientPhone', 'ClientEmail', 'GuestCountEstimate', 'Status', 'Notes', 'CreatedAt'],
  FloorPlan:  ['EntryID', 'EventID', 'ItemName', 'ItemType', 'LocationNote', 'Dimensions', 'Notes', 'CreatedAt'],
  SeatingPlan:['EntryID', 'EventID', 'TableNumber', 'TableCapacity', 'GuestName', 'SeatNumber', 'Notes', 'CreatedAt'],
  Budget:     ['EntryID', 'EventID', 'ItemDescription', 'Category', 'EstimatedCost', 'ActualCost', 'AmountPaid', 'DueDate', 'PaidStatus', 'VendorName', 'Notes', 'CreatedAt'],
  GuestList:  ['EntryID', 'EventID', 'GuestName', 'SideGroup', 'PartySize', 'RSVPStatus', 'MealChoice', 'DietaryNotes', 'TableNumber', 'ContactPhone', 'ContactEmail', 'Notes', 'CreatedAt'],
  Vendors:    ['EntryID', 'EventID', 'VendorName', 'ServiceType', 'ContactPerson', 'Phone', 'Email', 'ContractStatus', 'DepositDueDate', 'DepositAmount', 'BalanceDueDate', 'BalanceAmount', 'Notes', 'CreatedAt'],
  RunSheet:   ['EntryID', 'EventID', 'Date', 'Time', 'ActivityDescription', 'ResponsiblePerson', 'DurationMinutes', 'Notes', 'CreatedAt'],
  Notes:      ['EntryID', 'EventID', 'NoteText', 'ReminderDate', 'Author', 'CreatedAt']
};

// ---- One-time setup ----
// Run this once from the Apps Script editor (select it in the function
// dropdown, click Run). Safe to re-run — only creates what's missing.
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SCHEMA).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, SCHEMA[tabName].length).setValues([SCHEMA[tabName]]);
      sheet.setFrozenRows(1);
    }
  });

  // Clean up the blank default tab Google gives every new spreadsheet.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) {
    var token = Utilities.getUuid();
    props.setProperty('API_TOKEN', token);
    Logger.log('Generated API_TOKEN: ' + token);
    Logger.log('(Also visible any time under Project Settings > Script Properties.)');
  } else {
    Logger.log('API_TOKEN already set — leaving it as-is.');
  }
}

// ---- HTTP entry points ----
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkToken(p.token)) return json({ ok: false, error: 'unauthorized' });

  try {
    switch (p.action) {
      case 'ping':
        return json({ ok: true, message: 'pong', time: new Date().toISOString() });

      case 'listEvents':
        return json({ ok: true, events: listTab('Events') });

      case 'listEntries': {
        if (CATEGORY_TABS.indexOf(p.category) === -1) return json({ ok: false, error: 'invalid category' });
        var eventId = p.event;
        var entries = listTab(p.category, function (o) {
          return !eventId || String(o.EventID) === String(eventId);
        });
        return json({ ok: true, entries: entries });
      }

      case 'calendar':
        return json({ ok: true, items: buildCalendar(p.month) });

      default:
        return json({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad json body' });
  }
  if (!checkToken(body.token)) return json({ ok: false, error: 'unauthorized' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json({ ok: false, error: 'server busy, try again' });
  }

  try {
    switch (body.action) {
      case 'createEvent': {
        var ev = body.event || {};
        if (!ev.EventID) return json({ ok: false, error: 'missing EventID' });
        // Idempotent: a queued write retried after a lost response must not duplicate the row.
        if (findRowNumberById('Events', 'EventID', ev.EventID) === -1) appendEntry('Events', ev);
        return json({ ok: true });
      }

      case 'updateEvent': {
        if (!body.eventId) return json({ ok: false, error: 'missing eventId' });
        var okEv = updateEntryRow('Events', 'EventID', body.eventId, body.patch || {});
        return json(okEv ? { ok: true } : { ok: false, error: 'not found' });
      }

      case 'createEntry': {
        if (CATEGORY_TABS.indexOf(body.category) === -1) return json({ ok: false, error: 'invalid category' });
        var entry = body.entry || {};
        if (!entry.EntryID || !entry.EventID) return json({ ok: false, error: 'missing EntryID/EventID' });
        if (findRowNumberById(body.category, 'EntryID', entry.EntryID) === -1) appendEntry(body.category, entry);
        return json({ ok: true });
      }

      case 'updateEntry': {
        if (CATEGORY_TABS.indexOf(body.category) === -1) return json({ ok: false, error: 'invalid category' });
        if (!body.entryId) return json({ ok: false, error: 'missing entryId' });
        var okU = updateEntryRow(body.category, 'EntryID', body.entryId, body.patch || {});
        return json(okU ? { ok: true } : { ok: false, error: 'not found' });
      }

      case 'deleteEntry': {
        if (CATEGORY_TABS.indexOf(body.category) === -1) return json({ ok: false, error: 'invalid category' });
        if (!body.entryId) return json({ ok: false, error: 'missing entryId' });
        var okD = deleteEntryRow(body.category, 'EntryID', body.entryId);
        return json(okD ? { ok: true } : { ok: false, error: 'not found' });
      }

      default:
        return json({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- Calendar aggregation ----
// Pulls every dated row across tabs for the given 'YYYY-MM' month into one
// flat list, so the frontend fetches a single small payload per month view.
function buildCalendar(month) {
  var items = [];
  var events = listTab('Events');
  var eventNameById = {};
  events.forEach(function (ev) { eventNameById[ev.EventID] = ev.EventName; });

  function inMonth(val) {
    if (!val) return null;
    var s = (val instanceof Date)
      ? Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(val).split('T')[0];
    return s.indexOf(month) === 0 ? s : null;
  }

  events.forEach(function (ev) {
    var d = inMonth(ev.EventDate);
    if (d) items.push({ date: d, time: '', category: 'Event', eventId: ev.EventID, eventName: ev.EventName, title: ev.EventName });
  });

  listTab('RunSheet').forEach(function (r) {
    var d = inMonth(r.Date);
    if (d) items.push({ date: d, time: r.Time || '', category: 'RunSheet', eventId: r.EventID, eventName: eventNameById[r.EventID] || '', title: r.ActivityDescription || 'Run sheet item' });
  });

  listTab('Budget').forEach(function (r) {
    var d = inMonth(r.DueDate);
    if (d) items.push({ date: d, time: '', category: 'Budget', eventId: r.EventID, eventName: eventNameById[r.EventID] || '', title: (r.ItemDescription || 'Payment') + ' due' });
  });

  listTab('Vendors').forEach(function (r) {
    var d1 = inMonth(r.DepositDueDate);
    if (d1) items.push({ date: d1, time: '', category: 'Vendors', eventId: r.EventID, eventName: eventNameById[r.EventID] || '', title: (r.VendorName || 'Vendor') + ' — deposit due' });
    var d2 = inMonth(r.BalanceDueDate);
    if (d2) items.push({ date: d2, time: '', category: 'Vendors', eventId: r.EventID, eventName: eventNameById[r.EventID] || '', title: (r.VendorName || 'Vendor') + ' — balance due' });
  });

  listTab('Notes').forEach(function (r) {
    var d = inMonth(r.ReminderDate);
    if (d) items.push({ date: d, time: '', category: 'Notes', eventId: r.EventID, eventName: eventNameById[r.EventID] || '', title: r.NoteText || 'Note' });
  });

  return items;
}

// ---- Sheet helpers ----
function checkToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  return !!expected && token === expected;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(tabName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) return { sheet: null, header: [], rows: [] };
  var values = sheet.getDataRange().getValues();
  var header = values.shift() || [];
  return { sheet: sheet, header: header, rows: values };
}

function listTab(tabName, filterFn) {
  var d = getSheetData(tabName);
  var objs = d.rows.map(function (row) {
    var o = {};
    d.header.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
  return filterFn ? objs.filter(filterFn) : objs;
}

function appendEntry(tabName, obj) {
  var header = SCHEMA[tabName];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) throw new Error('Unknown tab: ' + tabName);
  obj.CreatedAt = obj.CreatedAt || new Date().toISOString();
  var row = header.map(function (h) { return (obj[h] !== undefined && obj[h] !== null) ? obj[h] : ''; });
  sheet.appendRow(row);
}

function findRowNumberById(tabName, idCol, idVal) {
  var d = getSheetData(tabName);
  if (!d.sheet) return -1;
  var idx = d.header.indexOf(idCol);
  if (idx === -1) return -1;
  for (var i = 0; i < d.rows.length; i++) {
    if (String(d.rows[i][idx]) === String(idVal)) return i + 2; // +1 for header row, +1 to 1-index
  }
  return -1;
}

function updateEntryRow(tabName, idCol, idVal, patch) {
  var rowNum = findRowNumberById(tabName, idCol, idVal);
  if (rowNum === -1) return false;
  var header = SCHEMA[tabName];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  header.forEach(function (h, i) {
    if (patch[h] !== undefined) sheet.getRange(rowNum, i + 1).setValue(patch[h]);
  });
  return true;
}

function deleteEntryRow(tabName, idCol, idVal) {
  var rowNum = findRowNumberById(tabName, idCol, idVal);
  if (rowNum === -1) return false;
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName).deleteRow(rowNum);
  return true;
}
