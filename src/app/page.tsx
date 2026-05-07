"use client";

import Image from "next/image";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { trackAnalyticsEvent } from "@/lib/analytics";

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  resources?: ResourceCard[];
};

type ResourceCard = {
  title: string;
  summary: string;
  url: string;
  type: string;
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
  recommendedResourceUrls?: string[];
};

type PageContext = {
  pageContext: string;
  pageTitle: string;
  pageUrl: string;
};

const SESSION_MESSAGES_KEY = "wendy.session.messages";
const SESSION_MEMORY_KEY = "wendy.session.memory";
const SESSION_LAUNCHER_KNOCK_KEY = "wendy.session.launcherKnockPlayed";
const MAX_SESSION_MESSAGES = 12;

const defaultQuickActions: QuickAction[] = [
  {
    label: "What does a first visit look like?",
    prompt: "What does a first visit look like at Windy Ridge?",
  },
  {
    label: "How much does care typically cost?",
    prompt: "How much does care typically cost at Windy Ridge?",
  },
  {
    label: "Can chiropractic help back or neck pain?",
    prompt: "Can chiropractic help back or neck pain?",
  },
  {
    label: "Which location should I book at?",
    prompt: "Which Windy Ridge location should I book at, Bozeman or Big Sky?",
  },
];

const contextualQuickActionSets: Array<{
  patterns: RegExp[];
  actions: QuickAction[];
}> = [
  {
    patterns: [/\bback pain\b/, /\blow(?:er)? back\b/, /\bsciatica\b/, /\bdisc\b/],
    actions: [
      {
        label: "Can chiropractic help sciatica?",
        prompt: "Can chiropractic help sciatica?",
      },
      {
        label: "What causes low back pain after skiing?",
        prompt: "What causes low back pain after skiing around Big Sky?",
      },
      {
        label: "What should I expect on my first visit?",
        prompt: "What should I expect on my first visit at Windy Ridge?",
      },
    ],
  },
  {
    patterns: [/\bneck pain\b/, /\bheadaches?\b/, /\bmigraines?\b/, /\bposture\b/],
    actions: [
      {
        label: "Can neck tension contribute to headaches?",
        prompt: "Can neck tension contribute to headaches?",
      },
      {
        label: "Do you have blogs on migraines?",
        prompt: "Do you have blogs or resources on migraines?",
      },
      {
        label: "Can posture cause neck pain?",
        prompt: "Can posture or desk work cause neck pain?",
      },
    ],
  },
  {
    patterns: [/\bpregnan/, /\bpostpartum\b/, /\bnewborn\b/, /\bpediatric\b/, /\bbaby\b/],
    actions: [
      {
        label: "Is chiropractic safe during pregnancy?",
        prompt: "Is chiropractic safe during pregnancy?",
      },
      {
        label: "Do you offer postpartum care?",
        prompt: "Does Windy Ridge offer postpartum care?",
      },
      {
        label: "Can Dr. Claire see newborns?",
        prompt: "Can Dr. Claire see newborns?",
      },
    ],
  },
  {
    patterns: [/\bbig sky\b/, /\bski(?:ing)?\b/, /\bsnowboard\b/],
    actions: [
      {
        label: "Who practices in Big Sky?",
        prompt: "Who practices at Windy Ridge in Big Sky?",
      },
      {
        label: "Do you treat skiing injuries?",
        prompt: "Does Windy Ridge help with skiing injuries?",
      },
      {
        label: "Can I book Thursday appointments?",
        prompt: "Can I book Thursday appointments in Big Sky?",
      },
    ],
  },
  {
    patterns: [/\binsurance\b/, /\bcost\b/, /\bpricing\b/, /\bcash\b/, /\brates?\b/],
    actions: [
      {
        label: "How does insurance work?",
        prompt: "How does insurance work at Windy Ridge?",
      },
      {
        label: "What does a first visit cost?",
        prompt: "What does a first visit cost at Windy Ridge?",
      },
      {
        label: "Do you offer cash pricing?",
        prompt: "Does Windy Ridge offer cash pricing?",
      },
    ],
  },
];

