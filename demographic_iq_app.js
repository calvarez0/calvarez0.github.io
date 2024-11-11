// Policy Calculation Functions

function calculateMedicareSavings(age, healthNeeds) {
  if (age >= 65) {
    return healthNeeds === "high" ? 3000 : healthNeeds === "medium" ? 2000 : 1000;
  } else {
    return healthNeeds === "high" ? 1500 : healthNeeds === "medium" ? 1000 : 500;
  }
}

function calculateEnergySavings(energyUsage) {
  return energyUsage === "high" ? 2500 : energyUsage === "medium" ? 1500 : 800;
}

function kamalaHarrisPolicy(demographics) {
  let netIncomeImpact = 0;
  let taxableIncome = demographics.income;

  // Apply deductions first
  if (demographics.isStartup) {
      taxableIncome -= 50000; // Expanded Section 195 deduction
  }

  // Higher taxes on high income after deductions
  if (taxableIncome > 400000) {
      netIncomeImpact -= taxableIncome * 0.012; // Medicare and NIIT rates increase for high earners
      if (taxableIncome > 1000000) {
          netIncomeImpact -= taxableIncome * 0.0396; // Top rate for high earners
      }
  }

  // Capital gains and dividends tax
  if (demographics.capitalGains > 1000000) {
      netIncomeImpact -= demographics.capitalGains * (0.28 - 0.2);
  }
  if (demographics.dividends > 1000000) {
      netIncomeImpact -= demographics.dividends * (0.28 - 0.2);
  }

  // Child and college tax credits (Direct credits)
  netIncomeImpact += demographics.newbornDependents * 6000; // $6,000 for newborns
  netIncomeImpact += demographics.youngDependents * 3600; // $3,600 for ages 2-5
  netIncomeImpact += demographics.otherDependents * 3000; // $3,000 for ages 6+

  if (demographics.dependentsCollege) {
      netIncomeImpact += demographics.dependentsCollege * 6000;
  }

  // Low-income additional support (Direct credit)
  if (taxableIncome <= 50000) {
      netIncomeImpact += 1000;
  }

  // First-time homebuyer credit (Direct credit)
  if (demographics.firstTimeHomebuyer) {
      netIncomeImpact += 6250; // $25,000 spread over 4 years
  }

  // Expanded EITC for workers without dependents (Direct credit)
  if (!demographics.dependents && taxableIncome < 20000) {
      netIncomeImpact += 1500;
  }

  // Social Security and tips exemptions (Direct credits)
  netIncomeImpact += demographics.age >= 65 ? 1500 : 0;
  netIncomeImpact += demographics.tips ? 100 : 0;

  // Medicare savings (Direct credit)
  netIncomeImpact += calculateMedicareSavings(demographics.age, demographics.healthNeeds);

  return netIncomeImpact;
}

function donaldTrumpPolicy(demographics) {
  let netIncomeImpact = 0;
  let taxableIncome = demographics.income;

  // Apply deductions first
  if (demographics.autoLoanInterest) {
      taxableIncome -= demographics.autoLoanInterest * 0.1;
  }

  // Capital gains and dividends (reduced rate, Direct credit)
  netIncomeImpact += (demographics.capitalGains || 0) * 0.15;
  netIncomeImpact += (demographics.dividends || 0) * 0.15;

  // Income adjustments (Direct credit)
  if (taxableIncome < 400000) {
      netIncomeImpact += 1000; // Tax cut for households under $400,000
  }

  // Tariff burdens (Direct impact on net income)
  if (taxableIncome <= 80000) {
      netIncomeImpact -= 500;
  } else if (taxableIncome <= 200000) {
      netIncomeImpact -= 300;
  }

  // Social Security, overtime, and tips exemptions (Direct credits)
  netIncomeImpact += demographics.age >= 65 ? 1500 : 0;
  netIncomeImpact += demographics.overtime ? 200 : 0;
  netIncomeImpact += demographics.tips ? 100 : 0;

  // Adjust for dependents (Direct credits)
  netIncomeImpact += demographics.newbornDependents * 5000;
  netIncomeImpact += demographics.youngDependents * 3000;
  netIncomeImpact += demographics.otherDependents * 2000;

  if (demographics.dependentsCollege) {
      netIncomeImpact += demographics.dependentsCollege * 2500;
  }

  // Energy savings (Direct credit)
  netIncomeImpact += calculateEnergySavings(demographics.energyUsage);

  return netIncomeImpact;
}

function createPieChart(data, title, elementId) {
  if (typeof Plotly === "undefined") {
    console.error("Plotly is not loaded");
    return;
  }

  const labels = data.map((item) => item.label);
  const values = data.map((item) => item.value);
  const colors = data.map((item) => item.color);

  const layout = {
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.4,
    },
    margin: { t: 10, b: 10 },
  };

  const config = {
    displayModeBar: false,
  };

  Plotly.newPlot(
    elementId,
    [
      {
        type: "pie",
        labels: labels,
        values: values,
        marker: { colors: colors },
        hoverinfo: "label+value+percent",
        textinfo: "none",
      },
    ],
    layout,
    config
  );
}

