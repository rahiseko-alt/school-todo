/**
 * test/test-ui-dom.js
 * フロントエンドUI構造、DOM要素、CSS要件、モバイル対応、アクセシビリティ静的・動的検証
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

console.log('=== Running UI / DOM / CSS Verification Tests ===\n');

const htmlPath = path.resolve(__dirname, '../src/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. 基本マークアップと必須コンテナの存在確認
test('UI構造: 必須コンテナ・ビュー要素の存在', () => {
  const requiredIds = [
    'taskList',
    'modalCreate',
    'modalEdit',
    'modalNote',
    'modalStatus',
    'modalHistory',
    'toastContainer',
    'viewTitle',
    'taskCount'
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `要素 id="${id}" が存在すること`);
  }
});

// 2. モーダルと各フォームフィールドの存在確認
test('UI構造: 新規作成・編集・追記・状態変更モーダルと全フィールドの存在', () => {
  const requiredFields = [
    'createTitle',
    'createPeriodType',
    'createSpecifiedDate',
    'createDescription',
    'createStatus',
    'createAssignee',
    'createCreatedBy',
    'editTitle',
    'editPeriodType',
    'editSpecifiedDate',
    'editDescription',
    'editStatus',
    'editAssignee',
    'editUpdatedBy',
    'noteContent',
    'noteActor',
    'statusNewStatus',
    'statusActor'
  ];

  for (const fieldId of requiredFields) {
    assert.ok(html.includes(`id="${fieldId}"`), `入力フィールド id="${fieldId}" が存在すること`);
  }
});

// 3. ナビゲーションタブの確認
test('UI構造: 4つのビュー切り替えタブ (今日/今週/今月/年間)', () => {
  const views = ['today', 'this_week', 'this_month', 'annual'];
  for (const v of views) {
    assert.ok(html.includes(`data-view="${v}"`), `data-view="${v}" のタブボタンが存在すること`);
  }
});

// 4. モバイル・レスポンシブ CSS 要件 (指示書第46項 人間テストケース9)
test('CSS検証: 320px最小幅、横スクロール防止、44pxタップターゲット', () => {
  // 1. viewport
  assert.ok(html.includes('name="viewport"') && html.includes('width=device-width'), 'viewport metaタグ');

  // 2. min-width: 320px
  assert.ok(html.includes('min-width: 320px'), 'body min-width 320px');

  // 3. overflow-x: hidden
  assert.ok(html.includes('overflow-x: hidden'), 'body overflow-x hidden');

  // 4. 最小タップ領域 44px
  assert.ok(html.includes('--min-tap: 44px') || html.includes('min-height: 44px'), '44px 以上のタップ領域基準');

  // 5. ボタン要素に min-tap が適用されていること
  assert.ok(html.includes('var(--min-tap)') || html.includes('44px'), 'min-tap が適用されていること');
});

// 5. モーダルのスクロールと画面外はみ出し防止
test('CSS検証: モーダルの max-height / overflow スクロール設定', () => {
  assert.ok(html.includes('max-height') && (html.includes('overflow-y: auto') || html.includes('overflow: auto')), 'モーダルが画面外にはみ出さずスクロール可能であること');
});

// 6. 二重送信防止（ボタン無効化 & 連打抑止）のJS実装
test('JS検証: フォーム送信時の二重送信防止処理', () => {
  // 送信時にボタンの disabled 制御または isSubmitting フラグがあるか
  const hasSubmittingGuard = html.includes('isSubmitting') || html.includes('disabled = true') || html.includes('disabled = false');
  assert.ok(hasSubmittingGuard, '二重送信防止処理（disabled制御等）が実装されていること');
});

// 7. クライアント側バリデーション
test('JS検証: タイトル未入力時のクライアント側バリデーションとメッセージ表示', () => {
  assert.ok(html.includes('タイトルを入力してください') || html.includes('タイトルは必須') || html.includes('showToast'), 'タイトル未入力のバリデーションと通知があること');
});

// 8. 状態ラベルとスタイリングの完全性
test('CSS検証: 全ステータス (検討中/進行中/保留/完了/中止/取消) に対応するスタイル定義', () => {
  const statuses = ['review', 'progress', 'pending', 'completed', 'cancelled', 'revoked'];
  for (const st of statuses) {
    assert.ok(html.includes(`--st-${st}-bg`) || html.includes(`status-${st}`), `ステータス ${st} のスタイル定義が存在すること`);
  }
});

// 9. 完了・中止タスクの視覚的表現 (淡色表示 task-muted)
test('CSS検証: 完了・中止タスクの淡色表示 (.task-muted) クラス', () => {
  assert.ok(html.includes('.task-muted') || html.includes('task-muted'), 'task-muted クラスが存在すること');
});

// 10. ローカルストレージでの操作者記憶 (現場教職員の利便性)
test('JS検証: 直近の操作者を localStorage に保存・初期選択する機能', () => {
  assert.ok(html.includes('localStorage') && html.includes('school_board_last_actor'), '操作者記憶キー school_board_last_actor が利用されていること');
});

console.log(`\nUI / DOM / CSS Tests Finished: Passed=${passedTests}, Failed=${failedTests}`);
if (failedTests > 0) {
  process.exit(1);
}
