/* ============================================
   PATRIO — Wizard Logic
   ============================================ */

const PAGU_WHATSAPP = '528444849359';

/* ---- Wizard Type Detection ---- */
const tipoParam = new URLSearchParams(window.location.search).get('tipo');
const WIZARD_TYPE = tipoParam === 'jardineria' ? 'jardines'
                  : tipoParam === 'administracion' ? 'administracion'
                  : 'inversion';

/* ============================================
   INVESTMENT WIZARD DATA
   ============================================ */

const PROJECT_DATA = {
  multifamiliar:  { name: 'Multifamiliar',               capRate: 0.13,  appreciation: 0.06 },
  casa_renovada:  { name: 'Casa renovada en estudios',    capRate: 0.17,  appreciation: 0.05 },
  local_comercial:{ name: 'Local comercial',              capRate: 0.11,  appreciation: 0.05 },
  bodega:         { name: 'Bodega o nave pequeña',        capRate: 0.115, appreciation: 0.06 },
  recomendado:    { name: 'Recomendado',                  capRate: 0.14,  appreciation: 0.055 }
};

const CREDIT_DATA = {
  hipotecario: { rate: 0.115, months: 180 },
  puente:      { rate: 0.14,  months: 18  },
  personal:    { rate: 0.165, months: 60  }
};

const CITY_NAMES = {
  monterrey: 'Monterrey',
  saltillo:  'Saltillo'
};

const HELP_LABELS = {
  buscar_propiedad:    'Buscar la propiedad ideal',
  supervisar_obra:     'Supervisar mi obra',
  administrar_inmueble:'Administrar mi inmueble',
  mas_info:            'Solo quiero más información'
};

/* ============================================
   JARDINES WIZARD DATA
   ============================================ */

const JARDINES_DATA = {
  jardin_casa: {
    grande:  { inversion: 100000, plusvalia: 12, tiempo: '4-5 semanas' },
    mediano: { inversion: 40000,  plusvalia: 10, tiempo: '3-4 semanas' },
    pequeno: { inversion: 8000,   plusvalia: 6,  tiempo: '1-2 semanas' }
  },
  departamento: {
    grande:  { inversion: 15000, plusvalia: 3,  tiempo: '1-2 semanas' },
    mediano: { inversion: 12000, plusvalia: 6,  tiempo: '1-2 semanas' },
    pequeno: { inversion: 6000,  plusvalia: 10, tiempo: '1-2 semanas' }
  },
  terreno: {
    grande:  { inversion: 100000, plusvalia: 15, tiempo: '4-5 semanas' },
    mediano: { inversion: 40000,  plusvalia: 13, tiempo: '3-4 semanas' },
    pequeno: { inversion: 15000,  plusvalia: 12, tiempo: '1-2 semanas' }
  }
};

const JARDINES_ESPACIO_MAP = {
  jardin_patio:  'jardin_casa',
  terraza_balcon: 'departamento',
  terreno:       'terreno',
  abandonado:    'jardin_casa'
};

const JARDINES_ESPACIO_LABELS = {
  jardin_patio:  'Jardín en casa',
  terraza_balcon: 'Terraza o balcón',
  terreno:       'Terreno sin construir',
  abandonado:    'Espacio abandonado'
};

const JARDINES_TAMANO_LABELS = {
  pequeno: 'Pequeño (-20 m²)',
  mediano: 'Mediano (20-60 m²)',
  grande:  'Grande (+60 m²)'
};

const JARDINES_OBJETIVO_LABELS = {
  vender:         'Vender y maximizar precio',
  renta:          'Cobrar más renta',
  disfrutar:      'Mejorar calidad de vida',
  terreno_sin_uso:'Terreno sin uso'
};

const JARDINES_INSIGHTS = {
  vender: 'Un jardín bien diseñado es lo primero que ve un comprador. En propiedades de Monterrey y Saltillo, ese porcentaje puede representar decenas de miles de pesos adicionales al momento de cerrar la venta.',
  renta: 'Los inquilinos pagan más por espacios que se sienten cuidados. Un jardín en buen estado puede justificar entre $500 y $1,500 pesos más de renta cada mes.',
  disfrutar: 'No necesitas gastar una fortuna para transformar tu espacio. Con la inversión estimada puedes tener un jardín que uses y disfrutes todo el año.',
  terreno_sin_uso: 'Un terreno bien presentado se vende más rápido y a mejor precio. El paisajismo básico es la inversión con mejor retorno antes de poner a trabajar ese activo.'
};

