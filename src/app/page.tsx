"use client";

import { FormEvent, useMemo, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type QuickAction = {
  label: string;
  prompt?: string;
  url?: string;
};

type WendyEventName =
  | "wendy_chat_opened"
  | "wendy_message_sent"
  | "wendy_booking_link_clicked"
  | "wendy_quick_action_clicked";

type WendyEventPayload = Record<string, string | number | boolean | undefined>;

const quickActions: QuickAction[] = [
  {
    label: "Book Appointment",
    url: "https://windyridgechiropractic.janeapp.com/",
  },
  {
    label: "First Visit",
    url: "https://windyridgechiropractic.com/what-to-expect-on-your-first-visit-to-windy-ridge-chiropractic/",
  },
  {
    label: "Services",
    url: "https://windyridgechiropractic.com/chiropractic-services/",
  },
  {
    label: "Bozeman Location",
    prompt: "Tell me what I should know about the Bozeman location.",
  },
  {
    label: "Big Sky Location",
    prompt: "Tell me what I should know about the Big Sky location.",
  },
  {
    label: "Insurance & Cost",
    prompt: "What should I know about insurance and cost before booking?",
  },
];

const friendlyConnectionError =
  "Sorry, Wendy is having trouble connecting right now. Please try again in a moment, or book directly here: https://windyridgechiropractic.janeapp.com/";

const welcomeMessage: Message = {
  role: "assistant",
  content:
    "Hi, I’m Wendy with Windy Ridge Chiropractic. I can help you prep for a visit, talk through what to share, or point you toward booking.",
};

function renderMessageContent(content: string) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlPattern);

  return parts.map((part, index) => {
    if (!part.match(/^https?:\/\/[^\s]+$/)) {
      return part;
    }

    return (
      <a
        className="font-semibold text-[#f2a36f] underline decoration-[#f2a36f]/50 underline-offset-4 transition hover:text-white"
        href={part}
        key={`${part}-${index}`}
        onClick={() => {
          if (part.includes("windyridgechiropractic.janeapp.com")) {
            trackWendyEvent("wendy_booking_link_clicked", {
              source: "chat_response",
              url: part,
            });
          }
        }}
        rel="noopener noreferrer"
        target="_blank"
      >
        {part}
      </a>
    );
  });
}

function getPageContext() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("pageContext") ?? "";
}

function trackWendyEvent(name: WendyEventName, payload: WendyEventPayload = {}) {
  const event = {
    name,
    payload,
    timestamp: new Date().toISOString(),
  };

  // Future integrations can forward this event to Google Analytics or Monday.com.
  console.log("[Wendy event]", event);
}

