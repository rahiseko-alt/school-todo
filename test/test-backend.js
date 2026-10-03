/**
 * test/test-backend.js
 * バックエンドAPI関数テスト & 排他制御・履歴整合性テスト (Level 2 & Level 3)
 */

const assert = require('assert');
const {
  MockSpreadsheet,
  MockLockService,
  MockUtilities
} = require('./gas-mock');

// グローバル環境に GAS API モックを設定
global.LockService = new MockLockService();
global.Utilities = MockUtilities;

const Code = require('../src/Code');

let passedTests = 0;
let failedTests = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passedTests++;
    results.push({ name, status: 'PASS' });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failedTests++;
    results.push({ name, status: 'FAIL', error: err.message });
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

console.log('=== Running Backend API & Integration Tests ===\n');

// 共通セットアップ: 新しいモックスプレッドシートを生成
function setupCleanEnvironment() {
  const ss = new MockSpreadsheet();
  Code.setSpreadsheetForTest(ss);
  Code.initSheets(ss);
  return ss;
}

// 1. initSheets & getMembers テスト
test('initSheets & getMembers: 初期シート作成とアクティブメンバー取得', () => {
  const ss = setupCleanEnvironment();
  assert.ok(ss.getSheetByName('Tasks'), 'Tasksシートが存在すること');
  assert.ok(ss.getSheetByName('History'), 'Historyシートが存在すること');
  assert.ok(ss.getSheetByName('Members'), 'Membersシートが存在すること');

  const membersRes = Code.getMembers();
  assert.strictEqual(membersRes.success, true);
  assert.strictEqual(membersRes.members.length, 6, '初期メンバー6名');
  assert.strictEqual(membersRes.members[0].name, '校長');
  assert.strictEqual(membersRes.members[0].active, true);
  assert.strictEqual(membersRes.members[1].name, '教頭');
});

// 2. createTask テスト (正常作成・IDフォーマット・History作成)
test('createTask: 正常作成、TASK-YYYYMMDD-XXXX形式、History新規登録記録', () => {
  const ss = setupCleanEnvironment();

  const res = Code.createTask({
    title: '運動会全体打合せ',
    description: '校庭にて進行順確認',
    periodType: '今週',
    status: '進行中',
    assignee: '教務主任',
    createdBy: '教頭'
  });

  assert.strictEqual(res.success, true, '作成成功');
  const task = res.task;
  assert.match(task.taskId, /^TASK-\d{8}-0001$/, '連番IDが TASK-YYYYMMDD-0001 形式であること');
  assert.strictEqual(task.title, '運動会全体打合せ');
  assert.strictEqual(task.periodType, '今週');
  assert.strictEqual(task.status, '進行中');
  assert.strictEqual(task.assignee, '教務主任');
  assert.strictEqual(task.createdBy, '教頭');
  assert.strictEqual(task.updatedBy, '教頭');

  // Tasksシート確認
  const taskSheet = ss.getSheetByName('Tasks');
  assert.strictEqual(taskSheet.getLastRow(), 2, 'ヘッダー+1行');

  // Historyシート確認 (難所A: 新規登録ログ)
  const historySheet = ss.getSheetByName('History');
  assert.strictEqual(historySheet.getLastRow(), 2, 'ヘッダー+1行');
  const histRow = historySheet.getRange(2, 1, 1, 9).getValues()[0];
  assert.strictEqual(histRow[1], task.taskId, 'taskIdが一致');
  assert.strictEqual(histRow[3], '教頭', 'actorが一致');
  assert.strictEqual(histRow[4], '新規登録', 'actionTypeが新規登録');
  assert.strictEqual(histRow[7], '運動会全体打合せ', 'afterValueがタイトル');
});

// 3. 連番ID採番テスト (複数タスク作成時のインクリメント)
test('createTask: 連続作成でIDが0001, 0002, 0003とインクリメントされる', () => {
  const ss = setupCleanEnvironment();

  const res1 = Code.createTask({ title: 'タスク1', periodType: '今日', status: '進行中', createdBy: '校長' });
  const res2 = Code.createTask({ title: 'タスク2', periodType: '今週', status: '進行中', createdBy: '教頭' });
  const res3 = Code.createTask({ title: 'タスク3', periodType: '今月', status: '進行中', createdBy: '教務主任' });

  assert.match(res1.task.taskId, /-0001$/);
  assert.match(res2.task.taskId, /-0002$/);
  assert.match(res3.task.taskId, /-0003$/);
});

