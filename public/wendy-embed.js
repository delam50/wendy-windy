(function () {
  var currentScript = document.currentScript;
  var scriptUrl = currentScript && currentScript.src ? currentScript.src : "";
  var widgetOrigin =
    currentScript && currentScript.dataset ? currentScript.dataset.wendyOrigin : "";

  if (!widgetOrigin && scriptUrl) {
    try {
      widgetOrigin = new URL(scriptUrl).origin;
    } catch {
      widgetOrigin = "";
    }
  }

  if (!widgetOrigin) {
    widgetOrigin = "https://windy-wendy.vercel.app";
  }

  var iframe = document.createElement("iframe");
  var widgetUrl = new URL(widgetOrigin);

  widgetUrl.searchParams.set("pageTitle", document.title || "");
  widgetUrl.searchParams.set("pageUrl", window.location.href || "");

  iframe.src = widgetUrl.toString();
  iframe.title = "Wendy, Windy Ridge Chiropractic chatbot";
  iframe.setAttribute("aria-label", "Wendy, Windy Ridge Chiropractic chatbot");
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.allow = "clipboard-write";

  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "360px",
    height: "120px",
    maxWidth: "100vw",
    maxHeight: "100dvh",
    border: "0",
    background: "transparent",
    colorScheme: "normal",
    zIndex: "2147483647",
  });

  function resizeWidget(isOpen) {
    if (isOpen) {
      iframe.style.width = "420px";
      iframe.style.height = "760px";
      iframe.style.maxWidth = "100vw";
      iframe.style.maxHeight = "100dvh";
      return;
    }

    iframe.style.width = "360px";
    iframe.style.height = "120px";
    iframe.style.maxWidth = "100vw";
    iframe.style.maxHeight = "140px";
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== widgetOrigin) {
      return;
    }

    if (
      event.data &&
      event.data.source === "windy-wendy" &&
      event.data.type === "wendy_widget_state"
    ) {
      resizeWidget(Boolean(event.data.isOpen));
    }
  });

  resizeWidget(false);
  document.body.appendChild(iframe);
})();
