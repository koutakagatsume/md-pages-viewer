# 見た目の変更

表示は Shadow DOM の中に作るため、組み込み先のCSSの影響を受けません。見た目は次のCSS変数で変えます。

| CSS変数 | 内容 |
| --- | --- |
| `--mpv-font-family` | フォント |
| `--mpv-font-size` | 本文の文字の大きさ（初期値 16px） |
| `--mpv-color-text` | 文字色 |
| `--mpv-color-bg` | 背景色 |
| `--mpv-color-accent` | リンクと現在のページの強調色 |
| `--mpv-color-border` | 区切り線の色 |
| `--mpv-sidebar-width` | サイドバーの幅 |
| `--mpv-spacing` | 余白の基準の大きさ |

## 例

```css
md-pages-viewer {
  --mpv-color-accent: #8250df;
  --mpv-sidebar-width: 300px;
}
```

文字色とフォントは、指定しなければ組み込み先の設定を引き継ぎます。
