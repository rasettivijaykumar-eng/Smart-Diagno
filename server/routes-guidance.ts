import { Router } from "express";
import { z } from "zod";
import { findDoctors } from "./routes-public.ts";
import { parseBody } from "./helpers.ts";

export const guidanceRouter = Router();

export type SeverityLevel = "mild" | "moderate" | "severe" | "critical";

export type DiseaseMatch = {
  name: string;
  likelihood: "High" | "Moderate" | "Possible";
  description: string;
};

export type ClinicalAnalysis = {
  severity: SeverityLevel;
  severityLabel: string;
  severityReason: string;
  potentialDiseases: DiseaseMatch[];
  causes: string[];
  remedies: {
    selfCare: string[];
    lifestyle: string[];
    strictNoMeds: string;
  };
  redFlags: string[];
  recommendedHospitalTier: "multispecialty" | "general" | "clinic";
  hospitalTierReason: string;
};

const URGENT_SIGNS = ["chest-pain", "trouble-breathing", "stroke-signs", "severe-bleeding", "loss-consciousness"] as const;
const schema = z.object({
  concern: z.string().trim().min(3).max(500),
  urgentSymptoms: z.array(z.enum(URGENT_SIGNS)).max(5).default([]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).strict();

// Emergency text patterns
const CRITICAL_TEXT = /(chest (pain|pressure|tightness)|can'?t breathe|cannot breathe|(difficulty|trouble|struggling) breathing|shortness of breath at rest|stroke|face droop|slurred speech|unconscious|passed out|severe bleeding|won'?t stop bleeding|seizure|overdose|suicid|kill myself|self[- ]harm|anaphyla|throat (is )?closing|coughing (up )?blood|blue lips|unresponsive)/i;

const STRICT_NO_MEDS_NOTICE =
  "⚠️ Strict No-Medication Policy: This system provides non-medicinal self-care and clinical navigation only. Do NOT self-medicate with antibiotics, unprescribed painkillers, or over-the-counter combinations. Antibiotics have zero effect on viral infections and improper medication is dangerous. Always consult a licensed doctor for prescriptions.";

export function analyzeSymptoms(concern: string, urgentSymptoms: string[] = []): ClinicalAnalysis {
  const c = concern.toLowerCase();
  const hasUrgentTag = urgentSymptoms.length > 0;
  const hasCriticalText = CRITICAL_TEXT.test(c);

  // ── 1. Critical / Severe Emergencies ───────────────────────────────────────
  if (hasUrgentTag || hasCriticalText) {
    return {
      severity: "critical",
      severityLabel: "🚨 Critical / Emergency Urgency",
      severityReason: "Your symptoms indicate potential cardiovascular, neurological, or respiratory distress that requires immediate medical intervention.",
      potentialDiseases: [
        { name: "Acute Coronary / Cardiac Event", likelihood: "High", description: "Potentially acute ischemia or rhythm disturbance needing urgent ECG/cardiac enzymes." },
        { name: "Acute Respiratory Compromise", likelihood: "High", description: "Severe airway narrowing, pneumonia, or pulmonary distress needing emergency oxygenation." },
        { name: "Acute Neurological / Stroke Event", likelihood: "Possible", description: "Sudden focal deficits or altered consciousness requiring emergency neuro-imaging." },
      ],
      causes: [
        "Acute reduction in coronary or cerebral blood flow",
        "Severe bronchial spasm or acute alveolar compromise",
        "Sudden systemic hemodynamic or electrical instability",
      ],
      remedies: {
        selfCare: [
          "Sit down immediately in a comfortable upright position (propped up with cushions).",
          "Loosen all tight clothing around the neck, chest, and waist to ease breathing.",
          "Keep calm, take slow deep breaths, and avoid moving or walking.",
          "Alert someone nearby immediately or dial your local emergency medical service (108/112).",
        ],
        lifestyle: [
          "Do not exert yourself physically under any circumstance.",
          "Do not drive yourself to the hospital; travel with assistance or via ambulance.",
        ],
        strictNoMeds: STRICT_NO_MEDS_NOTICE,
      },
      redFlags: [
        "Chest pain radiating to the left arm, jaw, shoulder, or back",
        "Inability to speak in full sentences due to breathlessness",
        "Sudden facial drooping, arm weakness, or slurred speech",
        "Loss of consciousness, fainting, or severe bluish discoloration of lips",
      ],
      recommendedHospitalTier: "multispecialty",
      hospitalTierReason: "Critical presentations require Multi-Specialty / Tertiary Hospitals equipped with 24/7 Emergency Trauma, ICU, Cath Lab, and emergency super-specialists. General clinics cannot manage critical resuscitation.",
    };
  }

  // ── 2. Fever + Cold / Cough / Headache / Flu ──────────────────────────────
  if (/(fever|cold|cough|headache|throat|flu|chills|shiver|sneeze|runny nose|nasal|sinus|phlegm)/i.test(c)) {
    const isHighFever = /(high fever|10[2-5]|severe headache|rigor)/i.test(c);
    const severity: SeverityLevel = isHighFever ? "moderate" : "mild";

    return {
      severity,
      severityLabel: isHighFever ? "🟡 Moderate Severity — Medical Consultation Advised" : "🟢 Mild / Common Presentation",
      severityReason: isHighFever
        ? "Elevated temperature or intense headache warrants clinical monitoring to rule out bacterial infection or dengue/malaria."
        : "Symptoms are characteristic of an acute viral upper respiratory tract infection without red-flag emergency signs.",
      potentialDiseases: [
        { name: "Common Cold (Viral Rhinitis / Rhinovirus)", likelihood: "High", description: "Acute, self-limiting viral infection of the upper respiratory mucosa causing runny nose, congestion, and mild fever." },
        { name: "Influenza (Seasonal Flu)", likelihood: "High", description: "Acute viral illness presenting with sudden onset fever, body aches, chills, fatigue, and headache." },
        { name: "Acute Viral Sinusitis", likelihood: "Moderate", description: "Inflammation of the sinus cavities leading to facial pressure, frontal headache, and nasal blockage." },
        { name: "Acute Pharyngitis / Tonsillitis", likelihood: "Possible", description: "Viral or bacterial throat infection causing painful swallowing and swollen throat glands." },
      ],
      causes: [
        "Invasion of upper respiratory mucosa by viral pathogens (Rhinovirus, Adenovirus, or Influenza)",
        "Systemic immune response: white blood cells release pyrogens and cytokines, causing core fever and blood vessel dilation that induces headache",
        "Sinus mucosa swelling causing localized pressure headaches around forehead and eyes",
        "Dehydration and fluid loss from elevated body temperature and mouth breathing",
      ],
      remedies: {
        selfCare: [
          "Hydrate continuously: Drink plenty of warm water, clear vegetable broth, and warm tulsi-ginger-pepper herbal tea.",
          "Steam inhalation: Inhale warm plain water steam for 7–10 minutes 2 to 3 times a day to clear congested nasal and sinus passages.",
          "Warm salt-water gargle: Mix 1/2 teaspoon salt in a glass of lukewarm water and gargle 3 times daily for soothing sore throat.",
          "Cool forehead compress: Place a clean, damp, cool washcloth across your forehead to comfort headache and ease temperature.",
          "Rest: Commit to 8 to 10 hours of complete physical bed rest in a well-ventilated, comfortable room.",
        ],
        lifestyle: [
          "Elevate your head with an extra pillow while resting to ease nasal drainage and breathing.",
          "Eat warm, freshly cooked, light meals (khichdi, oats, lentil soup) that are easy on digestion.",
          "Avoid cold drafts, iced drinks, smoking, and refrigerated foods.",
          "Monitor body temperature with a thermometer every 4–6 hours.",
        ],
        strictNoMeds: STRICT_NO_MEDS_NOTICE,
      },
      redFlags: [
        "Fever exceeding 103°F (39.4°C) or lasting longer than 3 continuous days",
        "Severe neck stiffness, extreme confusion, or intolerance to light",
        "Onset of chest pain, shortness of breath, or coughing up blood/thick brown phlegm",
        "Persistent vomiting causing inability to keep oral fluids down",
      ],
      recommendedHospitalTier: isHighFever ? "multispecialty" : "general",
      hospitalTierReason: isHighFever
        ? "For persistent or high fever, a Multi-Specialty Hospital offers comprehensive blood diagnostics (CBC, Dengue/Malaria screening) and specialty internal medicine care."
        : "For common cold and mild fever, General Hospitals and local Primary Care Clinics are prioritized for quick consultation without the long queues of emergency tertiary centers.",
    };
  }

  // ── 3. Stomach / Abdominal Pain / Vomiting / Diarrhea / Acidity ─────────────
  if (/(stomach|abdom|vomit|diarrhea|loose|nausea|acid|heartburn|gas|bloat|cramp|digest|motion)/i.test(c)) {
    const isSevereGut = /(severe pain|sharp pain|blood|dehydrat|unbearable)/i.test(c);
    const severity: SeverityLevel = isSevereGut ? "severe" : "mild";

    return {
      severity,
      severityLabel: isSevereGut ? "🔴 Severe Gastrointestinal Distress" : "🟢 Mild to Moderate Digestive Discomfort",
      severityReason: isSevereGut
        ? "Severe abdominal pain or bloody stool may indicate surgical or acute infectious pathology requiring immediate evaluation."
        : "Symptoms are consistent with acute gastritis, dietary indiscretion, or mild viral gastroenteritis.",
      potentialDiseases: [
        { name: "Acute Gastroenteritis (Food Poisoning / Stomach Flu)", likelihood: "High", description: "Viral or bacterial infection of the stomach and intestines causing nausea, cramps, and loose stools." },
        { name: "Gastritis / Hyperacidity (GERD)", likelihood: "High", description: "Irritation of the gastric mucosal lining due to stomach acid, leading to burning pain and bloating." },
        { name: "Functional Dyspepsia / Indigestion", likelihood: "Moderate", description: "Impaired digestion causing upper abdominal fullness, early satiety, and belching." },
        { name: "Appendicitis (Rule Out if Lower Right Pain)", likelihood: "Possible", description: "Inflammation of the appendix; requires emergency clinical ultrasound if pain is focused in lower right abdomen." },
      ],
      causes: [
        "Ingestion of contaminated food/water triggering intestinal irritation and osmotic fluid secretion",
        "Excess gastric acid secretion from prolonged fasting, spicy food, or psychological stress",
        "Disruption of normal gut microbiota or temporary lactose/food intolerance",
      ],
      remedies: {
        selfCare: [
          "Oral Rehydration: Sip Oral Rehydration Salts (ORS) or tender coconut water in small, frequent mouthfuls to replenish electrolytes.",
          "BRAT diet: Once nausea eases, consume gentle foods — Bananas, Rice, Applesauce, and Toast.",
          "Warm compress: Apply a warm water bag or heating pad across the abdomen for 15 minutes to relieve muscle cramping.",
          "Ginger / Mint water: Sip warm water steeped with fresh crushed ginger to naturally settle nausea.",
        ],
        lifestyle: [
          "Avoid dairy products, oily curries, caffeine, sodas, and alcohol until full recovery.",
          "Eat small meals every few hours rather than large heavy plates.",
          "Remain upright for at least 60 minutes after eating to prevent acid backflow.",
        ],
        strictNoMeds: STRICT_NO_MEDS_NOTICE,
      },
      redFlags: [
        "Sharp, worsening pain localized to the lower right abdomen",
        "Vomiting containing blood or having a dark coffee-ground appearance",
        "Black tarry stools or visible red blood in diarrhea",
        "Inability to retain any liquids for over 12 hours with sunken eyes and severe dizziness",
      ],
      recommendedHospitalTier: isSevereGut ? "multispecialty" : "general",
      hospitalTierReason: isSevereGut
        ? "Acute severe abdominal conditions require Multi-Specialty Hospitals with 24/7 surgical gastroenterologists, ultrasound/CT diagnostics, and IV rehydration units."
        : "Standard digestive upsets are best handled by General Physicians at General Hospitals or Primary Clinics.",
    };
  }

  // ── 4. Joint / Back Pain / Orthopedic / Sprain ─────────────────────────────
  if (/(joint|back pain|knee|shoulder|neck|sprain|muscle|fracture|bone|arthritis|spine|swelling)/i.test(c)) {
    const isTrauma = /(fall|accident|fracture|cannot walk|deformity|severe)/i.test(c);
    const severity: SeverityLevel = isTrauma ? "severe" : "mild";

    return {
      severity,
      severityLabel: isTrauma ? "🔴 High Urgency — Orthopedic Evaluation" : "🟢 Mild Musculoskeletal Strain",
      severityReason: isTrauma
        ? "Possible bone fracture, ligament rupture, or severe joint dislocation requiring emergency X-ray imaging."
        : "Likely postural strain, muscular spasm, or mild degenerative joint wear.",
      potentialDiseases: [
        { name: "Acute Musculoskeletal Strain / Sprain", likelihood: "High", description: "Micro-tearing of muscle fibers or ligaments following sudden movement, lifting, or awkward posture." },
        { name: "Lumbar / Cervical Spondylosis", likelihood: "Moderate", description: "Age or posture-related wear and tear of spinal discs and facet joints." },
        { name: "Osteoarthritis / Reactive Arthritis", likelihood: "Possible", description: "Joint cartilage thinning causing stiffness and dull aching, especially in knees or hips." },
      ],
      causes: [
        "Improper ergonomics: prolonged sitting, incorrect heavy lifting, or poor mattress support",
        "Sudden twisting or tensile overload on ligaments during physical activity",
        "Post-viral or inflammatory reactive joint sensitivity",
      ],
      remedies: {
        selfCare: [
          "R.I.C.E. protocol: Rest the affected area; apply an Ice pack wrapped in cloth for 15 minutes (first 48 hours for acute swelling).",
          "For chronic stiffness, apply gentle warmth using a hot towel or heating pad for 15 minutes.",
          "Gentle range of motion: Avoid complete immobilization; perform slow, pain-free ankle/knee/neck circles.",
          "Supportive resting posture: If experiencing back pain, sleep on your back with a pillow beneath your knees to relieve lumbar tension.",
        ],
        lifestyle: [
          "Avoid bending forward at the waist; bend from knees when picking up objects.",
          "Ensure an ergonomic chair with proper lower back support.",
          "Avoid high heels and unsupportive footwear.",
        ],
        strictNoMeds: STRICT_NO_MEDS_NOTICE,
      },
      redFlags: [
        "Inability to bear any weight on the leg or visible deformity of the limb",
        "Numbness, tingling, or loss of bowel/bladder control associated with back pain (Cauda Equina warning)",
        "Hot, intensely red, rapidly swelling joint with fever (septic arthritis warning)",
      ],
      recommendedHospitalTier: isTrauma ? "multispecialty" : "general",
      hospitalTierReason: isTrauma
        ? "Suspected fractures and acute trauma need a Multi-Specialty Hospital equipped with digital X-ray, CT/MRI, and an orthopedic surgical trauma team."
        : "Routine joint aches and postural back pain are suitably treated by orthopedic consultants at General Hospitals.",
    };
  }

  // ── 5. Skin / Rash / Allergy / Itching ─────────────────────────────────────
  if (/(skin|rash|itch|hive|spot|allergy|eczema|boil|acne|dermat|blister)/i.test(c)) {
    return {
      severity: "mild",
      severityLabel: "🟢 Mild Dermatological Concern",
      severityReason: "Localized skin changes without breathing compromise are typically manageable with non-invasive skin care.",
      potentialDiseases: [
        { name: "Contact Dermatitis / Allergic Eczema", likelihood: "High", description: "Reaction to chemical irritants, soaps, plants, cosmetics, or synthetic fabrics." },
        { name: "Urticaria (Acute Hives)", likelihood: "Moderate", description: "Histamine release resulting in raised, itchy pink welts triggered by food, heat, or viral antigens." },
        { name: "Fungal Infection (Tinea / Ringworm / Intertrigo)", likelihood: "Possible", description: "Superficial fungal proliferation in warm, moist skin folds." },
      ],
      causes: [
        "Direct allergen or harsh chemical exposure sensitizing epidermal cells",
        "Excessive sweating and friction blocking sweat ducts (heat rash / miliaria)",
        "Immune hypersensitivity reaction to a systemic allergen or viral infection",
      ],
      remedies: {
        selfCare: [
          "Cold water compress: Apply a soft cloth soaked in cool water to calm intense itching and heat.",
          "Calamine lotion: Dab soothing calamine lotion gently on non-broken, itchy skin areas.",
          "Trim fingernails short to prevent skin breakage and secondary bacterial infection from scratching.",
          "Take brief lukewarm (not hot) baths using mild, fragrance-free cleanser.",
        ],
        lifestyle: [
          "Wear loose, lightweight 100% cotton garments.",
          "Keep skin folds dry and well-ventilated.",
          "Avoid scented soaps, harsh detergents, and synthetic fabrics.",
        ],
        strictNoMeds: STRICT_NO_MEDS_NOTICE,
      },
      redFlags: [
        "Rash accompanied by swelling of the face, lips, tongue, or breathing difficulty (anaphylaxis)",
        "Rapidly spreading purple or blood-colored spots that do not fade when pressed (petechiae/purpura)",
        "Blistering skin lesions covering large parts of the body with high fever",
      ],
      recommendedHospitalTier: "general",
      hospitalTierReason: "Skin concerns are ideally reviewed by Dermatologists or General Physicians at General Hospitals or clinics.",
    };
  }

  // ── 6. Dizziness / Headache / Neurological ─────────────────────────────────
  if (/(migraine|dizz|vertigo|spinning|headache|lighthead|numb|tingl)/i.test(c)) {
    const isSevereNeuro = /(sudden worst headache|thunderclap|weakness|speech)/i.test(c);
    const severity: SeverityLevel = isSevereNeuro ? "critical" : "mild";

    return {
      severity,
      severityLabel: isSevereNeuro ? "🚨 High Severity — Neurological Alert" : "🟢 Mild to Moderate Headache / Dizziness",
      severityReason: isSevereNeuro
        ? "Sudden explosive headache or focal weakness requires emergency exclude-hemorrhage CT scan."
        : "Commonly associated with tension, dehydration, lack of sleep, or postural vertigo.",
      potentialDiseases: [
        { name: "Tension Headache", likelihood: "High", description: "Band-like dull pressure around forehead and temples caused by muscle contraction and stress." },
        { name: "Benign Paroxysmal Positional Vertigo (BPPV)", likelihood: "Moderate", description: "Brief spinning sensations triggered by changes in head position due to dislodged inner-ear otoconia." },
        { name: "Migraine without Aura", likelihood: "Moderate", description: "Throbbing unilateral headache often associated with sensitivity to light and sound." },
      ],
      causes: [
        "Prolonged screen glare, eye strain, cervical muscle fatigue, and poor posture",
        "Fluid depletion (dehydration) leading to transient postural cerebral hypoperfusion",
        "Inner ear labyrinthine fluid imbalance or sleep deprivation",
      ],
      remedies: {
        selfCare: [
          "Rest in a quiet, dark, well-ventilated room with eyes closed.",
          "Hydrate immediately: Drink 2 large glasses of water or electrolyte fluid slowly.",
          "Apply a gentle warm or cool compress to the back of the neck and forehead.",
          "Perform gentle neck stretches: Tilt ear toward shoulder slowly to release tension.",
        ],
        lifestyle: [
          "Take regular 20-20-20 breaks when working on computer screens (every 20 mins, look 20 feet away for 20 seconds).",
          "Maintain consistent sleep and meal schedules; avoid skipping breakfast.",
          "Avoid abrupt head movements when getting up from lying down.",
        ],
        strictNoMeds: STRICT_NO_MEDS_NOTICE,
      },
      redFlags: [
        "Sudden 'thunderclap' headache reaching maximum intensity within seconds",
        "Headache with stiff neck, high fever, and vomiting",
        "Weakness, numbness, or loss of sensation on one side of the face or body",
      ],
      recommendedHospitalTier: isSevereNeuro ? "multispecialty" : "general",
      hospitalTierReason: isSevereNeuro
        ? "Neurological red flags require a Multi-Specialty Hospital with an operational CT/MRI and Emergency Neurology service."
        : "Routine headaches and mild dizziness can be effectively managed by General Physicians or Neurologists in General Hospitals.",
    };
  }

  // ── 7. Fallback General Clinical Guidance ──────────────────────────────────
  return {
    severity: "mild",
    severityLabel: "🟢 Mild / General Health Inquiry",
    severityReason: "Your symptoms appear non-critical based on current description. Clinical assessment is recommended for definitive guidance.",
    potentialDiseases: [
      { name: "Mild Systemic Viral Reaction", likelihood: "Moderate", description: "Mild constitutional immune response to everyday environmental or viral factors." },
      { name: "Physical Fatigue / Dehydration", likelihood: "Moderate", description: "Overexertion or inadequate fluid intake leading to fatigue, dull aches, or malaise." },
    ],
    causes: [
      "Immune system adaptation to environmental changes or viral exposure",
      "Physical exhaustion, stress, or inadequate rest",
      "Suboptimal hydration or irregular nutrition",
    ],
    remedies: {
      selfCare: [
        "Drink at least 2.5 to 3 liters of warm water and electrolyte fluids throughout the day.",
        "Ensure 7 to 8 hours of restorative sleep in a quiet space.",
        "Eat wholesome, freshly prepared meals rich in vegetables and fruits.",
        "Engage in calm breathing exercises to alleviate physical stress.",
      ],
      lifestyle: [
        "Avoid strenuous workouts until your energy levels fully stabilize.",
        "Maintain good hand hygiene and adequate ventilation in living spaces.",
      ],
      strictNoMeds: STRICT_NO_MEDS_NOTICE,
    },
    redFlags: [
      "Any sudden, dramatic worsening of your baseline symptoms",
      "High persistent fever exceeding 102°F or breathlessness",
      "Chest pain, fainting, or severe persistent vomiting",
    ],
    recommendedHospitalTier: "general",
    hospitalTierReason: "General Hospitals and Primary Care Clinics are recommended for routine evaluation and prompt clinical consultation.",
  };
}

export type GuidanceInput = z.infer<typeof schema>;

export async function buildGuidance(
  data: Pick<GuidanceInput, "concern" | "urgentSymptoms" | "lat" | "lng">,
  _history: string[] = []
) {
  const analysis = analyzeSymptoms(data.concern, data.urgentSymptoms);
  const isUrgent = analysis.severity === "critical" || analysis.severity === "severe";

  // Match specialties
  const specialties: string[] = [];
  if (/heart|chest|palpitat|angina/i.test(data.concern)) specialties.push("Cardiology");
  if (/fever|cold|cough|throat|flu|sinus/i.test(data.concern)) specialties.push("General Physician", "ENT");
  if (/stomach|abdom|vomit|diarrhea|acid/i.test(data.concern)) specialties.push("Gastroenterology", "General Physician");
  if (/joint|back|knee|bone|ortho/i.test(data.concern)) specialties.push("Orthopedics");
  if (/skin|rash|itch|allergy/i.test(data.concern)) specialties.push("Dermatology");
  if (/headache|migraine|dizz|vertigo|neuro/i.test(data.concern)) specialties.push("Neurology", "General Physician");
  if (specialties.length === 0) specialties.push("General Physician");
  const uniqueSpecialties = [...new Set(specialties)].slice(0, 3);

  const doctors = uniqueSpecialties.flatMap((spec) =>
    findDoctors({ specialty: spec, lat: data.lat, lng: data.lng, radiusKm: 20 })
  ).slice(0, 5);

  return {
    kind: isUrgent ? ("urgent" as const) : ("navigation" as const),
    severity: analysis.severity,
    severityLabel: analysis.severityLabel,
    severityReason: analysis.severityReason,
    potentialDiseases: analysis.potentialDiseases,
    causes: analysis.causes,
    remedies: analysis.remedies,
    redFlags: analysis.redFlags,
    recommendedHospitalTier: analysis.recommendedHospitalTier,
    hospitalTierReason: analysis.hospitalTierReason,
    message: isUrgent
      ? "These symptoms show potential red flags and may need immediate attention. Please review the emergency guidance below and seek care at a Multi-Specialty Hospital now."
      : "Clinical analysis completed. Below are the potential conditions, causes, and safe home remedies (non-medicinal), along with prioritized nearby hospitals.",
    nextSteps: isUrgent
      ? ["Seek emergency department care at a Multi-Specialty Hospital", "Call emergency services (108/112) or have someone drive you", "Do not drive yourself"]
      : ["Follow the non-medicinal self-care remedies below", "Book an appointment or visit a prioritized hospital if symptoms persist beyond 2-3 days", "Never self-medicate with unprescribed pills or antibiotics"],
    followUpQuestions: [
      "How long have you had these symptoms?",
      "On a scale of 1 to 10, how intense is the discomfort?",
      "Are you experiencing any other symptoms, such as high fever, breathlessness, or vomiting?",
    ],
    suggestedSpecialties: uniqueSpecialties,
    doctors: doctors.map(({ id, name, specialty, clinic, distanceKm, openSlots }) => ({
      id, name, specialty, clinic, distanceKm, openSlots,
    })),
    disclaimer: "No diagnosis is provided. Educational and clinical navigation information only. Not a substitute for professional in-person medical diagnosis. No prescription medications or dosages are advised.",
  };
}

guidanceRouter.post("/guidance", async (request, response) => {
  const data = parseBody(schema, request, response);
  if (!data) return;
  response.json(await buildGuidance(data));
});