/**
 * 学校予定共有ボード - 業務ロジック・期間判定モジュール
 * (src/Logic.js)
 * 
 * 基準タイムゾーン: Asia/Tokyo
 * 週の定義: 月曜日〜日曜日 (月曜 00:00:00 〜 日曜 23:59:59)
 * 動作環境: Node.js (CommonJS) / GAS (Google Apps Script)
 */

// 定数定義
var PERIOD_TYPES = ['今日', '今週', '今月', '日付指定', '年間', '未定'];
var STATUS_TYPES = ['検討中', '進行中', '保留', '完了', '中止', '取消'];
var CLOSED_STATUSES = ['完了', '中止', '取消'];
var VIEW_TYPES = ['today', 'this_week', 'this_month', 'annual'];

/**
 * 日付・日時・文字列から Asia/Tokyo タイムゾーンの各パーツを取得
 * @param {Date|string|number} [date]
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number, dayOfWeek: number }}
 */
function getJSTParts(date) {
  var d = (date instanceof Date && !isNaN(date.getTime()))
    ? date
    : (typeof date === 'string' || typeof date === 'number')
      ? new Date(date)
      : new Date();

  if (isNaN(d.getTime())) {
    throw new Error('無効な日付です');
  }

  var formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  var parts = formatter.formatToParts(d);
  var map = {};
  for (var i = 0; i < parts.length; i++) {
    map[parts[i].type] = parts[i].value;
  }

  var year = parseInt(map.year, 10);
  var month = parseInt(map.month, 10);
  var day = parseInt(map.day, 10);
  var hour = parseInt(map.hour, 10);
  var minute = parseInt(map.minute, 10);
  var second = parseInt(map.second, 10);

  // JSTでの年月日を元に曜日を算出 (0: 日曜, 1: 月曜, ..., 6: 土曜)
  var utcDate = new Date(Date.UTC(year, month - 1, day));
  var dayOfWeek = utcDate.getUTCDay();

  return {
    year: year,
    month: month,
    day: day,
    hour: hour,
    minute: minute,
    second: second,
    dayOfWeek: dayOfWeek
  };
}

/**
 * Asia/Tokyo 基準の日時フォーマット: YYYY/MM/DD HH:mm
 * @param {Date|string|number} [date]
 * @returns {string}
 */
function formatDateTime(date) {
  if (!date && date !== 0) return '';
  var parts = getJSTParts(date);
  var y = parts.year;
  var m = String(parts.month).padStart(2, '0');
  var d = String(parts.day).padStart(2, '0');
  var h = String(parts.hour).padStart(2, '0');
  var min = String(parts.minute).padStart(2, '0');
  return y + '/' + m + '/' + d + ' ' + h + ':' + min;
}

/**
 * Asia/Tokyo 基準の日付フォーマット: YYYY-MM-DD
 * @param {Date|string|number} [date]
 * @returns {string}
 */
