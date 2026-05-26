import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;

const choices = [
  {
    id: "salaried",
    label: "Salaried",
    badge: "Most common",
    description: "Start with salary, Form 16 values, standard deduction, and TDS.",
    persona: "salaried",
    step: "income"
  },
  {
    id: "investor",
    label: "Investor",
    badge: "Capital gains",
    description: "Review equity gains, interest income, 112A, 111A, and special-rate warnings.",
    persona: "investor",
    step: "income"
  },
  {
    id: "freelancer",
    label: "Freelancer",
    badge: "44ADA",
    description: "Use professional receipts, presumptive income, credits, and validation.",
    persona: "freelancer",
    step: "income"
  },
  {
    id: "senior",
    label: "Senior Citizen",
    badge: "Age-aware",
    description: "Set the senior age band, interest income, and health deduction review.",
    persona: "senior",
    step: "profile"
  },
  {
    id: "professional",
    label: "Tax Professional",
    badge: "Review mode",
    description: "Jump to worksheet, source trace, AI review, and downloadable reports.",
    persona: "professional",
    step: "results"
  },
  {
    id: "import",
    label: "Import Form 16/PDF",
    badge: "Review first",
    description: "Upload CSV, JSON, or searchable PDF, then confirm mapped values before apply.",
    step: "imports"
  },
  {
    id: "compare",
    label: "Compare Regimes",
    badge: "Old vs new",
    description: "Compute with the backend engine, then compare old and new regime outcomes.",
    step: "results"
  }
];

const aboutContent = {
  coverage: [
    {
      title: "Supported scope",
      badge: "Coverage",
      body: "This local calculator supports selected Indian individual/HUF scenarios for AY 2025-26 and AY 2026-27. It does not file returns, connect AIS, handle NRI/DTAA, GST, cloud sync, account login, or share links."
    },
    {
      title: "Tax coverage",
      badge: "AY 2026-27",
      body: "AY 2026-27 uses the default new-regime framing, 115BAC slabs, Section 87A normal-income rebate treatment, standard deduction support, old-vs-new comparison, supported capital-gains rows, and presumptive sections already present in the rulepack."
    },
    {
      title: "Data storage behavior",
      badge: "Storage",
      body: "Draft form values, selected start path, checklist state, saved scenarios, AI review context, and dismissed review notes stay in this browser through localStorage. Import previews create encrypted local artifacts with 7-day retention metadata. Reports are generated for user-controlled browser download. Delete local data clears the browser-held app state; the local Node server keeps only masked development audit events."
    },
    {
      title: "Trust model",
      badge: "Review",
      body: "All calculations call the Node tax engine. Imports and AI review show confidence, evidence, and warnings before values are applied."
    }
  ],
  sources: [
    {
      title: "Builder",
      badge: "Credits",
      body: "Built by D Siva Kumar with help from the CodeBasics Team."
    },
    {
      title: "Official source checks",
      badge: "References",
      body: "Latest public guidance reviewed for this upgrade: salaried individual AY 2026-27 and business/profession AY 2026-27 pages from the Income Tax Department.",
      links: [
        { href: "https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1", label: "Salaried Individuals AY 2026-27" },
        { href: "https://www.incometax.gov.in/iec/foportal/help/individual-business-profession", label: "Business/Profession AY 2026-27" }
      ]
    },
    {
      title: "Rulepack",
      badge: "Evidence",
      details: [
        ["Active AY", "2026-27"],
        ["Source register", "src-2026-05-08-v1"],
        ["Last reviewed", "2026-05-08"]
      ]
    }
  ],
  privacy: [
    {
      title: "Privacy posture",
      badge: "Local app",
      body: "This website estimates tax locally for the current browser session and does not provide account login, cloud sync, or share links."
    },
    {
      title: "What is stored",
      badge: "Browser",
      body: "The app can store draft calculator inputs, selected start path, local scenarios, checklist state, and AI review context in localStorage on this device. Uploaded import content is used for preview and stored as an encrypted local artifact with retention metadata."
    },
    {
      title: "User controls",
      badge: "Control",
      body: "Use Privacy policy, Export local data, and Delete local data in Profile to review purpose/retention, download the browser-held package, or clear local draft/report/import state."
    }
  ]
};

