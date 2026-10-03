/**
 * test/test-regressions.js
 * コードレビューで見つかった重大・中程度の不具合の再発防止テスト
 * - GAS と同じ「Code → Logic」の読み込み順でも期間判定・入力チェックが働くこと
 * - History の書き込みに失敗したとき Tasks が元に戻ること (難所A)
 * - 操作者・担当が Members の有効メンバーに限られること
 * - 履歴が新しい順に返ること (指示書第13項)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  MockSpreadsheet,
  MockLockService,
  MockUtilities
} = require('./gas-mock');

global.LockService = new MockLockService();
global.Utilities = MockUtilities;

const Code = require('../src/Code');
const Logic = require('../src/Logic');

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    passedTests++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

function setupCleanEnvironment() {
  const ss = new MockSpreadsheet();
  Code.setSpreadsheetForTest(ss);
  Code.initSheets(ss);
  return ss;
}

/**
 * GAS と同じく require / module の無い1つのグローバル空間に、
 * README の手順どおり Code → Logic の順でファイルを読み込む
 */
function loadLikeGas() {
  const context = vm.createContext({
    LockService: new MockLockService(),
    Utilities: MockUtilities,
    console: console
  });
  for (const file of ['Code.js', 'Logic.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  }
  return context;
}

console.log('=== Running Regression Tests ===\n');

test('GAS読み込み順: 今日の日付を指定した予定が今週・今月の画面に出る', () => {
  const gas = loadLikeGas();
  const ss = new MockSpreadsheet();
  gas.setSpreadsheetForTest(ss);
  gas.initSheets(ss);

  const today = Logic.getTodayStr();
  const res = gas.createTask({
    title: '週内の日付指定',
    periodType: '日付指定',
    specifiedDate: today,
    status: '検討中',
    createdBy: '教頭'
  });
  assert.strictEqual(res.success, true, res.error);

  const week = gas.getTasks('this_week');
  assert.strictEqual(week.success, true);
  assert.ok(week.tasks.some(t => t.taskId === res.task.taskId), '今週画面に含まれること');

  const month = gas.getTasks('this_month');
  assert.ok(month.tasks.some(t => t.taskId === res.task.taskId), '今月画面に含まれること');
});

test('GAS読み込み順: 修正でタイトル空・更新者なしは保存されない', () => {
  const gas = loadLikeGas();
  const ss = new MockSpreadsheet();
  gas.setSpreadsheetForTest(ss);
  gas.initSheets(ss);

  const created = gas.createTask({ title: '元の題名', periodType: '今週', status: '検討中', createdBy: '教頭' });
  assert.strictEqual(created.success, true, created.error);

  const res = gas.updateTask(created.task.taskId, { title: '', periodType: '今週', status: '検討中', updatedBy: '' });
  assert.strictEqual(res.success, false);
  assert.ok(res.error, '理由が返ること');

  const after = gas.getTasks('annual').tasks.find(t => t.taskId === created.task.taskId);
  assert.strictEqual(after.title, '元の題名');
});

/** History シートへの書き込みだけを失敗させる */
function breakHistoryWrites(ss) {
  const historySheet = ss.getSheetByName('History');
  const originalGetRange = historySheet.getRange.bind(historySheet);
  historySheet.getRange = (row, ...rest) => {
    const range = originalGetRange(row, ...rest);
    if (row > 1) {
      range.setValues = () => { throw new Error('simulated History write failure'); };
    }
    return range;
  };
}

function silenceConsoleError(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

test('難所A: 新規登録で History 書き込みに失敗したら Tasks に予定が残らない', () => {
  const ss = setupCleanEnvironment();
  breakHistoryWrites(ss);

  const res = silenceConsoleError(() => Code.createTask({
    title: '履歴なしで残ってはいけない予定', periodType: '今日', status: '検討中', createdBy: '教頭'
  }));

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, '処理できませんでした。もう一度操作してください。');
  assert.strictEqual(ss.getSheetByName('Tasks').getLastRow(), 1, 'Tasks はヘッダー行のみ');
  assert.strictEqual(ss.getSheetByName('History').getLastRow(), 1, 'History はヘッダー行のみ');
});

test('難所A: 修正・追記・状態変更で History 書き込みに失敗したら Tasks は元のまま', () => {
  const ss = setupCleanEnvironment();
  const created = Code.createTask({
    title: '元の題名', description: '元の内容', periodType: '今週', status: '進行中', createdBy: '教頭'
  });
  assert.strictEqual(created.success, true, created.error);
  const taskId = created.task.taskId;
  const before = JSON.stringify(ss.getSheetByName('Tasks').data);
  const historyRowsBefore = ss.getSheetByName('History').getLastRow();

  breakHistoryWrites(ss);

  const results = silenceConsoleError(() => [
    Code.updateTask(taskId, { title: '変更後', periodType: '今月', status: '進行中', updatedBy: '校長' }),
    Code.addTaskNote(taskId, { note: '追記', actor: '校長' }),
    Code.changeTaskStatus(taskId, { status: '完了', actor: '校長' })
  ]);

  results.forEach(r => assert.strictEqual(r.success, false));
  assert.strictEqual(JSON.stringify(ss.getSheetByName('Tasks').data), before, 'Tasks が変わっていないこと');
  assert.strictEqual(ss.getSheetByName('History').getLastRow(), historyRowsBefore, 'History が増えていないこと');
});

test('想定外のエラーは原因が開発者向けログに出る', () => {
  const ss = setupCleanEnvironment();
  breakHistoryWrites(ss);

  const logged = [];
  const original = console.error;
  console.error = (msg) => logged.push(String(msg));
  try {
    Code.createTask({ title: 'ログ確認', periodType: '今日', status: '検討中', createdBy: '教頭' });
  } finally {
    console.error = original;
  }
  assert.ok(logged.some(l => l.includes('createTask') && l.includes('simulated History write failure')));
});

test('Members に無い名前・無効メンバーでは登録・修正・追記・状態変更できない', () => {
  const ss = setupCleanEnvironment();
  ss.getSheetByName('Members').appendRow(['MEM-0099', '退職者', false, 99]);

  const bad = Code.createTask({ title: 'x', periodType: '今日', status: '検討中', createdBy: '知らない人' });
  assert.strictEqual(bad.success, false);
  assert.strictEqual(bad.error, '登録者は一覧から選んでください。');

  const badAssignee = Code.createTask({ title: 'x', periodType: '今日', status: '検討中', createdBy: '教頭', assignee: '退職者' });
  assert.strictEqual(badAssignee.success, false);
  assert.strictEqual(badAssignee.error, '担当は一覧から選んでください。');

  const ok = Code.createTask({ title: 'x', periodType: '今日', status: '検討中', createdBy: '教頭' });
  assert.strictEqual(ok.success, true, ok.error);
  const id = ok.task.taskId;

  assert.strictEqual(Code.updateTask(id, { title: 'y', periodType: '今日', status: '検討中', updatedBy: '退職者' }).success, false);
  assert.strictEqual(Code.addTaskNote(id, { note: 'n', actor: '知らない人' }).success, false);
  assert.strictEqual(Code.changeTaskStatus(id, { status: '完了', actor: '知らない人' }).success, false);
  assert.strictEqual(ss.getSheetByName('History').getLastRow(), 2, '新規登録の1件だけが記録されていること');
});

test('Members から外れた担当者が付いた予定も、担当を変えなければ修正できる', () => {
  const ss = setupCleanEnvironment();
  const created = Code.createTask({ title: 'x', periodType: '今日', status: '検討中', createdBy: '教頭', assignee: '養護教諭' });
  assert.strictEqual(created.success, true, created.error);
  const members = ss.getSheetByName('Members').data;
  members.find(r => r[1] === '養護教諭')[2] = false;

  const res = Code.updateTask(created.task.taskId, { title: 'y', periodType: '今日', status: '検討中', assignee: '養護教諭', updatedBy: '校長' });
  assert.strictEqual(res.success, true, res.error);
});

test('指示書第13項: 履歴は新しい順に返る', () => {
  setupCleanEnvironment();
  const created = Code.createTask({ title: '順序確認', periodType: '今週', status: '検討中', createdBy: '教頭' });
  const id = created.task.taskId;
  Code.addTaskNote(id, { note: '一つ目', actor: '校長' });
  Code.changeTaskStatus(id, { status: '進行中', actor: '教務主任' });

  const history = Code.getTaskHistory(id).history;
  assert.deepStrictEqual(history.map(h => h.actionType), ['状態変更', '追記', '新規登録']);
});

test('何も変えずに修正を保存しても、保存せず履歴も残さない', () => {
  const ss = setupCleanEnvironment();
  const created = Code.createTask({ title: '変更なし', periodType: '今週', status: '検討中', createdBy: '教頭' });
  const before = JSON.stringify(ss.getSheetByName('Tasks').data);

  const res = Code.updateTask(created.task.taskId, { title: '変更なし', periodType: '今週', status: '検討中', updatedBy: '校長' });
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('変更された項目がありません'));
  assert.strictEqual(JSON.stringify(ss.getSheetByName('Tasks').data), before, '更新者・更新日時も変わらないこと');
  assert.strictEqual(ss.getSheetByName('History').getLastRow(), 2, '新規登録の1件のみ');
});

test('同じ分に同じ予定を送ると2件目は作らず、作らなかったことを返す', () => {
  const ss = setupCleanEnvironment();
  const input = { title: '同じ予定', periodType: '今月', status: '検討中', createdBy: '教頭' };
  const first = Code.createTask(input);
  const second = Code.createTask(input);

  assert.strictEqual(first.success, true);
  assert.ok(!first.duplicate, '1件目は新規作成');
  assert.strictEqual(second.success, true);
  assert.strictEqual(second.duplicate, true, '2件目は作らなかったことが分かる');
  assert.strictEqual(second.task.taskId, first.task.taskId);
  assert.strictEqual(ss.getSheetByName('Tasks').getLastRow(), 2);
});

test('画面: 2件目を作らなかったときは「すでに登録されています」と知らせる', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.ok(html.includes('res.duplicate') && html.includes('同じ予定がすでに登録されています'));
});

test('historyId は UUID そのもの', () => {
  const ss = setupCleanEnvironment();
  Code.createTask({ title: 'ID確認', periodType: '今週', status: '検討中', createdBy: '教頭' });
  const historyId = ss.getSheetByName('History').data[1][0];
  assert.ok(!String(historyId).startsWith('HIST-'), historyId);
});

console.log(`\nRegression Tests Finished: Passed=${passedTests}, Failed=${failedTests}`);
if (failedTests > 0) {
  process.exit(1);
}
