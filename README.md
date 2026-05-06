# Windy Wendy

Embeddable Wendy chatbot for Windy Ridge Chiropractic.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the widget.

## WordPress Embed

Add this script to WordPress once Wendy is deployed:

```html
<script src="https://YOUR-WENDY-DOMAIN.com/wendy-embed.js" defer></script>
```

The embed script automatically passes `document.title` as `pageTitle` and
`window.location.href` as `pageUrl`, so Wendy can answer with subtle awareness
of the page a visitor is reading.

For local testing from another page, override the widget origin:

```html
<script
  src="https://YOUR-WENDY-DOMAIN.com/wendy-embed.js"
  data-wendy-origin="http://localhost:3000"
  defer
></script>
```

## Knowledge Sync

Refresh generated website and JaneApp knowledge:

```bash
npm run sync:sitemap
```
