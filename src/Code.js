/**
 * 学校予定共有ボード - バックエンドスクリプト
 * (src/Code.js)
 * 
 * Google Apps Script / Node.js 双方で動作するデータアクセス・API実装
 */

/**
 * 期間判定・バリデーションの共通ロジック (src/Logic.js) を取得する。
 * GAS ではファイルの読み込み順が保証されないため、読み込み時ではなく呼び出し時に解決する。
 * @returns {object}
 */
function getLogic() {
  if (typeof Logic !== 'undefined') return Logic;
  return require('./Logic');
}

var SYSTEM_ERROR_MESSAGE = '処理できませんでした。もう一度操作してください。';

/**
 * 開発者向けに原因をログへ出す (GAS では「実行数」画面で確認できる)
 * @param {string} where
 * @param {Error|any} err
 */
function logError(where, err) {
  console.error('[' + where + '] ' + (err && err.stack ? err.stack : String(err)));
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
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * スクリプトロックを取得して fn を実行し、必ず解放する。
 * 想定外の例外は原因をログへ出し、利用者には理解可能なメッセージを返す。
 * @param {string} where ログ用の呼び出し元名
 * @param {function(): object} fn
 * @returns {object}
 */
function withLock(where, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { success: false, error: 'ほかの人が操作中のため保存できませんでした。少し待ってからもう一度操作してください。' };
  }
  try {
    return fn();
  } catch (err) {
    logError(where, err);
    return { success: false, error: SYSTEM_ERROR_MESSAGE };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Asia/Tokyo 基準の日時文字列取得: YYYY/MM/DD HH:mm
 * @param {Date|string|number} [date]
 * @returns {string}
 */
function getNowStr(date) {
  return getLogic().formatDateTime(date || new Date());
}

/**
 * Asia/Tokyo 基準の日付文字列取得: YYYY-MM-DD
 * @param {Date|string|number} [date]
 * @returns {string}
 */
function getTodayYmd(date) {
  return getLogic().getTodayStr(date);
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
  return Utilities.getUuid();
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
  var taskSheet = ss.getSheetByName('Tasks');
  if (!taskSheet) return [];
  var lastRow = taskSheet.getLastRow();
  if (lastRow <= 1) return [];

  var notesMap = getNotesMap(ss);
  var values = taskSheet.getRange(2, 1, lastRow - 1, TASK_HEADERS.length).getValues();
  var tasks = [];
  for (var i = 0; i < values.length; i++) {
    var taskId = String(values[i][0] || '').trim();
    if (!taskId) continue;
    tasks.push(rowToTask(values[i], notesMap[taskId] || []));
  }
  return tasks;
}

/**
 * Tasks シートの1行を Task オブジェクトへ変換
 * @param {Array<any>} row
 * @param {Array<object>} notes
 * @returns {object}
 */
function rowToTask(row, notes) {
  return {
    taskId: String(row[0] || '').trim(),
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
    notes: notes
  };
}

/**
 * 更新系API で使う Tasks / History シートを取得 (無ければ初期化)
 * @param {object} ss
 * @returns {{ task: object, history: object }}
 */
function getWritableSheets(ss) {
  if (!ss.getSheetByName('Tasks') || !ss.getSheetByName('History')) {
    initSheets(ss);
  }
  return { task: ss.getSheetByName('Tasks'), history: ss.getSheetByName('History') };
}

/**
 * taskId で Tasks シートの行を探す
 * @param {object} taskSheet
 * @param {string} taskId
 * @returns {{ rowIndex: number, row: Array<any> }|null}
 */
function findTaskRow(taskSheet, taskId) {
  var lastRow = taskSheet.getLastRow();
  if (lastRow <= 1) return null;
  var values = taskSheet.getRange(2, 1, lastRow - 1, TASK_HEADERS.length).getValues();
  var target = String(taskId).trim();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === target) {
      return { rowIndex: i + 2, row: values[i] };
    }
  }
  return null;
}

/**
 * History シート1行分を作る
 * @returns {Array<any>}
 */
function buildHistoryRow(taskId, timestamp, actor, actionType, fieldName, beforeValue, afterValue, comment) {
  return [generateUuid(), taskId, timestamp, actor, actionType, fieldName, beforeValue, afterValue, comment];
}

/**
 * 難所A: Tasks の1行と、それに対応する History 行をまとめて書き込む。
 * History の書き込みに失敗した場合は Tasks を元に戻し、
 * 「Tasks だけ更新されて History が残らない」状態を作らない。
 * @param {{ task: object, history: object }} sheets
 * @param {number} rowIndex 書き込む Tasks の行番号
 * @param {Array<any>} newRow
 * @param {Array<any>|null} oldRow 更新前の行 (新規登録なら null)
 * @param {Array<Array<any>>} historyRows
 */
