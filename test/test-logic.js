/**
 * test/test-logic.js
 * 期間判定・業務ロジック・境界値テスト (Level 2 & 第48項)
 */

const assert = require('assert');
const Logic = require('../src/Logic');

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

console.log('=== Running Logic & Boundary Tests ===\n');

// 1. 日付・時刻フォーマットテスト
test('formatDate: JST基準の日付文字列(YYYY-MM-DD)', () => {
  const d = new Date('2026-10-03T12:00:00Z'); // UTC 12:00 -> JST 21:00
  const formatted = Logic.formatDate(d);
  assert.strictEqual(formatted, '2026-10-03');
});

test('formatDateTime: JST基準の日時文字列(YYYY/MM/DD HH:mm)', () => {
  const d = new Date('2026-10-03T03:05:00Z'); // UTC 03:05 -> JST 12:05
  const formatted = Logic.formatDateTime(d);
  assert.strictEqual(formatted, '2026/10/03 12:05');
});

test('getTodayStr: 省略時は現在日付のYYYY-MM-DDを返却', () => {
  const today = Logic.getTodayStr();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

// 2. 週の期間計算 (月曜〜日曜) テスト
test('getThisWeekRange: 通常週 (水曜日基準)', () => {
  // 2026-10-07 は水曜日
  const range = Logic.getThisWeekRange(new Date('2026-10-07T00:00:00Z'));
  assert.strictEqual(range.startStr, '2026-10-05', '月曜日開始であること');
  assert.strictEqual(range.endStr, '2026-10-11', '日曜日終了であること');
});

// 境界値テスト: 月曜日
test('getThisWeekRange: 境界値 月曜日基準 (2026-10-05)', () => {
  const range = Logic.getThisWeekRange(new Date('2026-10-05T09:00:00+09:00'));
  assert.strictEqual(range.startStr, '2026-10-05');
  assert.strictEqual(range.endStr, '2026-10-11');
});

// 境界値テスト: 日曜日
test('getThisWeekRange: 境界値 日曜日基準 (2026-10-11)', () => {
  const range = Logic.getThisWeekRange(new Date('2026-10-11T23:59:00+09:00'));
  assert.strictEqual(range.startStr, '2026-10-05');
  assert.strictEqual(range.endStr, '2026-10-11');
});

// 境界値テスト: 年末年始またぎの週 (2025-12-31は水曜, 2026-01-01は木曜)
test('getThisWeekRange: 境界値 年末年始またぎ週 (2025-12-31 水曜)', () => {
  const range = Logic.getThisWeekRange(new Date('2025-12-31T12:00:00+09:00'));
  assert.strictEqual(range.startStr, '2025-12-29'); // 月曜
  assert.strictEqual(range.endStr, '2026-01-04');   // 日曜
});

test('getThisWeekRange: 境界値 年末年始またぎ週 (2026-01-01 木曜)', () => {
  const range = Logic.getThisWeekRange(new Date('2026-01-01T12:00:00+09:00'));
  assert.strictEqual(range.startStr, '2025-12-29'); // 月曜
  assert.strictEqual(range.endStr, '2026-01-04');   // 日曜
});

// 3. 今月の期間計算テスト
test('getThisMonthRange: 通常月 (10月)', () => {
  const range = Logic.getThisMonthRange(new Date('2026-10-15T00:00:00+09:00'));
  assert.strictEqual(range.startStr, '2026-10-01');
  assert.strictEqual(range.endStr, '2026-10-31');
});

// 境界値テスト: 月初 (1日)
test('getThisMonthRange: 境界値 月初 (2026-10-01)', () => {
  const range = Logic.getThisMonthRange(new Date('2026-10-01T00:00:00+09:00'));
  assert.strictEqual(range.startStr, '2026-10-01');
  assert.strictEqual(range.endStr, '2026-10-31');
});

// 境界値テスト: 月末 (31日)
test('getThisMonthRange: 境界値 月末 (2026-10-31)', () => {
  const range = Logic.getThisMonthRange(new Date('2026-10-31T23:59:59+09:00'));
  assert.strictEqual(range.startStr, '2026-10-01');
  assert.strictEqual(range.endStr, '2026-10-31');
});

// 境界値テスト: 小の月 (4月, 6月, 9月, 11月) の月末
test('getThisMonthRange: 境界値 小の月末 (2026-11-30)', () => {
  const range = Logic.getThisMonthRange(new Date('2026-11-10T12:00:00+09:00'));
  assert.strictEqual(range.startStr, '2026-11-01');
  assert.strictEqual(range.endStr, '2026-11-30');
});

// 境界値テスト: うるう年の2月 (2024年 = 29日)
test('getThisMonthRange: 境界値 うるう年の2月 (2024-02-15)', () => {
  const range = Logic.getThisMonthRange(new Date('2024-02-15T12:00:00+09:00'));
  assert.strictEqual(range.startStr, '2024-02-01');
  assert.strictEqual(range.endStr, '2024-02-29');
});

// 境界値テスト: 平年の2月 (2025年 = 28日)
test('getThisMonthRange: 境界値 平年の2月 (2025-02-15)', () => {
  const range = Logic.getThisMonthRange(new Date('2025-02-15T12:00:00+09:00'));
  assert.strictEqual(range.startStr, '2025-02-01');
  assert.strictEqual(range.endStr, '2025-02-28');
});

// 4. ビュー別タスク判定 (isTaskInView / filterTasksByView)
const sampleTasks = [
  { taskId: 'T-1', title: '今日タスク', periodType: '今日', status: '進行中' },
  { taskId: 'T-2', title: '今週タスク', periodType: '今週', status: '進行中' },
  { taskId: 'T-3', title: '今月タスク', periodType: '今月', status: '進行中' },
  { taskId: 'T-4', title: '日付指定(今日)', periodType: '日付指定', specifiedDate: '2026-10-07', status: '進行中' },
  { taskId: 'T-5', title: '日付指定(今週金曜)', periodType: '日付指定', specifiedDate: '2026-10-09', status: '進行中' },
  { taskId: 'T-6', title: '日付指定(今月末)', periodType: '日付指定', specifiedDate: '2026-10-31', status: '進行中' },
  { taskId: 'T-7', title: '日付指定(翌月)', periodType: '日付指定', specifiedDate: '2026-11-05', status: '進行中' },
  { taskId: 'T-8', title: '年間タスク', periodType: '年間', status: '検討中' },
  { taskId: 'T-9', title: '未定タスク', periodType: '未定', status: '保留' },
  { taskId: 'T-10', title: '完了タスク', periodType: '今日', status: '完了' }
];

// 基準日: 2026-10-07 (水曜日)
const baseDate = new Date('2026-10-07T10:00:00+09:00');

test('filterTasksByView: today ビュー (今日 + specifiedDate=今日)', () => {
  const filtered = Logic.filterTasksByView(sampleTasks, 'today', baseDate);
  const ids = filtered.map(t => t.taskId);
  assert.deepStrictEqual(ids.sort(), ['T-1', 'T-10', 'T-4'].sort(), 'T-1(今日), T-4(2026-10-07), T-10(今日・完了)が含まれること');
});

test('filterTasksByView: this_week ビュー (今日 + 今週 + 今週内の指定日)', () => {
  const filtered = Logic.filterTasksByView(sampleTasks, 'this_week', baseDate);
  const ids = filtered.map(t => t.taskId);
  // 今週は 2026-10-05 〜 2026-10-11
  // 対象: T-1(今日), T-2(今週), T-4(10/7), T-5(10/9), T-10(今日・完了)
  assert.deepStrictEqual(ids.sort(), ['T-1', 'T-2', 'T-4', 'T-5', 'T-10'].sort());
});

test('filterTasksByView: this_month ビュー (今日 + 今週 + 今月 + 今月内の指定日)', () => {
  const filtered = Logic.filterTasksByView(sampleTasks, 'this_month', baseDate);
  const ids = filtered.map(t => t.taskId);
  // 今月は 2026-10-01 〜 2026-10-31
  // 対象: T-1(今日), T-2(今週), T-3(今月), T-4(10/7), T-5(10/9), T-6(10/31), T-10(今日・完了)
  assert.deepStrictEqual(ids.sort(), ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-10'].sort());
});

test('filterTasksByView: annual ビュー (全タスク対象)', () => {
  const filtered = Logic.filterTasksByView(sampleTasks, 'annual', baseDate);
  assert.strictEqual(filtered.length, sampleTasks.length, '全10件が返却されること');
});

// 5. バリデーション関数のテスト
test('validateTaskInput: 正常系 (新規作成)', () => {
  const input = {
    title: '運動会準備',
    periodType: '今週',
    status: '進行中',
    createdBy: '教頭'
  };
  const res = Logic.validateTaskInput(input, false);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.errors.length, 0);
});

test('validateTaskInput: 正常系 (日付指定)', () => {
  const input = {
    title: '職員会議',
    periodType: '日付指定',
    specifiedDate: '2026-10-15',
    status: '検討中',
    createdBy: '校長'
  };
  const res = Logic.validateTaskInput(input, false);
  assert.strictEqual(res.valid, true);
});

test('validateTaskInput: 異常系 (タイトル未入力)', () => {
  const input = {
    title: '   ',
    periodType: '今日',
    status: '進行中',
    createdBy: '教頭'
  };
  const res = Logic.validateTaskInput(input, false);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('タイトル')));
});