/* ============================================
   ADMIN WIZARD DATA
   ============================================ */

const ADMIN_RENTA_DATA = {
  depto_estudio:     { renta: 12000,  ocupancia: 0.95 },
  casa_habitacion:   { renta: 16000,  ocupancia: 0.95 },
  local_comercial:   { renta: 12000,  ocupancia: 0.75 },
  nave_bodega:       { renta: 100000, ocupancia: 0.80 },
  mixto:             { renta: 15000,  ocupancia: 0.80 },
  parque_industrial: { renta: 15000,  ocupancia: 0.80 }
};

const ADMIN_UNIDADES_MAP = {
  '1-4': 2.5, '5-10': 7.5, '11-20': 15, '20+': 25
};

const ADMIN_TIPO_LABELS = {
  depto_estudio:     'Departamentos o estudios',
  casa_habitacion:   'Casa habitación',
  local_comercial:   'Locales comerciales',
  mixto:             'Desarrollo mixto',
  nave_bodega:       'Naves o bodegas',
  parque_industrial: 'Parque industrial'
};

const ADMIN_UNIDADES_LABELS = {
  '1-4': '1–4 unidades', '5-10': '5–10 unidades', '11-20': '11–20 unidades', '20+': 'Más de 20 unidades'
};

/* ---- State ---- */
const wizardState = {
  currentStep: WIZARD_TYPE === 'jardines' ? 0 : 1,
  totalSteps: WIZARD_TYPE === 'administracion' ? 5 : 8,
  answers: {},
  photoFile: null
};

/* ============================================
   INIT
   ============================================ */
function initWizard() {
  // Remove steps from the other wizard type
  document.querySelectorAll('.wizard__step').forEach(step => {
    if (step.dataset.wizard && step.dataset.wizard !== WIZARD_TYPE) {
      step.remove();
    }
  });

  // Update page title
  if (WIZARD_TYPE === 'jardines') {
    document.title = 'Patrio — Jardines & Paisajismo';
  } else if (WIZARD_TYPE === 'administracion') {
    document.title = 'Patrio — Administración de rentas';
  }

  setupOptionCards();
  setupBackButtons();
  setupNextButtons();

  if (WIZARD_TYPE === 'inversion') {
    setupCapitalInputs();
    setupCreditToggle();
    setupCreditCards();
  }

  if (WIZARD_TYPE === 'jardines') {
    setupPhotoUpload();
  }

  if (WIZARD_TYPE === 'administracion') {
    setupAdminIngresoToggle();
    setupAdminIngresoInput();
    setupAdminContactForm();
  }

  setupTooltips();
  setupContactForm();
  showStep(wizardState.currentStep);
}

/* ============================================
   STEP NAVIGATION
   ============================================ */
