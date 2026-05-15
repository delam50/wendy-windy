export type QuickPrompt = {
  label: string;
  prompt: string;
  topic: string;
  bucket: "educational" | "cost-booking" | "provider-location";
};

export type UsageTopic = {
  topic?: string;
  count?: number;
};

export type QuickPromptResult = {
  actions: Array<Pick<QuickPrompt, "label" | "prompt">>;
  source: "page" | "curated" | "usage";
};

const MAX_QUICK_PROMPTS = 3;
const MIN_USAGE_COUNT = 5;

const quickPromptBank: QuickPrompt[] = [
  {
    label: "What should I expect on my first visit?",
    prompt: "What should I expect on my first visit?",
    topic: "first visit",
    bucket: "educational",
  },
  {
    label: "How do I know which provider to book with?",
    prompt: "How do I know which Windy Ridge provider to book with?",
    topic: "provider matching",
    bucket: "provider-location",
  },
  {
    label: "Do I need X-rays first?",
    prompt: "Do I need X-rays before seeing a chiropractor?",
    topic: "first visit",
    bucket: "educational",
  },
  {
    label: "How much does care cost in Bozeman?",
    prompt: "How much does a chiropractor cost in Bozeman?",
    topic: "pricing",
    bucket: "cost-booking",
  },
  {
    label: "Does insurance cover chiropractic care?",
    prompt: "Does insurance cover chiropractic care?",
    topic: "insurance",
    bucket: "cost-booking",
  },
  {
    label: "What is a follow-up visit cost?",
    prompt: "What is the cost of a follow-up visit?",
    topic: "pricing",
    bucket: "cost-booking",
  },
  {
    label: "Can chiropractic help low back pain?",
    prompt: "Can chiropractic help low back pain?",
    topic: "back pain",
    bucket: "educational",
  },
  {
    label: "Why does my back hurt after skiing?",
    prompt: "What causes low back pain after skiing or hiking?",
    topic: "back pain",
    bucket: "educational",
  },
  {
    label: "When should back pain be checked?",
    prompt: "When should back pain be checked?",
    topic: "back pain",
    bucket: "educational",
  },
  {
    label: "Can neck tension cause headaches?",
    prompt: "Can neck tension cause headaches?",
    topic: "headaches",
    bucket: "educational",
  },
  {
    label: "Can chiropractic help migraines?",
    prompt: "Can chiropractic help migraines?",
    topic: "headaches",
    bucket: "educational",
  },
  {
    label: "What helps neck pain from desk work?",
    prompt: "What helps neck pain from desk work?",
    topic: "neck pain",
    bucket: "educational",
  },
  {
    label: "What happens after dry needling?",
    prompt: "What should I expect after dry needling?",
    topic: "dry needling",
    bucket: "educational",
  },
  {
    label: "Will dry needling make me sore?",
    prompt: "Will I be sore after dry needling?",
    topic: "dry needling",
    bucket: "educational",
  },
  {
    label: "Soft tissue work vs massage?",
    prompt: "What is the difference between soft tissue work and massage?",
    topic: "dry needling",
    bucket: "educational",
  },
  {
    label: "Do you offer pregnancy care?",
    prompt: "Do you offer chiropractic care during pregnancy?",
    topic: "pregnancy",
    bucket: "educational",
  },
  {
    label: "Who sees kids or newborns?",
    prompt: "Who sees kids or newborns at Windy Ridge?",
    topic: "pediatric/newborn",
    bucket: "provider-location",
  },
  {
    label: "Pediatric care in Big Sky?",
    prompt: "Which provider is well aligned for pediatric care in Big Sky?",
    topic: "pediatric/newborn",
    bucket: "provider-location",
  },
  {
    label: "What are your Four Corners hours?",
    prompt: "What are your Four Corners hours?",
    topic: "clinic hours",
    bucket: "provider-location",
  },
  {
    label: "What are your Big Sky hours?",
    prompt: "What are your Big Sky hours?",
    topic: "clinic hours",
    bucket: "provider-location",
  },
  {
    label: "Who is available in Big Sky?",
    prompt: "Who is available in Big Sky?",
    topic: "Big Sky",
    bucket: "provider-location",
  },
  {
    label: "What are your Big Sky hours?",
    prompt: "What are your Big Sky hours?",
    topic: "Big Sky",
    bucket: "provider-location",
  },
  {
    label: "Do you treat skiing injuries?",
    prompt: "Do you treat skiing injuries in Big Sky?",
    topic: "Big Sky",
    bucket: "educational",
  },
  {
    label: "Do you offer massage therapy?",
    prompt: "Do you offer massage therapy?",
    topic: "massage",
    bucket: "provider-location",
  },
  {
    label: "Who sees dogs in clinic?",
    prompt: "Who sees dogs in clinic?",
    topic: "animal chiropractic",
    bucket: "provider-location",
  },
  {
    label: "Where is animal chiropractic offered?",
    prompt: "Where is animal chiropractic offered?",
    topic: "animal chiropractic",
    bucket: "provider-location",
  },
];

