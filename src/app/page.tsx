"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { trackAnalyticsEvent } from "@/lib/analytics";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type QuickAction = {
  label: string;
  prompt?: string;
  url?: string;
};

type LeadForm = {
  name: string;
  phone: string;
  email: string;
  location: string;
  mainConcern: string;
  preferredTiming: string;
};

type SessionMemory = {
  concern?: string;
  preferredLocation?: "Bozeman" | "Big Sky";
  discussedPricing?: boolean;
  bookingInfoProvided?: boolean;
  bookingLinkClicked?: boolean;
};

type PageContext = {
  pageContext: string;
  pageTitle: string;
  pageUrl: string;
};

const SESSION_MESSAGES_KEY = "wendy.session.messages";
const SESSION_MEMORY_KEY = "wendy.session.memory";
const MAX_SESSION_MESSAGES = 12;

const quickActions: QuickAction[] = [
  {
    label: "Book",
    url: "https://windyridgechiropractic.janeapp.com/",
  },
  {
    label: "First visit",
    url: "https://windyridgechiropractic.com/what-to-expect-on-your-first-visit-to-windy-ridge-chiropractic/",
  },
  {
    label: "Services",
    url: "https://windyridgechiropractic.com/chiropractic-services/",
  },
  {
    label: "Bozeman",
    prompt: "Tell me what I should know about the Bozeman location.",
  },
  {
    label: "Big Sky",
    prompt: "Tell me what I should know about the Big Sky location.",
  },
  {
    label: "Cost",
    prompt: "What should I know about insurance and cost before booking?",
  },
];

const friendlyConnectionError =
  "Sorry, Wendy is having trouble connecting right now. Please try again in a moment, or book directly here: https://windyridgechiropractic.janeapp.com/";

const leadSuccessMessage =
  "Brilliant, I’ll pass this along to the Windy Ridge team. You can also book directly here if you’d like the fastest option: https://windyridgechiropractic.janeapp.com/";

const welcomeMessage: Message = {
  role: "assistant",
  content:
    "Hi, I'm Wendy with Windy Ridge Chiropractic. I can help with services, first visits, locations, pricing, and booking so you can move better, feel better, and get back to life unrestricted.",
};

const emptyLeadForm: LeadForm = {
  name: "",
  phone: "",
  email: "",
  location: "",
  mainConcern: "",
  preferredTiming: "",
};

const emptySessionMemory: SessionMemory = {};