test('validateTaskInput: 異常系 (日付指定で指定日未入力または不正フォーマット)', () => {
  const inputNoDate = {
    title: '遠足',
    periodType: '日付指定',
    specifiedDate: '',
    status: '進行中',
    createdBy: '学年主任'
  };
  const res1 = Logic.validateTaskInput(inputNoDate, false);
  assert.strictEqual(res1.valid, false);

  const inputBadDate = {
    title: '遠足',
    periodType: '日付指定',
    specifiedDate: '2026/10/15', // スラッシュ形式はNG
    status: '進行中',
    createdBy: '学年主任'
  };
  const res2 = Logic.validateTaskInput(inputBadDate, false);
  assert.strictEqual(res2.valid, false);
});

test('validateTaskInput: 異常系 (無効な日付 2026-02-30)', () => {
  const res = Logic.isValidDateStr('2026-02-30');
  assert.strictEqual(res, false, '存在しない日付は無効');
});

test('validateTaskInput: 正常系 (うるう年 2024-02-29)', () => {
  const res = Logic.isValidDateStr('2024-02-29');
  assert.strictEqual(res, true, 'うるう年の2月29日は有効');
});

test('validateNoteInput: 追記バリデーション', () => {
  const validNote = Logic.validateNoteInput({ note: '写真素材受領', actor: '教務主任' });
  assert.strictEqual(validNote.valid, true);

  const emptyNote = Logic.validateNoteInput({ note: '   ', actor: '教務主任' });
  assert.strictEqual(emptyNote.valid, false);

  const noActor = Logic.validateNoteInput({ note: '写真素材受領', actor: '' });
  assert.strictEqual(noActor.valid, false);
});

test('validateStatusInput: ステータスバリデーション', () => {
  const valid = Logic.validateStatusInput({ status: '完了', actor: '校長' });
  assert.strictEqual(valid.valid, true);

  const invalidStatus = Logic.validateStatusInput({ status: '存在しない状態', actor: '校長' });
  assert.strictEqual(invalidStatus.valid, false);
});

console.log(`\nLogic Tests Finished: Passed=${passedTests}, Failed=${failedTests}`);
if (failedTests > 0) {
  process.exit(1);
}
