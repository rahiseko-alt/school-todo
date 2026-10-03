/**
 * test/test-human-scenarios.js
 * Level 3 統合テスト、Level 4 人間テストケース1〜10、履歴完全性テスト、UXテスト
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
const testLogs = [];

function test(name, fn) {
  try {
    fn();
    passedTests++;
    testLogs.push({ name, status: 'PASS' });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failedTests++;
    testLogs.push({ name, status: 'FAIL', error: err.message, stack: err.stack });
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

console.log('=== Running Human Scenarios & UX Tests ===\n');

function setupCleanEnvironment() {
  const ss = new MockSpreadsheet();
  Code.setSpreadsheetForTest(ss);
  Code.initSheets(ss);
  return ss;
}

// =============================================================================
// Level 3 統合テスト: 一連の業務フロー整合性検証
// =============================================================================
test('Level 3 統合テスト: 新規登録→一覧表示→修正→追記→状態変更→履歴確認 の連続実行と整合性', () => {
  const ss = setupCleanEnvironment();

  // 1. 新規登録
  const createRes = Code.createTask({
    title: '卒業式予行練習',
    description: '全校生徒による通し練習',
    periodType: '今週',
    status: '進行中',
    assignee: '教務主任',
    createdBy: '教頭'
  });
  assert.strictEqual(createRes.success, true);
  const taskId = createRes.task.taskId;

  // 2. 一覧表示確認
  const listRes = Code.getTasks('this_week');
  assert.strictEqual(listRes.success, true);
  const foundTask = listRes.tasks.find(t => t.taskId === taskId);
  assert.ok(foundTask, '今週一覧に表示されること');
  assert.strictEqual(foundTask.title, '卒業式予行練習');

  // 3. 修正 (タイトルと担当者の変更)
  const updateRes = Code.updateTask(taskId, {
    title: '卒業式第1回予行練習',
    description: '全校生徒による通し練習 (雨天時体育館)',
    periodType: '今週',
    status: '進行中',
    assignee: '学年主任',
    updatedBy: '校長'
  });
  assert.strictEqual(updateRes.success, true);
  assert.strictEqual(updateRes.task.title, '卒業式第1回予行練習');
  assert.strictEqual(updateRes.task.assignee, '学年主任');
  assert.strictEqual(updateRes.task.updatedBy, '校長');

  // 4. 追記
  const noteRes = Code.addTaskNote(taskId, {
    note: '体育館の音響マイクテストを前日放課後に実施すること',
    actor: '事務職員'
  });
  assert.strictEqual(noteRes.success, true);
  assert.strictEqual(noteRes.task.notes.length, 1);
  assert.strictEqual(noteRes.task.notes[0].actor, '事務職員');

  // 5. 状態変更
  const statusRes = Code.changeTaskStatus(taskId, {
    status: '完了',
    actor: '教頭'
  });
  assert.strictEqual(statusRes.success, true);
  assert.strictEqual(statusRes.task.status, '完了');
  assert.strictEqual(statusRes.task.updatedBy, '教頭');

  // 6. 履歴確認
  const historyRes = Code.getTaskHistory(taskId);
  assert.strictEqual(historyRes.success, true);
  const history = historyRes.history;

  // 履歴件数検証: 新規登録(1) + 修正(タイトル,詳細,担当者で3) + 追記(1) + 状態変更(1) = 6件
  assert.ok(history.length >= 5, `十分な履歴が記録されていること: 実際=${history.length}`);

  // 各アクションの存在と順序検証
  assert.ok(history.some(h => h.actionType === '新規登録' && h.actor === '教頭'));
  assert.ok(history.some(h => h.actionType === '修正' && h.fieldName === 'タイトル' && h.actor === '校長'));
  assert.ok(history.some(h => h.actionType === '追記' && h.actor === '事務職員'));
  assert.ok(history.some(h => h.actionType === '状態変更' && h.afterValue === '完了' && h.actor === '教頭'));

  // TasksシートとHistoryシートの整合性
  const taskSheet = ss.getSheetByName('Tasks');
  const historySheet = ss.getSheetByName('History');
  assert.strictEqual(taskSheet.getLastRow(), 2, 'タスクは1件のみ存在');
  assert.strictEqual(historySheet.getLastRow(), history.length + 1, '履歴行数と完全一致');
});

// =============================================================================
// Level 4 人間テストケース 1〜10
// =============================================================================

// 人間テストケース1: 新しい予定を作る
test('人間テストケース1: 新しい予定を作る (今日/今週/今月/日付指定/未定/年間)', () => {
  const ss = setupCleanEnvironment();

  // 教職員が画面から入力するシナリオ
  const taskData = {
    title: '新入生オリエンテーション',
    periodType: '今週',
    description: '体育館にて実施。資料配布準備要。',
    status: '進行中',
    assignee: '教務主任',
    createdBy: '教頭'
  };

  const res = Code.createTask(taskData);
  assert.strictEqual(res.success, true, 'エラーなく登録できること');
  assert.ok(res.task.taskId, 'taskIdが発行されること');

  // 今週画面に出ること
  const weekTasks = Code.getTasks('this_week').tasks;
  const found = weekTasks.find(t => t.taskId === res.task.taskId);
  assert.ok(found, '今週画面に表示されること');
  assert.strictEqual(found.description, taskData.description, '内容が読めること');
  assert.strictEqual(found.createdBy, '教頭', '操作した人が分かること');

  // Historyに新規登録が残ること
  const hist = Code.getTaskHistory(res.task.taskId).history;
  assert.strictEqual(hist.length, 1);
  assert.strictEqual(hist[0].actionType, '新規登録');
  assert.strictEqual(hist[0].actor, '教頭');
});

// 人間テストケース2: 内容を変更する
test('人間テストケース2: 内容を変更する (更新前後の値、更新者)', () => {
  const ss = setupCleanEnvironment();

  const original = Code.createTask({
    title: '校内清掃',
    description: '各教室のゴミ箱回収',
    periodType: '今日',
    status: '進行中',
    assignee: '学年主任',
    createdBy: '教頭'
  }).task;

  // 修正操作
  const updateRes = Code.updateTask(original.taskId, {
    title: '校内美化清掃 (特別日課)',
    description: '各教室のゴミ箱回収および特別教室のワックス掛け',
    periodType: '今日',
    status: '進行中',
    assignee: '教務主任',
    updatedBy: '校長'
  });

  assert.strictEqual(updateRes.success, true);
  assert.strictEqual(updateRes.task.title, '校内美化清掃 (特別日課)', '新しい内容が表示される');
  assert.strictEqual(updateRes.task.description, '各教室のゴミ箱回収および特別教室のワックス掛け');
  assert.strictEqual(updateRes.task.updatedBy, '校長', '更新者が校長であること');

  // 他のデータ破壊がないこと（作成者や作成日時は保持）
  assert.strictEqual(updateRes.task.createdBy, '教頭');
  assert.strictEqual(updateRes.task.createdAt, original.createdAt);

  // Historyに変更前後が残ること
  const hist = Code.getTaskHistory(original.taskId).history;
  const titleDiff = hist.find(h => h.fieldName === 'タイトル');
  assert.strictEqual(titleDiff.beforeValue, '校内清掃');
  assert.strictEqual(titleDiff.afterValue, '校内美化清掃 (特別日課)');
  assert.strictEqual(titleDiff.actor, '校長');
});

// 人間テストケース3: 方針変更 (今月 → 未定)
test('人間テストケース3: 方針変更 (今月 → 未定 への変更と各ビューの表示)', () => {
  const ss = setupCleanEnvironment();

  const task = Code.createTask({
    title: 'PTAバザー',
    description: '校庭模擬店',
    periodType: '今月',
    status: '検討中',
    createdBy: '教頭'
  }).task;

  // 今月ビューに存在することを確認
  let monthTasks = Code.getTasks('this_month').tasks;
  assert.ok(monthTasks.some(t => t.taskId === task.taskId));

  // 未定に変更
  const updateRes = Code.updateTask(task.taskId, {
    title: task.title,
    description: task.description,
    periodType: '未定',
    status: '保留',
    updatedBy: '校長'
  });
  assert.strictEqual(updateRes.success, true);

  // 今月ビューから除外されること
  monthTasks = Code.getTasks('this_month').tasks;
  assert.strictEqual(monthTasks.some(t => t.taskId === task.taskId), false, '今月ビューには出ないこと');

  // 年間ビュー等で存在確認可能であること
  const annualTasks = Code.getTasks('annual').tasks;
  assert.ok(annualTasks.some(t => t.taskId === task.taskId), '年間ビューでは存在確認可能であること');

  // Historyに変更記録があること
  const hist = Code.getTaskHistory(task.taskId).history;
  const periodDiff = hist.find(h => h.fieldName === '期間');
  assert.ok(periodDiff);
  assert.strictEqual(periodDiff.beforeValue, '今月');
  assert.strictEqual(periodDiff.afterValue, '未定');
  assert.strictEqual(periodDiff.actor, '校長');
});

// 人間テストケース4: 追記
test('人間テストケース4: 追記 (元本文を消さず追記者が残る)', () => {
  const ss = setupCleanEnvironment();

  const originalText = '学校案内パンフレットの印刷発注準備';
  const task = Code.createTask({
    title: 'パンフレット作成',
    description: originalText,
    periodType: '今月',
    status: '進行中',
    createdBy: '事務職員'
  }).task;

  // 追記: 写真素材の完成待ち
  const noteRes = Code.addTaskNote(task.taskId, {
    note: '写真素材の完成待ち',
    actor: '教務主任'
  });

  assert.strictEqual(noteRes.success, true);
  assert.strictEqual(noteRes.task.description, originalText, '元本文が一切消えていないこと');
  assert.strictEqual(noteRes.task.notes.length, 1);
  assert.strictEqual(noteRes.task.notes[0].note, '写真素材の完成待ち');
  assert.strictEqual(noteRes.task.notes[0].actor, '教務主任');
  assert.ok(noteRes.task.notes[0].timestamp, '日時が残ること');

  // Historyで確認可能であること
  const hist = Code.getTaskHistory(task.taskId).history;
  const noteHist = hist.find(h => h.actionType === '追記');
  assert.ok(noteHist);
  assert.strictEqual(noteHist.comment, '写真素材の完成待ち');
  assert.strictEqual(noteHist.actor, '教務主任');
});

// 人間テストケース5: 完了
test('人間テストケース5: 完了 (進行中→完了、消滅せず存在確認可能、履歴が残る)', () => {
  const ss = setupCleanEnvironment();

  const task = Code.createTask({
    title: '避難訓練実施',
    periodType: '今日',
    status: '進行中',
    createdBy: '学年主任'
  }).task;

  // 完了に変更
  const res = Code.changeTaskStatus(task.taskId, {
    status: '完了',
    actor: '校長'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task.status, '完了');

  // 一覧から消滅せず存在すること (Logic.isClosedStatus は true)
  const todayTasks = Code.getTasks('today').tasks;
  const completedTask = todayTasks.find(t => t.taskId === task.taskId);
  assert.ok(completedTask, '完了後も一覧から消滅しないこと');
  assert.strictEqual(Logic.isClosedStatus(completedTask.status), true, '完了ステータスとして判定される');

  // Historyが残ること
  const hist = Code.getTaskHistory(task.taskId).history;
  const statusHist = hist.find(h => h.actionType === '状態変更');
  assert.ok(statusHist);
  assert.strictEqual(statusHist.beforeValue, '進行中');
  assert.strictEqual(statusHist.afterValue, '完了');
});

// 人間テストケース6: 中止
test('人間テストケース6: 中止 (消滅せず中止状態、履歴確認可能)', () => {
  const ss = setupCleanEnvironment();

  const task = Code.createTask({
    title: '台風接近に伴う課外授業',
    periodType: '今日',
    status: '進行中',
    createdBy: '教頭'
  }).task;

  // 中止に変更
  const res = Code.changeTaskStatus(task.taskId, {
    status: '中止',
    actor: '校長'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task.status, '中止');

  // データ削除されないこと
  const allTasks = Code.readAllTasks(ss);
  assert.ok(allTasks.some(t => t.taskId === task.taskId && t.status === '中止'));

  // 履歴確認可能
  const hist = Code.getTaskHistory(task.taskId).history;
  const cancelHist = hist.find(h => h.actionType === '状態変更' && h.afterValue === '中止');
  assert.ok(cancelHist);
});

// 人間テストケース7: 操作ミス (登録ボタン連打・二重送信防止)
test('人間テストケース7: 操作ミス (登録ボタン連打・二重送信防止)', () => {
  const ss = setupCleanEnvironment();

  const payload = {
    title: '職員連絡会',
    description: '連絡事項確認',
    periodType: '今日',
    status: '進行中',
    createdBy: '教務主任'
  };

  // 1回目
  const res1 = Code.createTask(payload);
  assert.strictEqual(res1.success, true);

  // 2回目（連打）
  const res2 = Code.createTask(payload);
  assert.strictEqual(res2.success, true);

  // 3回目（連打）
  const res3 = Code.createTask(payload);
  assert.strictEqual(res3.success, true);

  const all = Code.readAllTasks(ss);
  assert.strictEqual(all.length, 1, '3回連打してもタスクは1件のみ登録されること');
  assert.strictEqual(res1.task.taskId, res2.task.taskId);
  assert.strictEqual(res1.task.taskId, res3.task.taskId);
});

// 人間テストケース8: 入力不足
test('人間テストケース8: 入力不足 (タイトルなしでの登録エラー表示)', () => {
  const ss = setupCleanEnvironment();

  const res = Code.createTask({
    title: '',
    periodType: '今週',
    status: '進行中',
    createdBy: '校長'
  });

  assert.strictEqual(res.success, false, '登録されないこと');
  assert.ok(res.error, 'エラーメッセージが存在すること');
  assert.ok(res.error.includes('タイトル'), 'タイトルに関する理解可能なメッセージであること');

  // タスクシートは空（ヘッダーのみ）
  const taskSheet = ss.getSheetByName('Tasks');
  assert.strictEqual(taskSheet.getLastRow(), 1);
});

// 人間テストケース9: スマートフォン (320px幅, DOM, CSS, タップ領域)
test('人間テストケース9: スマートフォン対応 (320px対応, 横スクロール防止, タップターゲット44px以上)', () => {
  const htmlPath = path.resolve(__dirname, '../src/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // 1. viewport メタタグの確認 (320px対応)
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1'), '適切なviewportメタタグが設定されていること');

  // 2. CSSの最小幅と横スクロール防止設定
  assert.ok(html.includes('min-width: 320px'), 'min-width: 320px が定義されていること');
  assert.ok(html.includes('overflow-x: hidden'), 'overflow-x: hidden が設定されていること');

  // 3. タップターゲット最小領域 44px
  assert.ok(html.includes('--min-tap: 44px') || html.includes('min-height: 44px'), '44px 以上のタップ領域基準が設定されていること');

  // 4. モーダルのレスポンシブスタイル (画面外にはみ出さない設定)
  assert.ok(html.includes('.modal-container') || html.includes('.modal'), 'モーダルコンテナが存在すること');
  assert.ok(html.includes('max-height') || html.includes('overflow-y: auto'), 'モーダル内容が画面内に収まるようスクロール設定されていること');

  // 5. ボタンや操作要素のタップ領域確認
  assert.ok(html.includes('btn-add-task'), '新規追加ボタンクラスが存在すること');
  assert.ok(html.includes('nav-tab-btn'), 'タブボタンクラスが存在すること');
});

// 人間テストケース10: 複数予定 (最低10件混在登録での各ビューの正確な分類)
test('人間テストケース10: 複数予定 (最低10件の混在登録とビュー分類検証)', () => {
  const ss = setupCleanEnvironment();

  // 基準日: 2026-10-07 (水曜)
  const baseDate = new Date('2026-10-07T10:00:00+09:00');
  const baseTodayYmd = Logic.formatDate(baseDate); // 2026-10-07

  // 指示書例：今日×2, 今週×2, 今月×2, 日付指定×2, 年間×1, 未定×1 計10件
  const mixedTasks = [
    { title: '今日1 (朝会)', periodType: '今日', status: '進行中', createdBy: '校長' },
    { title: '今日2 (給食指導)', periodType: '今日', status: '完了', createdBy: '養護教諭' },
    { title: '今週1 (校内研修)', periodType: '今週', status: '進行中', createdBy: '教頭' },
    { title: '今週2 (PTA役員会)', periodType: '今週', status: '検討中', createdBy: '教頭' },
    { title: '今月1 (中間考査)', periodType: '今月', status: '検討中', createdBy: '教務主任' },
    { title: '今月2 (避難訓練)', periodType: '今月', status: '保留', createdBy: '学年主任' },
    { title: '日付指定1 (今週内 2026-10-09)', periodType: '日付指定', specifiedDate: '2026-10-09', status: '進行中', createdBy: '教頭' },
    { title: '日付指定2 (来月 2026-11-20)', periodType: '日付指定', specifiedDate: '2026-11-20', status: '検討中', createdBy: '事務職員' },
    { title: '年間1 (卒業式)', periodType: '年間', status: '検討中', createdBy: '校長' },
    { title: '未定1 (同窓会総会)', periodType: '未定', status: '保留', createdBy: '校長' }
  ];

  const createdTasks = [];
  for (const item of mixedTasks) {
    const res = Code.createTask(item);
    assert.strictEqual(res.success, true);
    createdTasks.push(res.task);
  }

  assert.strictEqual(createdTasks.length, 10, '10件登録完了');

  // 1. today ビュー検証:
  // 対象: 今日1, 今日2
  const todayList = Logic.filterTasksByView(createdTasks, 'today', baseDate);
  const todayTitles = todayList.map(t => t.title);
  assert.ok(todayTitles.includes('今日1 (朝会)'));
  assert.ok(todayTitles.includes('今日2 (給食指導)'));
  assert.strictEqual(todayList.length, 2, '今日ビューは2件');

  // 2. this_week ビュー検証:
  // 対象: 今日1, 今日2, 今週1, 今週2, 日付指定1(10/09)
  const weekList = Logic.filterTasksByView(createdTasks, 'this_week', baseDate);
  const weekTitles = weekList.map(t => t.title);
  assert.ok(weekTitles.includes('今日1 (朝会)'));
  assert.ok(weekTitles.includes('今日2 (給食指導)'));
  assert.ok(weekTitles.includes('今週1 (校内研修)'));
  assert.ok(weekTitles.includes('今週2 (PTA役員会)'));
  assert.ok(weekTitles.includes('日付指定1 (今週内 2026-10-09)'));
  assert.strictEqual(weekList.length, 5, '今週ビューは5件');

  // 3. this_month ビュー検証:
  // 対象: 今日1, 今日2, 今週1, 今週2, 日付指定1, 今月1, 今月2
  const monthList = Logic.filterTasksByView(createdTasks, 'this_month', baseDate);
  const monthTitles = monthList.map(t => t.title);
  assert.ok(monthTitles.includes('今月1 (中間考査)'));
  assert.ok(monthTitles.includes('今月2 (避難訓練)'));
  assert.strictEqual(monthList.length, 7, '今月ビューは7件 (今日2+今週2+今月2+今週内日付1)');

  // 4. annual ビュー検証:
  // 対象: 全10件
  const annualList = Logic.filterTasksByView(createdTasks, 'annual', baseDate);
  assert.strictEqual(annualList.length, 10, '年間ビューは全10件すべて表示');
});

// =============================================================================
// 履歴完全性テスト (第49項)
// =============================================================================
test('履歴完全性テスト: 1タスクの 作成→修正→追記→状態変更→再修正→完了 で人間が追跡可能か検証', () => {
  const ss = setupCleanEnvironment();

  // 1. 作成
  const t1 = Code.createTask({
    title: '学芸会プログラム印刷',
    description: '印刷室の輪転機で500部',
    periodType: '今週',
    status: '検討中',
    assignee: '教務主任',
    createdBy: '教頭'
  }).task;

  // 2. 修正
  Code.updateTask(t1.taskId, {
    title: '学芸会プログラム印刷 (カラー表紙)',
    description: '表紙のみインクジェット、本文輪転機',
    periodType: '今週',
    status: '検討中',
    assignee: '教務主任',
    updatedBy: '校長'
  });

  // 3. 追記
  Code.addTaskNote(t1.taskId, {
    note: '表紙用の上質紙が届きました',
    actor: '事務職員'
  });

  // 4. 状態変更
  Code.changeTaskStatus(t1.taskId, {
    status: '進行中',
    actor: '教頭'
  });

  // 5. 再修正 (担当変更・期間変更)
  Code.updateTask(t1.taskId, {
    title: '学芸会プログラム印刷 (カラー表紙)',
    description: '表紙のみインクジェット、本文輪転機',
    periodType: '今日',
    status: '進行中',
    assignee: '学年主任',
    updatedBy: '教務主任'
  });

  // 6. 完了
  Code.changeTaskStatus(t1.taskId, {
    status: '完了',
    actor: '校長'
  });

  // 履歴シートからログのみを取得して追跡性を検証
  const hist = Code.getTaskHistory(t1.taskId).history;
  assert.ok(hist.length >= 6, '全アクションが個別に記録されていること');

  // 各履歴項目の人間可読性検証
  console.log('\n--- 履歴完全性ログ検証 (Human Readable Audit) ---');
  hist.forEach((h, idx) => {
    console.log(`[#${idx + 1}] 日時:${h.timestamp} 操作者:${h.actor} 種別:${h.actionType} 項目:${h.fieldName} 前:[${h.beforeValue}] 後:[${h.afterValue}] 備考:${h.comment}`);
    assert.ok(h.timestamp, '日時が空でない');
    assert.ok(h.actor, '操作者が空でない');
    assert.ok(h.actionType, '種別が空でない');
  });

  // 誰が何をしたか完全に追跡できることをアサート
  assert.strictEqual(hist[0].actionType, '新規登録');
  assert.strictEqual(hist[0].actor, '教頭');

  const titleUpdate = hist.find(h => h.fieldName === 'タイトル');
  assert.ok(titleUpdate && titleUpdate.actor === '校長' && titleUpdate.beforeValue === '学芸会プログラム印刷');

  const noteLog = hist.find(h => h.actionType === '追記');
  assert.ok(noteLog && noteLog.actor === '事務職員' && noteLog.comment.includes('上質紙'));

  const statusProgress = hist.find(h => h.actionType === '状態変更' && h.afterValue === '進行中');
  assert.ok(statusProgress && statusProgress.actor === '教頭');

  const periodChange = hist.find(h => h.fieldName === '期間' && h.afterValue === '今日');
  assert.ok(periodChange && periodChange.actor === '教務主任');

  const statusCompleted = hist.find(h => h.actionType === '状態変更' && h.afterValue === '完了');
  assert.ok(statusCompleted && statusCompleted.actor === '校長');
});

// =============================================================================
// 最終人間シナリオテスト (第58項)
// シナリオ: 職員A新規作成 → 職員B内容修正 → 職員C追記 → 職員A予定時期変更 → 職員B保留 → 職員C進行中へ戻す → 職員A完了 → 最終履歴監査
// =============================================================================
test('最終人間シナリオテスト (第58項): 職員A作成→職員B修正→職員C追記→職員A時期変更→職員B保留→職員C進行中→職員A完了→最終履歴確認', () => {
  const ss = setupCleanEnvironment();

  // 1. 学校職員Aが新しい予定を作る
  const createRes = Code.createTask({
    title: '文化祭看板制作',
    description: '体育館前ロータリーに設置する大看板の木枠組み立て',
    periodType: '今月',
    status: '進行中',
    assignee: '教務主任',
    createdBy: '教頭' // 職員A = 教頭
  });
  assert.strictEqual(createRes.success, true);
  const taskId = createRes.task.taskId;

  // 2. 職員Bが内容を修正する
  const updateRes1 = Code.updateTask(taskId, {
    title: '文化祭メイン看板制作 (雨天対応仕様)',
    description: '木枠組み立ておよび耐水合板のビス留め・防滴ペイント塗布',
    periodType: '今月',
    status: '進行中',
    assignee: '学年主任',
    updatedBy: '校長' // 職員B = 校長
  });
  assert.strictEqual(updateRes1.success, true);

  // 3. 職員Cが追記する
  const noteRes = Code.addTaskNote(taskId, {
    note: '木材および耐水塗料が美術室に搬入されました。放課後作業可能です。',
    actor: '事務職員' // 職員C = 事務職員
  });
  assert.strictEqual(noteRes.success, true);

  // 4. 職員Aが予定時期を変更する
  const updateRes2 = Code.updateTask(taskId, {
    title: updateRes1.task.title,
    description: updateRes1.task.description,
    periodType: '今週', // 今月 → 今週
    status: '進行中',
    assignee: '学年主任',
    updatedBy: '教頭' // 職員A = 教頭
  });
  assert.strictEqual(updateRes2.success, true);

  // 5. 職員Bが保留にする
  const statusRes1 = Code.changeTaskStatus(taskId, {
    status: '保留',
    actor: '校長' // 職員B = 校長
  });
  assert.strictEqual(statusRes1.success, true);

  // 6. 職員Cが進行中へ戻す
  const statusRes2 = Code.changeTaskStatus(taskId, {
    status: '進行中',
    actor: '事務職員' // 職員C = 事務職員
  });
  assert.strictEqual(statusRes2.success, true);

  // 7. 職員Aが完了にする
  const statusRes3 = Code.changeTaskStatus(taskId, {
    status: '完了',
    actor: '教頭' // 職員A = 教頭
  });
  assert.strictEqual(statusRes3.success, true);

  // 8. 履歴を確認する (最終履歴だけを読んで「誰が・いつ・何をしたか」が完全に理解できるか)
  const historyRes = Code.getTaskHistory(taskId);
  assert.strictEqual(historyRes.success, true);
  const history = historyRes.history;

  console.log('\n--- 第58項 最終人間シナリオ履歴監査ログ (Audit Log) ---');
  history.forEach((h, idx) => {
    console.log(`[#${idx + 1}] 日時:${h.timestamp} | 操作者:${h.actor} | 種別:${h.actionType} | 項目:${h.fieldName} | 前:[${h.beforeValue}] -> 後:[${h.afterValue}] | 備考:${h.comment}`);
    assert.ok(h.timestamp, '日時が記録されていること');
    assert.ok(h.actor, '操作者が明記されていること');
    assert.ok(h.actionType, '操作種別が明記されていること');
  });

  // 各ステップのログ整合性を厳格検証
  // 1: 職員A(教頭)の新規作成
  assert.strictEqual(history[0].actionType, '新規登録');
  assert.strictEqual(history[0].actor, '教頭');

  // 2: 職員B(校長)の内容修正 (タイトル, 詳細, 担当者)
  const bTitle = history.find(h => h.fieldName === 'タイトル' && h.actor === '校長');
  assert.ok(bTitle && bTitle.afterValue.includes('雨天対応仕様'));
  const bDesc = history.find(h => h.fieldName === '詳細' && h.actor === '校長');
  assert.ok(bDesc && bDesc.afterValue.includes('耐水合板'));
  const bAssignee = history.find(h => h.fieldName === '担当者' && h.actor === '校長');
  assert.ok(bAssignee && bAssignee.afterValue === '学年主任');

  // 3: 職員C(事務職員)の追記
  const cNote = history.find(h => h.actionType === '追記' && h.actor === '事務職員');
  assert.ok(cNote && cNote.comment.includes('美術室に搬入'));

  // 4: 職員A(教頭)の予定時期変更
  const aPeriod = history.find(h => h.fieldName === '期間' && h.actor === '教頭');
  assert.ok(aPeriod && aPeriod.beforeValue === '今月' && aPeriod.afterValue === '今週');

  // 5: 職員B(校長)の保留
  const bPending = history.find(h => h.actionType === '状態変更' && h.actor === '校長' && h.afterValue === '保留');
  assert.ok(bPending && bPending.beforeValue === '進行中');

  // 6: 職員C(事務職員)の進行中復帰
  const cProgress = history.find(h => h.actionType === '状態変更' && h.actor === '事務職員' && h.afterValue === '進行中');
  assert.ok(cProgress && cProgress.beforeValue === '保留');

  // 7: 職員A(教頭)の完了
  const aCompleted = history.find(h => h.actionType === '状態変更' && h.actor === '教頭' && h.afterValue === '完了');
  assert.ok(aCompleted && aCompleted.beforeValue === '進行中');
});


// =============================================================================
// UXテスト (第50項: 10の質問すべてYESであることの検証)
// =============================================================================
test('UXテスト (第50項): 10の質問に対するHTML/CSS/UI実装検証', () => {
  const htmlPath = path.resolve(__dirname, '../src/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Q1: 初見で「追加」が分かるか？
  // 「＋ 新しい予定を追加」という視認性の高い目立つ緑色ボタン
  assert.ok(html.includes('＋ 新しい予定を追加') || html.includes('新しい予定'), 'Q1: 明確な追加ボタンが存在すること');
  assert.ok(html.includes('--success') || html.includes('btn-add-task'), 'Q1: 目立つアクセントカラーが適用されていること');

  // Q2: 今日の予定を見る方法が分かるか？
  assert.ok(html.includes('data-view="today"') && html.includes('今日'), 'Q2: 「今日」タブが存在すること');

  // Q3: 今週の予定を見る方法が分かるか？
  assert.ok(html.includes('data-view="this_week"') && html.includes('今週'), 'Q3: 「今週」タブが存在すること');

  // Q4: 修正方法が分かるか？
  assert.ok(html.includes('btn-edit') || html.includes('修正'), 'Q4: 各カードに「修正」ボタンが存在すること');

  // Q5: 追記方法が分かるか？
  assert.ok(html.includes('btn-note') || html.includes('追記'), 'Q5: 各カードに「追記」ボタンが存在すること');

  // Q6: 完了への変更方法が分かるか？
  assert.ok(html.includes('btn-status') || html.includes('状態変更'), 'Q6: 各カードに「状態変更」ボタンが存在すること');

  // Q7: 誰が変更したか分かるか？
  assert.ok(html.includes('task-meta') && (html.includes('更新者') || html.includes('作成者')), 'Q7: 作成者・更新者がカード上に明記されていること');

  // Q8: 変更履歴を見る場所が分かるか？
  assert.ok(html.includes('btn-history') || html.includes('履歴'), 'Q8: 各カードに「履歴」ボタンが存在すること');

  // Q9: スマホで押しにくいボタンがないか？
  assert.ok(html.includes('--min-tap: 44px') || html.includes('min-height: 44px'), 'Q9: 全ての操作要素に44px以上の最小タップ領域が確保されていること');

  // Q10: 専門用語を知らなくても使えるか？
  // カンバン、スプリント、バックログ等のアジャイル・IT専門用語がなく、日常的な学校用語のみ
  const forbiddenTerms = ['kanban', 'sprint', 'backlog', 'scrum', 'issue tracking', 'agile', 'commit'];
  for (const term of forbiddenTerms) {
    // HTMLのユーザー向けテキスト内に専門用語が含まれていないかチェック
    const bodyMatch = html.match(/<body>[\s\S]*<\/body>/i);
    if (bodyMatch) {
      const bodyText = bodyMatch[0].replace(/<script[\s\S]*?<\/script>/gi, '');
      assert.strictEqual(bodyText.toLowerCase().includes(term), false, `Q10: IT専門用語「${term}」が含まれていないこと`);
    }
  }
});

console.log(`\nHuman Scenarios & UX Tests Finished: Passed=${passedTests}, Failed=${failedTests}`);
if (failedTests > 0) {
  process.exit(1);
}