// 4. バリデーションエラーテスト
test('createTask: バリデーションエラー (タイトルなし)', () => {
  const ss = setupCleanEnvironment();
  const res = Code.createTask({
    title: '',
    periodType: '今日',
    status: '進行中',
    createdBy: '校長'
  });
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('タイトル'));
});

// 5. updateTask テスト (指定Taskのみ変更、差分記録、他タスク非破壊)
test('updateTask: 指定Taskのフィールド変更と差分Historyの正確な記録', () => {
  const ss = setupCleanEnvironment();

  // 2件作成
  const t1 = Code.createTask({ title: '予定A', periodType: '今日', status: '進行中', createdBy: '校長' }).task;
  const t2 = Code.createTask({ title: '予定B', periodType: '今週', status: '進行中', createdBy: '教頭' }).task;

  // 予定Aを更新 (タイトル変更、期間を今月から日付指定へ変更、担当変更)
  const upRes = Code.updateTask(t1.taskId, {
    title: '予定A (改定)',
    description: '詳細追記あり',
    periodType: '日付指定',
    specifiedDate: '2026-10-15',
    status: '進行中',
    assignee: '養護教諭',
    updatedBy: '教務主任'
  });

  assert.strictEqual(upRes.success, true);
  assert.strictEqual(upRes.task.title, '予定A (改定)');
  assert.strictEqual(upRes.task.periodType, '日付指定');
  assert.strictEqual(upRes.task.specifiedDate, '2026-10-15');
  assert.strictEqual(upRes.task.assignee, '養護教諭');
  assert.strictEqual(upRes.task.updatedBy, '教務主任');

  // 予定Bが変化していないことを確認
  const allTasks = Code.readAllTasks(ss);
  const taskB = allTasks.find(t => t.taskId === t2.taskId);
  assert.strictEqual(taskB.title, '予定B', '予定Bは影響を受けないこと');
  assert.strictEqual(taskB.updatedBy, '教頭');

  // Historyシートに差分が記録されていることを確認
  const histRes = Code.getTaskHistory(t1.taskId);
  assert.strictEqual(histRes.success, true);
  // 新規登録 + タイトル修正 + 詳細修正 + 期間修正 + 指定日修正 + 担当者修正 = 計6レコード
  const history = histRes.history;
  assert.ok(history.length >= 5, '差分項目が記録されていること');

  const titleHist = history.find(h => h.fieldName === 'タイトル');
  assert.ok(titleHist);
  assert.strictEqual(titleHist.beforeValue, '予定A');
  assert.strictEqual(titleHist.afterValue, '予定A (改定)');
  assert.strictEqual(titleHist.actor, '教務主任');
});

// 6. addTaskNote テスト (指示書第10項: 元本文を消さない、追記者を記録、カードから確認可能)
test('addTaskNote: 元descriptionを破壊せずHistoryに追記記録、notes配列に反映', () => {
  const ss = setupCleanEnvironment();

  const originalDesc = '第1体育館での会場設営手順';
  const task = Code.createTask({
    title: '式典準備',
    description: originalDesc,
    periodType: '今週',
    status: '進行中',
    createdBy: '校長'
  }).task;

  // 追記メモを追加
  const noteRes1 = Code.addTaskNote(task.taskId, {
    note: 'パイプ椅子は倉庫奥の新品を使用すること',
    actor: '学年主任'
  });

  assert.strictEqual(noteRes1.success, true);
  assert.strictEqual(noteRes1.task.description, originalDesc, '元本文が保持されていること');
  assert.strictEqual(noteRes1.task.updatedBy, '学年主任');
  assert.strictEqual(noteRes1.task.notes.length, 1);
  assert.strictEqual(noteRes1.task.notes[0].actor, '学年主任');
  assert.strictEqual(noteRes1.task.notes[0].note, 'パイプ椅子は倉庫奥の新品を使用すること');

  // 2回目の追記
  const noteRes2 = Code.addTaskNote(task.taskId, {
    note: '写真撮影用の演台カバーも準備完了',
    actor: '事務職員'
  });
  assert.strictEqual(noteRes2.success, true);
  assert.strictEqual(noteRes2.task.notes.length, 2);
  assert.strictEqual(noteRes2.task.notes[1].actor, '事務職員');

  // 一覧取得時にも notes 配列が含まれていることを確認
  const listRes = Code.getTasks('all');
  const listedTask = listRes.tasks.find(t => t.taskId === task.taskId);
  assert.strictEqual(listedTask.notes.length, 2);
  assert.strictEqual(listedTask.description, originalDesc);
});