function showStep(n) {
  wizardState.currentStep = n;

  // Hide all steps, show the target
  document.querySelectorAll('.wizard__step').forEach(el => {
    el.classList.remove('active');
  });

  const target = document.querySelector(`.wizard__step[data-step="${n}"]`);
  if (!target) return;
  target.classList.add('active');

  // Re-trigger fade-in-up animations inside the new step
  target.querySelectorAll('.fade-in-up').forEach(el => {
    el.classList.remove('fade-in-up');
    void el.offsetHeight; // force reflow
    el.classList.add('fade-in-up');
  });

  // Update header
  updateProgressBar();
  updateStepLabel();

  // Update next-button enabled state for this step
  refreshNextButton(n);

  // Pre-fill results
  if (WIZARD_TYPE === 'inversion' && n === 6) populateResults();
  if (WIZARD_TYPE === 'jardines' && n === 7) populateJardinesResults();
  if (WIZARD_TYPE === 'administracion' && n === 5) populateAdminResults();

  // Pre-fill contact fields
  if (WIZARD_TYPE === 'inversion' && n === 8) populateContactAutofill();
  if (WIZARD_TYPE === 'jardines' && n === 8) populateJardinesContactAutofill();
  if (WIZARD_TYPE === 'administracion' && n === 5) populateAdminContactAutofill();

  // Re-render lucide icons (for dynamically shown elements)
  if (window.lucide) lucide.createIcons();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goNext() {
  if (wizardState.currentStep < wizardState.totalSteps) {
    if (WIZARD_TYPE === 'inversion') captureStep5Data();

    // Admin step 1: "construir" redirects to investment wizard
    if (WIZARD_TYPE === 'administracion' && wizardState.currentStep === 1 && wizardState.answers.step1 === 'construir') {
      window.location.href = 'wizard.html';
      return;
    }

    showStep(wizardState.currentStep + 1);
  }
}

function goBack() {
  const minStep = WIZARD_TYPE === 'jardines' ? 0 : 1;
  if (wizardState.currentStep > minStep) {
    showStep(wizardState.currentStep - 1);
  }
}

/* ============================================
   PROGRESS BAR & LABEL
   ============================================ */
function updateProgressBar() {
  const fill = document.querySelector('.progress-bar__fill');
  if (!fill) return;

  if (WIZARD_TYPE === 'jardines' && wizardState.currentStep === 0) {
    fill.style.width = '0%';
  } else {
    fill.style.width = `${(wizardState.currentStep / wizardState.totalSteps) * 100}%`;
  }
}

function updateStepLabel() {
  const label = document.querySelector('.wizard__step-label');
  if (!label) return;

  if (WIZARD_TYPE === 'jardines' && wizardState.currentStep === 0) {
    label.textContent = '';
  } else {
    label.textContent = `Paso ${wizardState.currentStep} de ${wizardState.totalSteps}`;
  }
}

/* ============================================
   OPTION CARDS  (scoped per step)
   ============================================ */
function setupOptionCards() {
  document.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => {
      const step = card.closest('.wizard__step');
      const field = card.dataset.field; // e.g. "credito", "ayuda"
      const stepNum = step ? step.dataset.step : null;

      // Determine the group: either by data-field or by step
      let group;
      if (field) {
        group = step.querySelectorAll(`.option-card[data-field="${field}"]`);
      } else {
        // All option-cards in this step that DON'T have a data-field
        group = step.querySelectorAll('.option-card:not([data-field])');
      }

      // Deselect siblings
      group.forEach(c => c.classList.remove('selected'));

      // Select this card
      card.classList.add('selected');

      // Store answer
      const value = card.dataset.value;
      if (field) {
        wizardState.answers[field] = value;
      } else if (stepNum) {
        wizardState.answers[`step${stepNum}`] = value;
      }

      // Enable/disable next button
      refreshNextButton(parseInt(stepNum, 10));

      // Special: credit toggle (investment wizard)
      if (field === 'credito') handleCreditToggle(value);

      // Special: step 8 help → update hidden input (investment wizard)
      if (field === 'ayuda') {
        const inp = document.getElementById('ayuda-input');
        if (inp) inp.value = HELP_LABELS[value] || value;
        refreshSubmitButton();
      }
    });
  });
}

/* ============================================
   NEXT / BACK BUTTONS
   ============================================ */
function setupNextButtons() {
  document.querySelectorAll('.wizard__next-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!btn.disabled) goNext();
    });
  });
}

function setupBackButtons() {
  document.querySelectorAll('.wizard__back-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      goBack();
    });
  });
}

/** Decide whether the next button for this step should be enabled. */
function refreshNextButton(stepNum) {
  const step = document.querySelector(`.wizard__step[data-step="${stepNum}"]`);
  if (!step) return;

  const nextBtn = step.querySelector('.wizard__next-btn');
  if (!nextBtn) return;

  let enabled = false;

  if (WIZARD_TYPE === 'jardines') {
    if (stepNum === 0) {
      enabled = true;
    } else if (stepNum >= 1 && stepNum <= 5) {
      enabled = !!step.querySelector('.option-card:not([data-field]).selected');
    } else if (stepNum === 6 || stepNum === 7) {
      enabled = true;
    }
  } else if (WIZARD_TYPE === 'administracion') {
    if (stepNum === 1 || stepNum === 2) {
      enabled = !!step.querySelector('.option-card:not([data-field]).selected');
    } else if (stepNum === 3) {
      // Both ciudad AND unidades must be selected
      const hasCiudad = !!step.querySelector('.option-card[data-field="ciudad"].selected');
      const hasUnidades = !!step.querySelector('.option-card[data-field="unidades"].selected');
      enabled = hasCiudad && hasUnidades;
    } else if (stepNum === 4) {
      const conoce = wizardState.answers.conoce_ingreso;
      if (conoce === 'no') {
        enabled = true;
      } else if (conoce === 'si') {
        enabled = parseNumber(document.getElementById('admin-ingreso')?.value) > 0;
      }
    }
  } else {
    // Investment wizard
    if (stepNum >= 1 && stepNum <= 4) {
      enabled = !!step.querySelector('.option-card:not([data-field]).selected');
    } else if (stepNum === 5) {
      enabled = isStep5Valid();
    } else if (stepNum === 6 || stepNum === 7) {
      enabled = true;
    }
  }

  nextBtn.disabled = !enabled;
}