export default function Home() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending,
    [input, isSending],
  );

  async function sendMessage(content: string) {
    const trimmedContent = content.trim();

    if (!trimmedContent || isSending) {
      return;
    }

    trackWendyEvent("wendy_message_sent", {
      messageLength: trimmedContent.length,
      pageContext: getPageContext() || undefined,
    });

    const nextMessages: Message[] = [
      ...messages,
      { role: "user", content: trimmedContent },
    ];

    setIsOpen(true);
    setMessages(nextMessages);
    setInput("");
    setError("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages,
          pageContext: getPageContext(),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok || !data.message) {
        throw new Error(friendlyConnectionError);
      }

      const assistantMessage = data.message;

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: assistantMessage },
      ]);
    } catch {
      setError(friendlyConnectionError);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function clearChat() {
    setMessages([welcomeMessage]);
    setInput("");
    setError("");
    setIsSending(false);
  }

  function openChat() {
    setIsOpen((currentValue) => {
      if (!currentValue) {
        trackWendyEvent("wendy_chat_opened", {
          pageContext: getPageContext() || undefined,
        });
      }

      return !currentValue;
    });
  }

  function handleQuickAction(action: QuickAction) {
    trackWendyEvent("wendy_quick_action_clicked", {
      label: action.label,
      type: action.url ? "link" : "prompt",
      url: action.url,
    });

    if (action.label === "Book Appointment" && action.url) {
      trackWendyEvent("wendy_booking_link_clicked", {
        source: "quick_action",
        url: action.url,
      });
    }
  }

  function renderQuickActions() {
    return (
      <div className="ml-1 mt-3 grid w-full max-w-[86%] grid-cols-1 gap-2 sm:grid-cols-2">
        {quickActions.map((action) => {
          const className =
            "min-h-11 rounded-xl border border-white/12 bg-[#252525] px-3.5 py-2.5 text-left text-xs font-semibold leading-5 text-[#f4f4f4] shadow-lg shadow-black/15 transition hover:border-[#c46a2d] hover:bg-[#332820] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35";

          if (action.url) {
            return (
              <a
                className={className}
                href={action.url}
                key={action.label}
                onClick={() => handleQuickAction(action)}
                rel="noopener noreferrer"
                target="_blank"
              >
                {action.label}
              </a>
            );
          }

          return (
            <button
              className={className}
              key={action.label}
              onClick={() => {
                handleQuickAction(action);
                void sendMessage(action.prompt ?? action.label);
              }}
              type="button"
            >
              {action.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-transparent text-white">
      <section
        aria-label="Windy Ridge Chiropractic chat widget"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex max-h-[100dvh] min-w-0 flex-col items-end gap-3 overflow-x-hidden sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:gap-4"
      >
        {isOpen ? (
          <div className="flex h-[min(650px,calc(100dvh_-_7rem_-_env(safe-area-inset-bottom)))] w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#2a2a2a] shadow-2xl shadow-black/45">
            <header className="shrink-0 border-b border-white/12 bg-[#1f1f1f] px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c46a2d]">
                    Windy Ridge
                  </p>
                  <h1 className="mt-1 break-words text-lg font-semibold leading-7 text-white">
                    Chat with Wendy
                  </h1>
                  <p className="mt-1 break-words text-xs leading-5 text-[#d6d6d6]">
                    Move better, feel better, get back to life unrestricted.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="h-9 rounded-full border border-white/12 bg-[#2a2a2a] px-3 text-xs font-semibold text-[#d6d6d6] transition hover:border-[#c46a2d] hover:text-white"
                    onClick={clearChat}
                    type="button"
                  >
                    Clear chat
                  </button>
                  <button
                    aria-label="Minimize chat"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-[#2a2a2a] text-lg leading-none text-[#d6d6d6] transition hover:border-[#c46a2d] hover:text-white"
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    x
                  </button>
                </div>
              </div>
            </header>

            <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-3.5 py-4 sm:px-4">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`}>
                  <div
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[90%] overflow-hidden break-words rounded-2xl px-4 py-3.5 text-sm leading-7 shadow-lg shadow-black/20 sm:max-w-[86%] ${
                        message.role === "user"
                          ? "rounded-br-md bg-[#c46a2d] text-white"
                          : "rounded-bl-md border border-white/12 bg-[#1f1f1f] text-[#f4f4f4]"
                      }`}
                    >
                      <span className="whitespace-pre-wrap">
                        {renderMessageContent(message.content)}
                      </span>
                    </div>
                  </div>
                  {index === 0 && messages.length === 1
                    ? renderQuickActions()
                    : null}
                </div>
              ))}
              {isSending ? (
                <div
                  aria-label="Wendy is typing"
                  className="inline-flex max-w-[90%] items-center gap-2 rounded-2xl rounded-bl-md border border-white/12 bg-[#1f1f1f] px-4 py-4 shadow-lg shadow-black/20 sm:max-w-[86%]"
                  role="status"
                >
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#c46a2d]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#c46a2d] [animation-delay:120ms]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#c46a2d] [animation-delay:240ms]" />
                  <span className="sr-only">Wendy is typing</span>
                </div>
              ) : null}
            </div>

            <form
              className="shrink-0 border-t border-white/12 bg-[#252525] p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:p-4"
              onSubmit={handleSubmit}
            >
              {error ? (
                <p className="mb-3 break-words rounded-xl border border-[#c46a2d]/40 bg-[#3a2418] px-3 py-2 text-xs leading-6 text-[#ffd9c2]">
                  {error}
                </p>
              ) : null}
              <label className="sr-only" htmlFor="chat-message">
                Message Wendy
              </label>
              <div className="flex min-w-0 items-end gap-2">
                <textarea
                  className="max-h-24 min-h-14 min-w-0 flex-1 resize-none rounded-2xl border border-white/12 bg-[#1f1f1f] px-4 py-3 text-base leading-7 text-white outline-none transition placeholder:text-[#9f9f9f] focus:border-[#c46a2d] focus:ring-2 focus:ring-[#c46a2d]/30 sm:max-h-28 sm:text-sm"
                  id="chat-message"
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask Wendy..."
                  rows={1}
                  value={input}
                />
                <button
                  className="h-14 shrink-0 rounded-2xl bg-[#c46a2d] px-4 text-sm font-semibold text-white transition hover:bg-[#a95722] disabled:cursor-not-allowed disabled:bg-[#6f513f] disabled:text-[#cfc7c1] sm:px-5"
                  disabled={!canSend}
                  type="submit"
                >
                  Send
                </button>
              </div>
              <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-5 text-[#a9a9a9]">
                General information only. For urgent or severe symptoms, seek
                medical care right away.
              </p>
            </form>
          </div>
        ) : null}

        <button
          aria-expanded={isOpen}
          aria-label={isOpen ? "Chat is open" : "Open Wendy chat"}
          className="flex min-h-16 max-w-full items-center justify-center rounded-full bg-[#c46a2d] px-5 py-3.5 text-center text-sm font-bold leading-5 text-white shadow-2xl shadow-black/40 transition hover:bg-[#a95722] focus:outline-none focus:ring-4 focus:ring-[#c46a2d]/35 sm:min-h-20 sm:px-7 sm:py-4"
          onClick={openChat}
          type="button"
        >
          Wendy 1.0 - Friendly Chatbot
        </button>
      </section>
    </main>
  );
}
