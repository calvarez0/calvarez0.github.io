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
    if (demographics.capitalGains > 1000000) {
        netIncomeImpact -= (demographics.capitalGains * (28 - 20)) / 100;
    }
    if (demographics.income > 400000) {
        netIncomeImpact -= (demographics.income * (5 - 3.8)) / 100;
    }
    if (demographics.income <= 400000) {
        netIncomeImpact += demographics.dependents * 3000;
        netIncomeImpact += demographics.dependentsCollege * 6000;
        if (demographics.income < 50000) {
            netIncomeImpact += 1000;
        }
    }
    netIncomeImpact += calculateMedicareSavings(demographics.age, demographics.healthNeeds);
    return netIncomeImpact;
}

function donaldTrumpPolicy(demographics) {
    let netIncomeImpact = demographics.dependents * 5000;
    if (demographics.income < 400000) {
        netIncomeImpact += 1000;
    }
    netIncomeImpact += calculateEnergySavings(demographics.energyUsage);
    return netIncomeImpact;
}

function createPieChart(data, title, elementId) {
    // Check if Plotly is available
    if (typeof Plotly === 'undefined') {
        console.error('Plotly is not loaded');
        return;
    }

    const labels = data.map(item => item.label);
    const values = data.map(item => item.value);
    const colors = data.map(item => item.color);

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

    Plotly.newPlot(elementId, [{
        type: "pie",
        labels: labels,
        values: values,
        marker: { colors: colors },
        hoverinfo: "label+value+percent",
        textinfo: "none",
    }], layout, config);
}

function updateImpactDisplay(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element with id ${elementId} not found`);
        return;
    }
    
    // Remove existing classes first
    element.classList.remove('positive-income', 'negative-income');
    
    // Add appropriate class based on value
    if (value >= 0) {
        element.classList.add('positive-income');
        element.textContent = `+$${Math.abs(value).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    } else {
        element.classList.add('negative-income');
        element.textContent = `-$${Math.abs(value).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximationFractionDigits: 2
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
document.addEventListener('DOMContentLoaded', function() {
    // Add click event listener to calculate button
    const calculateButton = document.querySelector('button');
    if (calculateButton) {
        calculateButton.addEventListener('click', calculateImpact);
    }
});

function calculateImpact() {
    try {
        const demographics = {
            income: parseFloat(document.getElementById("income").value) || 0,
            capitalGains: parseFloat(document.getElementById("capitalGains").value) || 0,
            dividends: parseFloat(document.getElementById("dividends").value) || 0,
            age: parseInt(document.getElementById("age").value) || 0,
            dependents: parseInt(document.getElementById("dependents").value) || 0,
            dependentsCollege: parseInt(document.getElementById("dependentsCollege").value) || 0,
            healthNeeds: document.getElementById("healthNeeds").value || "low",
            energyUsage: document.getElementById("energyUsage").value || "low",
        };

        const kamalaImpact = kamalaHarrisPolicy(demographics);
        const trumpImpact = donaldTrumpPolicy(demographics);

        updateImpactDisplay("kamalaImpact", kamalaImpact);
        updateImpactDisplay("trumpImpact", trumpImpact);

        const kamalaPieData = [
            { label: "Income Tax Savings", value: kamalaImpact > 0 ? kamalaImpact : 0, color: "green" },
            { label: "Income Tax Increase", value: kamalaImpact < 0 ? -kamalaImpact : 0, color: "#c10013" },
            { label: "Other Deductions", value: 2000, color: "lightgreen" },
            { label: "Social Security", value: 70, color: "blue" },
            { label: "Healthcare Savings", value: calculateMedicareSavings(demographics.age, demographics.healthNeeds), color: "lightblue" },
            { label: "Energy Savings", value: calculateEnergySavings(demographics.energyUsage), color: "skyblue" },
        ];

        const trumpPieData = [
            { label: "Income Tax Savings", value: trumpImpact > 0 ? trumpImpact : 0, color: "green" },
            { label: "Income Tax Increase", value: trumpImpact < 0 ? -trumpImpact : 0, color: "red" },
            { label: "Other Deductions", value: 1500, color: "lightgreen" },
            { label: "Social Security", value: 75, color: "blue" },
            { label: "Healthcare", value: 45, color: "lightblue" },
            { label: "Education", value: 35, color: "skyblue" },
        ];

        createPieChart(kamalaPieData, "Kamala Harris", "kamalaChart");
        createPieChart(trumpPieData, "Donald Trump", "trumpChart");

        scrollToResults(); // Scroll to the results section after calculation
    } catch (error) {
        console.error('Error in calculateImpact:', error);
    }
}

function switchCandidate(candidate) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchCandidate('${candidate}')"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    // Update candidate displays
    document.querySelectorAll('.candidate').forEach(el => {
        el.classList.remove('active');
    });

    const activeCandidate = document.getElementById(`${candidate}Candidate`);
    if (activeCandidate) {
        activeCandidate.classList.add('active');
    }

    // Resize charts
    if (candidate === 'kamala') {
        Plotly.Plots.resize('kamalaChart');
    } else {
        Plotly.Plots.resize('trumpChart');
    }
}

// When the page loads, show Kamala's card by default on mobile
document.addEventListener('DOMContentLoaded', function() {
    const calculateButton = document.querySelector('button');
    if (calculateButton) {
        calculateButton.addEventListener('click', calculateImpact);
    }
    
    // Initialize the first candidate as active on mobile
    switchCandidate('kamala');
});