function writeTaskWithHistory(sheets, rowIndex, newRow, oldRow, historyRows) {
  var taskRange = sheets.task.getRange(rowIndex, 1, 1, TASK_HEADERS.length);
  taskRange.setValues([newRow]);
  try {
    var historyStart = sheets.history.getLastRow() + 1;
    sheets.history.getRange(historyStart, 1, historyRows.length, HISTORY_HEADERS.length).setValues(historyRows);
  } catch (err) {
    try {
      if (oldRow) {
        taskRange.setValues([oldRow]);
      } else {
        sheets.task.deleteRow(rowIndex);
      }
    } catch (rollbackErr) {
      logError('writeTaskWithHistory:rollback taskId=' + newRow[0], rollbackErr);
    }
    throw err;
  }
  if (typeof SpreadsheetApp !== 'undefined') {
    SpreadsheetApp.flush();
  }
}

/**
 * Members シートの有効メンバー名一覧
 * @param {object} ss
 * @returns {Array<string>}
 */
function getActiveMemberNames(ss) {
  var res = getMembers(ss);
  if (!res.success) throw new Error(res.error);
  return res.members.map(function(m) { return m.name; });
}

/**
 * 名前が有効メンバーに含まれるかを確認し、含まれなければエラーメッセージを返す
 * @param {Array<string>} activeNames
 * @param {string} name
 * @param {string} label 例: '登録者'
 * @returns {string|null}
 */
function checkMemberName(activeNames, name, label) {
  if (activeNames.indexOf(name) === -1) {
    return label + 'は一覧から選んでください。';
  }
  return null;
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
  var tasksRes = getTasks('today');
  if (!tasksRes.success) return tasksRes;
  var membersRes = getMembers();
  if (!membersRes.success) return membersRes;
  return {
    success: true,
    tasks: tasksRes.tasks,
    members: membersRes.members,
    serverTime: getNowStr(),
    currentView: 'today'
  };
}

/**
 * 予定一覧取得API (viewTypeに応じた期間フィルタ)
 * @param {string} viewType "today" | "this_week" | "this_month" | "annual"
 * @returns {{ success: boolean, tasks: Array<object> }}
 */
function getTasks(viewType) {
  try {
    var tasks = readAllTasks();
    if (viewType && viewType !== 'all') {
      tasks = getLogic().filterTasksByView(tasks, viewType);
    }
    return { success: true, tasks: tasks };
  } catch (e) {
    logError('getTasks', e);
    return { success: false, error: '予定を読み込めませんでした。もう一度操作してください。' };
  }
}

/**
 * 予定新規作成API (LockService排他制御, 二重登録防止, 連番ID採番, 整合的履歴記録)
 * @param {object} data { title: string, periodType: string, specifiedDate?: string, description?: string, status: string, assignee?: string, createdBy: string }
 * @returns {{ success: boolean, task: object, duplicate?: boolean }|{ success: false, error: string }}
 *   duplicate: 同じ人が同じ分に同じ予定を送ったため、新しく作らず既存の予定を返した
 */
function createTask(data) {
  var valRes = getLogic().validateTaskInput(data, false);
  if (!valRes.valid) {
    return { success: false, error: valRes.errors.join('、') };
  }

  var ss = getSpreadsheet();
  return withLock('createTask', function() {
    var sheets = getWritableSheets(ss);
    var taskSheet = sheets.task;

    var nowStr = getNowStr();
    var title = String(data.title).trim();
    var description = String(data.description || '');
    var periodType = String(data.periodType);
    var specifiedDate = formatDateVal(data.specifiedDate || '');
    var status = String(data.status || '検討中');
    var assignee = String(data.assignee || '').trim();
    var createdBy = String(data.createdBy || '').trim();

    var activeNames = getActiveMemberNames(ss);
    var memberError = checkMemberName(activeNames, createdBy, '登録者') ||
      (assignee ? checkMemberName(activeNames, assignee, '担当') : null);
    if (memberError) return { success: false, error: memberError };

    // 二重登録防止チェック: 同一作成者・同一タイトル・同一期間・同一指定日で同一分の連続送信を検知
    var lastRow = taskSheet.getLastRow();
    if (lastRow > 1) {
      var checkCount = Math.min(lastRow - 1, 5);
      var recentRows = taskSheet.getRange(lastRow - checkCount + 1, 1, checkCount, TASK_HEADERS.length).getValues();
      for (var i = recentRows.length - 1; i >= 0; i--) {
        var r = recentRows[i];
        if (
          String(r[1]).trim() === title &&
          String(r[3]).trim() === periodType &&
          String(r[7]).trim() === createdBy &&
          formatDateVal(r[4]) === specifiedDate &&
          formatDateTimeVal(r[8]) === nowStr
        ) {
          // 2件目は作らず、既存の予定を返したことを画面に伝える
          return { success: true, duplicate: true, task: rowToTask(r, []) };
        }
      }
    }

    // 難所C: 排他制御下での連番 taskId 採番
    var taskId = generateTaskId(taskSheet);
    var taskRow = [
      taskId, title, description, periodType, specifiedDate, status,
      assignee, createdBy, nowStr, createdBy, nowStr
    ];
    var historyRow = buildHistoryRow(
      taskId, nowStr, createdBy, '新規登録', '全体', '', title,
      description ? ('新規登録: ' + description.substring(0, 100)) : '新規登録'
    );

    // 難所A: Tasks と History をまとめて書き込む
    writeTaskWithHistory(sheets, lastRow + 1, taskRow, null, [historyRow]);

    return { success: true, task: rowToTask(taskRow, []) };
  });
}

