/**
 * 学校予定共有ボード - バックエンドスクリプト
 * (src/Code.js)
 * 
 * Google Apps Script / Node.js 双方で動作するデータアクセス・API実装
 */

// 外部ロジックモジュールの参照 (Node.js環境ではrequire、GASではグローバルLogic)
var LogicModule = null;
if (typeof require !== 'undefined') {
  try {
    LogicModule = require('./Logic');
  } catch (e) {
    // パス違い等のフォールバック
  }
}
if (!LogicModule && typeof globalThis !== 'undefined' && globalThis.Logic) {
  LogicModule = globalThis.Logic;
}

// =============================================================================
// 定数定義
// =============================================================================

var TASK_HEADERS = [
  'taskId',
  'title',
  'description',
  'periodType',
  'specifiedDate',
  'status',
  'assignee',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt'
];

var HISTORY_HEADERS = [
  'historyId',
  'taskId',
  'timestamp',
  'actor',
  'actionType',
  'fieldName',
  'beforeValue',
  'afterValue',
  'comment'
];

var MEMBER_HEADERS = [
  'memberId',
  'name',
  'active',
  'sortOrder'
];

var INITIAL_MEMBERS = [
  ['MEM-0001', '校長', true, 1],
  ['MEM-0002', '教頭', true, 2],
  ['MEM-0003', '教務主任', true, 3],
  ['MEM-0004', '学年主任', true, 4],
  ['MEM-0005', '養護教諭', true, 5],
  ['MEM-0006', '事務職員', true, 6]
];

// テスト用スプレッドシート参照保持
var _testSpreadsheet = null;

// =============================================================================
// ユーティリティ・インフラ補助関数
// =============================================================================

/**
 * テスト環境用スプレッドシートの明示的設定
 * @param {object} ss 
 */
function setSpreadsheetForTest(ss) {
  _testSpreadsheet = ss;
}

/**
 * アクティブまたはテスト用スプレッドシートを取得
 * @returns {object|null}
 */
function getSpreadsheet() {
  if (_testSpreadsheet) return _testSpreadsheet;
  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) return ss;
    } catch (e) {}
  }
  return null;
}

/**
 * 排他制御用 Lock オブジェクト取得
 * @returns {object}
 */
function getLock() {
  if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
    try {
      var lock = LockService.getScriptLock();
      if (lock) return lock;
    } catch (e) {}
  }
  return {
    tryLock: function() { return true; },
    releaseLock: function() {}
  };
}

/**
 * Asia/Tokyo 基準の日時文字列取得: YYYY/MM/DD HH:mm
 * @param {Date|string|number} [date]
 * @returns {string}
 */
function getNowStr(date) {
  if (LogicModule && LogicModule.formatDateTime) {
    return LogicModule.formatDateTime(date || new Date());
  }
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    try {
      return Utilities.formatDate(date ? new Date(date) : new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    } catch (e) {}
  }
  var d = date ? new Date(date) : new Date();
  var utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  var jst = new Date(utc + (3600000 * 9));
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return jst.getFullYear() + '/' + pad(jst.getMonth() + 1) + '/' + pad(jst.getDate()) + ' ' + pad(jst.getHours()) + ':' + pad(jst.getMinutes());
}

/**
 * Asia/Tokyo 基準の日付文字列取得: YYYY-MM-DD
 * @param {Date|string|number} [date]
 * @returns {string}
 */
function getTodayYmd(date) {
  if (LogicModule && LogicModule.getTodayStr) {
    return LogicModule.getTodayStr(date);
  }
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    try {
      return Utilities.formatDate(date ? new Date(date) : new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    } catch (e) {}
  }
  var d = date ? new Date(date) : new Date();
  var utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  var jst = new Date(utc + (3600000 * 9));
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return jst.getFullYear() + '-' + pad(jst.getMonth() + 1) + '-' + pad(jst.getDate());
}

/**
 * スプレッドシートセルの日付値を正規化 (YYYY-MM-DD)
 * @param {any} val 
 * @returns {string}
 */
