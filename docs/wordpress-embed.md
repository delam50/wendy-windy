# Wendy WordPress Embed

Use this snippet in WordPress with WPCode.

Go to:

`WordPress -> WPCode -> Header & Footer -> Footer`

Paste this into the Footer field, then replace:

`https://YOUR-VERCEL-URL.vercel.app`

with the deployed Wendy Vercel app URL.

```html
<script>
  (function () {
    var WENDY_APP_URL = "https://YOUR-VERCEL-URL.vercel.app";
    var COLLAPSED_WIDTH = 360;
    var COLLAPSED_HEIGHT = 120;
    var DESKTOP_WIDTH = 420;
    var DESKTOP_HEIGHT = 760;
    var MOBILE_BREAKPOINT = 640;

    function buildWendyUrl() {
      var url = new URL(WENDY_APP_URL);

      url.searchParams.set("pageTitle", document.title || "");
      url.searchParams.set("pageUrl", window.location.href || "");

      return url.toString();
    }

    function isMobile() {
      return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function applyClosedSize(iframe) {
      iframe.style.width = Math.min(COLLAPSED_WIDTH, window.innerWidth) + "px";
      iframe.style.height = COLLAPSED_HEIGHT + "px";
      iframe.style.maxWidth = "100vw";
      iframe.style.maxHeight = COLLAPSED_HEIGHT + "px";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
    }

    function applyOpenSize(iframe) {
      if (isMobile()) {
        iframe.style.width = "100vw";
        iframe.style.height = "100dvh";
        iframe.style.maxWidth = "100vw";
        iframe.style.maxHeight = "100dvh";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        return;
      }

      iframe.style.width = DESKTOP_WIDTH + "px";
      iframe.style.height = DESKTOP_HEIGHT + "px";
      iframe.style.maxWidth = "100vw";
      iframe.style.maxHeight = "100dvh";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
    }

    function createWendyIframe() {
      var iframe = document.createElement("iframe");

      iframe.src = buildWendyUrl();
      iframe.title = "Wendy, Windy Ridge Chiropractic chatbot";
      iframe.setAttribute("aria-label", "Wendy, Windy Ridge Chiropractic chatbot");
      iframe.setAttribute("loading", "lazy");
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      iframe.allow = "clipboard-write";

      iframe.style.position = "fixed";
      iframe.style.border = "0";
      iframe.style.background = "transparent";
      iframe.style.colorScheme = "normal";
      iframe.style.zIndex = "2147483647";
      iframe.style.display = "block";
      iframe.style.overflow = "hidden";

      applyClosedSize(iframe);

      return iframe;
    }

    var iframe = createWendyIframe();
    var isOpen = false;

    window.addEventListener("message", function (event) {
      if (event.origin !== WENDY_APP_URL) {
        return;
      }

      if (
        event.data &&
        event.data.source === "windy-wendy" &&
        event.data.type === "wendy_widget_state"
      ) {
        isOpen = Boolean(event.data.isOpen);

        if (isOpen) {
          applyOpenSize(iframe);
        } else {
          applyClosedSize(iframe);
        }
      }
    });

    window.addEventListener("resize", function () {
      if (isOpen) {
        applyOpenSize(iframe);
      } else {
        applyClosedSize(iframe);
      }
    });

    document.body.appendChild(iframe);
  })();
</script>
```

Notes:

- The iframe stays small while Wendy is collapsed, so it avoids blocking page content.
- On desktop, Wendy opens as a bottom-right floating panel.
- On mobile, Wendy opens full screen for easier typing and reading.
- The script passes `pageTitle` and `pageUrl` to Wendy so she can tailor answers subtly to the current WordPress page.