/* ============================================
   CAPITAL INPUTS (formatting) — Investment only
   ============================================ */
function setupCapitalInputs() {
  ['capital', 'credito-monto'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener('input', () => {
      // Strip non-digits
      let raw = input.value.replace(/[^0-9]/g, '');
      if (raw) {
        input.value = Number(raw).toLocaleString('en-US');
      }
      refreshNextButton(5);
    });
  });
}

function parseNumber(str) {
  if (!str) return 0;
  return parseInt(str.replace(/[^0-9]/g, ''), 10) || 0;
}

function isStep5Valid() {
  const capital = parseNumber(document.getElementById('capital')?.value);
  return capital > 0;
}

function captureStep5Data() {
  if (wizardState.currentStep !== 5) return;
  wizardState.answers.capital = parseNumber(document.getElementById('capital')?.value);
  wizardState.answers.creditoMonto = parseNumber(document.getElementById('credito-monto')?.value);
}

/* ============================================
   CREDIT TOGGLE — Investment only
   ============================================ */
function setupCreditToggle() {
  // Initial state is handled by card click → handleCreditToggle
}

function handleCreditToggle(value) {
  const typesGroup = document.querySelector('.credit-types-group');
  const amountGroup = document.querySelector('.credit-amount-group');

  if (value === 'si') {
    if (typesGroup) typesGroup.style.display = '';
    if (amountGroup) amountGroup.style.display = '';
  } else {
    if (typesGroup) typesGroup.style.display = 'none';
    if (amountGroup) amountGroup.style.display = 'none';
    // Clear credit selections
    document.querySelectorAll('.credit-card').forEach(c => c.classList.remove('selected'));
    wizardState.answers.creditoTipo = null;
    const creditoMontoInput = document.getElementById('credito-monto');
    if (creditoMontoInput) creditoMontoInput.value = '';
    wizardState.answers.creditoMonto = 0;
  }

  // Re-render lucide icons for newly visible elements
  if (window.lucide) lucide.createIcons();
  refreshNextButton(5);
}

/* ============================================
   CREDIT CARDS (type selection) — Investment only
   ============================================ */
function setupCreditCards() {
  document.querySelectorAll('.credit-card').forEach(card => {
    card.addEventListener('click', () => {
      // Deselect all
      document.querySelectorAll('.credit-card').forEach(c => c.classList.remove('selected'));
      // Select this one
      card.classList.add('selected');
      wizardState.answers.creditoTipo = card.dataset.value;
    });
  });
}

/* ============================================
   TOOLTIPS
   ============================================ */
function setupTooltips() {
  document.querySelectorAll('.tooltip-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const metric = trigger.closest('.results-metric, .results-patrimonio__label');
      if (!metric) return;

      const box = metric.querySelector ? metric.querySelector('.tooltip-box') || metric.closest('.results-metric')?.querySelector('.tooltip-box') : null;
      const tooltipBox = box || trigger.parentElement.parentElement.querySelector('.tooltip-box');
      if (!tooltipBox) return;

      // Toggle
      tooltipBox.classList.toggle('visible');
    });
  });
}

/* ============================================
   PHOTO UPLOAD — Jardines only
   ============================================ */
function setupPhotoUpload() {
  const dropzone = document.getElementById('photo-dropzone');
  const input = document.getElementById('photo-input');
  const preview = document.getElementById('photo-preview');
  const removeBtn = document.getElementById('photo-remove');

  if (!dropzone || !input) return;

  // Click to select
  dropzone.addEventListener('click', () => input.click());

  // Drag & drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('photo-upload__dropzone--dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('photo-upload__dropzone--dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('photo-upload__dropzone--dragover');
    if (e.dataTransfer.files.length) {
      handlePhotoFile(e.dataTransfer.files[0]);
    }
  });

  // File input change
  input.addEventListener('change', () => {
    if (input.files.length) {
      handlePhotoFile(input.files[0]);
    }
  });

  // Remove photo
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      wizardState.photoFile = null;
      if (preview) preview.style.display = 'none';
      if (dropzone) dropzone.style.display = '';
      input.value = '';

      // Reset next button text
      const step6 = document.querySelector('.wizard__step[data-step="6"]');
      const nextBtn = step6 ? step6.querySelector('.wizard__next-btn') : null;
      if (nextBtn) {
        nextBtn.innerHTML = 'Continuar sin foto <i data-lucide="arrow-right" style="width:18px;height:18px;"></i>';
        if (window.lucide) lucide.createIcons();
      }
    });
  }
}