function formatDateVal(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    return getTodayYmd(val);
  }
  var s = String(val).trim();
  return s.replace(/\//g, '-');
}

/**
 * スプレッドシートセルの日時値を正規化 (YYYY/MM/DD HH:mm)
 * @param {any} val 
 * @returns {string}
 */
function formatDateTimeVal(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    return getNowStr(val);
  }
  return String(val).trim();
}

/**
 * UUID / 一意ID 生成
 * @returns {string}
 */
function generateUuid() {
  if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
    try {
      return Utilities.getUuid();
    } catch (e) {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 難所C: 排他制御下での連番 taskId 採番 (TASK-YYYYMMDD-XXXX)
 * @param {object} taskSheet 
 * @returns {string}
 */
function generateTaskId(taskSheet) {
  var todayYmd = getTodayYmd().replace(/-/g, ''); // 例: 20261003
  var prefix = 'TASK-' + todayYmd + '-';
  var maxSeq = 0;

  var lastRow = taskSheet.getLastRow();
  if (lastRow > 1) {
    var ids = taskSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var idStr = String(ids[i][0] || '');
      if (idStr.indexOf(prefix) === 0) {
        var seqStr = idStr.substring(prefix.length);
        var seqNum = parseInt(seqStr, 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }
  }

  var nextSeq = maxSeq + 1;
  return prefix + String(nextSeq).padStart(4, '0');
}

/**
 * History シートから全タスクの追記メモをマップ化して取得
 * (現在の予定カードからも追記が確認できるようにする要件対応)
 * @param {object} ss 
 * @returns {object} { [taskId]: Array<{ timestamp: string, actor: string, note: string }> }
 */
function getNotesMap(ss) {
  var notesMap = {};
  if (!ss) return notesMap;
  var historySheet = ss.getSheetByName('History');
  if (!historySheet) return notesMap;
  var lastRow = historySheet.getLastRow();
  if (lastRow <= 1) return notesMap;

  var historyValues = historySheet.getRange(2, 1, lastRow - 1, HISTORY_HEADERS.length).getValues();
  for (var i = 0; i < historyValues.length; i++) {
    var row = historyValues[i];
    var taskId = String(row[1] || '').trim();
    var actionType = String(row[4] || '');
    if (actionType === '追記' && taskId) {
      if (!notesMap[taskId]) notesMap[taskId] = [];
      notesMap[taskId].push({
        timestamp: formatDateTimeVal(row[2]),
        actor: String(row[3] || ''),
        note: String(row[8] || row[7] || '')
      });
    }
  }
  return notesMap;
}

/**
 * Tasks シートの全件取得
 * @param {object} [ss] 
 * @returns {Array<object>}
 */
function readAllTasks(ss) {
  ss = ss || getSpreadsheet();
  if (!ss) return [];
  var taskSheet = ss.getSheetByName('Tasks');
  if (!taskSheet) return [];
  var lastRow = taskSheet.getLastRow();
  if (lastRow <= 1) return [];

  var notesMap = getNotesMap(ss);
  var values = taskSheet.getRange(2, 1, lastRow - 1, TASK_HEADERS.length).getValues();
  var tasks = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var taskId = String(row[0] || '').trim();
    if (!taskId) continue;

    tasks.push({
      taskId: taskId,
      title: String(row[1] || ''),
      description: String(row[2] || ''),
      periodType: String(row[3] || ''),
      specifiedDate: formatDateVal(row[4]),
      status: String(row[5] || '検討中'),
      assignee: String(row[6] || ''),
      createdBy: String(row[7] || ''),
      createdAt: formatDateTimeVal(row[8]),
      updatedBy: String(row[9] || ''),
      updatedAt: formatDateTimeVal(row[10]),
      notes: notesMap[taskId] || []
    });
  }
  return tasks;
}

// =============================================================================
// Web App エントリポイント
// =============================================================================

/**
 * Web App GETリクエストハンドラ
 * @param {object} e 
 * @returns {HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('学校予定共有ボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// =============================================================================
// 初期化関数
// =============================================================================

/**
 * シート初期化 (シートが存在しなければヘッダー作成、初期Members投入)
 * @param {object} [ss] 
 * @returns {{ success: boolean, message: string }}
 */
function initSheets(ss) {
  ss = ss || getSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheet が見つかりません。');
  }

  // 1. Tasks シート
  var taskSheet = ss.getSheetByName('Tasks');
  if (!taskSheet) {
    taskSheet = ss.insertSheet('Tasks');
  }
  if (taskSheet.getLastRow() === 0) {
    taskSheet.getRange(1, 1, 1, TASK_HEADERS.length).setValues([TASK_HEADERS]);
  }

  // 2. History シート
  var historySheet = ss.getSheetByName('History');
  if (!historySheet) {
    historySheet = ss.insertSheet('History');
  }
  if (historySheet.getLastRow() === 0) {
    historySheet.getRange(1, 1, 1, HISTORY_HEADERS.length).setValues([HISTORY_HEADERS]);
  }

  // 3. Members シート
  var memberSheet = ss.getSheetByName('Members');
  if (!memberSheet) {
    memberSheet = ss.insertSheet('Members');
  }
  if (memberSheet.getLastRow() === 0) {
    memberSheet.getRange(1, 1, 1, MEMBER_HEADERS.length).setValues([MEMBER_HEADERS]);
  }
  if (memberSheet.getLastRow() <= 1) {
    memberSheet.getRange(2, 1, INITIAL_MEMBERS.length, MEMBER_HEADERS.length).setValues(INITIAL_MEMBERS);
  }

  return { success: true, message: '初期化が完了しました。' };
}

// =============================================================================
// API 関数群
// =============================================================================

/**
 * 初期データ取得API
 * @returns {{ success: boolean, tasks: Array<object>, members: Array<object>, serverTime: string, currentView: string }}
 */
function getInitialData() {
  try {
    var tasksRes = getTasks('today');
    var membersRes = getMembers();
    var serverTime = getNowStr();
    return {
      success: true,
      tasks: tasksRes.tasks || [],
      members: membersRes.members || [],
      serverTime: serverTime,
      currentView: 'today'
    };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * 予定一覧取得API (viewTypeに応じた期間フィルタ)
 * @param {string} viewType "today" | "this_week" | "this_month" | "annual"
 * @returns {{ success: boolean, tasks: Array<object> }}
 */
function getTasks(viewType) {
  try {
    var tasks = readAllTasks();
    var filtered = tasks;
    if (viewType && viewType !== 'all') {
      if (LogicModule && LogicModule.filterTasksByView) {
        filtered = LogicModule.filterTasksByView(tasks, viewType);
      } else {
        var todayStr = getTodayYmd();
        if (viewType === 'today') {
          filtered = tasks.filter(function(t) {
            return t.periodType === '今日' || t.specifiedDate === todayStr;
          });
        } else if (viewType === 'this_week') {
          filtered = tasks.filter(function(t) {
            return t.periodType === '今日' || t.periodType === '今週';
          });
        } else if (viewType === 'this_month') {
          filtered = tasks.filter(function(t) {
            return t.periodType === '今日' || t.periodType === '今週' || t.periodType === '今月';
          });
        }
      }
    }
    return { success: true, tasks: filtered };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * 予定新規作成API (LockService排他制御, 二重登録防止, 連番ID採番, 整合的履歴記録)
 * @param {object} data { title: string, periodType: string, specifiedDate?: string, description?: string, status: string, assignee?: string, createdBy: string }
 * @returns {{ success: boolean, task: object }|{ success: false, error: string }}
 */
function createTask(data) {
  if (!data || typeof data !== 'object') {
    return { success: false, error: '入力データが無効です。' };
  }

  // バリデーション
  if (LogicModule && LogicModule.validateTaskInput) {
    var valRes = LogicModule.validateTaskInput(data, false);
    if (!valRes.valid) {
      return { success: false, error: valRes.errors.join('、') };
    }
  } else {
    if (!data.title || !String(data.title).trim()) {
      return { success: false, error: 'タイトルは必須です。' };
    }
    if (!data.periodType) {
      return { success: false, error: '期間区分は必須です。' };
    }
    if (!data.createdBy) {
      return { success: false, error: '作成者は必須です。' };
    }
  }

  var ss = getSpreadsheet();
  if (!ss) return { success: false, error: 'Spreadsheet が見つかりません。' };

  var lock = getLock();
  if (!lock.tryLock(15000)) {
    return { success: false, error: '混雑のため排他ロックを取得できませんでした。再度お試しください。' };
  }

  try {
    var taskSheet = ss.getSheetByName('Tasks');
    var historySheet = ss.getSheetByName('History');
    if (!taskSheet || !historySheet) {
      initSheets(ss);
      taskSheet = ss.getSheetByName('Tasks');
      historySheet = ss.getSheetByName('History');
    }

    var nowStr = getNowStr();
    var title = String(data.title).trim();
    var description = String(data.description || '');
    var periodType = String(data.periodType);
    var specifiedDate = formatDateVal(data.specifiedDate || '');
    var status = String(data.status || '検討中');
    var assignee = String(data.assignee || '').trim();
    var createdBy = String(data.createdBy || '').trim();

    // 二重登録防止チェック: 同一作成者・同一タイトル・同一期間・同一指定日で同一分の連続送信を検知
    var lastRow = taskSheet.getLastRow();
    if (lastRow > 1) {
      var checkCount = Math.min(lastRow - 1, 5);
      var startCheckRow = lastRow - checkCount + 1;
      var recentRows = taskSheet.getRange(startCheckRow, 1, checkCount, TASK_HEADERS.length).getValues();
      for (var i = recentRows.length - 1; i >= 0; i--) {
        var r = recentRows[i];
        if (
          String(r[1]).trim() === title &&
          String(r[3]).trim() === periodType &&
          String(r[7]).trim() === createdBy &&
          formatDateVal(r[4]) === specifiedDate &&
          formatDateTimeVal(r[8]) === nowStr
        ) {
          var existingTask = {
            taskId: String(r[0]),
            title: String(r[1]),
            description: String(r[2]),
            periodType: String(r[3]),
            specifiedDate: formatDateVal(r[4]),
            status: String(r[5]),
            assignee: String(r[6]),
            createdBy: String(r[7]),
            createdAt: formatDateTimeVal(r[8]),
            updatedBy: String(r[9]),
            updatedAt: formatDateTimeVal(r[10]),
            notes: []
          };
          return { success: true, task: existingTask };
        }
      }
    }

    // 難所C: 排他制御下での連番 taskId 採番
    var taskId = generateTaskId(taskSheet);

    var taskRow = [
      taskId,
      title,
      description,
      periodType,
      specifiedDate,
      status,
      assignee,
      createdBy,
      nowStr,
      createdBy,
      nowStr
    ];

    // Tasks シートへ追加
    taskSheet.appendRow(taskRow);

    // 難所A: History シートへ新規登録履歴を追加
    var historyId = 'HIST-' + generateUuid();
    var historyRow = [
      historyId,
      taskId,
      nowStr,
      createdBy,
      '新規登録',
      '全体',
      '',
      title,
      description ? ('新規登録: ' + description.substring(0, 100)) : '新規登録'
    ];
    historySheet.appendRow(historyRow);

    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
      SpreadsheetApp.flush();
    }

    var newTask = {
      taskId: taskId,
      title: title,
      description: description,
      periodType: periodType,
      specifiedDate: specifiedDate,
      status: status,
      assignee: assignee,
      createdBy: createdBy,
      createdAt: nowStr,
      updatedBy: createdBy,
      updatedAt: nowStr,
      notes: []
    };

    return { success: true, task: newTask };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * 予定更新API (各項目の変更差分をHistoryに記録し、更新日時・更新者をTasksに反映)
 * @param {string} taskId 
 * @param {object} data { title: string, periodType: string, specifiedDate?: string, description?: string, status: string, assignee?: string, updatedBy: string }
 * @returns {{ success: boolean, task: object }|{ success: false, error: string }}
 */
function updateTask(taskId, data) {
  if (!taskId) return { success: false, error: 'taskId は必須です。' };
  if (!data || typeof data !== 'object') return { success: false, error: '入力データが無効です。' };

  if (LogicModule && LogicModule.validateTaskInput) {
    var valRes = LogicModule.validateTaskInput(data, true);
    if (!valRes.valid) {
      return { success: false, error: valRes.errors.join('、') };
    }
  }

  var ss = getSpreadsheet();
  if (!ss) return { success: false, error: 'Spreadsheet が見つかりません。' };

  var lock = getLock();
  if (!lock.tryLock(15000)) {
    return { success: false, error: '混雑のため排他ロックを取得できませんでした。再度お試しください。' };
  }

  try {
    var taskSheet = ss.getSheetByName('Tasks');
    var historySheet = ss.getSheetByName('History');
    if (!taskSheet || !historySheet) {
      return { success: false, error: '必要なシートが見つかりません。' };
    }

    var lastRow = taskSheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: '対象の予定が見つかりません: ' + taskId };
    }

    var values = taskSheet.getRange(2, 1, lastRow - 1, TASK_HEADERS.length).getValues();
    var targetRowIndex = -1;
    var oldRow = null;

    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(taskId).trim()) {
        targetRowIndex = i + 2;
        oldRow = values[i];
        break;
      }
    }

    if (targetRowIndex === -1 || !oldRow) {
      return { success: false, error: '対象の予定が見つかりません: ' + taskId };
    }

    var nowStr = getNowStr();
    var updatedBy = String(data.updatedBy || '').trim();

    var oldTitle = String(oldRow[1] || '');
    var oldDescription = String(oldRow[2] || '');
    var oldPeriodType = String(oldRow[3] || '');
    var oldSpecifiedDate = formatDateVal(oldRow[4]);
    var oldStatus = String(oldRow[5] || '');
    var oldAssignee = String(oldRow[6] || '');
    var createdBy = String(oldRow[7] || '');
    var createdAt = formatDateTimeVal(oldRow[8]);

    var newTitle = data.title !== undefined ? String(data.title).trim() : oldTitle;
    var newDescription = data.description !== undefined ? String(data.description) : oldDescription;
    var newPeriodType = data.periodType !== undefined ? String(data.periodType) : oldPeriodType;
    var newSpecifiedDate = data.specifiedDate !== undefined ? formatDateVal(data.specifiedDate) : oldSpecifiedDate;
    var newStatus = data.status !== undefined ? String(data.status) : oldStatus;
    var newAssignee = data.assignee !== undefined ? String(data.assignee).trim() : oldAssignee;

    // 難所A: 変更差分を検知してHistoryへ記録
    var historyEntries = [];

    if (oldTitle !== newTitle) {
      historyEntries.push({
        fieldName: 'タイトル',
        beforeValue: oldTitle,
        afterValue: newTitle,
        actionType: '修正',
        comment: ''
      });
    }
    if (oldDescription !== newDescription) {
      historyEntries.push({
        fieldName: '詳細',
        beforeValue: oldDescription,
        afterValue: newDescription,
        actionType: '修正',
        comment: ''
      });
    }
    if (oldPeriodType !== newPeriodType) {
      historyEntries.push({
        fieldName: '期間',
        beforeValue: oldPeriodType,
        afterValue: newPeriodType,
        actionType: '修正',
        comment: ''
      });
    }
    if (oldSpecifiedDate !== newSpecifiedDate) {
      historyEntries.push({
        fieldName: '指定日',
        beforeValue: oldSpecifiedDate,
        afterValue: newSpecifiedDate,
        actionType: '修正',
        comment: ''
      });
    }
    if (oldStatus !== newStatus) {
      historyEntries.push({
        fieldName: '状態',
        beforeValue: oldStatus,
        afterValue: newStatus,
        actionType: '状態変更',
        comment: '状態を「' + oldStatus + '」から「' + newStatus + '」に変更'
      });
    }
    if (oldAssignee !== newAssignee) {
      historyEntries.push({
        fieldName: '担当者',
        beforeValue: oldAssignee,
        afterValue: newAssignee,
        actionType: '修正',
        comment: ''
      });
    }

    // 差分がなくても更新者が指定されている場合は更新ログまたは全体ログ
    if (historyEntries.length === 0) {
      historyEntries.push({
        fieldName: '全体',
        beforeValue: oldTitle,
        afterValue: newTitle,
        actionType: '修正',
        comment: '変更なし更新'
      });
    }

    for (var j = 0; j < historyEntries.length; j++) {
      var h = historyEntries[j];
      historySheet.appendRow([
        'HIST-' + generateUuid(),
        taskId,
        nowStr,
        updatedBy,
        h.actionType,
        h.fieldName,
        h.beforeValue,
        h.afterValue,
        h.comment
      ]);
    }

    // Tasks シート更新
    var updatedRow = [
      taskId,
      newTitle,
      newDescription,
      newPeriodType,
      newSpecifiedDate,
      newStatus,
      newAssignee,
      createdBy,
      createdAt,
      updatedBy,
      nowStr
    ];
    taskSheet.getRange(targetRowIndex, 1, 1, TASK_HEADERS.length).setValues([updatedRow]);

    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
      SpreadsheetApp.flush();
    }

    var notesMap = getNotesMap(ss);

    var updatedTask = {
      taskId: taskId,
      title: newTitle,
      description: newDescription,
      periodType: newPeriodType,
      specifiedDate: newSpecifiedDate,
      status: newStatus,
      assignee: newAssignee,
      createdBy: createdBy,
      createdAt: createdAt,
      updatedBy: updatedBy,
      updatedAt: nowStr,
      notes: notesMap[taskId] || []
    };

    return { success: true, task: updatedTask };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * 追記メモ登録API
 * 指示書第10項: 追記では既存本文を書き換えない。追記内容は履歴として保存する。現在の予定カードからも追記が確認できるようにする。
 * @param {string} taskId 
 * @param {object} data { note: string, actor: string }
 * @returns {{ success: boolean, task: object }|{ success: false, error: string }}
 */
function addTaskNote(taskId, data) {
  if (!taskId) return { success: false, error: 'taskId は必須です。' };
  if (!data || typeof data !== 'object') return { success: false, error: '入力データが無効です。' };

  if (LogicModule && LogicModule.validateNoteInput) {
    var valRes = LogicModule.validateNoteInput(data);
    if (!valRes.valid) {
      return { success: false, error: valRes.errors.join('、') };
    }
  } else {
    if (!data.note || !String(data.note).trim()) {
      return { success: false, error: '追記内容は必須です。' };
    }
    if (!data.actor || !String(data.actor).trim()) {
      return { success: false, error: '操作者は必須です。' };
    }
  }

  var ss = getSpreadsheet();
  if (!ss) return { success: false, error: 'Spreadsheet が見つかりません。' };

  var lock = getLock();
  if (!lock.tryLock(15000)) {
    return { success: false, error: '混雑のため排他ロックを取得できませんでした。再度お試しください。' };
  }

  try {
    var taskSheet = ss.getSheetByName('Tasks');
    var historySheet = ss.getSheetByName('History');
    if (!taskSheet || !historySheet) {
      return { success: false, error: '必要なシートが見つかりません。' };
    }

    var lastRow = taskSheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: '対象の予定が見つかりません: ' + taskId };
    }

    var values = taskSheet.getRange(2, 1, lastRow - 1, TASK_HEADERS.length).getValues();
    var targetRowIndex = -1;
    var targetRow = null;

    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(taskId).trim()) {
        targetRowIndex = i + 2;
        targetRow = values[i];
        break;
      }
    }

    if (targetRowIndex === -1 || !targetRow) {
      return { success: false, error: '対象の予定が見つかりません: ' + taskId };
    }

    var nowStr = getNowStr();
    var actor = String(data.actor).trim();
    var note = String(data.note).trim();

    // 1. History シートへ追記履歴を追加 (難所A)
    var historyId = 'HIST-' + generateUuid();
    historySheet.appendRow([
      historyId,
      taskId,
      nowStr,
      actor,
      '追記',
      '追記',
      '',
      note,
      note
    ]);

    // 2. Tasks シートの更新者・更新日時を反映
    // (既存本文 description は書き換えない。カード側で notes 配列から表示)
    targetRow[9] = actor;   // updatedBy
    targetRow[10] = nowStr; // updatedAt
    taskSheet.getRange(targetRowIndex, 1, 1, TASK_HEADERS.length).setValues([targetRow]);

    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
      SpreadsheetApp.flush();
    }

    var notesMap = getNotesMap(ss);

    var task = {
      taskId: taskId,
      title: String(targetRow[1] || ''),
      description: String(targetRow[2] || ''),
      periodType: String(targetRow[3] || ''),
      specifiedDate: formatDateVal(targetRow[4]),
      status: String(targetRow[5] || ''),
      assignee: String(targetRow[6] || ''),
      createdBy: String(targetRow[7] || ''),
      createdAt: formatDateTimeVal(targetRow[8]),
      updatedBy: actor,
      updatedAt: nowStr,
      notes: notesMap[taskId] || []
    };

    return { success: true, task: task };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * 状態変更API (状態のみの変更操作・Historyへの「状態変更」記録)
 * @param {string} taskId 
 * @param {object} data { status: string, actor: string }
 * @returns {{ success: boolean, task: object }|{ success: false, error: string }}
 */
