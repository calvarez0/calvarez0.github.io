let currentQuestionIndex = 0;
const questions = [
  {
    theme: "Individual Rights",
    tag: "abortionrights",
    question: "Abortion is a woman's unrestricted right.",
    answer: null,
  },
  {
    theme: "Individual Rights",
    tag: "lgbtqrights",
    question: "I support transgender and LGBTQ+ rights and protections.",
    answer: null,
  },
  {
    theme: "Individual Rights",
    tag: "votingrights",
    question:
      "Voting registration should be made easier for all eligible citizens.",
    answer: null,
  },
  {
    theme: "Domestic Issues",
    tag: "crimepunishment",
    question: "There should be stricter punishment for crimes.",
    answer: null,
  },
  {
    theme: "Domestic Issues",
    tag: "guncontrol",
    question: "There should be increased restrictions on gun ownership.",
    answer: null,
  },
  {
    theme: "Domestic Issues",
    tag: "healthcare",
    question:
      "The government should expand healthcare coverage like ObamaCare.",
    answer: null,
  },
  {
    theme: "Economic Issues",
    tag: "incomeinequality",
    question:
      "There should be higher taxes on the wealthy to reduce income inequality.",
    answer: null,
  },
  {
    theme: "Economic Issues",
    tag: "immigration",
    question:
      "There should be a pathway to citizenship for undocumented immigrants.",
    answer: null,
  },
  {
    theme: "Economic Issues",
    tag: "minimumwage",
    question:
      "I support increasing the federal minimum wage to match inflation.",
    answer: null,
  },
  {
    theme: "Defense and International Issues",
    tag: "foreignpolicy",
    question:
      "It is better for the U.S. to reduce involvement in foreign wars and conflicts.",
    answer: null,
  },
  {
    theme: "Defense and International Issues",
    tag: "tradepolicy",
    question:
      "The U.S. should focus on protecting domestic industries and limiting trade with China.",
    answer: null,
  },
  {
    theme: "Defense and International Issues",
    tag: "militaryspending",
    question:
      "I support strengthening the military to maintain peace and security.",
    answer: null,
  },
];

// Update UI based on the current question
function updateUI() {
  const themeElement = document.querySelector(".theme");
  const questionElement = document.querySelector(".question");
  const progressElement = document.querySelector(".progress");

  const currentQuestion = questions[currentQuestionIndex];

  // Update question content
  themeElement.textContent = currentQuestion.theme;
  questionElement.textContent = currentQuestion.question;

  // Update progress bar
  const progressWidth = (currentQuestionIndex / (questions.length - 1)) * 100;
  progressElement.style.width = progressWidth + "%";

  // Update buttons
  document.getElementById("previous").disabled = currentQuestionIndex === 0;
  document.getElementById("next").disabled =
    !questions[currentQuestionIndex].answer;

  // Reset selected answer
  const selectedAnswer = currentQuestion.answer;
  document.querySelectorAll('input[name="answer"]').forEach((input) => {
    input.checked = input.value == selectedAnswer;
  });

  if (currentQuestionIndex === questions.length - 1) {
    document.getElementById("next").textContent = "Submit";
  } else {
    document.getElementById("next").textContent = "Next";
  }
}

// Event listener for answer selection
document.querySelectorAll('input[name="answer"]').forEach((input) => {
  input.addEventListener("change", (event) => {
    questions[currentQuestionIndex].answer = event.target.value;
    document.getElementById("next").disabled = false;
  });
});

// Event listener for navigation buttons
document.getElementById("previous").addEventListener("click", () => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
    updateUI();
  }
});

document.getElementById("next").addEventListener("click", () => {
  if (currentQuestionIndex < questions.length - 1) {
    currentQuestionIndex++;
    updateUI();
  } else {
    console.log("Submit answers:", questions);
    localStorage.setItem("userAnswers", JSON.stringify(questions));
    window.location.href = "results.html"; // Assuming 'results.html' is the results page
    // Submit the answers or proceed to the next step
  }
});

// Initial UI update
updateUI();