/**
 * 予定更新API (各項目の変更差分をHistoryに記録し、更新日時・更新者をTasksに反映)
 * @param {string} taskId
 * @param {object} data { title: string, periodType: string, specifiedDate?: string, description?: string, status: string, assignee?: string, updatedBy: string }
 * @returns {{ success: boolean, task: object }|{ success: false, error: string }}
 */
function updateTask(taskId, data) {
  if (!taskId) return { success: false, error: '対象の予定が指定されていません。' };
  var valRes = getLogic().validateTaskInput(data, true);
  if (!valRes.valid) {
    return { success: false, error: valRes.errors.join('、') };
  }

  var ss = getSpreadsheet();
  return withLock('updateTask', function() {
    var sheets = getWritableSheets(ss);
    var found = findTaskRow(sheets.task, taskId);
    if (!found) {
      return { success: false, error: '対象の予定が見つかりません。画面を更新してください。' };
    }
    var oldRow = found.row;

    var nowStr = getNowStr();
    var updatedBy = String(data.updatedBy || '').trim();

    var oldTitle = String(oldRow[1] || '');
    var oldDescription = String(oldRow[2] || '');
    var oldPeriodType = String(oldRow[3] || '');
    var oldSpecifiedDate = formatDateVal(oldRow[4]);
    var oldStatus = String(oldRow[5] || '');
    var oldAssignee = String(oldRow[6] || '');

    var newTitle = data.title !== undefined ? String(data.title).trim() : oldTitle;
    var newDescription = data.description !== undefined ? String(data.description) : oldDescription;
    var newPeriodType = data.periodType !== undefined ? String(data.periodType) : oldPeriodType;
    var newSpecifiedDate = data.specifiedDate !== undefined ? formatDateVal(data.specifiedDate) : oldSpecifiedDate;
    var newStatus = data.status !== undefined ? String(data.status) : oldStatus;
    var newAssignee = data.assignee !== undefined ? String(data.assignee).trim() : oldAssignee;

    var activeNames = getActiveMemberNames(ss);
    var memberError = checkMemberName(activeNames, updatedBy, '更新者') ||
      (newAssignee && newAssignee !== oldAssignee ? checkMemberName(activeNames, newAssignee, '担当') : null);
    if (memberError) return { success: false, error: memberError };

    // 難所A: 変更差分を項目ごとに History へ記録
    var changes = [
      ['タイトル', oldTitle, newTitle, '修正'],
      ['詳細', oldDescription, newDescription, '修正'],
      ['期間', oldPeriodType, newPeriodType, '修正'],
      ['指定日', oldSpecifiedDate, newSpecifiedDate, '修正'],
      ['状態', oldStatus, newStatus, '状態変更'],
      ['担当者', oldAssignee, newAssignee, '修正']
    ];
    var historyRows = [];
    for (var j = 0; j < changes.length; j++) {
      var c = changes[j];
      if (c[1] === c[2]) continue;
      var comment = c[3] === '状態変更' ? '状態を「' + c[1] + '」から「' + c[2] + '」に変更' : '';
      historyRows.push(buildHistoryRow(taskId, nowStr, updatedBy, c[3], c[0], c[1], c[2], comment));
    }
    // 何も変わっていなければ保存も履歴記録もしない
    if (historyRows.length === 0) {
      return { success: false, error: '変更された項目がありません。直したい項目を書き換えてから保存してください。' };
    }

    var updatedRow = [
      taskId, newTitle, newDescription, newPeriodType, newSpecifiedDate, newStatus,
      newAssignee, oldRow[7], oldRow[8], updatedBy, nowStr
    ];
    writeTaskWithHistory(sheets, found.rowIndex, updatedRow, oldRow, historyRows);

    return { success: true, task: rowToTask(updatedRow, getNotesMap(ss)[taskId] || []) };
  });
}

