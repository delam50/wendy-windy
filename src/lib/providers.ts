export type WendyProvider = {
  id: string;
  name: string;
  role: "chiropractor" | "massage therapist";
  locations: Array<"Four Corners" | "Big Sky">;
  availabilityNote?: string;
  focus: string[];
};

export type RankedWendyProvider = WendyProvider & {
  score: number;
  reasons: string[];
};

export const wendyProviders: WendyProvider[] = [
  {
    id: "dr-david",
    name: "Dr. David",
    role: "chiropractor",
    locations: ["Four Corners", "Big Sky"],
    availabilityNote: "Both locations with varying hours.",
    focus: [
      "general chiropractic",
      "neck pain",
      "back pain",
      "active adults",
      "sports injuries",
      "soft tissue care",
      "dry needling when appropriate",
    ],
  },
  {
    id: "dr-josh",
    name: "Dr. Josh",
    role: "chiropractor",
    locations: ["Four Corners"],
    focus: [
      "general chiropractic",
      "neck pain",
      "back pain",
      "soft tissue care",
      "dry needling when appropriate",
      "small animal chiropractic",
    ],
  },
  {
    id: "dr-kyle",
    name: "Dr. Kyle",
    role: "chiropractor",
    locations: ["Four Corners", "Big Sky"],
    availabilityNote: "Big Sky Thursdays 8 AM-5 PM.",
    focus: [
      "sports chiropractic",
      "performance care",
      "active patients",
      "sports injuries",
      "lower limb issues",
      "ankle mobility",
      "soft tissue care",
      "dry needling when appropriate",
    ],
  },
  {
    id: "dr-claire",
    name: "Dr. Claire",
    role: "chiropractor",
    locations: ["Four Corners", "Big Sky"],
    availabilityNote:
      "Big Sky on Wednesdays and not at Four Corners on Wednesdays. Also offers at-home visits for mom and newborn when applicable.",
    focus: [
      "pediatrics",
      "pregnancy",
      "postpartum",
      "perinatal care",
      "family chiropractic",
      "newborn care",
      "children",
    ],
  },
  {
    id: "nichole",
    name: "Nichole",
    role: "massage therapist",
    locations: ["Big Sky"],
    focus: ["massage therapy"],
  },
  {
    id: "james",
    name: "James",
    role: "massage therapist",
    locations: ["Four Corners"],
    focus: ["massage therapy"],
  },
];

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function addScore(
  ranked: RankedWendyProvider,
  amount: number,
  reason: string,
) {
  ranked.score += amount;
  ranked.reasons.push(reason);
}

