// Policy Calculation Functions

function calculateMedicareSavings(age, healthNeeds) {
  if (age >= 65) {
    return healthNeeds === "high"
      ? 3000
      : healthNeeds === "medium"
      ? 2000
      : 1000;
  } else {
    return healthNeeds === "high"
      ? 1500
      : healthNeeds === "medium"
      ? 1000
      : 500;
  }
}

function calculateEnergySavings(energyUsage) {
  return energyUsage === "high" ? 2500 : energyUsage === "medium" ? 1500 : 800;
}

function kamalaHarrisPolicy(demographics) {
  let netIncomeImpact = 0;

  // Higher taxes on income for those above specific thresholds
  if (demographics.income > 400000) {
    netIncomeImpact -= demographics.income * 0.012; // Increase in Medicare and NIIT rates for high earners
    netIncomeImpact -=
      demographics.income > 1000000 ? demographics.income * 0.0396 : 0; // Top rate for high earners
  }

  // Capital gains tax increase for high earners
  if (demographics.capitalGains > 1000000) {
    netIncomeImpact -= demographics.capitalGains * (0.28 - 0.2); // 28% capital gains tax on gains above $1 million
  }
  if (demographics.dividends > 1000000) {
    netIncomeImpact -= demographics.dividends * (0.28 - 0.2); // Increase on dividends
  }

  // Credits for households earning $400k or below
  if (demographics.income <= 400000) {
    netIncomeImpact += demographics.dependents * 3000; // Child tax credit for dependents
    netIncomeImpact += demographics.dependentsCollege * 6000; // Extra credit for dependents in college
    if (demographics.income < 50000) {
      netIncomeImpact += 1000; // Additional support for low-income earners
    }
  }

  // First-time homebuyer credit (if applicable)
  if (demographics.firstTimeHomebuyer) {
    netIncomeImpact += 25000 / 4; // $25,000 spread over 4 years for first-time homebuyers
  }

  // Expanded earned income tax credit (EITC) for workers without dependents
  if (!demographics.dependents && demographics.income < 20000) {
    netIncomeImpact += 1500; // Approximation for EITC expansion for individuals without dependents
  }

  // Credits and exemptions
  netIncomeImpact += demographics.age >= 65 ? 1500 : 0; // Credit for Social Security beneficiaries
  netIncomeImpact += demographics.tips ? 100 : 0; // Exemption on tips for service workers

  // Small business and startup deductions
  if (demographics.isStartup) {
    netIncomeImpact += 50000; // Expanded Section 195 deduction for startup expenses
  }

  // Medicare savings for healthcare needs
  netIncomeImpact += calculateMedicareSavings(
    demographics.age,
    demographics.healthNeeds
  );

  return netIncomeImpact;
}

function donaldTrumpPolicy(demographics) {
  let netIncomeImpact = 0;

  // Adjust for dependents
  netIncomeImpact += demographics.dependents * 5000;
  if (demographics.dependentsCollege) {
    netIncomeImpact += demographics.dependentsCollege * 2500; // Additional for dependents in college
  }

  // Income adjustments based on threshold
  if (demographics.income < 400000) {
    netIncomeImpact += 1000; // Small tax cut for households under $400,000
  }

  // Exemptions
  if (demographics.age >= 65) {
    netIncomeImpact += 1500; // Exempt Social Security benefits for seniors
  }
  netIncomeImpact += demographics.overtime ? 200 : 0; // Exempt overtime pay from income tax
  netIncomeImpact += demographics.tips ? 100 : 0; // Exempt tips from income tax

  // Adjustments for capital gains and dividends (reduced rate)
  netIncomeImpact += (demographics.capitalGains || 0) * 0.15; // Approximate 15% reduction for capital gains
  netIncomeImpact += (demographics.dividends || 0) * 0.15; // Approximate 15% reduction for dividends

  // Itemized deduction for auto loan interest
  if (demographics.autoLoanInterest) {
    netIncomeImpact += demographics.autoLoanInterest * 0.1; // Approximate 10% benefit on auto loan interest
  }

  // Adjustments based on tariffs and foreign retaliation
  if (demographics.income <= 80000) {
    netIncomeImpact -= 500; // Tariff burden on lower-income households
  } else if (demographics.income <= 200000) {
    netIncomeImpact -= 300; // Tariff burden on middle-income households
  }

  // Additional deductions for energy savings
  netIncomeImpact += calculateEnergySavings(demographics.energyUsage);

  return netIncomeImpact;
}