function AppShell() {
  const [activeTab, setActiveTabState] = useState("start");
  const [selectedChoice, setSelectedChoice] = useState(readStored("selected_choice", ""));
  const [aboutSection, setAboutSection] = useState(readStored("about_section", "coverage"));
  const motionPreference = useMemo(() => {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "reduced" : "standard";
  }, []);

  useEffect(() => {
    window.__taxReactShellReady = true;
    const handleOpenTab = (event) => {
      const tab = event.detail?.tab;
      if (["start", "calculator", "guide", "about"].includes(tab)) {
        setActiveTabState(tab);
      }
    };
    window.addEventListener("tax-open-tab", handleOpenTab);
    return () => window.removeEventListener("tax-open-tab", handleOpenTab);
  }, []);

  useEffect(() => {
    const guide = document.querySelector("#usage-guide");
    document.body.dataset.activeTab = activeTab;
    writeStored("active_tab", activeTab);
    writeStored("motion_preference", motionPreference);
    if (guide) {
      if (activeTab === "guide") {
        guide.setAttribute("open", "");
      } else if (guide.open && !isModalDialog(guide)) {
        guide.removeAttribute("open");
      }
    }
  }, [activeTab, motionPreference]);

  useEffect(() => {
    if (selectedChoice) writeStored("selected_choice", selectedChoice);
  }, [selectedChoice]);

  useEffect(() => {
    writeStored("about_section", aboutSection);
  }, [aboutSection]);

  function setActiveTab(tab) {
    setActiveTabState(tab);
  }

  function choose(item) {
    setSelectedChoice(item.id);
    writeStored("choice_hub_seen", "true");
    setActiveTabState("calculator");

    window.setTimeout(() => {
      if (item.persona) {
        window.dispatchEvent(new CustomEvent("tax-select-start-path", {
          detail: { persona: item.persona }
        }));
      } else if (item.step) {
        const stepButton = document.querySelector(`[data-step="${cssEscape(item.step)}"]`);
        stepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      document.querySelector("#tax-wizard")?.focus({ preventScroll: true });
    }, 80);
  }

  return h("div", { className: "react-product-shell" },
    h("nav", { className: "product-tabs", "aria-label": "Application sections" },
      tabButton("start", "Start", activeTab, setActiveTab, { testId: "start-tab" }),
      tabButton("calculator", "Calculator", activeTab, setActiveTab, { testId: "calculator-tab" }),
      tabButton("guide", "Guide", activeTab, setActiveTab, { testId: "guide-tab" }),
      tabButton("about", "About", activeTab, setActiveTab, { testId: "about-tab" })
    ),
    activeTab === "about" && h(AboutPanel, { aboutSection, setAboutSection }),
    activeTab === "start" && h(ChoiceHub, { choices, selectedChoice, choose, setActiveTab })
  );
}

function tabButton(id, label, activeTab, setActiveTab, options = {}) {
  return h("button", {
    type: "button",
    className: `product-tab ${activeTab === id ? "active" : ""}`,
    "aria-pressed": activeTab === id ? "true" : "false",
    "data-testid": options.testId,
    onClick: () => setActiveTab(id)
  }, label);
}

function ChoiceHub({ choices, selectedChoice, choose, setActiveTab }) {
  return h("section", {
    className: "choice-hub active",
    "data-testid": "choice-hub",
    "aria-labelledby": "hero-heading"
  },
    h("div", { className: "choice-copy" },
      h("p", { className: "eyebrow" }, "AY 2026-27 ready"),
      h("h2", null, "Choose how you want to start"),
      h("p", null, "Pick the template closest to your situation. The calculator will focus the relevant income heads, checklist, and first useful step.")
    ),
    h("div", { className: "choice-grid" },
      choices.map((item, index) => h("button", {
        key: item.id,
        type: "button",
        className: `choice-card ${selectedChoice === item.id ? "selected" : ""}`,
        "data-testid": "choice-card",
        "data-choice": item.id,
        style: { "--choice-delay": `${index * 35}ms` },
        onClick: () => choose(item)
      },
        h("span", { className: "badge neutral" }, item.badge),
        h("strong", null, item.label),
        h("small", null, item.description)
      ))
    ),
    h("div", { className: "choice-actions" },
      h("button", {
        id: "hero-start-button",
        type: "button",
        className: "button primary",
        "data-testid": "hero-start-button",
        onClick: () => setActiveTab("calculator")
      }, "Open blank calculator")
    )
  );
}

function AboutPanel({ aboutSection, setAboutSection }) {
  const cards = aboutContent[aboutSection] ?? aboutContent.coverage;

  return h("section", { className: "about-panel", "aria-labelledby": "about-heading" },
    h("div", { className: "about-header" },
      h("p", { className: "eyebrow" }, "About"),
      h("h2", { id: "about-heading" }, "Application details and tax coverage"),
      h("p", null, "This page holds the trust, usage, source, privacy, and limitation details so the opening screen can stay focused on user choices.")
    ),
    h("div", { className: "about-section-tabs", "aria-label": "About sections" },
      ["coverage", "sources", "privacy"].map((id) => h("button", {
        key: id,
        type: "button",
        className: aboutSection === id ? "active" : "",
        onClick: () => setAboutSection(id)
      }, humanize(id)))
    ),
    h("div", { className: "about-grid" },
      cards.map(renderAboutCard)
    )
  );
}

function renderAboutCard(section, index) {
  const badgeClass = section.badge === "Coverage" || section.badge === "AY 2026-27"
    ? "badge success"
    : "badge neutral";

  return h("article", {
    key: section.title,
    className: `about-card ${section.links ? "source-card" : ""}`,
    style: { "--choice-delay": `${index * 40}ms` },
    "data-testid": section.title === "Tax coverage" ? "about-tax-coverage" : undefined
  },
    h("span", { className: badgeClass }, section.badge ?? section.title),
    h("h3", null, section.title),
    section.body && h("p", null, section.body),
    section.links && h("ul", null,
      section.links.map((link) => h("li", { key: link.href },
        h("a", { href: link.href, target: "_blank", rel: "noreferrer" }, link.label)
      ))
    ),
    section.details && h("dl", null,
      section.details.map(([term, description]) => h("div", { key: term },
        h("dt", null, term),
        h("dd", null, description)
      ))
    )
  );
}

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replaceAll('"', '\\"');
}

function humanize(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isModalDialog(dialog) {
  try {
    return dialog.matches(":modal");
  } catch {
    return false;
  }
}

const root = document.querySelector("#react-shell-root");
if (root) {
  createRoot(root).render(h(AppShell));
}