function formatDate(date) {
  if (!date && date !== 0) return '';
  var parts = getJSTParts(date);
  var y = parts.year;
  var m = String(parts.month).padStart(2, '0');
  var d = String(parts.day).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * 今日の日付文字列 (YYYY-MM-DD) を取得 (Asia/Tokyo 基準)
 * @param {Date|string|number} [nowDate]
 * @returns {string}
 */
function getTodayStr(nowDate) {
  return formatDate(nowDate || new Date());
}

/**
 * 今週の期間を取得 (Asia/Tokyo 基準, 月曜日〜日曜日)
 * @param {Date|string|number} [nowDate]
 * @returns {{ startStr: string, endStr: string, monday: Date, sunday: Date }}
 */
function getThisWeekRange(nowDate) {
  var parts = getJSTParts(nowDate || new Date());
  var year = parts.year;
  var month = parts.month;
  var day = parts.day;
  var dayOfWeek = parts.dayOfWeek; // 0: 日曜, 1: 月曜, ..., 6: 土曜

  // 月曜日までの日数差分 (日曜日=0なら -6日, 月曜=1なら 0日, 火曜=2なら -1日...)
  var diffDaysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  var baseUtc = Date.UTC(year, month - 1, day);
  var mondayUtc = baseUtc + diffDaysToMon * 86400000;
  var sundayUtc = mondayUtc + 6 * 86400000;

  var mD = new Date(mondayUtc);
  var sD = new Date(sundayUtc);

  var mYear = mD.getUTCFullYear();
  var mMonth = mD.getUTCMonth() + 1;
  var mDay = mD.getUTCDate();

  var sYear = sD.getUTCFullYear();
  var sMonth = sD.getUTCMonth() + 1;
  var sDay = sD.getUTCDate();

  var startStr = mYear + '-' + String(mMonth).padStart(2, '0') + '-' + String(mDay).padStart(2, '0');
  var endStr = sYear + '-' + String(sMonth).padStart(2, '0') + '-' + String(sDay).padStart(2, '0');

  // JST 月曜 00:00:00.000 と JST 日曜 23:59:59.999 の Date オブジェクト
  var monday = new Date(Date.UTC(mYear, mMonth - 1, mDay, 0, 0, 0, 0) - 9 * 3600 * 1000);
  var sunday = new Date(Date.UTC(sYear, sMonth - 1, sDay, 23, 59, 59, 999) - 9 * 3600 * 1000);

  return {
    startStr: startStr,
    endStr: endStr,
    monday: monday,
    sunday: sunday
  };
}

/**
 * 今月の期間を取得 (Asia/Tokyo 基準)
 * @param {Date|string|number} [nowDate]
 * @returns {{ startStr: string, endStr: string }}
 */
function getThisMonthRange(nowDate) {
  var parts = getJSTParts(nowDate || new Date());
  var year = parts.year;
  var month = parts.month;
  // 指定月の末日 (Date.UTCで month を渡すと翌月0日 = 当月末日)
  var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  var startStr = year + '-' + String(month).padStart(2, '0') + '-01';
  var endStr = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');

  return {
    startStr: startStr,
    endStr: endStr
  };
}

/**
 * 終了ステータス判定 (完了, 中止, 取消)
 * @param {string} status
 * @returns {boolean}
 */
function isClosedStatus(status) {
  return CLOSED_STATUSES.indexOf(status) !== -1;
}

/**
 * タスクが指定されたビューに含まれるか判定
 * @param {object} task
 * @param {string} viewType 'today' | 'this_week' | 'this_month' | 'annual'
 * @param {Date|string|number} [targetDate] 基準日時 (省略時は現在日時)
 * @returns {boolean}
 */
function isTaskInView(task, viewType, targetDate) {
  if (!task || typeof task !== 'object') {
    return false;
  }

  var periodType = task.periodType;
  var specifiedDate = (typeof task.specifiedDate === 'string' && task.specifiedDate.trim().length > 0)
    ? task.specifiedDate.trim()
    : null;

  if (viewType === 'annual') {
    return true;
  }

  if (viewType === 'today') {
    var todayStr = getTodayStr(targetDate);
    return periodType === '今日' || specifiedDate === todayStr;
  }

  if (viewType === 'this_week') {
    var weekRange = getThisWeekRange(targetDate);
    var inWeekRange = specifiedDate !== null && specifiedDate >= weekRange.startStr && specifiedDate <= weekRange.endStr;
    return periodType === '今日' || periodType === '今週' || inWeekRange;
  }

  if (viewType === 'this_month') {
    var monthRange = getThisMonthRange(targetDate);
    var inMonthRange = specifiedDate !== null && specifiedDate >= monthRange.startStr && specifiedDate <= monthRange.endStr;
    return periodType === '今日' || periodType === '今週' || periodType === '今月' || inMonthRange;
  }

  return false;
}

/**
 * タスク一覧を指定されたビューでフィルタリング
 * @param {Array<object>} tasks
 * @param {string} viewType
 * @param {Date|string|number} [targetDate]
 * @returns {Array<object>}
 */
function filterTasksByView(tasks, viewType, targetDate) {
  if (!Array.isArray(tasks)) {
    return [];
  }
  return tasks.filter(function(task) {
    return isTaskInView(task, viewType, targetDate);
  });
}

/**
 * YYYY-MM-DD 形式の日付文字列妥当性チェック
 * @param {string} str
 * @returns {boolean}
 */
function isValidDateStr(str) {
  if (typeof str !== 'string') return false;
  var match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  var y = parseInt(match[1], 10);
  var m = parseInt(match[2], 10);
  var d = parseInt(match[3], 10);
  if (m < 1 || m > 12) return false;
  var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= lastDay;
}

/**
 * タスク登録・更新入力のバリデーション
 * @param {object} data
 * @param {boolean} [isUpdate=false]
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateTaskInput(data, isUpdate) {
  var errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['入力データが無効です'] };
  }

  // title: 必須
  if (typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push('タイトルは必須です');
  }

  // periodType: 必須, 規定値内
  if (PERIOD_TYPES.indexOf(data.periodType) === -1) {
    errors.push('有効な期間区分を指定してください');
  } else if (data.periodType === '日付指定') {
    // 日付指定の場合は specifiedDate が必須
    if (!data.specifiedDate || !isValidDateStr(data.specifiedDate)) {
      errors.push('日付指定の場合は有効な日付(YYYY-MM-DD)を指定してください');
    }
  }

  // status: 必須, 規定値内
  if (STATUS_TYPES.indexOf(data.status) === -1) {
    errors.push('有効なステータスを指定してください');
  }

  // createdBy / updatedBy: 必須
  if (isUpdate) {
    if (typeof data.updatedBy !== 'string' || data.updatedBy.trim().length === 0) {
      errors.push('更新者は必須です');
    }
  } else {
    if (typeof data.createdBy !== 'string' || data.createdBy.trim().length === 0) {
      errors.push('作成者は必須です');
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * 追記メモ入力のバリデーション
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateNoteInput(data) {
  var errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['入力データが無効です'] };
  }

  if (typeof data.note !== 'string' || data.note.trim().length === 0) {
    errors.push('追記内容は必須です');
  }

  if (typeof data.actor !== 'string' || data.actor.trim().length === 0) {
    errors.push('操作者は必須です');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * ステータス変更入力のバリデーション
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStatusInput(data) {
  var errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['入力データが無効です'] };
  }

  if (STATUS_TYPES.indexOf(data.status) === -1) {
    errors.push('有効なステータスを指定してください');
  }

  if (typeof data.actor !== 'string' || data.actor.trim().length === 0) {
    errors.push('操作者は必須です');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// エクスポートオブジェクトの定義
var Logic = {
  PERIOD_TYPES: PERIOD_TYPES,
  STATUS_TYPES: STATUS_TYPES,
  CLOSED_STATUSES: CLOSED_STATUSES,
  VIEW_TYPES: VIEW_TYPES,
  getJSTParts: getJSTParts,
  formatDateTime: formatDateTime,
  formatDate: formatDate,
  getTodayStr: getTodayStr,
  getThisWeekRange: getThisWeekRange,
  getThisMonthRange: getThisMonthRange,
  isClosedStatus: isClosedStatus,
  isTaskInView: isTaskInView,
  filterTasksByView: filterTasksByView,
  isValidDateStr: isValidDateStr,
  validateTaskInput: validateTaskInput,
  validateNoteInput: validateNoteInput,
  validateStatusInput: validateStatusInput
};

// Node.js (CommonJS) 環境対応
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Logic;
}

// GAS / ブラウザ グローバル環境対応
if (typeof globalThis !== 'undefined') {
  globalThis.Logic = Logic;
  for (var k in Logic) {
    if (Object.prototype.hasOwnProperty.call(Logic, k)) {
      globalThis[k] = Logic[k];
    }
  }
}