function updateImpactDisplay(elementId, value) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Element with id ${elementId} not found`);
    return;
  }

  element.classList.remove("positive-income", "negative-income");

  if (value >= 0) {
    element.classList.add("positive-income");
    element.textContent = `+$${Math.abs(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  } else {
    element.classList.add("negative-income");
    element.textContent = `-$${Math.abs(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

function showCandidate(candidate) {
  const kamalaCandidate = document.getElementById("kamalaCandidate");
  const trumpCandidate = document.getElementById("trumpCandidate");

  if (kamalaCandidate && trumpCandidate) {
    kamalaCandidate.style.display = candidate === "kamala" ? "block" : "none";
    trumpCandidate.style.display = candidate === "trump" ? "block" : "none";

    if (candidate === "kamala") {
      Plotly.Plots.resize("kamalaChart");
    } else {
      Plotly.Plots.resize("trumpChart");
    }
  } else {
    console.error("Candidate elements not found");
  }
}

function scrollToResults() {
  const candidateTabs = document.querySelector(".mobile-tabs");
  if (candidateTabs) {
    candidateTabs.scrollIntoView({ behavior: "smooth" });
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const calculateButton = document.querySelector("button");
  if (calculateButton) {
    calculateButton.addEventListener("click", calculateImpact);
  }

  switchCandidate("kamala");
});

function calculateImpact() {
  try {
    const demographics = {
      income: parseFloat(document.getElementById("income")?.value) || 0,
      capitalGains: parseFloat(document.getElementById("capitalGains")?.value) || 0,
      dividends: parseFloat(document.getElementById("dividends")?.value) || 0,
      age: parseInt(document.getElementById("age")?.value) || 0,
      newbornDependents: parseInt(document.getElementById("newbornDependents")?.value) || 0,
      youngDependents: parseInt(document.getElementById("youngDependents")?.value) || 0,
      otherDependents: parseInt(document.getElementById("otherDependents")?.value) || 0,
      dependentsCollege: parseInt(document.getElementById("dependentsCollege")?.value) || 0,
      autoLoanInterest: parseFloat(document.getElementById("autoLoanInterest")?.value) || 0,
      firstTimeHomebuyer: document.getElementById("firstTimeHomebuyer")?.checked || false,
      isStartup: document.getElementById("isStartup")?.checked || false,
      tips: document.getElementById("tips")?.checked || false,
      overtime: document.getElementById("overtime")?.checked || false,
      socialSecurity: document.getElementById("socialSecurity")?.checked || false
    };

    const kamalaImpact = kamalaHarrisPolicy(demographics);
    const trumpImpact = donaldTrumpPolicy(demographics);

    updateImpactDisplay("kamalaImpact", kamalaImpact);
    updateImpactDisplay("trumpImpact", trumpImpact);
    //kamala
    const kHomeBuyerCredit = demographics.firstTimeHomebuyer ? 6250 : 0;
    const kChildTaxCredit = demographics.newbornDependents * 6000 + demographics.youngDependents * 3600 + demographics.otherDependents * 3000;
    const kSocialSecurityCredit = demographics.age >= 65 ? 1500 : 0;
    const kIncomeTaxSavings = kamalaImpact - (kamalaImpact < 0 ? -1 : 1) * (kHomeBuyerCredit + kChildTaxCredit + kSocialSecurityCredit);

    //trump
    const tSocialSecurityCredit = demographics.age >= 65 ? 1500 : 0;
    const tOvertimeCredit = demographics.overtime ? 200 : 0;
    const tIncomeTaxSavings = trumpImpact - (trumpImpact < 0 ? -1 : 1) * (tSocialSecurityCredit + tOvertimeCredit);


    const kamalaPieData = [
      { label: "Income Tax Savings", value: kIncomeTaxSavings > 0 ? kIncomeTaxSavings : 0, color: "green" },
      { label: "Income Tax Increase", value: kIncomeTaxSavings < 0 ? -kIncomeTaxSavings : 0, color: "#c10013" },
      { label: "First-Time Homebuyer Credit", value: demographics.firstTimeHomebuyer ? 6250 : 0, color: "orange" },
      { label: "Child Tax Credit", value: demographics.newbornDependents * 6000 + demographics.youngDependents * 3600 + demographics.otherDependents * 3000, color: "lightgreen" },
      { label: "Social Security", value: demographics.age >= 65 ? 1500 : 0, color: "blue" },
    ];

    const trumpPieData = [
      { label: "Income Tax Savings", value: tIncomeTaxSavings > 0 ? tIncomeTaxSavings : 0, color: "green" },
      { label: "Income Tax Increase", value: tIncomeTaxSavings < 0 ? -tIncomeTaxSavings : 0, color: "red" },
      { label: "Social Security", value: demographics.age >= 65 ? 1500 : 0, color: "blue" },
      { label: "Overtime Exemption", value: demographics.overtime ? 200 : 0, color: "lightblue" },
    ];

    createPieChart(kamalaPieData, "Kamala Harris", "kamalaChart");
    createPieChart(trumpPieData, "Donald Trump", "trumpChart");

    scrollToResults();
  } catch (error) {
    console.error("Error in calculateImpact:", error);
  }
}


function switchCandidate(candidate) {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
  const activeBtn = document.querySelector(`.tab-btn[onclick="switchCandidate('${candidate}')"]`);
  if (activeBtn) activeBtn.classList.add("active");

  document.querySelectorAll(".candidate").forEach((el) => el.classList.remove("active"));
  const activeCandidate = document.getElementById(`${candidate}Candidate`);
  if (activeCandidate) activeCandidate.classList.add("active");

  if (candidate === "kamala") {
    Plotly.Plots.resize("kamalaChart");
  } else {
    Plotly.Plots.resize("trumpChart");
  }
}