const pageTopicPatterns: Array<{ topic: string; patterns: RegExp[] }> = [
  { topic: "dry needling", patterns: [/dry needling/, /soft tissue/] },
  { topic: "pricing", patterns: [/cost/, /pricing/, /insurance/, /cash/] },
  { topic: "insurance", patterns: [/insurance/] },
  { topic: "pregnancy", patterns: [/pregnan/, /prenatal/, /postpartum/, /perinatal/] },
  { topic: "pediatric/newborn", patterns: [/pediatric/, /newborn/, /baby/, /child/, /kids?/] },
  { topic: "Big Sky", patterns: [/big sky/, /ski(?:ing)?/] },
  { topic: "back pain", patterns: [/back pain/, /low(?:er)? back/, /sciatica/] },
  { topic: "headaches", patterns: [/headache/, /migraine/] },
  { topic: "neck pain", patterns: [/neck pain/, /desk work/, /posture/] },
  { topic: "clinic hours", patterns: [/hours?/, /open/, /location/] },
  { topic: "first visit", patterns: [/first visit/, /new patient/, /what to expect/] },
];

const defaultTopics = ["first visit", "pricing", "provider matching"];

function normalize(value: string) {
  return value.toLowerCase().replace(/[-_/]+/g, " ");
}

function rotate<T>(items: T[], seedText: string) {
  if (items.length === 0) return items;
  const seed = Array.from(seedText).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  const offset = seed % items.length;

  return [...items.slice(offset), ...items.slice(0, offset)];
}

function getPageTopics(pageTitle: string, pageUrl: string, pageContext: string) {
  const context = normalize(`${pageTitle} ${pageUrl} ${pageContext}`);

  return pageTopicPatterns
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(context)))
    .map((entry) => entry.topic);
}

function getUsageTopics(usageTopics: UsageTopic[]) {
  return usageTopics
    .filter((topic) => (topic.count ?? 0) >= MIN_USAGE_COUNT)
    .map((topic) => topic.topic)
    .filter((topic): topic is string => Boolean(topic));
}

function candidatesForTopics(topics: string[], sourceWeight: number) {
  return topics.flatMap((topic, topicIndex) =>
    quickPromptBank
      .filter((prompt) => prompt.topic === topic)
      .map((prompt, promptIndex) => ({
        prompt,
        score: sourceWeight - topicIndex * 5 - promptIndex,
      })),
  );
}

function selectDiversePrompts(
  candidates: Array<{ prompt: QuickPrompt; score: number }>,
  seedText: string,
) {
  const sortedCandidates = rotate(
    [...candidates].sort((first, second) => second.score - first.score),
    seedText,
  ).sort((first, second) => second.score - first.score);
  const selected: QuickPrompt[] = [];
  const usedBuckets = new Set<string>();
  const usedTopics = new Set<string>();
  const pageSpecificCandidates = sortedCandidates.filter(
    (candidate) => candidate.score >= 100,
  );

  for (const candidate of pageSpecificCandidates) {
    if (selected.length >= MAX_QUICK_PROMPTS) {
      break;
    }

    if (selected.some((prompt) => prompt.label === candidate.prompt.label)) {
      continue;
    }

    selected.push(candidate.prompt);
    usedBuckets.add(candidate.prompt.bucket);
    usedTopics.add(candidate.prompt.topic);
  }

  function tryAdd(requireNewBucket: boolean) {
    for (const candidate of sortedCandidates) {
      if (selected.some((prompt) => prompt.label === candidate.prompt.label)) {
        continue;
      }

      const sameTopicCount = selected.filter(
        (prompt) => prompt.topic === candidate.prompt.topic,
      ).length;
      const pageContextStronglyJustifiesMore =
        candidate.score >= 100 && sameTopicCount < 2;

      if (usedTopics.has(candidate.prompt.topic) && !pageContextStronglyJustifiesMore) {
        continue;
      }

      if (requireNewBucket && usedBuckets.has(candidate.prompt.bucket)) {
        continue;
      }

      selected.push(candidate.prompt);
      usedBuckets.add(candidate.prompt.bucket);
      usedTopics.add(candidate.prompt.topic);

      if (selected.length >= MAX_QUICK_PROMPTS) {
        return;
      }
    }
  }

  tryAdd(true);
  tryAdd(false);

  return selected.slice(0, MAX_QUICK_PROMPTS);
}

export function getQuickPromptsForContext(input: {
  pageTitle?: string;
  pageUrl?: string;
  pageContext?: string;
  usageTopics?: UsageTopic[];
}): QuickPromptResult {
  const pageTitle = input.pageTitle ?? "";
  const pageUrl = input.pageUrl ?? "";
  const pageContext = input.pageContext ?? "";
  const seedText = `${pageTitle} ${pageUrl} ${pageContext}`;
  const pageTopics = getPageTopics(pageTitle, pageUrl, pageContext);
  const usageTopics = getUsageTopics(input.usageTopics ?? []);
  const topics = [
    ...pageTopics,
    ...defaultTopics,
    ...usageTopics.filter((topic) => !pageTopics.includes(topic)),
  ];
  const candidates = [
    ...candidatesForTopics(pageTopics, 120),
    ...candidatesForTopics(defaultTopics, 80),
    ...candidatesForTopics(usageTopics, 35),
  ];
  const selected = selectDiversePrompts(
    candidates.length > 0 ? candidates : candidatesForTopics(topics, 50),
    seedText || "windy-ridge",
  );

  return {
    actions: selected.map(({ label, prompt }) => ({ label, prompt })),
    source: pageTopics.length > 0 ? "page" : usageTopics.length > 0 ? "usage" : "curated",
  };
}