export function rankWendyProviders(input: {
  query: string;
  pageContext?: string;
  max?: number;
}) {
  const text = `${input.query}\n${input.pageContext ?? ""}`.toLowerCase();
  const mentionsFourCorners = includesAny(text, [
    /\bfour corners\b/,
    /\bbozeman\b/,
    /\bbelgrade\b/,
    /\bgallatin\b/,
  ]);
  const mentionsBigSky = /\bbig sky\b/.test(text);
  const pediatricIntent = includesAny(text, [
    /\bpediatric\b/,
    /\bkids?\b/,
    /\bchild(?:ren)?\b/,
    /\btoddler\b/,
    /\bbaby\b/,
    /\bnewborn\b/,
    /\bgrowing pains?\b/,
  ]);
  const pregnancyIntent = includesAny(text, [
    /\bpregnan/,
    /\bprenatal\b/,
    /\bpostpartum\b/,
    /\bperinatal\b/,
    /\bwomen'?s health\b/,
  ]);
  const performanceIntent = includesAny(text, [
    /\bsports?\b/,
    /\bperformance\b/,
    /\bactive\b/,
    /\bski(?:ing)?\b/,
    /\bhik(?:e|ing)\b/,
    /\bankle\b/,
    /\blower limb\b/,
    /\bmobility\b/,
    /\btraining\b/,
  ]);
  const massageIntent = includesAny(text, [
    /\bmassage\b/,
    /\bmassage therapy\b/,
    /\bmassage therapist\b/,
    /\bsoft tissue massage\b/,
  ]);
  const chiropracticSoftTissueIntent =
    /\b(dry needling|soft tissue care|soft tissue work)\b/.test(text) &&
    !massageIntent;
  const generalNeckBackIntent = includesAny(text, [
    /\bneck pain\b/,
    /\bback pain\b/,
    /\blow back\b/,
    /\blower back\b/,
    /\bsciatica\b/,
  ]);
  const animalIntent = includesAny(text, [
    /\bpet\b/,
    /\bdog\b/,
    /\bcat\b/,
    /\banimal\b/,
    /\bveterinary\b/,
  ]);

  const ranked = wendyProviders.map<RankedWendyProvider>((provider) => ({
    ...provider,
    score: 0,
    reasons: [],
  }));

  for (const provider of ranked) {
    const providerNamePattern = new RegExp(
      `\\b${provider.name.toLowerCase().replace("dr. ", "(?:dr\\.?\\s*)?")}\\b`,
      "i",
    );

    if (providerNamePattern.test(text)) {
      addScore(provider, 90, "user asked about this provider directly");
    }

    if (mentionsFourCorners && provider.locations.includes("Four Corners")) {
      addScore(provider, 10, "matches Four Corners / Bozeman location");
    }

    if (mentionsBigSky && provider.locations.includes("Big Sky")) {
      addScore(provider, 10, "matches Big Sky location");
    }

    if (massageIntent) {
      if (provider.id === "nichole" && mentionsBigSky) {
        addScore(provider, 60, "Big Sky massage therapy");
      } else if (provider.id === "james" && mentionsFourCorners) {
        addScore(provider, 60, "Four Corners massage therapy");
      } else if (provider.id === "nichole" || provider.id === "james") {
        addScore(provider, 38, "massage therapy");
      } else {
        provider.score -= 20;
      }
      continue;
    }

    if (pediatricIntent || pregnancyIntent) {
      if (provider.id === "dr-claire") {
        addScore(
          provider,
          mentionsBigSky ? 76 : mentionsFourCorners ? 70 : 68,
          mentionsBigSky
            ? "Wednesday Big Sky pediatric / pregnancy / perinatal care"
            : "primary pregnancy / pediatric / newborn care provider",
        );
      }
    }

    if (animalIntent && provider.id === "dr-josh") {
      addScore(provider, 70, "small animal chiropractic at Four Corners");
    }

    if (performanceIntent) {
      if (provider.id === "dr-kyle") {
        addScore(provider, 68, "sports / performance / ankle mobility focus");
      }
      if (provider.id === "dr-david") {
        addScore(provider, 24, "sports injuries and active adults");
      }
    }

    if (chiropracticSoftTissueIntent) {
      if (["dr-david", "dr-josh", "dr-kyle"].includes(provider.id)) {
        addScore(provider, 30, "soft tissue care / dry needling when appropriate");
      }
    }

    if (generalNeckBackIntent) {
      if (mentionsBigSky) {
        if (["dr-david", "dr-kyle"].includes(provider.id)) {
          addScore(provider, 34, "Big Sky general neck/back care option");
        }
      } else if (mentionsFourCorners) {
        if (["dr-david", "dr-josh"].includes(provider.id)) {
          addScore(provider, 44, "Four Corners general neck/back care option");
        }
        if (provider.id === "dr-kyle") {
          addScore(provider, 10, "available at Four Corners, but not the default for general neck/back pain");
        }
      } else {
        if (["dr-david", "dr-josh"].includes(provider.id)) {
          addScore(provider, 34, "general neck/back care");
        }
        if (provider.id === "dr-kyle") {
          addScore(provider, 18, "location-dependent general care option");
        }
      }
    }

    if (!mentionsFourCorners && !mentionsBigSky && provider.score > 0) {
      addScore(provider, 2, "ask which location works best");
    }
  }

  const sortedProviders = ranked
    .filter((provider) => provider.score > 0)
    .sort((first, second) => second.score - first.score);
  const topScore = sortedProviders[0]?.score ?? 0;
  const minimumScore = topScore >= 50
    ? topScore - 25
    : Math.max(28, topScore - 8);

  return sortedProviders
    .filter((provider) => provider.score >= minimumScore)
    .slice(0, input.max ?? 3);
}

export function formatProviderRankingContext(rankedProviders: RankedWendyProvider[]) {
  if (rankedProviders.length === 0) {
    return [
      "Provider ranking context: no strong deterministic provider match.",
      "If provider matching is needed, ask which location works best or give neutral location-based options.",
      "Avoid saying any provider is the best option.",
    ].join("\n");
  }

  return [
    "Provider ranking context from deterministic Wendy routing.",
    "Use this context. Do not invent provider roles. Do not ignore providers returned here. Do not over-recommend one provider if multiple providers match.",
    "Avoid 'best option', 'best provider', 'your best choice', or 'definitely the provider to see.' Prefer: a strong option, a good fit, well aligned, most directly aligned, or I'd start by checking availability with.",
    ...rankedProviders.map((provider, index) =>
      [
        `${index + 1}. ${provider.name} (${provider.role})`,
        `Locations: ${provider.locations.join(", ")}`,
        provider.availabilityNote ? `Availability: ${provider.availabilityNote}` : "",
        `Focus: ${provider.focus.join(", ")}`,
        `Why matched: ${provider.reasons.slice(0, 3).join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}
