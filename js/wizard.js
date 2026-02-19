/* ============================================
   PATRIO — Wizard Logic
   ============================================ */

const wizardState = {
  currentStep: 1,
  totalSteps: 8,
  answers: {}
};

function initWizard() {
  initOptionCards();
  updateProgressBar();
  updateStepLabel();
  initNextButton();
  animateStepContent();
}

function initOptionCards() {
  const cards = document.querySelectorAll('.option-card');

  cards.forEach(card => {
    card.addEventListener('click', () => {
      // Deselect all
      cards.forEach(c => {
        c.classList.remove('selected');
        const icon = c.querySelector('.option-card__check svg');
        if (icon) icon.style.display = 'none';
      });

      // Select clicked
      card.classList.add('selected');
      const checkIcon = card.querySelector('.option-card__check svg');
      if (checkIcon) checkIcon.style.display = 'block';

      const value = card.dataset.value;
      wizardState.answers[`step${wizardState.currentStep}`] = value;

      updateNextButton(true);
    });
  });
}

function updateProgressBar() {
  const fill = document.querySelector('.progress-bar__fill');
  if (!fill) return;

  const progress = (wizardState.currentStep / wizardState.totalSteps) * 100;
  fill.style.width = `${progress}%`;
}

function updateStepLabel() {
  const label = document.querySelector('.wizard__step-label');
  if (!label) return;

  label.textContent = `Paso ${wizardState.currentStep} de ${wizardState.totalSteps}`;
}

function initNextButton() {
  const btn = document.querySelector('.wizard__next-btn');
  if (!btn) return;

  btn.disabled = true;

  btn.addEventListener('click', () => {
    if (btn.disabled) return;

    // Step 1 only — log state for now
    console.log('Wizard state:', wizardState);
  });
}

function updateNextButton(enabled) {
  const btn = document.querySelector('.wizard__next-btn');
  if (!btn) return;

  btn.disabled = !enabled;
}

function animateStepContent() {
  const elements = document.querySelectorAll('.wizard__content .fade-in-up');
  elements.forEach((el, i) => {
    el.style.animationDelay = `${i * 80}ms`;
  });
}

document.addEventListener('DOMContentLoaded', initWizard);