// 7. changeTaskStatus テスト (状態のみ変更、Historyに「状態変更」記録)
test('changeTaskStatus: 状態のみ変更、Historyに「状態変更」記録', () => {
  const ss = setupCleanEnvironment();

  const task = Code.createTask({
    title: '防災訓練',
    periodType: '今月',
    status: '進行中',
    createdBy: '教頭'
  }).task;

  // 完了に変更
  const changeRes = Code.changeTaskStatus(task.taskId, {
    status: '完了',
    actor: '校長'
  });

  assert.strictEqual(changeRes.success, true);
  assert.strictEqual(changeRes.task.status, '完了');
  assert.strictEqual(changeRes.task.updatedBy, '校長');

  // History確認
  const histRes = Code.getTaskHistory(task.taskId);
  const statusHist = histRes.history.find(h => h.actionType === '状態変更');
  assert.ok(statusHist);
  assert.strictEqual(statusHist.beforeValue, '進行中');
  assert.strictEqual(statusHist.afterValue, '完了');
  assert.strictEqual(statusHist.actor, '校長');
});

// 8. getTaskHistory テスト (対象Taskの履歴のみ、他タスクの混入なし)
test('getTaskHistory: 対象Taskの履歴のみが分離されて返却される', () => {
  const ss = setupCleanEnvironment();

  const t1 = Code.createTask({ title: 'Task 1', periodType: '今日', status: '進行中', createdBy: '校長' }).task;
  const t2 = Code.createTask({ title: 'Task 2', periodType: '今週', status: '進行中', createdBy: '教頭' }).task;

  Code.addTaskNote(t1.taskId, { note: 'Note for Task 1', actor: '教務主任' });
  Code.addTaskNote(t2.taskId, { note: 'Note for Task 2', actor: '学年主任' });

  const h1 = Code.getTaskHistory(t1.taskId).history;
  const h2 = Code.getTaskHistory(t2.taskId).history;

  assert.ok(h1.every(h => h.taskId === t1.taskId), '全てTask 1の履歴');
  assert.ok(h2.every(h => h.taskId === t2.taskId), '全てTask 2の履歴');
});

// 9. 二重登録防止テスト (難所C)
test('createTask: 短時間での同一内容連打時の二重登録防止', () => {
  const ss = setupCleanEnvironment();

  const input = {
    title: '職員歓送迎会',
    description: '場所未定',
    periodType: '今月',
    status: '検討中',
    createdBy: '教頭'
  };

  // 1回目の登録
  const res1 = Code.createTask(input);
  assert.strictEqual(res1.success, true);

  // 2回目（即座に同パラメータで再送信）
  const res2 = Code.createTask(input);
  assert.strictEqual(res2.success, true);

  // Tasksシートを確認し、行が増えていない（重複作成されていない）ことを検証
  const taskSheet = ss.getSheetByName('Tasks');
  assert.strictEqual(taskSheet.getLastRow(), 2, '2回目の連打でもタスク行は1行のまま');
  assert.strictEqual(res1.task.taskId, res2.task.taskId, '既存タスク情報が返却される');
});

console.log(`\nBackend API Tests Finished: Passed=${passedTests}, Failed=${failedTests}`);
if (failedTests > 0) {
  process.exit(1);
}