function handlePhotoFile(file) {
  // Validate size (10 MB max)
  if (file.size > 10 * 1024 * 1024) {
    alert('El archivo es demasiado grande. Máximo 10 MB.');
    return;
  }

  wizardState.photoFile = file;

  const dropzone = document.getElementById('photo-dropzone');
  const preview = document.getElementById('photo-preview');
  const previewImg = document.getElementById('photo-preview-img');

  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    if (previewImg) previewImg.src = e.target.result;
    if (dropzone) dropzone.style.display = 'none';
    if (preview) preview.style.display = '';

    // Update next button text
    const step6 = document.querySelector('.wizard__step[data-step="6"]');
    const nextBtn = step6 ? step6.querySelector('.wizard__next-btn') : null;
    if (nextBtn) {
      nextBtn.innerHTML = 'Siguiente <i data-lucide="arrow-right" style="width:18px;height:18px;"></i>';
      if (window.lucide) lucide.createIcons();
    }
  };
  reader.readAsDataURL(file);
}

/* ============================================
   RESULTS CALCULATION — Investment (Step 6)
   ============================================ */
function populateResults() {
  const capital = wizardState.answers.capital || 0;
  const hasCredit = wizardState.answers.credito === 'si';
  const creditAmount = hasCredit ? (wizardState.answers.creditoMonto || 0) : 0;
  const creditType = hasCredit ? wizardState.answers.creditoTipo : null;
  const totalInvestment = capital + creditAmount;

  let projectKey = wizardState.answers.step4 || 'recomendado';
  const city = wizardState.answers.step3 || 'monterrey';

  // "Recomendado": pick best fit by capital
  if (projectKey === 'recomendado') {
    if (totalInvestment < 3000000) projectKey = 'casa_renovada';
    else if (totalInvestment < 5000000) projectKey = 'local_comercial';
    else projectKey = 'multifamiliar';
  }

  const project = PROJECT_DATA[projectKey];
  let capRate = project.capRate;

  // City adjustment
  if (city === 'saltillo') capRate *= 1.05;
  else capRate *= 0.97;

  const annualIncome = totalInvestment * capRate;
  const monthlyGross = annualIncome / 12;

  // Credit cost
  let monthlyCreditCost = 0;
  if (hasCredit && creditAmount > 0 && creditType && CREDIT_DATA[creditType]) {
    const c = CREDIT_DATA[creditType];
    const mr = c.rate / 12;
    monthlyCreditCost = creditAmount * (mr * Math.pow(1 + mr, c.months)) / (Math.pow(1 + mr, c.months) - 1);
  }

  const monthlyNet = Math.max(0, monthlyGross - monthlyCreditCost);
  const annualNet = monthlyNet * 12;

  // Payback
  const paybackYears = annualNet > 0 ? Math.round(totalInvestment / annualNet) : 99;

  // Patrimony at 10 years
  const patrimony10 = totalInvestment * Math.pow(1 + project.appreciation, 10);

  // Total return: cumulative rent + appreciation
  const totalReturn = (annualNet * 10) + (patrimony10 - totalInvestment);

  // Update DOM
  const cityName = CITY_NAMES[city] || city;
  const projectName = PROJECT_DATA[projectKey].name;

  setText('results-subtitle', `Tu proyecto en ${cityName}`);
  setText('results-project-type', projectName);
  setText('results-monthly-income', formatCurrency(monthlyNet));
  setText('results-cap-rate', `${(capRate * 100).toFixed(1)}%`);
  setText('results-payback', `${paybackYears} años`);
  setText('results-total-return', formatCurrencyShort(totalReturn));
  setText('results-patrimonio-value', `${formatCurrencyShort(patrimony10)} estimados a 10 años`);

  // Store for form
  wizardState.computed = {
    monthlyIncome: monthlyNet,
    capRate: capRate,
    totalInvestment: totalInvestment,
    projectName: projectName,
    cityName: cityName
  };
}

/* ============================================
   RESULTS CALCULATION — Jardines (Step 7)
   ============================================ */