const friendlyConnectionError =
  "Sorry, Wendy is having trouble connecting right now. Please try again in a moment, or book directly here: https://windyridgechiropractic.janeapp.com/";

const leadSuccessMessage =
  "Brilliant, I’ll pass this along to the Windy Ridge team. You can also book directly here if you’d like the fastest option: https://windyridgechiropractic.janeapp.com/";

const leadNotificationErrorMessage =
  "Thanks, I saved your details, but Wendy had trouble emailing the Windy Ridge team just now. Please try again in a moment, or book directly here for the fastest option: https://windyridgechiropractic.janeapp.com/";

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

function createMessageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getRevealChunks(content: string) {
  const words = content.split(/(\s+)/);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const wordsPerChunk = wordCount > 90 ? 8 : wordCount > 40 ? 6 : 4;
  const chunks: string[] = [];
  let currentChunk = "";
  let currentWordCount = 0;

  for (const token of words) {
    currentChunk += token;

    if (token.trim()) {
      currentWordCount += 1;
    }

    if (currentWordCount >= wordsPerChunk) {
      chunks.push(currentChunk);
      currentChunk = "";
      currentWordCount = 0;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function sanitizeResourceCards(resources: unknown) {
  if (!Array.isArray(resources)) {
    return [];
  }

  return resources
    .filter((resource): resource is Record<string, unknown> =>
      Boolean(resource && typeof resource === "object"),
    )
    .map((resource) => ({
      // Keep cards strictly user-facing. Retrieval scores/debug fields are
      // intentionally not copied into the UI model.
      title: typeof resource.title === "string" ? resource.title : "Windy Ridge Resource",
      summary:
        typeof resource.summary === "string"
          ? resource.summary
          : "A Windy Ridge resource with more detail.",
      url: typeof resource.url === "string" ? resource.url : "",
      type: typeof resource.type === "string" ? resource.type : "Resource",
    }))
    .filter((resource) => resource.url.startsWith("http"))
    .slice(0, 4);
}

function renderMessageContent(content: string) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlPattern);

  return parts.map((part, index) => {
    if (!part.match(/^https?:\/\/[^\s]+$/)) {
      return part;
    }

    const href = part.replace(/[),.!?]+$/, "");

    return (
      <a
        className="font-semibold text-[#f4ad79] underline decoration-[#f4ad79]/50 underline-offset-4 transition hover:text-white"
        href={href}
        key={`${part}-${index}`}
        onClick={() => {
          if (href.includes("windyridgechiropractic.janeapp.com")) {
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
        {href}
      </a>
    );
  });
}

function getResourceUrls(content: string) {
  const urls = content.match(/https?:\/\/[^\s)]+/g) ?? [];

  return Array.from(
    new Set(
      urls
        .map((url) => url.replace(/[),.!?]+$/, ""))
        .filter(
          (url) =>
            url.includes("windyridgechiropractic.com") &&
            !url.includes("windyridgechiropractic.janeapp.com"),
        ),
    ),
  );
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function getResourceTitle(url: string) {
  try {
    const parsedUrl = new URL(url);
    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    const lastSegment = segments.at(-1);

    if (!lastSegment) {
      return "Windy Ridge Chiropractic";
    }

    return titleCase(
      decodeURIComponent(lastSegment)
        .replace(/-/g, " ")
        .replace(/&#038;/g, "&")
        .replace(/\s+/g, " ")
        .trim(),
    );
  } catch {
    return "Windy Ridge Resource";
  }
}

function getResourceDescription(url: string) {
  const title = getResourceTitle(url);

  if (url.includes("/chiropractic-services/")) {
    return `Windy Ridge details on ${title.toLowerCase()} and care options.`;
  }

  if (url.includes("cost") || url.includes("insurance")) {
    return "Helpful context on cost, insurance, and what to confirm through JaneApp.";
  }

  if (url.includes("big-sky") || url.includes("bozeman")) {
    return "Local Windy Ridge information for Bozeman and Big Sky patients.";
  }

  return `A short Windy Ridge resource on ${title.toLowerCase()}.`;
}

function getResourceSnippet(content: string, url: string) {
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nearbyText =
    content
      .match(new RegExp(`([^\\n.?!]{35,180})${escapedUrl}`))?.[1]
      ?.replace(/^[\s:-]+|[\s:-]+$/g, "")
      .trim() ?? "";

  if (
    nearbyText &&
    !/book here|janeapp|fastest option/i.test(nearbyText)
  ) {
    return nearbyText.length > 150
      ? `${nearbyText.slice(0, 147).trim()}...`
      : nearbyText;
  }

  const cleanedContent = content
    .replace(url, "")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = cleanedContent
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence.length >= 35 &&
        !/book here|janeapp|fastest option/i.test(sentence),
    );
  const snippet = sentences.at(-1);

  if (!snippet) {
    return getResourceDescription(url);
  }

  return snippet.length > 150 ? `${snippet.slice(0, 147).trim()}...` : snippet;
}

function renderResourceCards(content: string, resources: ResourceCard[] = []) {
  const resourceCards =
    resources.length > 0
      ? resources
      : getResourceUrls(content)
          .slice(0, 4)
          .map((resourceUrl) => ({
            title: getResourceTitle(resourceUrl),
            summary: getResourceSnippet(content, resourceUrl),
            url: resourceUrl,
            type: getResourceDescription(resourceUrl).includes("cost")
              ? "Cost & Insurance Page"
              : "Resource",
          }));

  if (resourceCards.length === 0) {
    return null;
  }

  return (
    <div className="wendy-resource-enter mt-2 grid max-w-[92%] gap-2 sm:max-w-[88%]">
      {resourceCards.map((resource) => (
        <a
          className="group wendy-message-enter block rounded-2xl border border-[#d77a34]/40 bg-[linear-gradient(145deg,rgba(55,39,28,0.96),rgba(38,33,29,0.94))] p-3.5 text-left shadow-lg shadow-black/20 ring-1 ring-[#f4ad79]/5 transition duration-200 hover:-translate-y-0.5 hover:border-[#d77a34]/75 hover:bg-[#3b2b20] hover:shadow-[#d77a34]/15"
          href={resource.url}
          key={resource.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f4ad79]">
            {resource.type}
          </p>
          <p className="mt-1 break-words text-sm font-semibold leading-6 text-white">
            {resource.title}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#d6d6d6]">
            {resource.summary}
          </p>
          <span className="mt-3 inline-flex rounded-full border border-[#d77a34]/35 px-3 py-1 text-[11px] font-semibold text-[#f4ad79] transition group-hover:border-[#d77a34]">
            Open resource
          </span>
        </a>
      ))}
    </div>
  );
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

function getContextualQuickActions(pageContext: PageContext) {
  const contextText = `${pageContext.pageTitle} ${pageContext.pageUrl} ${pageContext.pageContext}`
    .toLowerCase()
    .replace(/[-_/]+/g, " ");

  if (!contextText.trim()) {
    return defaultQuickActions;
  }

  const matchedSet = contextualQuickActionSets.find((set) =>
    set.patterns.some((pattern) => pattern.test(contextText)),
  );

  if (!matchedSet) {
    return defaultQuickActions;
  }

  const rotationSeed = Array.from(contextText).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  const rotationOffset = rotationSeed % matchedSet.actions.length;

  return [
    ...matchedSet.actions.slice(rotationOffset),
    ...matchedSet.actions.slice(0, rotationOffset),
  ];
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
      ).map((message) => ({
        id: typeof message.id === "string" ? message.id : createMessageId(),
        role: message.role,
        content: message.content,
        resources: sanitizeResourceCards(message.resources),
      })),
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
      recommendedResourceUrls: Array.isArray(parsed.recommendedResourceUrls)
        ? parsed.recommendedResourceUrls
            .filter((url) => typeof url === "string")
            .slice(-12)
        : [],
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

function shouldPlayLauncherKnock() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.sessionStorage.getItem(SESSION_LAUNCHER_KNOCK_KEY) !== "true";
}

export default function Home() {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const latestAssistantMessageRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [playLauncherKnock, setPlayLauncherKnock] = useState(() =>
    shouldPlayLauncherKnock(),
  );
  const [messages, setMessages] = useState<Message[]>(() => loadSessionMessages());
  const latestAssistantScrollCountRef = useRef(
    messages.filter((message) => message.role === "assistant").length,
  );
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
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
  const suggestedQuickActions = useMemo(
    () => getContextualQuickActions(getPageContext()),
    [],
  );

  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending && !isRevealing,
    [input, isRevealing, isSending],
  );

  const shouldOfferLeadCapture = useMemo(
    () => {
      const latestUserMessage = messages.findLast(
        (message) => message.role === "user",
      );

      return (
        !hasClickedBookingLink &&
        !showLeadForm &&
        Boolean(latestUserMessage && hasBookingIntent(latestUserMessage.content))
      );
    },
    [hasClickedBookingLink, messages, showLeadForm],
  );

  useEffect(() => {
    persistSession(messages, {
      ...sessionMemory,
      bookingLinkClicked: hasClickedBookingLink,
    });
  }, [hasClickedBookingLink, messages, sessionMemory]);

  useEffect(() => {
    if (!playLauncherKnock) {
      return;
    }

    window.sessionStorage.setItem(SESSION_LAUNCHER_KNOCK_KEY, "true");
  }, [playLauncherKnock]);

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
    if (!isOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || messages.at(-1)?.role !== "assistant") {
      return;
    }

    const assistantMessageCount = messages.filter(
      (message) => message.role === "assistant",
    ).length;

    if (assistantMessageCount <= latestAssistantScrollCountRef.current) {
      return;
    }

    latestAssistantScrollCountRef.current = assistantMessageCount;

    window.requestAnimationFrame(() => {
      latestAssistantMessageRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [isOpen, messages]);

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

    if (!trimmedContent || isSending || isRevealing) {
      return;
    }

    trackAnalyticsEvent("message_sent", {
      ...getAnalyticsPageMetadata(),
      messageLength: trimmedContent.length,
      bookingLinkClicked: hasClickedBookingLink,
    });

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: trimmedContent,
    };
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
    setShowLeadForm(false);
    setLeadError("");
    setIsSending(true);

    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });

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
        resources?: ResourceCard[];
      };

      if (!response.ok || !data.message) {
        throw new Error(friendlyConnectionError);
      }

      const assistantMessage = data.message;
      const assistantResources = sanitizeResourceCards(data.resources);
      const assistantMessageId = createMessageId();
      const assistantChatMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        content: assistantMessage,
      };
      const memoryAfterAssistant = mergeSessionMemory(
        nextMemory,
        assistantChatMessage,
      );
      const recommendedResourceUrls = Array.from(
        new Set([
          ...(memoryAfterAssistant.recommendedResourceUrls ?? []),
          ...getResourceUrls(assistantMessage),
          ...assistantResources.map((resource) => resource.url),
        ]),
      ).slice(-12);

      trackAnalyticsEvent("assistant_response_received", {
        ...getAnalyticsPageMetadata(),
        assistantResponseLength: assistantMessage.length,
        bookingLinkClicked: hasClickedBookingLink,
      });

      setSessionMemory({
        ...memoryAfterAssistant,
        recommendedResourceUrls,
      });
      setIsSending(false);
      setIsRevealing(true);
      setMessages((currentMessages) =>
        trimMessagesForSession([
          ...currentMessages,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
          },
        ]),
      );
      setShowLeadForm(false);

      const revealChunks = getRevealChunks(assistantMessage);

      for (let chunkIndex = 0; chunkIndex < revealChunks.length; chunkIndex += 1) {
        const revealedContent = revealChunks.slice(0, chunkIndex + 1).join("");
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: revealedContent }
              : message,
          ),
        );
        await wait(22);
      }

      await wait(140);

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: assistantMessage, resources: assistantResources }
            : message,
        ),
      );
    } catch {
      setError(friendlyConnectionError);
      trackAnalyticsEvent("error_shown", {
        ...getAnalyticsPageMetadata(),
        errorType: "chat_connection",
      });
    } finally {
      setIsSending(false);
      setIsRevealing(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (canSend) {
      void sendMessage(input);
    }
  }

  function clearChat() {
    latestAssistantScrollCountRef.current = 1;
    setMessages([welcomeMessage]);
    setInput("");
    setError("");
    setIsSending(false);
    setIsRevealing(false);
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

    if (action.url?.includes("windyridgechiropractic.janeapp.com")) {
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
          leadSaved?: boolean;
        };

        if (data.leadSaved) {
          setMessages((currentMessages) => [
            ...currentMessages,
            { role: "assistant", content: leadNotificationErrorMessage },
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
          trackAnalyticsEvent("error_shown", {
            ...getAnalyticsPageMetadata(),
            errorType: "lead_email_notification",
            leadLocationPreference: leadForm.location || undefined,
          });
          return;
        }

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
      <div className="ml-1 mt-3 grid w-full max-w-[94%] grid-cols-1 gap-2 sm:max-w-[90%]">
        {suggestedQuickActions.map((action) => {
          const className =
            "wendy-orange-hover min-h-11 rounded-2xl border border-white/12 bg-[linear-gradient(145deg,rgba(255,255,255,0.065),rgba(215,122,52,0.045))] px-3.5 py-2.5 text-left text-xs font-semibold leading-5 text-[#f7f7f7] shadow-lg shadow-black/15 backdrop-blur hover:-translate-y-0.5 hover:border-[#d77a34] hover:bg-[#3a2a20]/85 hover:text-white hover:shadow-[#d77a34]/25 focus:outline-none focus:ring-2 focus:ring-[#d77a34]/50 active:translate-y-0 active:scale-[0.99]";

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
      <div className="ml-1 mt-3 max-w-[92%] rounded-2xl border border-[#d77a34]/35 bg-[#2f251f] px-4 py-3.5 shadow-lg shadow-black/20 sm:max-w-[88%]">
        <p className="text-xs leading-6 text-[#f4f4f4]">
          If you would rather have the Windy Ridge team follow up, I can collect
          a few quick details. Please keep the concern general.
        </p>
        <button
          className="wendy-orange-hover mt-3 rounded-full bg-[linear-gradient(135deg,#df8440,#b85f25)] px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-[#d77a34]/20 hover:-translate-y-0.5 hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[#d77a34]/45 active:translate-y-0"
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
      "wendy-input-glow w-full rounded-xl border border-white/12 bg-[#1f1f1f] px-3 py-2.5 text-sm leading-6 text-white outline-none transition duration-200 placeholder:text-[#8f8f8f] focus:border-[#df8440] focus:ring-0";

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
                className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#d77a34]/35 ${
                  leadForm.location === location
                    ? "border-[#d77a34] bg-[linear-gradient(135deg,#df8440,#b85f25)] text-white shadow-lg shadow-[#d77a34]/20"
                    : "border-white/12 bg-[#252525] text-[#d6d6d6] hover:border-[#d77a34] hover:text-white"
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
          <p className="rounded-xl border border-[#d77a34]/40 bg-[#3d2618] px-3 py-2 text-xs leading-5 text-[#ffd9c2]">
            {leadError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="wendy-orange-hover rounded-full bg-[#d77a34] px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-[#d77a34]/15 hover:-translate-y-0.5 hover:bg-[#b85f25] focus:outline-none focus:ring-2 focus:ring-[#d77a34]/45 disabled:cursor-not-allowed disabled:bg-[#6f513f] disabled:hover:translate-y-0"
            disabled={isSubmittingLead}
            type="submit"
          >
            {isSubmittingLead ? "Sending..." : "Send to Windy Ridge"}
          </button>
          <button
            className="wendy-orange-hover rounded-full border border-white/12 px-4 py-2.5 text-xs font-semibold text-[#d6d6d6] hover:border-[#d77a34] hover:text-white"
            onClick={() => setShowLeadForm(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const latestAssistantIndex = messages.findLastIndex(
    (message) => message.role === "assistant",
  );

  return (
    <main className="min-h-dvh overflow-x-hidden bg-transparent text-white">
      <section
        aria-label="Windy Ridge Chiropractic chat widget"
        className="wendy-widget-arrive fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex max-h-[100dvh] min-w-0 flex-col items-end gap-3 overflow-x-hidden sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:gap-4"
      >
        <div
          aria-hidden={!isOpen}
          className={`wendy-panel-glow flex h-[min(650px,calc(100dvh_-_7rem_-_env(safe-area-inset-bottom)))] w-full min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#232323]/92 ring-1 ring-[#d77a34]/20 backdrop-blur-xl transition-all duration-300 ease-out will-change-transform ${
            isOpen
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
              : "pointer-events-none translate-y-5 scale-[0.97] opacity-0"
          }`}
        >
            <header className="wendy-header-glow shrink-0 border-b border-white/12 bg-[radial-gradient(circle_at_top_right,rgba(215,122,52,0.2),transparent_42%),rgba(31,31,31,0.9)] px-4 py-3.5 backdrop-blur-xl sm:px-5 sm:py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-white p-1.5 shadow-lg shadow-black/20">
                    <Image
                      alt="Windy Ridge Chiropractic"
                      className="h-full w-full object-contain"
                      height={96}
                      src="/logo.png"
                      width={96}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f4ad79]">
                        Meet Wendy
                      </p>
                      <span
                        aria-label="Wendy is online"
                        className="wendy-online-indicator h-2 w-2 rounded-full bg-[#f4ad79] shadow-[0_0_14px_rgba(244,173,121,0.98)]"
                      />
                    </div>
                    <h1 className="mt-1 break-words text-[15px] font-semibold leading-6 text-white">
                      Windy Ridge’s AI Care Assistant
                    </h1>
                    <p className="mt-0.5 break-words text-xs leading-5 text-[#d6d6d6]">
                      Life. Unrestricted.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="wendy-orange-hover h-9 rounded-full border border-white/12 bg-[#2a2a2a] px-3 text-xs font-semibold text-[#d6d6d6] hover:border-[#d77a34] hover:bg-[#3a2a20] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#d77a34]/45"
                    onClick={clearChat}
                    type="button"
                  >
                    Clear chat
                  </button>
                  <button
                    aria-label="Minimize chat"
                    className="wendy-orange-hover flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-[#2a2a2a] text-lg leading-none text-[#d6d6d6] hover:border-[#d77a34] hover:bg-[#3a2a20] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#d77a34]/45"
                    onClick={closeChat}
                    type="button"
                  >
                    x
                  </button>
                </div>
              </div>
            </header>

            <div className="wendy-scrollbar min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(215,122,52,0.17),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent)] px-3.5 py-4 sm:px-4 sm:py-5">
              {messages.map((message, index) => (
                <div className="wendy-message-enter" key={`${message.role}-${index}`}>
                  <div
                    ref={
                      message.role === "assistant" && index === latestAssistantIndex
                        ? latestAssistantMessageRef
                        : undefined
                    }
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[92%] overflow-hidden break-words rounded-2xl px-4 py-3.5 text-sm leading-7 shadow-lg shadow-black/20 backdrop-blur sm:max-w-[88%] ${
                        message.role === "user"
                          ? "rounded-br-md bg-[linear-gradient(135deg,#df8440,#b85f25)] text-white shadow-[#d77a34]/15"
                          : "rounded-bl-md border border-white/12 bg-[#1f1f1f]/88 text-[#f4f4f4]"
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
                  {message.role === "assistant"
                    ? renderResourceCards(message.content, message.resources)
                    : null}
                  {index === messages.length - 1 ? renderLeadCaptureOffer() : null}
                  {index === messages.length - 1 ? renderLeadCaptureForm() : null}
                </div>
              ))}
              {isSending ? (
                <div
                  aria-label="Wendy is typing"
                  className="wendy-thinking-card inline-flex max-w-[92%] items-center gap-3 rounded-2xl rounded-bl-md border border-[#d77a34]/25 bg-[linear-gradient(145deg,rgba(31,31,31,0.96),rgba(49,38,31,0.9))] px-4 py-3.5 shadow-lg shadow-black/20 sm:max-w-[88%]"
                  role="status"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="wendy-typing-dot h-2.5 w-2.5 rounded-full bg-[#d77a34] shadow-[0_0_14px_rgba(215,122,52,0.45)]" />
                    <span className="wendy-typing-dot h-2.5 w-2.5 rounded-full bg-[#d77a34] shadow-[0_0_14px_rgba(215,122,52,0.45)]" />
                    <span className="wendy-typing-dot h-2.5 w-2.5 rounded-full bg-[#d77a34] shadow-[0_0_14px_rgba(215,122,52,0.45)]" />
                  </span>
                  <span className="text-xs font-medium leading-5 text-[#d6d6d6]">
                    Wendy is checking the best fit...
                  </span>
                  <span className="sr-only">Wendy is typing</span>
                </div>
              ) : null}
              <div aria-hidden="true" ref={messagesEndRef} />
            </div>

            <form
              className="shrink-0 border-t border-white/12 bg-[#252525]/92 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:p-4"
              onSubmit={handleSubmit}
            >
              {error ? (
                <p className="mb-3 break-words rounded-xl border border-[#d77a34]/40 bg-[#3d2618] px-3 py-2 text-xs leading-6 text-[#ffd9c2]">
                  {error}
                </p>
              ) : null}
              <label className="sr-only" htmlFor="chat-message">
                Message Wendy
              </label>
              <div className="flex min-w-0 items-end gap-2">
                <textarea
                  className="wendy-input-glow max-h-24 min-h-14 min-w-0 flex-1 resize-none rounded-2xl border border-white/12 bg-[#1f1f1f]/90 px-4 py-3 text-base leading-7 text-white outline-none transition duration-200 placeholder:text-[#9f9f9f] focus:border-[#df8440] focus:ring-0 sm:max-h-28 sm:text-sm"
                  id="chat-message"
                  onKeyDown={handleMessageKeyDown}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask Wendy..."
                  rows={1}
                  value={input}
                />
                <button
                  className="wendy-orange-hover h-14 shrink-0 rounded-2xl bg-[linear-gradient(135deg,#df8440,#b85f25)] px-4 text-sm font-semibold text-white shadow-lg shadow-[#d77a34]/25 hover:-translate-y-0.5 hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-[#d77a34]/50 disabled:cursor-not-allowed disabled:bg-[#6f513f] disabled:text-[#cfc7c1] disabled:hover:translate-y-0 sm:px-5"
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
          className={`wendy-launcher-glow flex min-h-16 max-w-full items-center justify-center gap-3 rounded-full border border-[#f4ad79]/40 bg-[linear-gradient(135deg,#df8440,#b85f25)] px-5 py-3.5 text-center text-sm font-bold leading-5 text-white ring-1 ring-white/15 transition duration-300 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_24px_58px_rgba(0,0,0,0.5),0_0_46px_rgba(215,122,52,0.42)] focus:outline-none focus:ring-4 focus:ring-[#d77a34]/50 active:translate-y-0 active:scale-[0.98] sm:min-h-20 sm:px-6 sm:py-4 ${
            isOpen
              ? ""
              : playLauncherKnock
                ? "wendy-launcher-knock"
                : "wendy-launcher-breathe"
          }`}
          onAnimationEnd={(event) => {
            if (event.animationName === "wendy-launcher-knock") {
              setPlayLauncherKnock(false);
            }
          }}
          onClick={openChat}
          type="button"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1 shadow-lg shadow-black/20">
            <Image
              alt=""
              className="h-full w-full object-contain"
              height={80}
              src="/logo.png"
              width={80}
            />
          </span>
          <span className="text-left">
            <span className="block">Meet Wendy</span>
            <span className="block text-xs font-semibold text-white/80">
              Windy Ridge AI
            </span>
          </span>
        </button>
      </section>
    </main>
  );
}