function trimMessagesForSession(messages: Message[]) {
  if (messages.length <= MAX_SESSION_MESSAGES) {
    return messages;
  }

  return [welcomeMessage, ...messages.slice(-(MAX_SESSION_MESSAGES - 1))];
}

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
            window.dispatchEvent(new Event("wendy-booking-link-clicked"));
            trackAnalyticsEvent("booking_link_clicked", {
              ...getAnalyticsPageMetadata(),
              bookingLinkClicked: true,
              source: "chat_response",
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

function getPageContext(): PageContext {
  if (typeof window === "undefined") {
    return {
      pageContext: "",
      pageTitle: "",
      pageUrl: "",
    };
  }

  const params = new URLSearchParams(window.location.search);
  const pageTitle = params.get("pageTitle")?.trim() ?? "";
  const pageUrl = params.get("pageUrl")?.trim() ?? "";
  const legacyPageContext = params.get("pageContext")?.trim() ?? "";
  const pageContext =
    legacyPageContext ||
    [pageTitle ? `Page title: ${pageTitle}` : "", pageUrl ? `Page URL: ${pageUrl}` : ""]
      .filter(Boolean)
      .join("\n");

  return {
    pageContext,
    pageTitle,
    pageUrl,
  };
}

function getAnalyticsPageMetadata() {
  const pageContext = getPageContext();

  return {
    pageTitle: pageContext.pageTitle || undefined,
    pageUrl: pageContext.pageUrl || undefined,
  };
}

function hasBookingIntent(content: string) {
  return /\b(book|booking|appointment|schedule|come in|be seen|visit|call me|contact me|follow up|pricing|cost|availability|available)\b/i.test(
    content,
  );
}

function includesBookingInfo(content: string) {
  return /janeapp|book|booking|appointment/i.test(content);
}

function includesPricingDiscussion(content: string) {
  return /pricing|cost|insurance|cash rate|rate|\$/i.test(content);
}

function inferPreferredLocation(content: string): SessionMemory["preferredLocation"] {
  if (/\bbig sky\b/i.test(content)) {
    return "Big Sky";
  }

  if (/\bbozeman\b|\bfour corners\b/i.test(content)) {
    return "Bozeman";
  }

  return undefined;
}

function inferConcern(content: string) {
  const concernPatterns = [
    /\bneck pain\b/i,
    /\blow(?:er)? back pain\b/i,
    /\bback pain\b/i,
    /\bheadaches?\b/i,
    /\bmigraines?\b/i,
    /\bdry needling\b/i,
    /\bpregnan(?:t|cy)\b/i,
    /\bpediatric(?:s)?\b/i,
    /\bsports? injury\b/i,
    /\bmassage\b/i,
  ];

  return concernPatterns
    .map((pattern) => content.match(pattern)?.[0])
    .find(Boolean)
    ?.toLowerCase();
}

function mergeSessionMemory(
  currentMemory: SessionMemory,
  message: Message,
): SessionMemory {
  const nextMemory: SessionMemory = { ...currentMemory };

  if (message.role === "user") {
    nextMemory.preferredLocation =
      inferPreferredLocation(message.content) ?? nextMemory.preferredLocation;
    nextMemory.concern = inferConcern(message.content) ?? nextMemory.concern;

    if (includesPricingDiscussion(message.content)) {
      nextMemory.discussedPricing = true;
    }
  }

  if (message.role === "assistant") {
    if (includesPricingDiscussion(message.content)) {
      nextMemory.discussedPricing = true;
    }

    if (includesBookingInfo(message.content)) {
      nextMemory.bookingInfoProvided = true;
    }
  }

  return nextMemory;
}

function loadSessionMessages() {
  if (typeof window === "undefined") {
    return [welcomeMessage];
  }

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(SESSION_MESSAGES_KEY) ?? "[]",
    ) as Message[];

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [welcomeMessage];
    }

    return trimMessagesForSession(
      parsed.filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      ),
    );
  } catch {
    return [welcomeMessage];
  }
}

function loadSessionMemory(): SessionMemory {
  if (typeof window === "undefined") {
    return emptySessionMemory;
  }

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(SESSION_MEMORY_KEY) ?? "{}",
    ) as SessionMemory;

    return {
      concern: typeof parsed.concern === "string" ? parsed.concern : undefined,
      preferredLocation:
        parsed.preferredLocation === "Bozeman" ||
        parsed.preferredLocation === "Big Sky"
          ? parsed.preferredLocation
          : undefined,
      discussedPricing: Boolean(parsed.discussedPricing),
      bookingInfoProvided: Boolean(parsed.bookingInfoProvided),
      bookingLinkClicked: Boolean(parsed.bookingLinkClicked),
    };
  } catch {
    return emptySessionMemory;
  }
}

function persistSession(messages: Message[], memory: SessionMemory) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    SESSION_MESSAGES_KEY,
    JSON.stringify(trimMessagesForSession(messages)),
  );
  window.sessionStorage.setItem(SESSION_MEMORY_KEY, JSON.stringify(memory));
}