function populateJardinesResults() {
  const espacioKey = wizardState.answers.step1;
  const objetivo = wizardState.answers.step2;
  const ciudad = wizardState.answers.step3;
  const tamano = wizardState.answers.step5;

  const tipoKey = JARDINES_ESPACIO_MAP[espacioKey] || 'jardin_casa';
  const data = (JARDINES_DATA[tipoKey] && JARDINES_DATA[tipoKey][tamano])
    ? JARDINES_DATA[tipoKey][tamano]
    : JARDINES_DATA.jardin_casa.mediano;

  const cityName = CITY_NAMES[ciudad] || 'Monterrey';
  const espacioLabel = JARDINES_ESPACIO_LABELS[espacioKey] || 'Espacio exterior';
  const tamanoLabel = JARDINES_TAMANO_LABELS[tamano] || 'Mediano';

  setText('jardines-results-subtitle', `Tu proyecto en ${cityName}`);
  setText('jardines-results-label', `${espacioLabel} · ${tamanoLabel}`);
  setText('jardines-results-inversion', formatCurrency(data.inversion));
  setText('jardines-results-plusvalia', `+${data.plusvalia}%`);
  setText('jardines-results-tiempo', data.tiempo);

  // Contextual insight
  const insight = JARDINES_INSIGHTS[objetivo] || '';
  const insightEl = document.getElementById('jardines-results-insight');
  if (insightEl) {
    const p = insightEl.querySelector('p');
    if (p) p.textContent = insight;
  }

  // Store for contact autofill
  wizardState.jardinesComputed = {
    inversion: data.inversion,
    plusvalia: data.plusvalia,
    tiempo: data.tiempo,
    cityName: cityName,
    espacioLabel: espacioLabel,
    tamanoLabel: tamanoLabel
  };
}

/* ============================================
   CONTACT AUTOFILL — Investment (Step 8)
   ============================================ */
function populateContactAutofill() {
  const city = wizardState.answers.step3;
  const project = wizardState.answers.step4;
  const capital = wizardState.answers.capital || 0;
  const credit = wizardState.answers.credito === 'si' ? (wizardState.answers.creditoMonto || 0) : 0;
  const totalCapital = capital + credit;

  const cityName = CITY_NAMES[city] || '—';
  const projectName = project ? (PROJECT_DATA[project]?.name || project) : '—';
  const capitalStr = totalCapital > 0 ? formatCurrency(totalCapital) : '—';

  setText('autofill-ciudad', cityName);
  setText('autofill-proyecto', projectName);
  setText('autofill-capital', capitalStr);

  // Hidden inputs
  setVal('autofill-ciudad-input', cityName);
  setVal('autofill-proyecto-input', projectName);
  setVal('autofill-capital-input', capitalStr);

  // Additional hidden fields
  setVal('form-situacion', wizardState.answers.step1 || '');
  setVal('form-objetivo', wizardState.answers.step2 || '');
  setVal('form-ingreso', wizardState.computed ? formatCurrency(wizardState.computed.monthlyIncome) : '');
  setVal('form-caprate', wizardState.computed ? `${(wizardState.computed.capRate * 100).toFixed(1)}%` : '');
}

/* ============================================
   CONTACT AUTOFILL — Jardines (Step 8)
   ============================================ */
function populateJardinesContactAutofill() {
  const c = wizardState.jardinesComputed || {};
  const ciudad = c.cityName || '—';
  const espacio = c.espacioLabel || '—';
  const tamano = c.tamanoLabel || '—';

  setText('jardines-autofill-ciudad', ciudad);
  setText('jardines-autofill-espacio', espacio);
  setText('jardines-autofill-tamano', tamano);

  setVal('jardines-autofill-ciudad-input', ciudad);
  setVal('jardines-autofill-espacio-input', espacio);
  setVal('jardines-autofill-tamano-input', tamano);

  setVal('jardines-form-objetivo', JARDINES_OBJETIVO_LABELS[wizardState.answers.step2] || '');
  setVal('jardines-form-estado', wizardState.answers.step4 || '');
  setVal('jardines-form-inversion', c.inversion ? formatCurrency(c.inversion) : '');
  setVal('jardines-form-plusvalia', c.plusvalia ? `+${c.plusvalia}%` : '');
  setVal('jardines-form-foto', wizardState.photoFile ? 'Sí' : 'No');
}

/* ============================================
   CONTACT FORM
   ============================================ */
