# データの形式

ページはフラットな配列で渡し、`parentId` で階層を表します。URLで渡す場合は、この配列そのものをJSONで返します。

| 項目 | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| id | string / number | 必須 | ページの一意なID |
| parentId | string / number / null | 必須 | 親ページのID。最上位は null |
| title | string | 必須 | パンくず・サイドバーに表示する名前 |
| md | string | md か src | 本文のMarkdown |
| src | string | md か src | mdファイルのURL |
| order | number | 任意 | 同じ階層内の並び順 |

## 例

```json
[
  { "id": "intro", "parentId": null, "title": "はじめに", "md": "# はじめに", "order": 1 },
  { "id": "login", "parentId": "intro", "title": "ログイン方法", "src": "/storage/manual/login.md" }
]
```

## 本文の取得

`src` のページは、開いたときに初めて取得します。取得した本文は画面を再読み込みするまで保持します。

- [x] 開いたページの分だけ取得する
- [x] 失敗したら「再読み込み」ボタンを出す
- [ ] 最初に全ページを読み込む