function createPieChart(data, title, elementId) {
  // Check if Plotly is available
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

  // Remove existing classes first
  element.classList.remove("positive-income", "negative-income");

  // Add appropriate class based on value
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
      maximationFractionDigits: 2,
    })}`;
  }
}

function showCandidate(candidate) {
  const kamalaCandidate = document.getElementById("kamalaCandidate");
  const trumpCandidate = document.getElementById("trumpCandidate");

  if (kamalaCandidate && trumpCandidate) {
    kamalaCandidate.style.display = candidate === "kamala" ? "block" : "none";
    trumpCandidate.style.display = candidate === "trump" ? "block" : "none";

    // Force reflow to fix layout shift issue on mobile
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
  const candidateTabs = document.querySelector(".tabs");
  if (candidateTabs) {
    candidateTabs.scrollIntoView({ behavior: "smooth" });
  }
}

// Add event listener when the document is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Add click event listener to calculate button
  const calculateButton = document.querySelector("button");
  if (calculateButton) {
    calculateButton.addEventListener("click", calculateImpact);
  }
});

function calculateImpact() {
  try {
    const demographics = {
      income: parseFloat(document.getElementById("income").value) || 0,
      capitalGains:
        parseFloat(document.getElementById("capitalGains").value) || 0,
      dividends: parseFloat(document.getElementById("dividends").value) || 0,
      age: parseInt(document.getElementById("age").value) || 0,
      dependents: parseInt(document.getElementById("dependents").value) || 0,
      dependentsCollege:
        parseInt(document.getElementById("dependentsCollege").value) || 0,
      firstTimeHomebuyer:
        document.getElementById("firstTimeHomebuyer").checked || false,
      isStartup: document.getElementById("isStartup").checked || false,
      tips: document.getElementById("tips").checked || false,
      overtime: document.getElementById("overtime").checked || false,
    };

    const kamalaImpact = kamalaHarrisPolicy(demographics);
    const trumpImpact = donaldTrumpPolicy(demographics);

    updateImpactDisplay("kamalaImpact", kamalaImpact);
    updateImpactDisplay("trumpImpact", trumpImpact);

    const kamalaPieData = [
      {
        label: "Income Tax Savings",
        value: kamalaImpact > 0 ? kamalaImpact : 0,
        color: "green",
      },
      {
        label: "Income Tax Increase",
        value: kamalaImpact < 0 ? -kamalaImpact : 0,
        color: "#c10013",
      },
      {
        label: "First-Time Homebuyer Credit",
        value: demographics.firstTimeHomebuyer ? 6250 : 0,
        color: "orange",
      },
      {
        label: "Child Tax Credit",
        value:
          demographics.dependents * 3000 +
          demographics.dependentsCollege * 6000,
        color: "lightgreen",
      },
      {
        label: "Social Security",
        value: demographics.age >= 65 ? 1500 : 0,
        color: "blue",
      },
    ];

    const trumpPieData = [
      {
        label: "Income Tax Savings",
        value: trumpImpact > 0 ? trumpImpact : 0,
        color: "green",
      },
      {
        label: "Income Tax Increase",
        value: trumpImpact < 0 ? -trumpImpact : 0,
        color: "red",
      },
      {
        label: "Social Security",
        value: demographics.age >= 65 ? 1500 : 0,
        color: "blue",
      },
      {
        label: "Overtime Exemption",
        value: demographics.overtime ? 200 : 0,
        color: "lightblue",
      },
    ];

    createPieChart(kamalaPieData, "Kamala Harris", "kamalaChart");
    createPieChart(trumpPieData, "Donald Trump", "trumpChart");

    scrollToResults(); // Scroll to the results section after calculation
  } catch (error) {
    console.error("Error in calculateImpact:", error);
  }
}

function switchCandidate(candidate) {
  // Update tab buttons
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  const activeBtn = document.querySelector(
    `.tab-btn[onclick="switchCandidate('${candidate}')"]`
  );
  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  // Update candidate displays
  document.querySelectorAll(".candidate").forEach((el) => {
    el.classList.remove("active");
  });

  const activeCandidate = document.getElementById(`${candidate}Candidate`);
  if (activeCandidate) {
    activeCandidate.classList.add("active");
  }

  // Resize charts
  if (candidate === "kamala") {
    Plotly.Plots.resize("kamalaChart");
  } else {
    Plotly.Plots.resize("trumpChart");
  }
}

// When the page loads, show Kamala's card by default on mobile
document.addEventListener("DOMContentLoaded", function () {
  const calculateButton = document.querySelector("button");
  if (calculateButton) {
    calculateButton.addEventListener("click", calculateImpact);
  }

  // Initialize the first candidate as active on mobile
  switchCandidate("kamala");
});

document.getElementById("menu-toggle").addEventListener("click", function () {
  document.getElementById("menu").classList.toggle("show");
});