function setupContactForm() {
  if (WIZARD_TYPE === 'jardines') {
    setupJardinesContactForm();
    return;
  }
  if (WIZARD_TYPE === 'administracion') {
    // Admin contact form is handled in setupAdminContactForm()
    return;
  }

  // --- Investment contact form ---
  const form = document.getElementById('contact-form');
  if (!form) return;

  // Validate on input change
  ['contact-name', 'contact-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', refreshSubmitButton);
  });

  // Submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('.wizard__submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
    }

    const formData = new FormData(form);

    try {
      await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
    } catch (_) {
      // Formspree may fail silently; still show success
    }

    // Show success state
    form.style.display = 'none';
    const success = document.querySelector('.contact-success');
    if (success) {
      success.style.display = '';
      // Build WhatsApp link
      const name = document.getElementById('contact-name')?.value || '';
      const cityName = wizardState.computed?.cityName || '';
      const projectName = wizardState.computed?.projectName || '';
      const msg = `Hola, soy ${name}. Me interesa un proyecto de ${projectName} en ${cityName}. Acabo de completar mi análisis en Patrio y me gustaría más información.`;
      const waBtn = document.getElementById('whatsapp-btn');
      if (waBtn) {
        waBtn.href = `https://wa.me/${PAGU_WHATSAPP}?text=${encodeURIComponent(msg)}`;
      }

      if (window.lucide) lucide.createIcons();
    }
  });
}

function refreshSubmitButton() {
  const name = document.getElementById('contact-name')?.value.trim();
  const phone = document.getElementById('contact-phone')?.value.trim();
  const btn = document.querySelector('#contact-form .wizard__submit-btn');
  if (btn) {
    btn.disabled = !(name && phone);
  }
}

/* ============================================
   CONTACT FORM — Jardines
   ============================================ */
function setupJardinesContactForm() {
  const form = document.getElementById('jardines-contact-form');
  if (!form) return;

  // Validate on input change
  ['jardines-contact-name', 'jardines-contact-email', 'jardines-contact-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', refreshJardinesSubmitButton);
  });

  // Submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('.wizard__submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
    }

    const formData = new FormData(form);

    // Attach photo if present
    if (wizardState.photoFile) {
      formData.append('foto', wizardState.photoFile);
    }

    try {
      await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
    } catch (_) {
      // Formspree may fail silently; still show success
    }

    // Show success state
    form.style.display = 'none';
    const success = form.closest('.wizard__step').querySelector('.contact-success');
    if (success) {
      success.style.display = '';

      // Build WhatsApp message
      const name = document.getElementById('jardines-contact-name')?.value || '';
      const c = wizardState.jardinesComputed || {};
      const objetivo = JARDINES_OBJETIVO_LABELS[wizardState.answers.step2] || '';
      const espacioLabel = c.espacioLabel || '';
      const tamanoLabel = c.tamanoLabel || '';
      const cityName = c.cityName || '';
      const hasPhoto = wizardState.photoFile ? '\nYa subí una foto de mi espacio en el formulario.' : '';

      const msg = `Hola PATRIO, acabo de usar la herramienta de jardines.\nMi nombre es ${name}.\nTengo ${espacioLabel} ${tamanoLabel} en ${cityName}.\nMi objetivo es: ${objetivo}.${hasPhoto}\nMe gustaría recibir una propuesta.`;

      const waBtn = document.getElementById('jardines-whatsapp-btn');
      if (waBtn) {
        waBtn.href = `https://wa.me/${PAGU_WHATSAPP}?text=${encodeURIComponent(msg)}`;
      }

      if (window.lucide) lucide.createIcons();
    }
  });
}

function refreshJardinesSubmitButton() {
  const name = document.getElementById('jardines-contact-name')?.value.trim();
  const email = document.getElementById('jardines-contact-email')?.value.trim();
  const phone = document.getElementById('jardines-contact-phone')?.value.trim();
  const btn = document.querySelector('#jardines-contact-form .wizard__submit-btn');
  if (btn) {
    btn.disabled = !(name && email && phone);
  }
}

/* ============================================
   ADMIN WIZARD — Ingreso Toggle & Input
   ============================================ */
function setupAdminIngresoToggle() {
  // Listen for conoce_ingreso card selection to show/hide input
  document.querySelectorAll('.option-card[data-field="conoce_ingreso"]').forEach(card => {
    card.addEventListener('click', () => {
      const group = document.querySelector('.admin-ingreso-group');
      if (!group) return;
      if (card.dataset.value === 'si') {
        group.style.display = '';
      } else {
        group.style.display = 'none';
        const input = document.getElementById('admin-ingreso');
        if (input) input.value = '';
      }
      refreshNextButton(4);
    });
  });
}

function setupAdminIngresoInput() {
  const input = document.getElementById('admin-ingreso');
  if (!input) return;
  input.addEventListener('input', () => {
    let raw = input.value.replace(/[^0-9]/g, '');
    if (raw) {
      input.value = Number(raw).toLocaleString('en-US');
    }
    refreshNextButton(4);
  });
}

/* ============================================
   ADMIN WIZARD — Results (Step 5)
   ============================================ */