export default function Home() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => loadSessionMessages());
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [sessionMemory, setSessionMemory] = useState<SessionMemory>(() =>
    loadSessionMemory(),
  );
  const [hasClickedBookingLink, setHasClickedBookingLink] = useState(() =>
    Boolean(loadSessionMemory().bookingLinkClicked),
  );
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadForm, setLeadForm] = useState<LeadForm>(emptyLeadForm);
  const [leadError, setLeadError] = useState("");
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);

  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending,
    [input, isSending],
  );

  const shouldOfferLeadCapture = useMemo(
    () =>
      !hasClickedBookingLink &&
      !showLeadForm &&
      messages.some((message) => message.role === "user" && hasBookingIntent(message.content)),
    [hasClickedBookingLink, messages, showLeadForm],
  );

  useEffect(() => {
    persistSession(messages, {
      ...sessionMemory,
      bookingLinkClicked: hasClickedBookingLink,
    });
  }, [hasClickedBookingLink, messages, sessionMemory]);

  useEffect(() => {
    window.parent?.postMessage(
      {
        source: "windy-wendy",
        type: "wendy_widget_state",
        isOpen,
      },
      "*",
    );
  }, [isOpen]);

  useEffect(() => {
    function handleBookingLinkClick() {
      setHasClickedBookingLink(true);
      setSessionMemory((currentMemory) => ({
        ...currentMemory,
        bookingInfoProvided: true,
        bookingLinkClicked: true,
      }));
    }

    window.addEventListener("wendy-booking-link-clicked", handleBookingLinkClick);

    return () => {
      window.removeEventListener(
        "wendy-booking-link-clicked",
        handleBookingLinkClick,
      );
    };
  }, []);

  async function sendMessage(content: string) {
    const trimmedContent = content.trim();

    if (!trimmedContent || isSending) {
      return;
    }

    trackAnalyticsEvent("message_sent", {
      ...getAnalyticsPageMetadata(),
      messageLength: trimmedContent.length,
      bookingLinkClicked: hasClickedBookingLink,
    });

    const userMessage: Message = { role: "user", content: trimmedContent };
    const nextMemory = mergeSessionMemory(sessionMemory, userMessage);
    const nextMessages: Message[] = trimMessagesForSession([
      ...messages,
      userMessage,
    ]);

    setIsOpen(true);
    setMessages(nextMessages);
    setSessionMemory(nextMemory);
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
          sessionMemory: nextMemory,
          ...getPageContext(),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok || !data.message) {
        throw new Error(friendlyConnectionError);
      }

      const assistantMessage = data.message;
      const assistantChatMessage: Message = {
        role: "assistant",
        content: assistantMessage,
      };
      const memoryAfterAssistant = mergeSessionMemory(
        nextMemory,
        assistantChatMessage,
      );

      trackAnalyticsEvent("assistant_response_received", {
        ...getAnalyticsPageMetadata(),
        assistantResponseLength: assistantMessage.length,
        bookingLinkClicked: hasClickedBookingLink,
      });

      setSessionMemory(memoryAfterAssistant);
      setMessages((currentMessages) =>
        trimMessagesForSession([...currentMessages, assistantChatMessage]),
      );
    } catch {
      setError(friendlyConnectionError);
      trackAnalyticsEvent("error_shown", {
        ...getAnalyticsPageMetadata(),
        errorType: "chat_connection",
      });
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
    setHasClickedBookingLink(false);
    setSessionMemory(emptySessionMemory);
    setShowLeadForm(false);
    setLeadForm(emptyLeadForm);
    setLeadError("");
    setIsSubmittingLead(false);

    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(SESSION_MESSAGES_KEY);
      window.sessionStorage.removeItem(SESSION_MEMORY_KEY);
    }
  }

  function openChat() {
    setIsOpen((currentValue) => {
      if (!currentValue) {
        trackAnalyticsEvent("widget_opened", {
          ...getAnalyticsPageMetadata(),
          bookingLinkClicked: hasClickedBookingLink,
        });
      } else {
        trackAnalyticsEvent("widget_closed", {
          ...getAnalyticsPageMetadata(),
          bookingLinkClicked: hasClickedBookingLink,
          source: "launcher",
        });
      }

      return !currentValue;
    });
  }

  function handleQuickAction(action: QuickAction) {
    trackAnalyticsEvent("quick_action_clicked", {
      ...getAnalyticsPageMetadata(),
      quickActionLabel: action.label,
      bookingLinkClicked: hasClickedBookingLink,
      source: action.url ? "link" : "prompt",
    });

    if (action.label === "Book" && action.url) {
      setHasClickedBookingLink(true);
      setSessionMemory((currentMemory) => ({
        ...currentMemory,
        bookingInfoProvided: true,
        bookingLinkClicked: true,
      }));
      trackAnalyticsEvent("booking_link_clicked", {
        ...getAnalyticsPageMetadata(),
        bookingLinkClicked: true,
        source: "quick_action",
      });
    }
  }

  function closeChat() {
    setIsOpen(false);
    trackAnalyticsEvent("widget_closed", {
      ...getAnalyticsPageMetadata(),
      bookingLinkClicked: hasClickedBookingLink,
      source: "header_minimize",
    });
  }

  function openLeadForm() {
    setShowLeadForm(true);
    setLeadError("");
    trackAnalyticsEvent("lead_form_opened", {
      ...getAnalyticsPageMetadata(),
      bookingLinkClicked: hasClickedBookingLink,
    });
  }

  function updateLeadForm(field: keyof LeadForm, value: string) {
    setLeadForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function validateLeadForm() {
    if (!leadForm.name.trim()) {
      return "Please add your name.";
    }

    if (!leadForm.phone.trim() && !leadForm.email.trim()) {
      return "Please add either a phone number or email.";
    }

    if (!leadForm.location) {
      return "Please choose Bozeman or Big Sky.";
    }

    return "";
  }

  async function handleLeadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validateLeadForm();

    if (validationError) {
      setLeadError(validationError);
      trackAnalyticsEvent("error_shown", {
        ...getAnalyticsPageMetadata(),
        errorType: "lead_validation",
        leadLocationPreference: leadForm.location || undefined,
      });
      return;
    }

    setLeadError("");
    setIsSubmittingLead(true);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...leadForm,
          pageTitle: getPageContext().pageTitle,
          pageUrl: getPageContext().pageUrl,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          errors?: string[];
        };

        throw new Error(data.errors?.[0] ?? "Lead submission failed.");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: leadSuccessMessage },
      ]);
      setShowLeadForm(false);
      setLeadForm(emptyLeadForm);
      setHasClickedBookingLink(true);
      setSessionMemory((currentMemory) => ({
        ...currentMemory,
        preferredLocation:
          leadForm.location === "Bozeman" || leadForm.location === "Big Sky"
            ? leadForm.location
            : currentMemory.preferredLocation,
        concern: leadForm.mainConcern.trim()
          ? "general follow-up concern"
          : currentMemory.concern,
        bookingInfoProvided: true,
        bookingLinkClicked: true,
      }));
      trackAnalyticsEvent("lead_form_submitted", {
        ...getAnalyticsPageMetadata(),
        bookingLinkClicked: hasClickedBookingLink,
        leadLocationPreference: leadForm.location,
      });
    } catch {
      setLeadError(
        "Sorry, Wendy could not save that right now. Please try again or book directly with JaneApp.",
      );
      trackAnalyticsEvent("error_shown", {
        ...getAnalyticsPageMetadata(),
        errorType: "lead_submission",
        leadLocationPreference: leadForm.location || undefined,
      });
    } finally {
      setIsSubmittingLead(false);
    }
  }

  function renderQuickActions() {
    return (
      <div className="ml-1 mt-3 grid w-full max-w-[92%] grid-cols-2 gap-2 sm:max-w-[88%]">
        {quickActions.map((action) => {
          const className =
            "min-h-11 rounded-2xl border border-white/12 bg-[#252525] px-3.5 py-2.5 text-left text-xs font-semibold leading-5 text-[#f4f4f4] shadow-lg shadow-black/15 transition duration-200 hover:-translate-y-0.5 hover:border-[#c46a2d] hover:bg-[#332820] hover:text-white hover:shadow-[#c46a2d]/10 focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35 active:translate-y-0 active:scale-[0.99]";

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

  function renderLeadCaptureOffer() {
    if (!shouldOfferLeadCapture) {
      return null;
    }

    return (
      <div className="ml-1 mt-3 max-w-[92%] rounded-2xl border border-[#c46a2d]/35 bg-[#2f251f] px-4 py-3.5 shadow-lg shadow-black/20 sm:max-w-[88%]">
        <p className="text-xs leading-6 text-[#f4f4f4]">
          If you would rather have the Windy Ridge team follow up, I can collect
          a few quick details. Please keep the concern general.
        </p>
        <button
          className="mt-3 rounded-full bg-[#c46a2d] px-4 py-2 text-xs font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-[#a95722] focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35 active:translate-y-0"
          onClick={openLeadForm}
          type="button"
        >
          Have the team follow up
        </button>
      </div>
    );
  }

  function renderLeadCaptureForm() {
    if (!showLeadForm) {
      return null;
    }

    const inputClassName =
      "w-full rounded-xl border border-white/12 bg-[#1f1f1f] px-3 py-2.5 text-sm leading-6 text-white outline-none transition duration-200 placeholder:text-[#8f8f8f] focus:border-[#c46a2d] focus:ring-2 focus:ring-[#c46a2d]/25";

    return (
      <form
        className="ml-1 mt-3 max-w-[96%] space-y-3 rounded-2xl border border-white/12 bg-[#1f1f1f] p-4 shadow-lg shadow-black/20 sm:max-w-[92%]"
        onSubmit={handleLeadSubmit}
      >
        <div>
          <p className="text-sm font-semibold leading-6 text-white">
            Have Windy Ridge follow up
          </p>
          <p className="mt-1 text-xs leading-5 text-[#bdbdbd]">
            Share only general details. For urgent or severe symptoms, seek
            medical care right away.
          </p>
        </div>

        <label className="block text-xs font-semibold leading-5 text-[#d6d6d6]">
          Name *
          <input
            className={`${inputClassName} mt-1`}
            onChange={(event) => updateLeadForm("name", event.target.value)}
            type="text"
            value={leadForm.name}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold leading-5 text-[#d6d6d6]">
            Phone
            <input
              className={`${inputClassName} mt-1`}
              onChange={(event) => updateLeadForm("phone", event.target.value)}
              type="tel"
              value={leadForm.phone}
            />
          </label>
          <label className="block text-xs font-semibold leading-5 text-[#d6d6d6]">
            Email
            <input
              className={`${inputClassName} mt-1`}
              onChange={(event) => updateLeadForm("email", event.target.value)}
              type="email"
              value={leadForm.email}
            />
          </label>
        </div>

        <fieldset>
          <legend className="text-xs font-semibold leading-5 text-[#d6d6d6]">
            Preferred location *
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {["Bozeman", "Big Sky"].map((location) => (
              <button
                className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35 ${
                  leadForm.location === location
                    ? "border-[#c46a2d] bg-[#c46a2d] text-white"
                    : "border-white/12 bg-[#252525] text-[#d6d6d6] hover:border-[#c46a2d] hover:text-white"
                }`}
                key={location}
                onClick={() => updateLeadForm("location", location)}
                type="button"
              >
                {location}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-xs font-semibold leading-5 text-[#d6d6d6]">
          Briefly, what are you hoping we can help with?
          <textarea
            className={`${inputClassName} mt-1 min-h-20 resize-none`}
            onChange={(event) => updateLeadForm("mainConcern", event.target.value)}
            value={leadForm.mainConcern}
          />
        </label>

        <label className="block text-xs font-semibold leading-5 text-[#d6d6d6]">
          Preferred appointment timing
          <input
            className={`${inputClassName} mt-1`}
            onChange={(event) =>
              updateLeadForm("preferredTiming", event.target.value)
            }
            placeholder="Example: weekday mornings"
            type="text"
            value={leadForm.preferredTiming}
          />
        </label>

        {leadError ? (
          <p className="rounded-xl border border-[#c46a2d]/40 bg-[#3a2418] px-3 py-2 text-xs leading-5 text-[#ffd9c2]">
            {leadError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-full bg-[#c46a2d] px-4 py-2.5 text-xs font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-[#a95722] focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35 disabled:cursor-not-allowed disabled:bg-[#6f513f] disabled:hover:translate-y-0"
            disabled={isSubmittingLead}
            type="submit"
          >
            {isSubmittingLead ? "Sending..." : "Send to Windy Ridge"}
          </button>
          <button
            className="rounded-full border border-white/12 px-4 py-2.5 text-xs font-semibold text-[#d6d6d6] transition duration-200 hover:border-[#c46a2d] hover:text-white"
            onClick={() => setShowLeadForm(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-transparent text-white">
      <section
        aria-label="Windy Ridge Chiropractic chat widget"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex max-h-[100dvh] min-w-0 flex-col items-end gap-3 overflow-x-hidden sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:gap-4"
      >
        <div
          aria-hidden={!isOpen}
          className={`flex h-[min(650px,calc(100dvh_-_7rem_-_env(safe-area-inset-bottom)))] w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#2a2a2a] shadow-2xl shadow-black/45 transition-all duration-200 ease-out will-change-transform ${
            isOpen
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
              : "pointer-events-none translate-y-3 scale-[0.98] opacity-0"
          }`}
        >
            <header className="shrink-0 border-b border-white/12 bg-[#1f1f1f] px-4 py-3.5 shadow-lg shadow-black/10 sm:px-5 sm:py-4">
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
                    className="h-9 rounded-full border border-white/12 bg-[#2a2a2a] px-3 text-xs font-semibold text-[#d6d6d6] transition duration-200 hover:border-[#c46a2d] hover:bg-[#332820] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35"
                    onClick={clearChat}
                    type="button"
                  >
                    Clear chat
                  </button>
                  <button
                    aria-label="Minimize chat"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-[#2a2a2a] text-lg leading-none text-[#d6d6d6] transition duration-200 hover:border-[#c46a2d] hover:bg-[#332820] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35"
                    onClick={closeChat}
                    type="button"
                  >
                    x
                  </button>
                </div>
              </div>
            </header>

            <div className="wendy-scrollbar min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-3.5 py-4 sm:px-4 sm:py-5">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`}>
                  <div
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[92%] overflow-hidden break-words rounded-2xl px-4 py-3.5 text-sm leading-7 shadow-lg shadow-black/20 sm:max-w-[88%] ${
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
                  {index === messages.length - 1 ? renderLeadCaptureOffer() : null}
                  {index === messages.length - 1 ? renderLeadCaptureForm() : null}
                </div>
              ))}
              {isSending ? (
                <div
                  aria-label="Wendy is typing"
                  className="inline-flex max-w-[92%] items-center gap-2 rounded-2xl rounded-bl-md border border-white/12 bg-[#1f1f1f] px-4 py-4 shadow-lg shadow-black/20 sm:max-w-[88%]"
                  role="status"
                >
                  <span className="wendy-typing-dot h-2.5 w-2.5 rounded-full bg-[#c46a2d]" />
                  <span className="wendy-typing-dot h-2.5 w-2.5 rounded-full bg-[#c46a2d]" />
                  <span className="wendy-typing-dot h-2.5 w-2.5 rounded-full bg-[#c46a2d]" />
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
                  className="max-h-24 min-h-14 min-w-0 flex-1 resize-none rounded-2xl border border-white/12 bg-[#1f1f1f] px-4 py-3 text-base leading-7 text-white outline-none transition duration-200 placeholder:text-[#9f9f9f] focus:border-[#c46a2d] focus:ring-2 focus:ring-[#c46a2d]/30 sm:max-h-28 sm:text-sm"
                  id="chat-message"
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask Wendy..."
                  rows={1}
                  value={input}
                />
                <button
                  className="h-14 shrink-0 rounded-2xl bg-[#c46a2d] px-4 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-[#a95722] focus:outline-none focus:ring-2 focus:ring-[#c46a2d]/35 disabled:cursor-not-allowed disabled:bg-[#6f513f] disabled:text-[#cfc7c1] disabled:hover:translate-y-0 sm:px-5"
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
              <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                Windy Ridge Chiropractic • Life. Unrestricted.
              </p>
            </form>
          </div>

        <button
          aria-expanded={isOpen}
          aria-label={isOpen ? "Chat is open" : "Open Wendy chat"}
          className="flex min-h-16 max-w-full items-center justify-center rounded-full border border-[#f2a36f]/25 bg-[#c46a2d] px-5 py-3.5 text-center text-sm font-bold leading-5 text-white shadow-2xl shadow-black/40 transition duration-200 hover:-translate-y-0.5 hover:bg-[#a95722] hover:shadow-[#c46a2d]/20 focus:outline-none focus:ring-4 focus:ring-[#c46a2d]/35 active:translate-y-0 active:scale-[0.98] sm:min-h-20 sm:px-7 sm:py-4"
          onClick={openChat}
          type="button"
        >
          Wendy 1.0 - Friendly Chatbot
        </button>
      </section>
    </main>
  );
}
