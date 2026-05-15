import { wendyProviders } from "./providers";

export type ClinicKnowledgeSourceType =
  | "clinic_fact"
  | "provider"
  | "pricing"
  | "hours"
  | "service"
  | "blog"
  | "location"
  | "safety"
  | "booking"
  | "massage"
  | "animal_chiropractic";

export type ClinicKnowledgeChunkType =
  | "provider_profile"
  | "clinic_hours"
  | "pricing_rule"
  | "service_info"
  | "blog_article"
  | "location_info"
  | "massage_info"
  | "animal_chiropractic"
  | "safety_guidance"
  | "booking_info";

export type ClinicKnowledgeFact = {
  id: string;
  sourceType: ClinicKnowledgeSourceType;
  chunkType: ClinicKnowledgeChunkType;
  title: string;
  priority: number;
  category: string;
  tags: string[];
  text: string;
  metadata?: Record<string, unknown>;
};

const bookingUrl = "https://windyridgechiropractic.janeapp.com/";

export const clinicKnowledgeFacts: ClinicKnowledgeFact[] = [
  {
    id: "clinic-philosophy",
    sourceType: "clinic_fact",
    chunkType: "service_info",
    title: "Windy Ridge philosophy",
    priority: 95,
    category: "Clinic Identity",
    tags: ["life unrestricted", "movement", "active lifestyle", "conservative care"],
    text:
      "Windy Ridge Chiropractic helps people move better, feel better, and get back to life unrestricted. Wendy should sound practical, warm, locally grounded, and focused on active Montana life in Bozeman and Big Sky. Care is conservative and evaluation-based, with no diagnosis or promised outcomes in chat.",
  },
  {
    id: "four-corners-location",
    sourceType: "location",
    chunkType: "location_info",
    title: "Bozeman Four Corners location",
    priority: 100,
    category: "Locations",
    tags: ["bozeman", "four corners", "address", "location"],
    text:
      "Bozeman / Four Corners address: 43 Mill Town Loop, Bozeman, MT 59718. This is the main Bozeman-area Windy Ridge location and is relevant for Four Corners, Bozeman, Belgrade, and Gallatin Valley questions.",
  },
  {
    id: "big-sky-location",
    sourceType: "location",
    chunkType: "location_info",
    title: "Big Sky location",
    priority: 100,
    category: "Locations",
    tags: ["big sky", "ousel falls", "address", "location"],
    text:
      "Big Sky address: 116 Ousel Falls Road, Big Sky, MT 59716. For live appointment openings, visitors should confirm through JaneApp or call the clinic.",
  },
  {
    id: "four-corners-hours",
    sourceType: "hours",
    chunkType: "clinic_hours",
    title: "Bozeman Four Corners clinic hours",
    priority: 105,
    category: "Clinic Hours",
    tags: ["bozeman", "four corners", "hours", "open", "closed"],
    text:
      "Bozeman / Four Corners general clinic hours: Monday 7:30 AM-5:00 PM, Tuesday 8:00 AM-5:00 PM, Wednesday 7:30 AM-5:00 PM, Thursday 8:00 AM-5:00 PM, Friday 8:00 AM-2:00 PM, Saturday closed, Sunday closed. Clinic hours are not a guarantee of live appointment availability.",
  },
  {
    id: "big-sky-hours",
    sourceType: "hours",
    chunkType: "clinic_hours",
    title: "Big Sky clinic hours and provider availability",
    priority: 105,
    category: "Clinic Hours",
    tags: ["big sky", "hours", "dr kyle", "dr michelle", "friday availability"],
    text:
      "Big Sky general availability: Monday 12:00 PM-5:00 PM, Tuesday 8:00 AM-12:00 PM, Wednesday Dr. Michelle 9:00 AM-4:00 PM, Thursday Dr. Kyle 8:00 AM-5:00 PM. Friday Big Sky availability may be seasonal and at Dr. Dave's discretion, so users should call or check JaneApp. Saturday and Sunday are closed.",
  },
  {
    id: "provider-availability",
    sourceType: "provider",
    chunkType: "provider_profile",
    title: "Provider availability rules",
    priority: 103,
    category: "Providers",
    tags: ["provider availability", "dr kyle", "dr michelle", "dr dave", "dr claire", "dr josh"],
    text:
      "Provider availability: Dr. Kyle is in Big Sky Thursdays 8:00 AM-5:00 PM. Dr. Michelle is in Big Sky Wednesdays 9:00 AM-4:00 PM and has limited hours at both locations. Dr. Dave practices at both locations with varying hours. Dr. Josh is Four Corners only. Dr. Claire is Four Corners only and also offers at-home visits for mom and newborn.",
  },
  ...wendyProviders.map<ClinicKnowledgeFact>((provider) => ({
    id: `provider-${provider.id}`,
    sourceType: provider.role === "massage therapist" ? "massage" : "provider",
    chunkType:
      provider.role === "massage therapist" ? "massage_info" : "provider_profile",
    title: `${provider.name} provider profile`,
    priority: provider.role === "massage therapist" ? 98 : 102,
    category: provider.role === "massage therapist" ? "Massage Therapy" : "Providers",
    tags: [
      provider.name.toLowerCase(),
      provider.role,
      ...provider.locations.map((location) => location.toLowerCase()),
      ...provider.focus,
    ],
    text: [
      `${provider.name} is a Windy Ridge ${provider.role}.`,
      `Locations: ${provider.locations.join(", ")}.`,
      provider.availabilityNote ? `Availability: ${provider.availabilityNote}` : "",
      `Focus areas: ${provider.focus.join(", ")}.`,
      provider.id === "dr-josh"
        ? "Dr. Josh also provides in-clinic small animal chiropractic care at Four Corners."
        : "",
      provider.id === "dr-michelle"
        ? "Dr. Michelle is also involved in pregnancy, pediatric, perinatal, women's health, family, and general chiropractic care. Do not overstate her availability; direct users to JaneApp or the website for current openings."
        : "",
      provider.id === "dr-claire"
        ? "Dr. Claire is a strong option for pregnancy, postpartum, pediatric, newborn, and family care at Four Corners, including at-home visits for moms and newborns."
        : "",
      provider.id === "dr-kyle"
        ? "Dr. Kyle is most directly aligned for sports, performance, skiing, hiking, lower limb, ankle mobility, rehab integration, active outdoor patients, and movement restoration questions."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  })),
  {
    id: "pricing-cash-rules",
    sourceType: "pricing",
    chunkType: "pricing_rule",
    title: "Cash pricing by location",
    priority: 110,
    category: "Pricing",
    tags: [
      "pricing",
      "cost",
      "cash rates",
      "four corners",
      "bozeman",
      "big sky",
      "new patient exam",
      "follow-up",
    ],
    text:
      "Cash pricing rules: New Patient Exam at Four Corners is $130. New Patient Exam at Big Sky is $150. Follow-Up Visit at Four Corners is $65. Follow-Up Visit at Big Sky is $85. Soft Tissue Visit is listed at $75 and includes dry needling when clinically appropriate. Adjustment + Soft Tissue pricing should be confirmed on the website or JaneApp rather than guessed. Listed cash rates may vary based on service type and current JaneApp listings.",
  },
  {
    id: "insurance-rules",
    sourceType: "pricing",
    chunkType: "pricing_rule",
    title: "Insurance and patient responsibility",
    priority: 104,
    category: "Pricing",
    tags: ["insurance", "benefits", "deductible", "copay", "patient responsibility"],
    text:
      "Insurance benefits vary by plan. Final patient responsibility can depend on benefits, deductibles, copays, covered services, and services performed. Wendy should avoid guaranteeing coverage and should encourage confirmation through the clinic or JaneApp when appropriate.",
  },
  {
    id: "services-overview",
    sourceType: "service",
    chunkType: "service_info",
    title: "Windy Ridge services",
    priority: 95,
    category: "Services",
    tags: ["chiropractic", "dry needling", "soft tissue", "rehab", "first visit", "massage"],
    text:
      "Windy Ridge services include chiropractic care, adjustments, movement evaluation, soft tissue care, dry needling when clinically appropriate, rehab or exercise guidance, massage therapy, family care, pregnancy/postpartum/pediatric care, sports and performance-focused care, and small animal chiropractic in clinic with Dr. Josh.",
  },
  {
    id: "animal-chiropractic",
    sourceType: "animal_chiropractic",
    chunkType: "animal_chiropractic",
    title: "Small animal chiropractic",
    priority: 105,
    category: "Animal Chiropractic",
    tags: ["animal chiropractic", "pet chiropractic", "dog chiropractic", "small animal", "dr josh"],
    text:
      "Windy Ridge offers small animal chiropractic care in clinic with Dr. Josh at the Four Corners location. Wendy should not diagnose animal conditions, should not promise outcomes, and should encourage users to consult their veterinarian for urgent, worsening, or concerning symptoms.",
  },
  {
    id: "massage-therapy",
    sourceType: "massage",
    chunkType: "massage_info",
    title: "Massage therapy routing",
    priority: 102,
    category: "Massage Therapy",
    tags: ["massage", "massage therapy", "nichole", "james", "big sky", "four corners"],
    text:
      "Massage therapy routing: Nichole is the massage therapist at Big Sky only. James is the massage therapist at Four Corners only. Wendy should keep massage therapy distinct from chiropractic soft tissue work or dry needling.",
  },
  {
    id: "booking-rules",
    sourceType: "booking",
    chunkType: "booking_info",
    title: "JaneApp booking rules",
    priority: 100,
    category: "Booking",
    tags: ["booking", "janeapp", "appointment", "availability", "pricing confirmation"],
    text:
      `For booking, current appointment types, live availability, provider schedules, and current pricing confirmation, Wendy should guide users to JaneApp: ${bookingUrl}. Wendy should not guarantee same-day availability.`,
    metadata: { url: bookingUrl },
  },
  {
    id: "safety-red-flags",
    sourceType: "safety",
    chunkType: "safety_guidance",
    title: "Safety and red-flag guidance",
    priority: 120,
    category: "Safety",
    tags: ["urgent", "red flag", "emergency", "medical care"],
    text:
      "Urgent or severe symptoms should be directed to medical care right away. Red flags include severe or rapidly worsening pain, major trauma, chest pain, trouble breathing, sudden weakness, numbness in the groin or saddle area, loss of bowel or bladder control, fainting, stroke-like symptoms, fever with severe symptoms, or concerning animal symptoms. Wendy should not add booking or sales CTAs for urgent red-flag situations.",
  },
];

export const clinicKnowledge = {
  generatedAt: new Date().toISOString(),
  canonical: true,
  bookingUrl,
  facts: clinicKnowledgeFacts,
};

