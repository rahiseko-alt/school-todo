/**
 * test/run-all-tests.js
 * 学校予定共有ボード - 全体テストランナー
 * Level 1 (静的確認) 〜 Level 4 (実利用テスト・人間テストケース1〜10・境界値・履歴完全性・UX)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('       学校予定共有ボード 総合テスト実行スイート');
console.log('================================================================\n');

const testSuites = [
  {
    name: 'Level 1: 静的コード確認 (Syntax Check)',
    cmd: 'node -c src/Logic.js && node -c src/Code.js && node -c test/gas-mock.js && node -c test/test-regressions.js',
    description: 'バックエンド、ロジック、テストハーネスの構文チェック'
  },
  {
    name: 'Level 2 & 境界値: 期間判定・業務ロジック・日付境界テスト',
    script: 'test/test-logic.js',
    description: '日付フォーマット、週/月範囲計算、ビュー分類、うるう年、境界値'
  },
  {
    name: 'Level 2: バックエンドAPI・排他制御・二重登録防止テスト',
    script: 'test/test-backend.js',
    description: '初期化、メンバー取得、CRUD、追記、状態変更、排他ロック、連番ID'
  },
  {
    name: 'Level 3 & Level 4: 統合テスト、人間テストケース1〜10、履歴完全性、UXテスト',
    script: 'test/test-human-scenarios.js',
    description: '一連の業務シナリオ、方針変更、追記、完了、中止、連打、スマホ対応、10件分類、履歴追跡、UX10問'
  },
  {
    name: '再発防止: レビュー指摘 (GAS読み込み順、履歴の整合性、メンバー確認、履歴の並び順)',
    script: 'test/test-regressions.js',
    description: 'Code→Logic の読み込み順での期間判定・入力チェック、History失敗時のTasks巻き戻し、原因ログ、Members確認、新しい順'
  },
  {
    name: 'UI / DOM / CSS: レスポンシブ、モーダル、アクセシビリティ検証',
    script: 'test/test-ui-dom.js',
    description: '320px画面、44pxタップ領域、横スクロール防止、入力フィールド、二重送信防止UI'
  }
];

let totalPassedSuites = 0;
let totalFailedSuites = 0;
const detailedLogs = [];

for (const suite of testSuites) {
  console.log(`>>> 実行中: [${suite.name}]`);
  console.log(`    説明: ${suite.description}`);

  try {
    let output = '';
    if (suite.cmd) {
      output = execSync(suite.cmd, { encoding: 'utf8', stdio: 'pipe' });
    } else if (suite.script) {
      output = execSync(`node ${suite.script}`, { encoding: 'utf8', stdio: 'pipe' });
    }
    console.log(output);
    totalPassedSuites++;
    detailedLogs.push({ name: suite.name, status: 'PASS', output });
    console.log(`[PASS] ${suite.name} 完了\n`);
  } catch (err) {
    totalFailedSuites++;
    console.error(`[FAIL] ${suite.name} でエラーが発生しました:`);
    console.error(err.stdout || err.message);
    detailedLogs.push({ name: suite.name, status: 'FAIL', output: err.stdout || err.message });
    console.log('\n');
  }
}

console.log('================================================================');
console.log('                   総合テスト実行サマリー');
console.log('================================================================');
console.log(`スイート総数: ${testSuites.length}`);
console.log(`合格 (PASS):  ${totalPassedSuites}`);
console.log(`不合格 (FAIL): ${totalFailedSuites}`);

if (totalFailedSuites === 0) {
  console.log('\n>>> 全テストスイートが正常に合格しました！ (ALL TESTS PASSED)');
  process.exit(0);
} else {
  console.error('\n>>> 不合格のテストスイートが存在します。修正してください。');
  process.exit(1);
}
