# 学校予定共有ボード 設計書 (DESIGN.md)

## 1. ファイル構成
- `src/Code.js`: GASバックエンド処理 (doGet, API関数群, シート操作, ロック管理, ID生成, 履歴生成)
- `src/Logic.js`: 期間判定ロジック, 日付フォーマット, バリデーション, 状態判定 (バックエンドとテスト共通利用可能な純粋関数群)
- `src/index.html`: Web App UI (HTML, CSS, Vanilla JS)
- `test/gas-mock.js`: Node.js環境でGASのSpreadsheetApp, LockService, Utilities等を忠実に再現するテストハーネス
- `test/test-logic.js`: 期間判定・境界値テスト (月曜/日曜/月初/月末/年末年始)
- `test/test-backend.js`: CRUD、更新、追記、状態変更、履歴整合性、ロック・二重送信検証
- `test/test-human-scenarios.js`: 人間テストケース1〜10、シナリオテスト、UX要件テスト
- `TEST_REPORT.md`: テスト証拠レポート
- `README.md`: 利用・設定・デプロイマニュアル
- `ISSUES_AFTER_PLAN.md`: 開発中発見事項

## 2. Google Sheets 構成
### 2.1 Tasks シート
- A: `taskId` (文字列: `TASK-YYYYMMDD-XXXX` または UUID)
- B: `title` (文字列)
- C: `description` (文字列, 改行あり)
- D: `periodType` (今日 / 今週 / 今月 / 日付指定 / 年間 / 未定)
- E: `specifiedDate` (YYYY-MM-DD, 日付指定時)
- F: `status` (検討中 / 進行中 / 保留 / 完了 / 中止 / 取消)
- G: `assignee` (文字列, Members.name)
- H: `createdBy` (文字列, Members.name)
- I: `createdAt` (文字列: YYYY/MM/DD HH:mm)
- J: `updatedBy` (文字列, Members.name)
- K: `updatedAt` (文字列: YYYY/MM/DD HH:mm)

### 2.2 History シート
- A: `historyId` (文字列, UUID)
- B: `taskId` (文字列)
- C: `timestamp` (文字列: YYYY/MM/DD HH:mm)
- D: `actor` (文字列, Members.name)
- E: `actionType` (新規登録 / 修正 / 追記 / 状態変更)
- F: `fieldName` (変更対象フィールド名, 追記時は "追記", 新規時は "全体")
- G: `beforeValue` (変更前値)
- H: `afterValue` (変更後値)
- I: `comment` (追記内容や備考)

### 2.3 Members シート
- A: `memberId` (文字列: MEM-XXXX)
- B: `name` (文字列)
- C: `active` (真偽値: TRUE / FALSE)
- D: `sortOrder` (数値)

## 3. インターフェース仕様 (固定API)
すべてのGAS API関数はフロントエンド `google.script.run` またはテスト実行から呼べる。

1. `getInitialData()`
   - 返却値: `{ success: true, tasks: Task[], members: Member[], serverTime: string, currentView: string }`
2. `getTasks(viewType)`
   - 引数: `viewType` ("today" | "this_week" | "this_month" | "annual")
   - 返却値: `{ success: true, tasks: Task[] }`
3. `createTask(data)`
   - 引数: `{ title: string, periodType: string, specifiedDate?: string, description?: string, status: string, assignee?: string, createdBy: string }`
   - 返却値: `{ success: true, task: Task }`
4. `updateTask(taskId, data)`
   - 引数: `taskId`, `{ title: string, periodType: string, specifiedDate?: string, description?: string, status: string, assignee?: string, updatedBy: string }`
   - 返却値: `{ success: true, task: Task }`
5. `addTaskNote(taskId, data)`
   - 引数: `taskId`, `{ note: string, actor: string }`
   - 返却値: `{ success: true, task: Task }`
6. `changeTaskStatus(taskId, data)`
   - 引数: `taskId`, `{ status: string, actor: string }`
   - 返却値: `{ success: true, task: Task }`
7. `getTaskHistory(taskId)`
   - 引数: `taskId`
   - 返却値: `{ success: true, history: HistoryItem[] }`
8. `getMembers()`
   - 返却値: `{ success: true, members: Member[] }` (active === TRUE のみ)
9. `initSheets()`
   - シートが存在しない場合に初期化＆サンプルメンバー作成

## 4. 期間判定ロジック仕様 (Logic.js)
基準タイムゾーン: `Asia/Tokyo`
週の定義: 月曜 00:00:00 〜 日曜 23:59:59
1. `filterTasksByView(tasks, viewType, targetDate)`
   - `today`: `periodType === '今日'` OR `specifiedDate === 今日の日付(YYYY-MM-DD)`
   - `this_week`: `periodType === '今日'` OR `periodType === '今週'` OR `specifiedDate が今週月〜日の範囲`
   - `this_month`: `periodType === '今日'` OR `periodType === '今週'` OR `periodType === '今月'` OR `specifiedDate が今月の範囲`
   - `annual`: 全ての期間タイプ対象（月・状態ごとにソート/グループ化可能）
2. 完了・中止・取消の扱い:
   - 削除はせず、通常一覧では視覚的に淡色表示または折りたたみ可能とし、確実に存在確認できる。