/**
 * 追記メモ登録API
 * 指示書第10項: 追記では既存本文を書き換えない。追記内容は履歴として保存する。現在の予定カードからも追記が確認できるようにする。
 * @param {string} taskId
 * @param {object} data { note: string, actor: string }
 * @returns {{ success: boolean, task: object }|{ success: false, error: string }}
 */
function addTaskNote(taskId, data) {
  if (!taskId) return { success: false, error: '対象の予定が指定されていません。' };
  var valRes = getLogic().validateNoteInput(data);
  if (!valRes.valid) {
    return { success: false, error: valRes.errors.join('、') };
  }

  var ss = getSpreadsheet();
  return withLock('addTaskNote', function() {
    var sheets = getWritableSheets(ss);
    var found = findTaskRow(sheets.task, taskId);
    if (!found) {
      return { success: false, error: '対象の予定が見つかりません。画面を更新してください。' };
    }

    var nowStr = getNowStr();
    var actor = String(data.actor).trim();
    var note = String(data.note).trim();

    var memberError = checkMemberName(getActiveMemberNames(ss), actor, '追記者');
    if (memberError) return { success: false, error: memberError };

    // 既存本文 description は書き換えず、更新者・更新日時だけ反映する
    var newRow = found.row.slice();
    newRow[9] = actor;
    newRow[10] = nowStr;
    var historyRow = buildHistoryRow(taskId, nowStr, actor, '追記', '追記', '', note, note);
    writeTaskWithHistory(sheets, found.rowIndex, newRow, found.row, [historyRow]);

    return { success: true, task: rowToTask(newRow, getNotesMap(ss)[taskId] || []) };
  });
}

/**
 * 状態変更API (状態のみの変更操作・Historyへの「状態変更」記録)
 * @param {string} taskId
 * @param {object} data { status: string, actor: string }
 * @returns {{ success: boolean, task: object }|{ success: false, error: string }}
 */
function changeTaskStatus(taskId, data) {
  if (!taskId) return { success: false, error: '対象の予定が指定されていません。' };
  var valRes = getLogic().validateStatusInput(data);
  if (!valRes.valid) {
    return { success: false, error: valRes.errors.join('、') };
  }

  var ss = getSpreadsheet();
  return withLock('changeTaskStatus', function() {
    var sheets = getWritableSheets(ss);
    var found = findTaskRow(sheets.task, taskId);
    if (!found) {
      return { success: false, error: '対象の予定が見つかりません。画面を更新してください。' };
    }

    var nowStr = getNowStr();
    var actor = String(data.actor).trim();
    var newStatus = String(data.status).trim();
    var oldStatus = String(found.row[5] || '検討中');

    var memberError = checkMemberName(getActiveMemberNames(ss), actor, '変更者');
    if (memberError) return { success: false, error: memberError };

    var newRow = found.row.slice();
    newRow[5] = newStatus;
    newRow[9] = actor;
    newRow[10] = nowStr;
    var historyRow = buildHistoryRow(
      taskId, nowStr, actor, '状態変更', '状態', oldStatus, newStatus,
      '状態を「' + oldStatus + '」から「' + newStatus + '」に変更'
    );
    writeTaskWithHistory(sheets, found.rowIndex, newRow, found.row, [historyRow]);

    return { success: true, task: rowToTask(newRow, getNotesMap(ss)[taskId] || []) };
  });
}

/**
 * 変更履歴取得API (新しい順)
 * @param {string} taskId
 * @returns {{ success: boolean, history: Array<object> }}
 */
function getTaskHistory(taskId) {
  try {
    if (!taskId) return { success: false, error: '対象の予定が指定されていません。' };
    var historySheet = getSpreadsheet().getSheetByName('History');
    if (!historySheet) return { success: true, history: [] };
    var lastRow = historySheet.getLastRow();
    if (lastRow <= 1) return { success: true, history: [] };

    var values = historySheet.getRange(2, 1, lastRow - 1, HISTORY_HEADERS.length).getValues();
    var history = [];
    var target = String(taskId).trim();

    // History シートは発生順に追記されるため、末尾から読むと新しい順になる
    for (var i = values.length - 1; i >= 0; i--) {
      var row = values[i];
      if (String(row[1]).trim() === target) {
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
    logError('getTaskHistory', e);
    return { success: false, error: '履歴を読み込めませんでした。もう一度操作してください。' };
  }
}

/**
 * 有効メンバー一覧取得API (active === true のみ、sortOrder昇順)
 * @param {object} [ss]
 * @returns {{ success: boolean, members: Array<object> }}
 */
function getMembers(ss) {
  try {
    ss = ss || getSpreadsheet();
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
    logError('getMembers', e);
    return { success: false, error: '職員一覧を読み込めませんでした。もう一度操作してください。' };
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
    withLock: withLock,
    writeTaskWithHistory: writeTaskWithHistory,
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
