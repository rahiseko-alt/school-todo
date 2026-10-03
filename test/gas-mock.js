/**
 * test/gas-mock.js
 * Google Apps Script の SpreadsheetApp, LockService, HtmlService, Utilities のインメモリモック
 */

class MockRange {
  constructor(sheet, startRow, startCol, numRows = 1, numCols = 1) {
    this.sheet = sheet;
    this.startRow = startRow; // 1-indexed
    this.startCol = startCol; // 1-indexed
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const result = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) {
        const rowIdx = this.startRow - 1 + r;
        const colIdx = this.startCol - 1 + c;
        if (rowIdx < this.sheet.data.length && colIdx < (this.sheet.data[rowIdx] || []).length) {
          row.push(this.sheet.data[rowIdx][colIdx]);
        } else {
          row.push('');
        }
      }
      result.push(row);
    }
    return result;
  }

  getValue() {
    const vals = this.getValues();
    return (vals[0] && vals[0][0] !== undefined) ? vals[0][0] : '';
  }

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const rowIdx = this.startRow - 1 + r;
      while (this.sheet.data.length <= rowIdx) {
        this.sheet.data.push([]);
      }
      for (let c = 0; c < values[r].length; c++) {
        const colIdx = this.startCol - 1 + c;
        while (this.sheet.data[rowIdx].length <= colIdx) {
          this.sheet.data[rowIdx].push('');
        }
        this.sheet.data[rowIdx][colIdx] = values[r][c];
      }
    }
    return this;
  }

  setValue(val) {
    return this.setValues([[val]]);
  }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.data = []; // 2次元配列
  }

  getName() {
    return this.name;
  }

  getLastRow() {
    return this.data.length;
  }

  getLastColumn() {
    let max = 0;
    for (const r of this.data) {
      if (r && r.length > max) max = r.length;
    }
    return max;
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }

  getDataRange() {
    const lr = this.getLastRow();
    const lc = this.getLastColumn();
    if (lr === 0 || lc === 0) {
      return new MockRange(this, 1, 1, 1, 1);
    }
    return new MockRange(this, 1, 1, lr, lc);
  }

  appendRow(rowArray) {
    this.data.push([...rowArray]);
    return this;
  }

  deleteRow(rowPosition) {
    this.data.splice(rowPosition - 1, 1);
    return this;
  }

  clear() {
    this.data = [];
  }
}

class MockSpreadsheet {
  constructor() {
    this.sheets = new Map();
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    if (this.sheets.has(name)) {
      return this.sheets.get(name);
    }
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }

  getSheets() {
    return Array.from(this.sheets.values());
  }
}

class MockLock {
  constructor() {
    this.isLocked = false;
  }

  tryLock(timeoutMs) {
    if (this.isLocked) return false;
    this.isLocked = true;
    return true;
  }

  waitLock(timeoutMs) {
    if (this.isLocked) {
      throw new Error('Lock timeout');
    }
    this.isLocked = true;
  }

  releaseLock() {
    this.isLocked = false;
  }
}

class MockLockService {
  constructor() {
    this.lock = new MockLock();
  }

  getScriptLock() {
    return this.lock;
  }
}

class MockUtilities {
  static getUuid() {
    return 'uuid-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
  }

  static formatDate(date, timeZone, format) {
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: timeZone || 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;

    if (format === 'yyyy/MM/dd HH:mm') {
      return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
    }
    if (format === 'yyyy-MM-dd') {
      return `${map.year}-${map.month}-${map.day}`;
    }
    if (format === 'yyyyMMdd') {
      return `${map.year}${map.month}${map.day}`;
    }
    return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
  }
}

module.exports = {
  MockRange,
  MockSheet,
  MockSpreadsheet,
  MockLockService,
  MockUtilities
};