function populateAdminResults() {
  const tipoPropiedad = wizardState.answers.step2;
  const ciudad = wizardState.answers.ciudad || 'monterrey';
  const unidades = wizardState.answers.unidades || '1-4';
  const conoce = wizardState.answers.conoce_ingreso;

  let ingresoBruto = 0;
  let esEstimado = false;

  if (conoce === 'si') {
    ingresoBruto = parseNumber(document.getElementById('admin-ingreso')?.value);
  } else {
    // Estimate from data
    const data = ADMIN_RENTA_DATA[tipoPropiedad] || ADMIN_RENTA_DATA.depto_estudio;
    const numUnidades = ADMIN_UNIDADES_MAP[unidades] || 2.5;
    ingresoBruto = Math.round(numUnidades * data.renta * data.ocupancia);
    esEstimado = true;
  }

  const ingresoNeto = Math.round(ingresoBruto * 0.90);
  const ingresoAnual = ingresoNeto * 12;

  setText('admin-ingreso-bruto', formatCurrency(ingresoBruto));
  setText('admin-ingreso-neto', formatCurrency(ingresoNeto));
  setText('admin-ingreso-anual', formatCurrency(ingresoAnual));

  // Show/hide estimation note
  const nota = document.getElementById('admin-estimacion-nota');
  if (nota) nota.style.display = esEstimado ? '' : 'none';

  wizardState.adminComputed = {
    ingresoBruto,
    ingresoNeto,
    ingresoAnual,
    esEstimado,
    tipoPropiedad,
    ciudad,
    unidades
  };
}

function populateAdminContactAutofill() {
  const c = wizardState.adminComputed || {};
  setVal('admin-form-tipo-propiedad', ADMIN_TIPO_LABELS[c.tipoPropiedad] || '');
  setVal('admin-form-ciudad', CITY_NAMES[c.ciudad] || '');
  setVal('admin-form-unidades', ADMIN_UNIDADES_LABELS[c.unidades] || '');
  setVal('admin-form-ingreso', c.ingresoBruto ? formatCurrency(c.ingresoBruto) : '');
}

/* ============================================
   ADMIN WIZARD — Contact Form
   ============================================ */
function setupAdminContactForm() {
  const form = document.getElementById('admin-contact-form');
  if (!form) return;

  ['admin-contact-name', 'admin-contact-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', refreshAdminSubmitButton);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('.wizard__submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando...';
    }

    const formData = new FormData(form);

    try {
      await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
    } catch (_) {}

    form.style.display = 'none';
    const success = form.closest('.wizard__step').querySelector('.contact-success');
    if (success) {
      success.style.display = '';

      const name = document.getElementById('admin-contact-name')?.value || '';
      const c = wizardState.adminComputed || {};
      const tipoLabel = ADMIN_TIPO_LABELS[c.tipoPropiedad] || '';
      const ciudadLabel = CITY_NAMES[c.ciudad] || '';
      const unidadesLabel = ADMIN_UNIDADES_LABELS[c.unidades] || '';
      const ingresoLabel = c.ingresoBruto ? formatCurrency(c.ingresoBruto) : '';

      const msg = `Hola PATRIO, soy ${name}. Me interesa que PATRIO administre mi propiedad.\nTipo: ${tipoLabel}\nCiudad: ${ciudadLabel}\nUnidades: ${unidadesLabel}\nIngreso mensual: ${ingresoLabel}`;

      const waBtn = document.getElementById('admin-whatsapp-btn');
      if (waBtn) {
        waBtn.href = `https://wa.me/${PAGU_WHATSAPP}?text=${encodeURIComponent(msg)}`;
      }

      if (window.lucide) lucide.createIcons();
    }
  });
}

function refreshAdminSubmitButton() {
  const name = document.getElementById('admin-contact-name')?.value.trim();
  const phone = document.getElementById('admin-contact-phone')?.value.trim();
  const btn = document.querySelector('#admin-contact-form .wizard__submit-btn');
  if (btn) {
    btn.disabled = !(name && phone);
  }
}

/* ============================================
   HELPERS
   ============================================ */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function formatCurrency(n) {
  if (!n || n <= 0) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatCurrencyShort(n) {
  if (!n || n <= 0) return '$0';
  if (n >= 1000000) {
    return '$' + (n / 1000000).toFixed(1) + 'M';
  }
  return '$' + Math.round(n).toLocaleString('en-US');
}

/* ============================================
   BOOT
   ============================================ */
document.addEventListener('DOMContentLoaded', initWizard);
