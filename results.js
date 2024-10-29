// President object with support for each question
const presidents = {
  kamalaHarris: {
    name: "Kamala Harris",
    party: "Democrat",
    positions: {
      abortionrights: true,
      lgbtqrights: true,
      votingrights: true,
      crimepunishment: false,
      guncontrol: true,
      healthcare: true,
      incomeinequality: true,
      immigration: true,
      minimumwage: true,
      foreignpolicy: true,
      tradepolicy: false,
      militaryspending: false,
    },
  },
  donaldTrump: {
    name: "Donald Trump",
    party: "Republican",
    positions: {
      abortionrights: false,
      lgbtqrights: false,
      votingrights: false,
      crimepunishment: true,
      guncontrol: false,
      healthcare: false,
      incomeinequality: false,
      immigration: false,
      minimumwage: false,
      foreignpolicy: false,
      tradepolicy: true,
      militaryspending: true,
    },
  },
};

document.addEventListener("DOMContentLoaded", () => {
  // Retrieve userAnswers from localStorage
  const userAnswers = JSON.parse(localStorage.getItem("userAnswers"));

  // handle the animation
  const presidentSection = document.querySelector(".president-section");
  if (presidentSection) {
    presidentSection.classList.add("animate");
  }

  setIndicatorColors(userAnswers);
});

function toggleDetails(element) {
  const details = element.querySelector(".details");
  const arrow = element.querySelector(".toggle-arrow");

  if (element.classList.contains("expanded")) {
    // Collapse
    const currentHeight = details.scrollHeight;
    details.style.height = currentHeight + "px";

    // Ugly hotfix
    details.offsetHeight;

    details.style.height = "0";
    element.classList.remove("expanded");
    arrow.style.transform = "rotate(0deg)";

    details.addEventListener(
      "transitionend",
      function handler() {
        details.style.height = "";
        details.removeEventListener("transitionend", handler);
      },
      { once: true }
    );
  } else {
    // Expand
    element.classList.add("expanded");
    const height = details.scrollHeight;
    details.style.height = "0";

    // Ugly hotfix
    details.offsetHeight;

    details.style.height = height + "px";
    arrow.style.transform = "rotate(180deg)";

    details.addEventListener(
      "transitionend",
      function handler() {
        if (element.classList.contains("expanded")) {
          details.style.height = "auto";
        }
        details.removeEventListener("transitionend", handler);
      },
      { once: true }
    );
  }
}

// set the indicator color based on the president's support for the issue
function setIndicatorColors(userAnswers) {
  // Process Kamala Harris' questions
  const kamalaQuestions = document.querySelectorAll(
    ".candidate-card:first-child .question"
  );
  kamalaQuestions.forEach((question) => {
    const issue = question
      .querySelector("p")
      .textContent.trim()
      .toLowerCase()
      .replace(/\s/g, "");

    const userAnswer = userAnswers.find((answer) => answer.tag === issue);

    if (!userAnswer) return; // Skip if no matching answer found

    const presidentPosition = presidents.kamalaHarris.positions[issue];
    const indicator = question.querySelector(".indicator");

    // New logic for setting indicator
    if (
      (userAnswer.answer <= 3 && !presidentPosition) ||
      (userAnswer.answer >= 3 && presidentPosition)
    ) {
      indicator.classList.add("green");
    } else {
      indicator.classList.add("red");
    }
  });

  // Process Donald Trump's questions
  const trumpQuestions = document.querySelectorAll(
    ".candidate-card:nth-child(2) .question"
  );
  trumpQuestions.forEach((question) => {
    const issue = question
      .querySelector("p")
      .textContent.trim()
      .toLowerCase()
      .replace(/\s/g, "");

    const userAnswer = userAnswers.find((answer) => answer.tag === issue);

    if (!userAnswer) return; // Skip if no matching answer found

    const presidentPosition = presidents.donaldTrump.positions[issue];
    const indicator = question.querySelector(".indicator");

    // New logic for setting indicator
    if (
      (userAnswer.answer <= 3 && presidentPosition === false) ||
      (userAnswer.answer >= 3 && presidentPosition === true)
    ) {
      indicator.classList.add("green");
    } else {
      indicator.classList.add("red");
    }
  });
}
