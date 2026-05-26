export const CHATBOT_KNOWLEDGE_CATEGORIES = [
  "onboarding",
  "rules",
  "profile",
  "imports",
  "income",
  "deductions",
  "credits",
  "results",
  "reports",
  "validation",
  "privacy",
  "readiness",
  "operations",
  "testing",
  "refusal"
];

const guideCitation = (label, target) => ({ label, target });

export const CHATBOT_KNOWLEDGE = [
  entry({
    id: "onboarding.no_knowledge.start",
    category: "onboarding",
    source_doc: "public/index.html",
    feature: "Application Guide",
    task: "No-knowledge user starting path",
    questions: [
      "I do not know tax where should I start?",
      "I have no tax knowledge how do I use this app?",
      "I am completely new to income tax calculation",
      "Start from zero and guide me through the calculator",
      "I do not understand this calculator"
    ],
    answer: "Start with Profile, keep the default supported year if it matches your scenario, enter Age, Taxpayer type, Residency, and Preferred regime, then move through Income, Deductions, Credits, and Results. If you do not have a value, keep it as 0 rather than guessing.",
    citations: [guideCitation("Application guide", "usage-guide-user-levels"), guideCitation("Profile page guide", "usage-guide-profile")],
    actions: [{ type: "navigate", step: "profile", label: "Profile step" }],
    tags: ["no knowledge", "new user", "start", "zero", "guide", "profile"]
  }),
  entry({
    id: "onboarding.beginner.salary",
    category: "onboarding",
    source_doc: "public/index.html",
    feature: "Application Guide",
    task: "Beginner salaried user path",
    questions: [
      "I am a beginner with salary income what should I do?",
      "How should a salaried person use this calculator?",
      "I only have salary and TDS where do I start?",
      "Guide me for a simple salary tax calculation",
      "I have Form 16 and salary income"
    ],
    answer: "For a beginner salary flow, fill Profile first, go to Income and enter Gross salary, go to Deductions for 80C or 80D only if claimed, go to Credits for TDS, then use Results to Validate, Compute, Compare regimes, and Explain.",
    citations: [guideCitation("Beginner path guide", "usage-guide-user-levels"), guideCitation("Income page guide", "usage-guide-income")],
    actions: [{ type: "navigate", step: "income", label: "Income step" }],
    tags: ["beginner", "salary", "form 16", "tds", "simple flow"]
  }),
  entry({
    id: "onboarding.beginner.import_choice",
    category: "onboarding",
    source_doc: "public/index.html",
    feature: "Application Guide",
    task: "Manual versus import choice",
    questions: [
      "Should I use import or manual entry?",
      "I have data in a file should I paste it?",
      "What is easier manual entry or import?",
      "Can the app fill values from my Form 16?",
      "I am new should I review import first?"
    ],
    answer: "If you are unsure, use manual entry for a simple case. Use Imports when you have supported CSV, JSON, or a searchable Form 16 PDF, then preview and confirm before the app applies any values.",
    citations: [guideCitation("Import page guide", "usage-guide-imports"), guideCitation("Beginner path guide", "usage-guide-user-levels")],
    actions: [{ type: "navigate", step: "imports", label: "Imports step" }],
    tags: ["beginner", "manual", "import", "form 16", "review"]
  }),
  entry({
    id: "onboarding.intermediate.compare",
    category: "onboarding",
    source_doc: "public/index.html",
    feature: "Application Guide",
    task: "Intermediate regime and deduction review",
    questions: [
      "I know my income and deductions how should I compare regimes?",
      "How should an intermediate user use old versus new regime comparison?",
      "I have salary deductions and credits what flow should I follow?",
      "How do I review if deductions are ignored?",
      "How do I compare regimes with 80C and TDS?"
    ],
    answer: "For an intermediate flow, enter Profile, Income, Deductions, and Credits, then run Validate before Compute. Use Compare regimes to see old and new regime cards, and review warnings for deductions that may be ignored under the selected regime.",
    citations: [guideCitation("Results page guide", "usage-guide-results"), guideCitation("Deductions page guide", "usage-guide-deductions")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["intermediate", "compare", "old regime", "new regime", "deductions", "warnings"]
  }),
  entry({
    id: "onboarding.intermediate.multiple_income",
    category: "onboarding",
    source_doc: "public/index.html",
    feature: "Application Guide",
    task: "Intermediate multi-income flow",
    questions: [
      "I have salary and interest income how do I use the app?",
      "How do I enter more than one income head?",
      "I have salary house property and other sources",
      "Can I calculate multiple income heads together?",
      "What if I have salary and capital gains?"
    ],
    answer: "Use Income and tick every income head that applies. Fill each visible card with annual INR values, keep non-applicable selected fields as 0, then validate before computing so missing or unsupported combinations are shown.",
    citations: [guideCitation("Income page guide", "usage-guide-income"), guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "income", label: "Income step" }],
    tags: ["intermediate", "multiple income", "salary", "interest", "house property", "capital gains"]
  }),
  entry({
    id: "onboarding.advanced.trace",
    category: "onboarding",
    source_doc: "public/index.html",
    feature: "Application Guide",
    task: "Advanced audit and trace review",
    questions: [
      "I am an advanced user how do I audit the calculation?",
      "How do I inspect rule trace and computation hash?",
      "How do I review the worksheet deeply?",
      "Where do I verify source evidence and assumptions?",
      "How do I check calculation details for review?"
    ],
    answer: "For an advanced review, run Compute, Compare regimes, and Explain. Then inspect the worksheet, computation hash, source register, assumptions, warnings, and downloadable JSON report.",
    citations: [guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["advanced", "audit", "trace", "hash", "source register", "worksheet", "json report"]
  }),
  entry({
    id: "onboarding.advanced.special_income",
    category: "onboarding",
    source_doc: "public/index.html",
    feature: "Application Guide",
    task: "Advanced special income flow",
    questions: [
      "How should I enter capital gains as an advanced user?",
      "How should I enter 44AD and 44ADA cases?",
      "How do I review special rate income?",
      "How do I test presumptive business scenarios?",
      "How do I check transfer date split for capital gains?"
    ],
    answer: "For special-income scenarios, use Income to select Capital gains or Business/profession, enter section, transfer date, gains, receipts, and cash/digital receipt values carefully, then use Validate and Explain to review warnings and source-backed assumptions.",
    citations: [guideCitation("Income page guide", "usage-guide-income"), guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "income", label: "Income step" }],
    tags: ["advanced", "capital gains", "44ad", "44ada", "special rate", "transfer date", "presumptive"]
  }),
  entry({
    id: "unavailable.ais_prefill",
    category: "imports",
    source_doc: "public/index.html",
    feature: "Import Review",
    task: "Unavailable AIS prefill",
    questions: [
      "Can the app import AIS automatically?",
      "Why is prefill from AIS disabled?",
      "Can I connect my e filing account?",
      "Can the app fetch data from income tax portal?",
      "Is automatic AIS prefill available?"
    ],
    answer: "Automatic AIS or portal prefill is not active in this app. Use manual entry or upload supported CSV, JSON, or searchable Form 16 PDF content in Imports, then preview and confirm before applying values.",
    citations: [guideCitation("Import page guide", "usage-guide-imports")],
    actions: [{ type: "navigate", step: "imports", label: "Imports step" }],
    tags: ["unavailable", "ais", "prefill", "portal", "e filing", "import"]
  }),
  entry({
    id: "imports.file_upload.pdf",
    category: "imports",
    source_doc: "public/index.html",
    feature: "Import Review",
    task: "Searchable PDF upload",
    questions: [
      "Can I upload a PDF Form 16?",
      "Can I upload a PDF file directly?",
      "How does PDF upload work?",
      "Can the app read PDF statements?",
      "Can I upload brokerage statement PDF?"
    ],
    answer: "PDF upload is active for searchable Form 16 PDFs. Use Imports and upload the PDF; the app extracts salary, TDS, 80C, and employer details into the normal review box, then requires confirmation before applying values. Brokerage statement PDFs are not mapped yet.",
    citations: [guideCitation("Import page guide", "usage-guide-imports")],
    actions: [{ type: "navigate", step: "imports", label: "Imports step" }],
    tags: ["pdf", "file upload", "form 16", "searchable pdf", "brokerage", "csv", "json"]
  }),
  entry({
    id: "imports.file_upload.csv_json_pdf",
    category: "imports",
    source_doc: "public/index.html",
    feature: "Import Review",
    task: "CSV, JSON, and PDF document upload",
    questions: [
      "Can I upload a CSV Form 16?",
      "How do I upload an import file?",
      "Can the app read a JSON import document?",
      "Where is the upload button for supported documents?",
      "How do I load a sample import document?",
      "Can I upload PDF in import section?"
    ],
    answer: "Use Imports and choose the CSV, JSON, or PDF file picker. CSV and JSON are read directly; searchable Form 16 PDFs are extracted into CSV-shaped review content. The app previews mapped values such as salary, TDS, deductions, interest, or capital gains, and still requires review confirmation before applying values.",
    citations: [guideCitation("Import page guide", "usage-guide-imports")],
    actions: [{ type: "navigate", step: "imports", label: "Imports step" }],
    tags: ["csv upload", "json upload", "pdf upload", "document upload", "form 16", "import file", "preview"]
  }),
  entry({
    id: "unavailable.cloud_account.save",
    category: "privacy",
    source_doc: "public/index.html",
    feature: "Privacy and Data Governance",
    task: "Unavailable account and cloud sync",
    questions: [
      "Can I create an account?",
      "Can I save my calculation online?",
      "Can I sync this calculation to cloud?",
      "Can I share a link to my scenario?",
      "Where do I log in?"
    ],
    answer: "Account login, cloud sync, and share links are not active in this local app. You can save a browser draft, export local data, and download JSON or HTML reports after Explain.",
    citations: [guideCitation("Profile page guide", "usage-guide-profile"), guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "profile", label: "Profile step" }],
    tags: ["unavailable", "account", "login", "cloud", "share", "save draft", "export"]
  }),
  entry({
    id: "rules.schema.supported",
    category: "rules",
    source_doc: "docs/delivery/SPRINTS.md",
    feature: "Machine-Readable Rule Schema",
    task: "Rulepack identity and rule data",
    questions: [
      "How does the calculator know which rulepack is being used?",
      "Where can I see the rule version behind my result?",
      "What is a rulepack in this calculator?",
      "How are supported rules controlled?"
    ],
    answer: "The app uses a versioned rulepack and shows the rulepack ID in the calculation worksheet after you run Explain. Use Results, then Explain, and review the worksheet metadata.",
    citations: [guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["rulepack", "rule version", "worksheet", "explain"]
  }),
  entry({
    id: "rules.provisions.supported",
    category: "rules",
    source_doc: "docs/delivery/SPRINTS.md",
    feature: "V1 Supported Provision Sign-Off",
    task: "Supported and excluded provisions",
    questions: [
      "Which provisions does this calculator support?",
      "Can the assistant tell me if a feature is supported?",
      "What happens when a tax provision is not supported?",
      "Does the app estimate unsupported scenarios?"
    ],
    answer: "The app is scoped to supported calculator scenarios only. Unsupported or excluded cases should show a warning or blocker instead of silently estimating.",
    citations: [guideCitation("Application guide", "usage-guide"), guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["supported", "unsupported", "scope", "guardrails"]
  }),
  entry({
    id: "rules.golden_vectors.explain",
    category: "testing",
    source_doc: "docs/testing/UAT_TEST_CASES.md",
    feature: "Golden Test Vectors",
    task: "Calculation correctness evidence",
    questions: [
      "How do I check if a calculation matches approved examples?",
      "What are golden vectors used for?",
      "How does the app verify calculation correctness?",
      "Where do I review calculation confidence?"
    ],
    answer: "Use Results to validate, compute, compare, and explain. The app also has automated golden-vector tests for supported scenarios, while the UI shows calculation confidence and warnings for the current scenario.",
    citations: [guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["golden vector", "confidence", "validation", "compute"]
  }),
  entry({
    id: "rules.source_register.review",
    category: "reports",
    source_doc: "docs/delivery/SPRINTS.md",
    feature: "Source Register",
    task: "Rule-to-source traceability",
    questions: [
      "Where is the source register shown?",
      "How do I see official references for a result?",
      "Where can I review source evidence?",
      "How do I know which source supports the calculation?"
    ],
    answer: "Run Explain from Results. The worksheet and source trace show rule metadata, source-register evidence, and report details for review.",
    citations: [guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["source register", "source evidence", "official reference", "explain"]
  }),
  entry({
    id: "profile.period.taxpayer",
    category: "profile",
    source_doc: "public/index.html",
    feature: "Application Shell and Navigation",
    task: "Taxpayer profile step",
    questions: [
      "What should I enter on the profile page?",
      "Where do I choose assessment year?",
      "Where do I enter age?",
      "Where do I select taxpayer type and residency?"
    ],
    answer: "Use Profile for Period type, Period, Act, Taxpayer type, Residency, Age, Display language, and Preferred regime. These fields are required before Validate, Compute, Compare, or Explain can run.",
    citations: [guideCitation("Profile page guide", "usage-guide-profile")],
    actions: [{ type: "navigate", step: "profile", label: "Profile step" }],
    tags: ["profile", "period", "age", "taxpayer", "residency", "regime"]
  }),
  entry({
    id: "profile.regime.compare",
    category: "profile",
    source_doc: "public/index.html",
    feature: "Results and Regime Comparison",
    task: "Old and new regime comparison",
    questions: [
      "Where do I choose old regime?",
      "Where do I choose new regime?",
      "How do I compare old and new regime?",
      "Why is the preferred regime needed?"
    ],
    answer: "Choose the preferred regime in Profile. To compare both regimes, go to Results and use Compare regimes after entering the scenario values.",
    citations: [guideCitation("Profile page guide", "usage-guide-profile"), guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "profile", label: "Profile step" }],
    tags: ["old regime", "new regime", "compare", "preferred regime"]
  }),
  entry({
    id: "imports.preview.apply",
    category: "imports",
    source_doc: "public/index.html",
    feature: "Import Architecture",
    task: "Preview and confirmation workflow",
    questions: [
      "How do I use import preview?",
      "Why is apply import blocked?",
      "What should I paste in import content?",
      "How do I apply imported values?"
    ],
    answer: "Use Imports to choose an import type, upload CSV, JSON, or a searchable Form 16 PDF, preview the mapping, review the values, and tick the confirmation checkbox before applying.",
    citations: [guideCitation("Import page guide", "usage-guide-imports")],
    actions: [{ type: "navigate", step: "imports", label: "Imports step" }],
    tags: ["import", "preview", "apply", "confirmation", "csv", "json"]
  }),
  entry({
    id: "imports.form16",
    category: "imports",
    source_doc: "docs/testing/UAT_TEST_CASES.md",
    feature: "Form 16 Import",
    task: "Salary, TDS, and deduction mapping",
    questions: [
      "Can I import Form 16 values?",
      "How do I review Form 16 salary and TDS?",
      "Can I reject imported tax credits?",
      "How does Form 16 import affect the form?"
    ],
    answer: "Upload a searchable Form 16 PDF or paste supported Form 16-like CSV or JSON content in Imports, preview it, review mapped salary, TDS, and deduction values, optionally reject tax-credit values, then confirm before applying.",
    citations: [guideCitation("Import page guide", "usage-guide-imports")],
    actions: [{ type: "navigate", step: "imports", label: "Imports step" }],
    tags: ["form 16", "salary", "tds", "deduction", "reject credits"]
  }),
  entry({
    id: "imports.investment.capital_gains",
    category: "imports",
    source_doc: "docs/testing/UAT_TEST_CASES.md",
    feature: "Interest, Dividend, Investment, and Capital-Gains Imports",
    task: "Review ambiguous import rows",
    questions: [
      "How do I import capital gains rows?",
      "How are ambiguous import rows handled?",
      "Can unsupported import columns be reviewed?",
      "What happens to duplicate import rows?"
    ],
    answer: "Use Preview import first. The review panel shows mapped, duplicate, ambiguous, or unsupported values so you can inspect them before any value is applied to the calculator.",
    citations: [guideCitation("Import page guide", "usage-guide-imports")],
    actions: [{ type: "navigate", step: "imports", label: "Imports step" }],
    tags: ["capital gains import", "ambiguous rows", "duplicate rows", "unsupported columns"]
  }),
  entry({
    id: "income.salary.hra.lta",
    category: "income",
    source_doc: "public/index.html",
    feature: "Salary, HRA, LTA, and House Property",
    task: "Salary allowances",
    questions: [
      "Where do I enter gross salary?",
      "Where do I enter HRA?",
      "Where do I enter LTA?",
      "What should I enter for salary income?"
    ],
    answer: "Use Income, select Salary, then enter Gross salary. HRA and LTA fields are in the same salary card and are used only where the selected regime and inputs support them.",
    citations: [guideCitation("Income page guide", "usage-guide-income")],
    actions: [{ type: "navigate", step: "income", label: "Income step" }],
    tags: ["salary", "gross salary", "hra", "lta", "allowance"]
  }),
  entry({
    id: "income.house.other_sources",
    category: "income",
    source_doc: "public/index.html",
    feature: "Salary, HRA, LTA, and House Property",
    task: "House property and other sources",
    questions: [
      "Where do I enter house property interest?",
      "Where do I enter let out loss?",
      "Where do I enter interest income?",
      "How do I add other source income?"
    ],
    answer: "Use Income, select House property for self-occupied interest or let-out loss, and select Other sources for interest income.",
    citations: [guideCitation("Income page guide", "usage-guide-income")],
    actions: [{ type: "navigate", step: "income", label: "Income step" }],
    tags: ["house property", "self occupied", "let out", "interest income", "other sources"]
  }),
  entry({
    id: "income.capital_gains",
    category: "income",
    source_doc: "public/index.html",
    feature: "Capital Gains Engine",
    task: "Capital-gains section, date, and amount",
    questions: [
      "Where do I enter 112A capital gains?",
      "Where do I enter 111A gain?",
      "How do I enter capital gain transfer date?",
      "How do I add capital gains asset row?"
    ],
    answer: "Use Income, select Capital gains, choose the section, enter transfer date and net gain, then add or delete the reviewed asset row as needed before computing.",
    citations: [guideCitation("Income page guide", "usage-guide-income")],
    actions: [{ type: "navigate", step: "income", label: "Income step" }],
    tags: ["capital gains", "111a", "112a", "112", "50aa", "transfer date", "net gain"]
  }),
  entry({
    id: "income.business.presumptive",
    category: "income",
    source_doc: "public/index.html",
    feature: "Business, Presumptive Tax, and Audit Checks",
    task: "Business and profession inputs",
    questions: [
      "Where do I enter 44AD turnover?",
      "Where do I enter 44ADA receipts?",
      "Where do I enter business income?",
      "What are cash and digital receipts for?"
    ],
    answer: "Use Income, select Business or profession, then choose the business type. Enter turnover or gross receipts, cash receipts, digital receipts, and business income fields that match the selected type.",
    citations: [guideCitation("Income page guide", "usage-guide-income")],
    actions: [{ type: "navigate", step: "income", label: "Income step" }],
    tags: ["business", "profession", "44ad", "44ada", "turnover", "receipts", "cash"]
  }),
  entry({
    id: "deductions.chapter_via",
    category: "deductions",
    source_doc: "public/index.html",
    feature: "Chapter VI-A Deduction Engine",
    task: "Deduction and exemption inputs",
    questions: [
      "Where do I enter 80C?",
      "Where do I enter 80D?",
      "Where do I enter 80GG?",
      "Where do I enter 80EE and 80EEA?"
    ],
    answer: "Use Deductions for standard deduction controls and Chapter VI-A inputs such as 80C, 80D, 80GG, 80EE, and 80EEA.",
    citations: [guideCitation("Deductions page guide", "usage-guide-deductions")],
    actions: [{ type: "navigate", step: "deductions", label: "Deductions step" }],
    tags: ["80c", "80d", "80gg", "80ee", "80eea", "deduction"]
  }),
  entry({
    id: "credits.tax_paid",
    category: "credits",
    source_doc: "public/index.html",
    feature: "Credits, Interest, Late Fee, and ITR Recommendation",
    task: "Taxes already paid",
    questions: [
      "Where do I enter TDS?",
      "Where do I enter TCS?",
      "Where do I enter advance tax?",
      "Where do I enter self assessment tax?"
    ],
    answer: "Use Credits for TDS, TCS, advance tax, and self-assessment tax already paid. These values reduce payable tax or may create a refund in the result.",
    citations: [guideCitation("Credits page guide", "usage-guide-credits")],
    actions: [{ type: "navigate", step: "credits", label: "Credits step" }],
    tags: ["tds", "tcs", "advance tax", "self assessment tax", "credits"]
  }),
  entry({
    id: "results.validate.compute",
    category: "results",
    source_doc: "public/index.html",
    feature: "Core Compute API",
    task: "Validate and compute actions",
    questions: [
      "How do I validate my inputs?",
      "How do I compute tax?",
      "What should I click after entering values?",
      "Why should I validate before compute?"
    ],
    answer: "Use Results or the side action rail. Run Validate to check missing or unsupported inputs, then Compute to calculate the current scenario.",
    citations: [guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["validate", "compute", "side rail", "results"]
  }),
  entry({
    id: "results.compare.itr",
    category: "results",
    source_doc: "public/index.html",
    feature: "Results and Regime Comparison",
    task: "Comparison, payable, refund, and ITR recommendation",
    questions: [
      "Where do I see old versus new regime?",
      "Where do I see payable or refund?",
      "Where is likely ITR form shown?",
      "How do I understand the result summary?"
    ],
    answer: "Use Results after Compute. The result summary shows payable or refund, comparison cards show old versus new regime, and the scenario summary shows the likely ITR form where available.",
    citations: [guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["compare regimes", "payable", "refund", "itr", "summary"]
  }),
  entry({
    id: "reports.explain.download",
    category: "reports",
    source_doc: "public/index.html",
    feature: "Downloadable Reports",
    task: "Explain, JSON report, and HTML report",
    questions: [
      "How do I generate a report?",
      "Why is JSON report disabled?",
      "Why is HTML report missing?",
      "How do I download calculation details?"
    ],
    answer: "Run Explain before downloading reports. After the explanation is generated, use JSON report or HTML report from the side action rail.",
    citations: [guideCitation("Results page guide", "usage-guide-results")],
    actions: [{ type: "navigate", step: "results", label: "Results step" }],
    tags: ["explain", "json report", "html report", "download", "generated explanation report"]
  }),
  entry({
    id: "validation.missing.required",
    category: "validation",
    source_doc: "public/index.html",
    feature: "Validation Framework",
    task: "Missing required fields",
    questions: [
      "What does Age is missing mean?",
      "Why does validate say a field is missing?",
      "What should I do when an error says missing?",
      "How do I fix required field errors?"
    ],
    answer: "A missing-entry message means the named field is empty or unchecked. Go to the named section, enter the required value, then run the action again.",
    citations: [guideCitation("Missing-entry guide", "usage-guide-errors")],
    actions: [{ type: "navigate", step: "profile", label: "Profile step" }],
    tags: ["missing", "required", "age", "validation", "error"]
  }),
  entry({
    id: "validation.year.regime",
    category: "validation",
    source_doc: "docs/testing/UAT_TEST_CASES.md",
    feature: "Year, Law, and Regime Validation",
    task: "Supported periods and regime checks",
    questions: [
      "Why is my assessment year unsupported?",
      "Why does the app warn about regime restrictions?",
      "Why does HRA show a new regime warning?",
      "How do I fix year and regime validation?"
    ],
    answer: "Use a supported Period and regime in Profile. Some deductions or exemptions are restricted by regime, so the app may warn or block the scenario before computing.",
    citations: [guideCitation("Profile page guide", "usage-guide-profile"), guideCitation("Deductions page guide", "usage-guide-deductions")],
    actions: [{ type: "navigate", step: "profile", label: "Profile step" }],
    tags: ["year", "regime", "hra warning", "unsupported", "validation"]
  }),
  entry({
    id: "validation.provision.specific",
    category: "validation",
    source_doc: "docs/testing/UAT_TEST_CASES.md",
    feature: "Provision-Specific Validation",
    task: "Limits, caps, and incompatible claims",
    questions: [
      "Why is 80C capped?",
      "Why are 80EE and 80EEA rejected together?",
      "Why is LTA blocked?",
      "Why is a negative amount not accepted?"
    ],
    answer: "Provision-specific validation checks caps, incompatible claims, journey limits, negative values, and unsupported combinations. Review the named field and adjust it before running Validate or Compute again.",
    citations: [guideCitation("Deductions page guide", "usage-guide-deductions"), guideCitation("Missing-entry guide", "usage-guide-errors")],
    actions: [{ type: "navigate", step: "deductions", label: "Deductions step" }],
    tags: ["80c cap", "80ee", "80eea", "lta", "negative", "limits"]
  }),
  entry({
    id: "privacy.local.data",
    category: "privacy",
    source_doc: "docs/engineering/OPERATIONS.md",
    feature: "Privacy and Data Governance",
    task: "Local data export and deletion",
    questions: [
      "How do I view the privacy policy?",
      "How do I export local data?",
      "How do I delete local data?",
      "Where is privacy notice acknowledgement?"
    ],
    answer: "Use Profile for the privacy notice and local data controls. You can open the privacy policy, export browser-held data, or delete local draft, report, and import data.",
    citations: [guideCitation("Profile page guide", "usage-guide-profile")],
    actions: [{ type: "navigate", step: "profile", label: "Profile step" }],
    tags: ["privacy", "export local data", "delete local data", "notice"]
  }),
  entry({
    id: "operations.readiness.support",
    category: "readiness",
    source_doc: "docs/release/LAUNCH.md",
    feature: "Launch Readiness",
    task: "Readiness, support, and feedback",
    questions: [
      "Where do I check launch readiness?",
      "Where is support SOP?",
      "How do I classify feedback?",
      "Where do I run final regression from UI?"
    ],
    answer: "Use Readiness for beta plan, final regression, launch-readiness checks, support SOP, and feedback triage actions.",
    citations: [guideCitation("Readiness page guide", "usage-guide-readiness")],
    actions: [{ type: "navigate", step: "launch", label: "Readiness step" }],
    tags: ["readiness", "support sop", "feedback", "regression", "beta"]
  }),
  entry({
    id: "operations.security.audit",
    category: "operations",
    source_doc: "docs/engineering/OPERATIONS.md",
    feature: "Security Controls",
    task: "Audit, rate limits, and safe API handling",
    questions: [
      "Does the app log API actions?",
      "How are security controls handled?",
      "Does the app expose sensitive audit values?",
      "Where are operations controls described?"
    ],
    answer: "The app uses local development audit events, rate limits, security headers, and masked operational evidence. Use Readiness and support views for visible operations evidence.",
    citations: [guideCitation("Readiness page guide", "usage-guide-readiness")],
    actions: [{ type: "navigate", step: "launch", label: "Readiness step" }],
    tags: ["security", "audit", "rate limit", "operations", "headers"]
  }),
  entry({
    id: "accessibility.quality",
    category: "operations",
    source_doc: "docs/product/PRD.md",
    feature: "Accessibility and Quality",
    task: "Keyboard, labels, contrast, and responsive behavior",
    questions: [
      "Can I use the app with keyboard?",
      "Does the app support accessible labels?",
      "How do I use the calculator on mobile?",
      "Are validation messages announced?"
    ],
    answer: "The app is designed with semantic sections, visible focus states, labels, responsive layout, and live validation regions. Use Tab to move through controls and the stepper or action rail to navigate.",
    citations: [guideCitation("Application guide", "usage-guide")],
    actions: [],
    tags: ["accessibility", "keyboard", "labels", "mobile", "focus"]
  }),
  entry({
    id: "testing.run.report",
    category: "testing",
    source_doc: "docs/testing/TEST_STRATEGY_AND_CASES.md",
    feature: "Final Regression",
    task: "Test report generation",
    questions: [
      "How do I run all tests?",
      "Where is the test report generated?",
      "How do I run browser tests?",
      "What does the test report include?"
    ],
    answer: "Use the project test commands from the tooling docs. The full test run writes the Markdown report under testing/output and includes native API coverage plus Playwright Chrome UI coverage.",
    citations: [guideCitation("Readiness page guide", "usage-guide-readiness")],
    actions: [{ type: "navigate", step: "launch", label: "Readiness step" }],
    tags: ["tests", "test report", "playwright", "browser", "regression"]
  }),
  entry({
    id: "refusal.tax.advice",
    category: "refusal",
    source_doc: "docs/chatbot/CHATBOT_PLAN.md",
    feature: "Chatbot Guardrails",
    task: "Tax, legal, and investment advice refusal",
    questions: [
      "How can I avoid tax?",
      "Which mutual fund should I buy?",
      "Give me legal advice for my tax notice",
      "Tell me the best tax saving investment"
    ],
    answer: "I can help with this calculator, but I can’t answer questions outside the app or provide personal tax, legal, or investment advice.",
    citations: [guideCitation("Application guide", "usage-guide")],
    actions: [],
    refusal: true,
    tags: ["refusal", "advice", "investment", "legal", "tax avoidance"]
  })
];

function entry(item) {
  return {
    refusal: false,
    actions: [],
    tags: [],
    ...item
  };
}