function changeTaskStatus(taskId, data) {
  if (!taskId) return { success: false, error: 'taskId は必須です。' };
  if (!data || typeof data !== 'object') return { success: false, error: '入力データが無効です。' };

  if (LogicModule && LogicModule.validateStatusInput) {
    var valRes = LogicModule.validateStatusInput(data);
    if (!valRes.valid) {
      return { success: false, error: valRes.errors.join('、') };
    }
  } else {
    if (!data.status) return { success: false, error: 'ステータスは必須です。' };
    if (!data.actor) return { success: false, error: '操作者は必須です。' };
  }

  var ss = getSpreadsheet();
  if (!ss) return { success: false, error: 'Spreadsheet が見つかりません。' };

  var lock = getLock();
  if (!lock.tryLock(15000)) {
    return { success: false, error: '混雑のため排他ロックを取得できませんでした。再度お試しください。' };
  }

  try {
    var taskSheet = ss.getSheetByName('Tasks');
    var historySheet = ss.getSheetByName('History');
    if (!taskSheet || !historySheet) {
      return { success: false, error: '必要なシートが見つかりません。' };
    }

    var lastRow = taskSheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: '対象の予定が見つかりません: ' + taskId };
    }

    var values = taskSheet.getRange(2, 1, lastRow - 1, TASK_HEADERS.length).getValues();
    var targetRowIndex = -1;
    var targetRow = null;

    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(taskId).trim()) {
        targetRowIndex = i + 2;
        targetRow = values[i];
        break;
      }
    }

    if (targetRowIndex === -1 || !targetRow) {
      return { success: false, error: '対象の予定が見つかりません: ' + taskId };
    }

    var nowStr = getNowStr();
    var actor = String(data.actor).trim();
    var newStatus = String(data.status).trim();
    var oldStatus = String(targetRow[5] || '検討中');

    // History に状態変更履歴を追加
    var historyId = 'HIST-' + generateUuid();
    historySheet.appendRow([
      historyId,
      taskId,
      nowStr,
      actor,
      '状態変更',
      '状態',
      oldStatus,
      newStatus,
      '状態を「' + oldStatus + '」から「' + newStatus + '」に変更'
    ]);

    // Tasks シート更新
    targetRow[5] = newStatus;
    targetRow[9] = actor;
    targetRow[10] = nowStr;
    taskSheet.getRange(targetRowIndex, 1, 1, TASK_HEADERS.length).setValues([targetRow]);

    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
      SpreadsheetApp.flush();
    }

    var notesMap = getNotesMap(ss);

    var task = {
      taskId: taskId,
      title: String(targetRow[1] || ''),
      description: String(targetRow[2] || ''),
      periodType: String(targetRow[3] || ''),
      specifiedDate: formatDateVal(targetRow[4]),
      status: newStatus,
      assignee: String(targetRow[6] || ''),
      createdBy: String(targetRow[7] || ''),
      createdAt: formatDateTimeVal(targetRow[8]),
      updatedBy: actor,
      updatedAt: nowStr,
      notes: notesMap[taskId] || []
    };

    return { success: true, task: task };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * 変更履歴取得API
 * @param {string} taskId 
 * @returns {{ success: boolean, history: Array<object> }}
 */
function getTaskHistory(taskId) {
  try {
    if (!taskId) return { success: false, error: 'taskId は必須です。' };
    var ss = getSpreadsheet();
    if (!ss) return { success: true, history: [] };
    var historySheet = ss.getSheetByName('History');
    if (!historySheet) return { success: true, history: [] };
    var lastRow = historySheet.getLastRow();
    if (lastRow <= 1) return { success: true, history: [] };

    var values = historySheet.getRange(2, 1, lastRow - 1, HISTORY_HEADERS.length).getValues();
    var history = [];

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      if (String(row[1]).trim() === String(taskId).trim()) {
        history.push({
          historyId: String(row[0] || ''),
          taskId: String(row[1] || ''),
          timestamp: formatDateTimeVal(row[2]),
          actor: String(row[3] || ''),
          actionType: String(row[4] || ''),
          fieldName: String(row[5] || ''),
          beforeValue: String(row[6] || ''),
          afterValue: String(row[7] || ''),
          comment: String(row[8] || '')
        });
      }
    }

    return { success: true, history: history };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * 有効メンバー一覧取得API (active === true のみ、sortOrder昇順)
 * @returns {{ success: boolean, members: Array<object> }}
 */
function getMembers() {
  try {
    var ss = getSpreadsheet();
    if (!ss) return { success: true, members: [] };
    var memberSheet = ss.getSheetByName('Members');
    if (!memberSheet) return { success: true, members: [] };
    var lastRow = memberSheet.getLastRow();
    if (lastRow <= 1) return { success: true, members: [] };

    var values = memberSheet.getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length).getValues();
    var members = [];

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var memberId = String(row[0] || '').trim();
      var name = String(row[1] || '').trim();
      var active = row[2] === true || String(row[2]).toLowerCase() === 'true';
      var sortOrder = Number(row[3]) || 0;

      if (memberId && active) {
        members.push({
          memberId: memberId,
          name: name,
          active: active,
          sortOrder: sortOrder
        });
      }
    }

    members.sort(function(a, b) {
      return a.sortOrder - b.sortOrder;
    });

    return { success: true, members: members };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

// =============================================================================
// Node.js (CommonJS) エクスポート設定
// =============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TASK_HEADERS: TASK_HEADERS,
    HISTORY_HEADERS: HISTORY_HEADERS,
    MEMBER_HEADERS: MEMBER_HEADERS,
    INITIAL_MEMBERS: INITIAL_MEMBERS,
    setSpreadsheetForTest: setSpreadsheetForTest,
    getSpreadsheet: getSpreadsheet,
    getLock: getLock,
    generateTaskId: generateTaskId,
    generateUuid: generateUuid,
    getNotesMap: getNotesMap,
    readAllTasks: readAllTasks,
    doGet: doGet,
    initSheets: initSheets,
    getInitialData: getInitialData,
    getTasks: getTasks,
    createTask: createTask,
    updateTask: updateTask,
    addTaskNote: addTaskNote,
    changeTaskStatus: changeTaskStatus,
    getTaskHistory: getTaskHistory,
    getMembers: getMembers
  };
}
