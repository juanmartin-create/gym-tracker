/* ============================================================
 * THRST — Training Log
 * PWA local-first: rutinas con prescripcion, progresion, timer,
 * e1RM/PRs, volumen semanal por musculo, chart de progreso,
 * peso corporal, notas. Sin backend, todo en localStorage.
 * ============================================================ */
(() => {
  "use strict";

  const STORE_KEY = "gymtracker:v3";
  const LEGACY_KEYS = ["gymtracker:v2", "gymtracker:v1"];
  const STEP = { weight: 2.5, reps: 1, rir: 1 };
  const LIMITS = { weight: [0, 1000], reps: [0, 100], rir: [0, 10] };

  const MUSCLES = [
    "Pecho", "Espalda", "Cuadriceps", "Femoral", "Gluteo",
    "Hombro", "Biceps", "Triceps", "Pantorrilla", "Core", "Otro"
  ];

  const MUSCLE_GUESS = [
    [/press.*banca|press.*plano|press.*inclin|fondo|apert/i, "Pecho"],
    [/dominad|jal[oó]n|remo|pullover|espalda/i, "Espalda"],
    [/sentadill|prensa|extensi[oó]n.*cua|hack|zancada|split.*squat/i, "Cuadriceps"],
    [/curl.*femoral|peso.*muerto.*rumano|rdl|isqui|nordic/i, "Femoral"],
    [/hip.*thrust|gluteo|puente/i, "Gluteo"],
    [/press.*militar|press.*hombro|elevaci[oó]n.*lateral|face.*pull|arnold/i, "Hombro"],
    [/curl.*bicep|martillo|predicador|concentr/i, "Biceps"],
    [/tricep|press.*franc|copa|extensi[oó]n.*tricep|jm.*press/i, "Triceps"],
    [/gemel|pantorrilla|calf/i, "Pantorrilla"],
    [/abdom|plancha|crunch|core|obliqu/i, "Core"],
  ];
  const guessMuscle = (name) => {
    for (const [re, m] of MUSCLE_GUESS) if (re.test(name)) return m;
    return "Otro";
  };

  // ---------- utilidades ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  const round1 = (v) => Math.round(v * 10) / 10;
  const round25 = (v) => Math.round(v / 2.5) * 2.5;

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  };
  const fmtShort = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  };
  const isSameDay = (iso, ref = new Date()) => {
    const d = new Date(iso);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
  };
  const startOfWeek = (ref = new Date()) => {
    const d = new Date(ref);
    const day = (d.getDay() + 6) % 7; // lunes = 0
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Epley 1RM = w * (1 + reps/30)
  const e1rm = (w, reps) => (reps <= 0 || w <= 0) ? 0 : w * (1 + reps / 30);

  // ---------- estado ----------
  let state = load();
  let view = { route: "hoy", params: {} };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    for (const key of LEGACY_KEYS) {
      try {
        const legacy = localStorage.getItem(key);
        if (legacy) return migrate(JSON.parse(legacy));
      } catch (e) { /* ignore */ }
    }
    return seed();
  }

  function fromLegacy(v1) {
    // v1 tenia routine.exercises: [{id,name,sets:N}] y session.entries[].sets:[{w,r,rir}]
    return {
      version: 2,
      routines: (v1.routines || []).map(r => ({
        id: r.id,
        name: r.name,
        exercises: (r.exercises || []).map(ex => ({
          id: ex.id,
          name: ex.name,
          muscle: guessMuscle(ex.name),
          targetSets: Array.from({ length: ex.sets || 3 }, () => ({ reps: 8, rir: 2 })),
        })),
      })),
      sessions: (v1.sessions || []).map(s => ({ ...s, notes: s.notes || "" })),
      bodyweight: [],
      settings: { restSec: 120 },
    };
  }

  function migrate(s) {
    if (!s.version || s.version < 2) s = fromLegacy(s);
    s.settings = s.settings || { restSec: 120 };
    s.bodyweight = s.bodyweight || [];
    for (const r of s.routines) {
      for (const ex of r.exercises) {
        if (!ex.muscle) ex.muscle = guessMuscle(ex.name);
      }
    }
    // v3: nutricion
    if (!s.version || s.version < 3) {
      s.profile = s.profile || null;
      s.targets = s.targets || null;
      s.foods = s.foods || seedFoods();
      s.meals = s.meals || [];
      s.version = 3;
    }
    // v4: rutina PPL definitiva (sin gluteo aislado ni abs) + rango de reps por ejercicio.
    // Reemplaza las rutinas; el historial de sesiones se conserva intacto.
    if (s.version < 4) {
      s.routines = seedRoutines();
      s.version = 4;
    }
    // asegurar shape v4 en cualquier rutina (por si quedo alguna con targetSets)
    for (const r of s.routines) {
      for (const ex of r.exercises) {
        if (ex.sets == null && ex.targetSets) {
          ex.sets = ex.targetSets.length;
          const reps = ex.targetSets.map(t => t.reps);
          ex.repsMin = Math.min(...reps);
          ex.repsMax = Math.max(...reps);
          delete ex.targetSets;
        }
        if (ex.sets == null) { ex.sets = 3; ex.repsMin = 8; ex.repsMax = 12; }
      }
    }
    return s;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn("No se pudo guardar", e); }
  }

  // Ejercicio: sets (cantidad) + rango de reps objetivo.
  // Declarada como function (hoisted) porque seed() corre antes de esta linea.
  function EX(name, muscle, sets, repsMin, repsMax) {
    return { id: uid(), name, muscle, sets, repsMin, repsMax };
  }

  function seedRoutines() {
    return [
      {
        id: uid(), name: "Push · Pecho Hombro Triceps",
        exercises: [
          EX("Press banca (barra)",            "Pecho",   4, 6, 8),
          EX("Press inclinado mancuernas",     "Pecho",   3, 8, 12),
          EX("Aperturas en polea",             "Pecho",   3, 12, 15),
          EX("Press militar (barra)",          "Hombro",  3, 6, 10),
          EX("Elevaciones laterales mancuerna","Hombro",  3, 12, 20),
          EX("Extension triceps polea",        "Triceps", 3, 10, 15),
          EX("Press frances",                  "Triceps", 3, 8, 12),
        ],
      },
      {
        id: uid(), name: "Pull · Espalda Posterior Biceps",
        exercises: [
          EX("Dominadas / Jalon al pecho",     "Espalda", 4, 6, 10),
          EX("Remo con barra",                 "Espalda", 3, 8, 10),
          EX("Remo sentado en polea",          "Espalda", 3, 10, 12),
          EX("Jalon brazo recto polea",        "Espalda", 3, 12, 20),
          EX("Face pull",                      "Hombro",  3, 15, 20),
          EX("Elevaciones laterales polea",    "Hombro",  3, 12, 20),
          EX("Curl con barra",                 "Biceps",  3, 8, 12),
          EX("Curl martillo",                  "Biceps",  3, 10, 15),
        ],
      },
      {
        id: uid(), name: "Piernas A · Cuadriceps",
        exercises: [
          EX("Sentadilla (barra)",             "Cuadriceps",  4, 6, 8),
          EX("Prensa",                         "Cuadriceps",  3, 10, 15),
          EX("Extension de cuadriceps",        "Cuadriceps",  3, 12, 20),
          EX("Curl femoral sentado",           "Femoral",     3, 10, 15),
          EX("Elevacion de gemelos",           "Pantorrilla", 3, 12, 20),
        ],
      },
      {
        id: uid(), name: "Piernas B · Isquios",
        exercises: [
          EX("Peso muerto rumano",             "Femoral",     4, 8, 10),
          EX("Hack squat (o prensa)",          "Cuadriceps",  3, 10, 15),
          EX("Extension de cuadriceps",        "Cuadriceps",  3, 12, 20),
          EX("Curl femoral acostado",          "Femoral",     3, 10, 15),
          EX("Elevacion de gemelos",           "Pantorrilla", 3, 15, 20),
        ],
      },
      {
        id: uid(), name: "Upper · Torso + Hombro",
        exercises: [
          EX("Press inclinado mancuernas",     "Pecho",   3, 8, 12),
          EX("Remo en maquina (T-bar)",        "Espalda", 3, 8, 12),
          EX("Jalon al pecho agarre neutro",   "Espalda", 3, 10, 12),
          EX("Press militar mancuernas",       "Hombro",  3, 8, 12),
          EX("Elevaciones laterales",          "Hombro",  3, 12, 20),
          EX("Pajaros en banco (mancuerna)",   "Hombro",  3, 15, 25),
        ],
      },
      {
        id: uid(), name: "Retoque · Hombro + Brazos (opcional)",
        exercises: [
          EX("Elevaciones laterales polea",    "Hombro",  3, 12, 20),
          EX("Pajaros / face pull",            "Hombro",  3, 15, 25),
          EX("Curl banco inclinado",           "Biceps",  3, 10, 15),
          EX("Curl martillo",                  "Biceps",  3, 10, 15),
          EX("Extension triceps sobre cabeza", "Triceps", 3, 10, 15),
        ],
      },
    ];
  }

  function seed() {
    return {
      version: 4,
      routines: seedRoutines(),
      sessions: [],
      bodyweight: [],
      settings: { restSec: 120 },
      profile: null,
      targets: null,
      foods: seedFoods(),
      meals: [],
    };
  }

  // Biblioteca base de alimentos (100g o unidad, valores redondeados)
  function seedFoods() {
    return [
      { id: uid(), name: "Pechuga de pollo",  serving: "100 g",   kcal: 165, p: 31, c: 0,  f: 3.6 },
      { id: uid(), name: "Huevo entero",      serving: "1 unidad",kcal: 78,  p: 6.3,c: 0.6,f: 5.3 },
      { id: uid(), name: "Clara de huevo",    serving: "1 unidad",kcal: 17,  p: 3.6,c: 0.2,f: 0.1 },
      { id: uid(), name: "Arroz blanco cocido",serving:"100 g",   kcal: 130, p: 2.7,c: 28, f: 0.3 },
      { id: uid(), name: "Avena",             serving: "100 g",   kcal: 389, p: 17, c: 66, f: 7 },
      { id: uid(), name: "Batata",            serving: "100 g",   kcal: 86,  p: 1.6,c: 20, f: 0.1 },
      { id: uid(), name: "Papa hervida",      serving: "100 g",   kcal: 87,  p: 1.9,c: 20, f: 0.1 },
      { id: uid(), name: "Banana",            serving: "1 mediana",kcal: 105, p: 1.3,c: 27, f: 0.4 },
      { id: uid(), name: "Manzana",           serving: "1 mediana",kcal: 95,  p: 0.5,c: 25, f: 0.3 },
      { id: uid(), name: "Palta",             serving: "100 g",   kcal: 160, p: 2,  c: 9,  f: 15 },
      { id: uid(), name: "Aceite de oliva",   serving: "1 cda",   kcal: 120, p: 0,  c: 0,  f: 14 },
      { id: uid(), name: "Whey protein",      serving: "1 scoop", kcal: 120, p: 24, c: 3,  f: 1.5 },
      { id: uid(), name: "Atun al agua",      serving: "1 lata",  kcal: 130, p: 28, c: 0,  f: 1 },
      { id: uid(), name: "Yogur griego",      serving: "170 g",   kcal: 100, p: 17, c: 6,  f: 0.7 },
      { id: uid(), name: "Almendras",         serving: "30 g",    kcal: 173, p: 6,  c: 6,  f: 15 },
      { id: uid(), name: "Pan integral",      serving: "1 rebanada",kcal: 80,p: 4,  c: 14, f: 1 },
      { id: uid(), name: "Carne magra",       serving: "100 g",   kcal: 200, p: 26, c: 0,  f: 10 },
      { id: uid(), name: "Salmon",            serving: "100 g",   kcal: 208, p: 20, c: 0,  f: 13 },
      { id: uid(), name: "Lentejas cocidas",  serving: "100 g",   kcal: 116, p: 9,  c: 20, f: 0.4 },
      { id: uid(), name: "Queso port salut",  serving: "30 g",    kcal: 90,  p: 6,  c: 0.5,f: 7 },
    ];
  }

  // ---------- consultas ----------
  const getRoutine = (id) => state.routines.find((r) => r.id === id);
  const getSession = (id) => state.sessions.find((s) => s.id === id);
  const sessionsOf = (routineId) =>
    state.sessions.filter((s) => s.routineId === routineId).sort((a, b) => new Date(b.date) - new Date(a.date));

  function lastSessionFor(routineId, exceptId) {
    return sessionsOf(routineId).find((s) => s.id !== exceptId) || null;
  }

  // Mejor e1RM historico por ejercicio (para PR)
  function bestE1RM(exerciseId, beforeSessionId) {
    let best = 0;
    for (const s of state.sessions) {
      if (s.id === beforeSessionId) continue;
      for (const e of s.entries) {
        if (e.exerciseId !== exerciseId) continue;
        for (const st of e.sets) {
          if (!st.done) continue;
          const v = e1rm(st.weight, st.reps);
          if (v > best) best = v;
        }
      }
    }
    return best;
  }

  // Ultima serie registrada (done) de un ejercicio en sesion previa
  function lastDoneSet(exerciseId, exceptSessionId) {
    for (const s of [...state.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date))) {
      if (s.id === exceptSessionId) continue;
      const e = s.entries.find(x => x.exerciseId === exerciseId);
      if (!e) continue;
      const doneSet = [...e.sets].reverse().find(x => x.done);
      if (doneSet) return { set: doneSet, date: s.date };
    }
    return null;
  }

  // Sugerencia de peso siguiente para un ejercicio segun ultima sesion (regla simple):
  //  - si RIR>=3: +5kg
  //  - si RIR==2: +2.5kg
  //  - si RIR==1: mantener
  //  - si RIR==0: -2.5kg
  function suggestWeight(exerciseId, targetReps) {
    const last = lastDoneSet(exerciseId);
    if (!last) return null;
    const { weight, reps, rir } = last.set;
    if (weight <= 0) return null;
    // ajuste por RIR
    let delta = 0;
    if (rir >= 3) delta = 5;
    else if (rir === 2) delta = 2.5;
    else if (rir === 1) delta = 0;
    else delta = -2.5;
    // penalizacion si target es mayor a reps hechas (progresion mas conservadora)
    if (targetReps && reps < targetReps) delta -= 2.5;
    const w = Math.max(0, round25(weight + delta));
    return { weight: w, from: weight, rir };
  }

  // ---------- iniciar / continuar entrenamiento ----------
  function startSession(routineId) {
    const routine = getRoutine(routineId);
    if (!routine) return;

    const todays = sessionsOf(routineId).find((s) => isSameDay(s.date));
    if (todays) { go("session", { id: todays.id }); return; }

    const prev = lastSessionFor(routineId);
    const entries = routine.exercises.map((ex) => {
      const prevEntry = prev && prev.entries.find((e) => e.exerciseId === ex.id);
      const count = ex.sets || 3;
      const suggestion = suggestWeight(ex.id, ex.repsMin);
      const sets = [];
      for (let i = 0; i < count; i++) {
        const ps = prevEntry && prevEntry.sets[i];
        const initialWeight = suggestion ? suggestion.weight : (ps ? ps.weight : 0);
        sets.push({
          weight: initialWeight,
          reps: ps ? ps.reps : ex.repsMin,
          rir: ps ? ps.rir : 2,
          done: false,
        });
      }
      return {
        exerciseId: ex.id, name: ex.name, muscle: ex.muscle || "Otro",
        repsMin: ex.repsMin, repsMax: ex.repsMax,
        sets,
      };
    });

    const session = {
      id: uid(),
      routineId,
      routineName: routine.name,
      date: new Date().toISOString(),
      entries,
      notes: "",
    };
    state.sessions.push(session);
    save();
    go("session", { id: session.id });
  }

  // ============================================================
  //  RENDER
  // ============================================================
  const appEl = $("#app");

  function render() {
    setActiveTab(view.route === "session" ? "hoy" : view.route);
    let html = "";
    switch (view.route) {
      case "hoy": html = viewHoy(); break;
      case "session": html = viewSession(); break;
      case "rutinas": html = viewRutinas(); break;
      case "routine-edit": html = viewRoutineEdit(); break;
      case "exercise-edit": html = viewExerciseEdit(); break;
      case "historial": html = viewHistorial(); break;
      case "stats": html = viewStats(); break;
      case "exercise-progress": html = viewExerciseProgress(); break;
      case "food": html = viewFood(); break;
      case "food-setup": html = viewFoodSetup(); break;
      case "food-pick": html = viewFoodPick(); break;
      case "food-library": html = viewFoodLibrary(); break;
      case "food-edit": html = viewFoodEdit(); break;
      default: html = viewHoy();
    }
    appEl.innerHTML = html;
    appEl.scrollTo?.(0, 0);
  }

  function setActiveTab(route) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.route === route));
  }

  // ---------- vista: TRAIN ----------
  function viewHoy() {
    if (state.routines.length === 0) {
      return `
        <div class="eyebrow">Today</div>
        <div class="header"><h1>Train</h1></div>
        ${emptyBlock("—", "Sin rutinas todavia", "Crea tu primer dia en Program.", "Ir a Program", "go-rutinas")}`;
    }
    const cards = state.routines.map((r) => {
      const last = sessionsOf(r.id)[0];
      const todays = last && isSameDay(last.date);
      const doneCount = todays ? countDoneSets(last) : 0;
      const totalCount = todays ? last.entries.reduce((n,e)=>n+e.sets.length,0) : 0;
      let sub;
      if (todays) sub = `<span class="pill done">En curso · ${doneCount}/${totalCount}</span>`;
      else if (last) sub = `Ultima: ${esc(fmtShort(last.date))}`;
      else sub = `${r.exercises.length} ejercicios`;
      const muscles = [...new Set(r.exercises.map(e => e.muscle))].slice(0,4).join(" · ");
      return `
        <div class="card tap" data-action="start" data-id="${r.id}">
          <div class="row">
            <div class="grow">
              <div class="title-lg">${esc(r.name)}</div>
              <div class="muted" style="margin-top:6px">${sub}</div>
              <div class="muted" style="margin-top:3px; font-size:11px; text-transform:uppercase; letter-spacing:0.14em;">${esc(muscles)}</div>
            </div>
            <span class="chev">${ICON.chev}</span>
          </div>
        </div>`;
    }).join("");
    // resumen de la semana
    const weekStart = startOfWeek();
    const thisWeek = state.sessions.filter(s => new Date(s.date) >= weekStart).length;
    return `
      <div class="eyebrow">Today · ${esc(new Date().toLocaleDateString("es-AR",{weekday:"long"}))}</div>
      <div class="header">
        <h1>Train</h1>
        <div class="sub">${thisWeek} sesion${thisWeek===1?"":"es"} esta semana</div>
      </div>
      ${cards}`;
  }

  function countDoneSets(session) {
    return session.entries.reduce((n,e)=>n+e.sets.filter(s=>s.done).length, 0);
  }

  // ---------- vista: SESION activa ----------
  function viewSession() {
    const s = getSession(view.params.id);
    if (!s) return viewHoy();
    const prev = lastSessionFor(s.routineId, s.id);

    const exercises = s.entries.map((entry, ei) => {
      const prevEntry = prev && prev.entries.find((e) => e.exerciseId === entry.exerciseId);
      const bestBefore = bestE1RM(entry.exerciseId, s.id);
      const suggestion = suggestWeight(entry.exerciseId, entry.repsMin);
      const rangeTxt = entry.repsMin != null
        ? (entry.repsMin === entry.repsMax ? `\u{1F3AF} ${entry.repsMin}` : `\u{1F3AF} ${entry.repsMin}-${entry.repsMax}`)
        : "";

      // Warm-up ramp: solo si primer set tiene peso > 40kg
      const workingW = entry.sets[0]?.weight || 0;
      let warmupHtml = "";
      if (workingW >= 40) {
        const w1 = round25(workingW * 0.4);
        const w2 = round25(workingW * 0.6);
        const w3 = round25(workingW * 0.8);
        warmupHtml = `
          <div class="warmup">
            <div class="wu-title">Warm-up</div>
            <b>${w1}kg × 8</b> · <b>${w2}kg × 5</b> · <b>${w3}kg × 3</b>
          </div>`;
      }

      const setsHtml = entry.sets.map((set, si) => {
        const ps = prevEntry && prevEntry.sets[si];
        const isPR = set.done && set.weight > 0 && set.reps > 0 && e1rm(set.weight, set.reps) > bestBefore && bestBefore > 0;
        const prevTxt = ps ? `<div class="prev-hint">Ultimo: <b>${ps.weight}kg × ${ps.reps}</b> · RIR ${ps.rir}${isPR ? '<span class="pr-mark">◆ PR</span>' : ''}</div>` : "";
        return `
          <div class="set ${set.done ? "done" : ""}" data-ei="${ei}" data-si="${si}">
            <div class="idx">${si + 1}</div>
            ${fieldHtml("weight", set.weight)}
            ${fieldHtml("reps", set.reps)}
            ${fieldHtml("rir", set.rir)}
            <button class="set-btn check" data-action="toggle-done" data-ei="${ei}" data-si="${si}" aria-label="Marcar hecho">
              ${ICON.check}
            </button>
            <button class="set-btn trash" data-action="rm-set" data-ei="${ei}" data-si="${si}" aria-label="Borrar serie">
              ${ICON.trash}
            </button>
          </div>
          ${si === 0 ? prevTxt : ""}`;
      }).join("");

      const suggestHtml = suggestion ? `
        <div class="suggest">
          Sugerido<br><b>${suggestion.weight}kg</b> <small>(prev ${suggestion.from}kg · RIR ${suggestion.rir})</small>
        </div>` : "";

      return `
        <div class="exercise">
          <div class="ex-head">
            <div>
              <div class="name">${esc(entry.name)}</div>
              <div class="muscle">${esc(entry.muscle || "")} · ${entry.sets.length} series · ${rangeTxt} reps</div>
            </div>
            ${suggestHtml}
          </div>
          ${warmupHtml}
          <div class="set-header">
            <div>#</div><div>KG</div><div>REPS</div><div>RIR</div><div></div><div></div>
          </div>
          ${setsHtml}
          <button class="add-set" data-action="add-set" data-ei="${ei}">+ Serie extra</button>
        </div>`;
    }).join("");

    return `
      <button class="back" data-action="go-hoy">${ICON.back} Train</button>
      <div class="eyebrow">${esc(fmtDate(s.date))}</div>
      <div class="header">
        <h1>${esc(s.routineName)}</h1>
      </div>
      ${exercises}

      <div class="section-title">Notas</div>
      <textarea class="textarea" id="session-notes" data-action="session-notes" placeholder="Como te sentiste, dolencias, cambios de ejercicios...">${esc(s.notes || "")}</textarea>

      <div class="fab-area">
        <button class="btn accent" data-action="finish">${ICON.check} Terminar sesion</button>
        <div style="height:10px"></div>
        <button class="btn danger" data-action="discard">Descartar registro</button>
      </div>`;
  }

  function fieldHtml(kind, value) {
    const mode = kind === "weight" ? "decimal" : "numeric";
    return `
      <div class="field">
        <div class="stepper">
          <button data-action="dec" data-kind="${kind}" aria-label="menos">−</button>
          <input type="text" inputmode="${mode}" data-kind="${kind}" value="${value}" />
          <button data-action="inc" data-kind="${kind}" aria-label="mas">+</button>
        </div>
      </div>`;
  }

  // ---------- vista: PROGRAM (rutinas) ----------
  function viewRutinas() {
    const cards = state.routines.map((r) => {
      const muscles = [...new Set(r.exercises.map(e => e.muscle))].join(" · ");
      const totalSets = r.exercises.reduce((n, e) => n + (e.sets || 0), 0);
      return `
      <div class="card tap" data-action="edit-routine" data-id="${r.id}">
        <div class="row">
          <div class="grow">
            <div class="title-lg">${esc(r.name)}</div>
            <div class="muted" style="margin-top:6px">${r.exercises.length} ejercicios · ${totalSets} series</div>
            <div class="muted" style="margin-top:3px; font-size:11px; text-transform:uppercase; letter-spacing:0.14em;">${esc(muscles)}</div>
          </div>
          <span class="chev">${ICON.chev}</span>
        </div>
      </div>`}).join("");
    return `
      <div class="eyebrow">Program</div>
      <div class="header">
        <h1>Split</h1>
        <div class="sub">Tus dias con prescripcion (reps @ RIR objetivo).</div>
      </div>
      ${cards || emptyBlock("—", "Sin rutinas", "Crea tu primer dia.", "", "")}
      <div class="fab-area">
        <button class="btn" data-action="new-routine">${ICON.plus} Nuevo dia</button>
      </div>`;
  }

  // ---------- vista: EDITAR RUTINA ----------
  function viewRoutineEdit() {
    const r = getRoutine(view.params.id);
    if (!r) return viewRutinas();
    const exs = r.exercises.map((ex) => {
      const summary = `${ex.sets}× \u{1F3AF} ${ex.repsMin}${ex.repsMax !== ex.repsMin ? "-" + ex.repsMax : ""} reps`;
      return `
      <div class="card tap" data-action="edit-exercise" data-id="${ex.id}">
        <div class="row">
          <div class="grow">
            <div class="title-lg">${esc(ex.name)}</div>
            <div class="muted" style="margin-top:4px; text-transform:uppercase; letter-spacing:0.14em; font-size:11px">${esc(ex.muscle || "Otro")}</div>
            <div class="muted" style="margin-top:6px; font-variant-numeric: tabular-nums">${summary}</div>
          </div>
          <span class="chev">${ICON.chev}</span>
        </div>
      </div>`}).join("");
    return `
      <button class="back" data-action="go-rutinas">${ICON.back} Program</button>
      <div class="eyebrow">Editar dia</div>
      <div class="header"><h1>${esc(r.name)}</h1></div>
      <input class="input" id="routine-name" value="${esc(r.name)}" data-action="rename-routine" placeholder="Nombre del dia" />
      <div class="section-title">Ejercicios</div>
      ${exs || `<div class="muted" style="padding:8px 4px 16px">Todavia no agregaste ejercicios.</div>`}
      <input class="input" id="new-ex-name" placeholder="Nuevo ejercicio (ej. Remo con barra)" />
      <button class="btn secondary" data-action="add-exercise">${ICON.plus} Agregar ejercicio</button>
      <div style="height:24px"></div>
      <button class="btn danger" data-action="del-routine">Eliminar este dia</button>`;
  }

  // ---------- vista: EDITAR EJERCICIO ----------
  function viewExerciseEdit() {
    const r = getRoutine(view.params.rid);
    if (!r) return viewRutinas();
    const ex = r.exercises.find(x => x.id === view.params.eid);
    if (!ex) return viewRoutineEdit();
    const muscleOptions = MUSCLES.map(m => `<option value="${m}" ${ex.muscle === m ? "selected" : ""}>${m}</option>`).join("");
    return `
      <button class="back" data-action="back-routine" data-rid="${r.id}">${ICON.back} ${esc(r.name)}</button>
      <div class="eyebrow">Ejercicio</div>
      <div class="header"><h1>${esc(ex.name)}</h1></div>

      <div class="section-title">Nombre</div>
      <input class="input" id="ex-name" value="${esc(ex.name)}" placeholder="Nombre del ejercicio" />

      <div class="section-title">Musculo</div>
      <select class="select" id="ex-muscle">${muscleOptions}</select>

      <div class="section-title">Series y objetivo de reps</div>
      <div class="input-row">
        <div><div class="lbl">Series</div><input class="input" id="ex-sets" type="number" inputmode="numeric" value="${ex.sets}" style="margin:0" /></div>
        <div><div class="lbl">Reps min</div><input class="input" id="ex-repsmin" type="number" inputmode="numeric" value="${ex.repsMin}" style="margin:0" /></div>
        <div><div class="lbl">Reps max</div><input class="input" id="ex-repsmax" type="number" inputmode="numeric" value="${ex.repsMax}" style="margin:0" /></div>
      </div>

      <div style="height:16px"></div>
      <button class="btn accent" data-action="save-exercise">${ICON.check} Guardar</button>
      <div style="height:10px"></div>
      <button class="btn danger" data-action="del-exercise">Eliminar ejercicio</button>`;
  }

  // ---------- vista: HISTORIAL ----------
  function viewHistorial() {
    const sessions = [...state.sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sessions.length === 0) {
      return `
        <div class="eyebrow">Log</div>
        <div class="header"><h1>Historial</h1></div>
        ${emptyBlock("—", "Sin registros", "Cuando termines una sesion, va a aparecer aqui.", "Ir a Train", "go-hoy")}`;
    }
    const blocks = sessions.map((s) => {
      const lines = s.entries.map((e) => {
        const done = e.sets.filter((x) => x.done);
        if (done.length === 0) return "";
        const top = done.reduce((m, x) => (e1rm(x.weight,x.reps) > e1rm(m.weight,m.reps) ? x : m), done[0]);
        const bestBefore = bestE1RM(e.exerciseId, s.id);
        const isPR = e1rm(top.weight, top.reps) > bestBefore && bestBefore > 0;
        return `<div class="hist-line">
          <span>${esc(e.name)}</span>
          <span class="sets">${done.length}× · top <b>${top.weight}kg×${top.reps}</b>${isPR ? ' <span class="pr-mark">◆ PR</span>' : ''}</span>
        </div>`;
      }).join("");
      const notes = s.notes ? `<div class="muted" style="margin-top:10px; font-style:italic">"${esc(s.notes)}"</div>` : "";
      return `
        <div class="hist-day">${esc(fmtDate(s.date))}</div>
        <div class="card">
          <div class="row" style="margin-bottom:10px"><div class="title-lg">${esc(s.routineName)}</div></div>
          ${lines || `<div class="muted">Sin series marcadas</div>`}
          ${notes}
        </div>`;
    }).join("");
    return `
      <div class="eyebrow">Log</div>
      <div class="header"><h1>Historial</h1></div>
      ${blocks}`;
  }

  // ---------- vista: DASHBOARD ----------
  function viewStats() {
    // ---- consistencia: sesiones por semana (ultimas 8) ----
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const start = startOfWeek(new Date(Date.now() - i * 7 * 86400000));
      const end = new Date(start); end.setDate(end.getDate() + 7);
      const n = state.sessions.filter(s => {
        const d = new Date(s.date);
        return d >= start && d < end;
      }).length;
      weeks.push({ start, n });
    }
    const maxWk = Math.max(4, ...weeks.map(w => w.n));
    const consistencyHtml = weeks.map((w, i) => {
      const isNow = i === weeks.length - 1;
      const isHit = w.n >= 3;
      const pct = Math.round((w.n / maxWk) * 100);
      return `
        <div class="wk ${isHit ? "hit" : ""} ${isNow ? "now" : ""}">
          <div class="bar" style="height:${Math.max(3, pct)}%"></div>
          <div class="lb">${w.n}</div>
        </div>`;
    }).join("");

    // ---- volumen semanal por musculo con zonas ----
    const weekStart = startOfWeek();
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+7);
    const weekSessions = state.sessions.filter(s => {
      const d = new Date(s.date);
      return d >= weekStart && d < weekEnd;
    });
    const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(lastWeekStart.getDate()-7);
    const lastWeekSessions = state.sessions.filter(s => {
      const d = new Date(s.date);
      return d >= lastWeekStart && d < weekStart;
    });
    const volumeByMuscle = {};
    const lastVolumeByMuscle = {};
    const tallyVolume = (arr, dest) => {
      for (const s of arr) {
        for (const e of s.entries) {
          const done = e.sets.filter(x => x.done).length;
          if (done === 0) continue;
          const m = e.muscle || "Otro";
          dest[m] = (dest[m] || 0) + done;
        }
      }
    };
    tallyVolume(weekSessions, volumeByMuscle);
    tallyVolume(lastWeekSessions, lastVolumeByMuscle);

    const totalWeekSets = Object.values(volumeByMuscle).reduce((a,b)=>a+b,0);
    const totalLastWeek = Object.values(lastVolumeByMuscle).reduce((a,b)=>a+b,0);
    const volDelta = totalWeekSets - totalLastWeek;
    const volDeltaTxt = totalLastWeek === 0
      ? "sin comparativo"
      : (volDelta === 0 ? "±0" : (volDelta > 0 ? "+" : "") + volDelta) + " vs semana anterior";
    const volDeltaClass = volDelta > 0 ? "up" : (volDelta < 0 ? "down" : "");

    // Zona: <8 low, 8-14 MEV/MAV, 15-20 optimo (MAV), 20+ over
    const zoneOf = (n) => n < 8 ? {c:"zone-low", tag:"BAJO"} :
                         n < 15 ? {c:"zone-mev", tag:"MEV"} :
                         n <= 20 ? {c:"zone-mav", tag:"OPTIMO"} :
                                   {c:"zone-over", tag:"ALTO"};
    const maxVol = Math.max(20, ...Object.values(volumeByMuscle));
    const volRows = MUSCLES.filter(m => volumeByMuscle[m])
      .sort((a,b)=>volumeByMuscle[b]-volumeByMuscle[a])
      .map(m => {
        const n = volumeByMuscle[m];
        const pct = Math.round((n / maxVol) * 100);
        const z = zoneOf(n);
        return `
          <div class="volume-row zoned ${z.c}">
            <div class="muscle">${esc(m)}</div>
            <div class="bar"><span style="width:${pct}%"></span></div>
            <div class="n"><b>${n}</b> sets<span class="zoneTag">${z.tag}</span></div>
          </div>`;
      }).join("") || `<div class="muted" style="padding:14px 0">Aun no marcaste series esta semana.</div>`;

    // ---- progresion por ejercicio ----
    const byExercise = {};
    for (const s of [...state.sessions].sort((a,b)=>new Date(a.date)-new Date(b.date))) {
      for (const e of s.entries) {
        const done = e.sets.filter(x => x.done);
        if (done.length === 0) continue;
        const top = done.reduce((m, x) => (e1rm(x.weight,x.reps) > e1rm(m.weight,m.reps) ? x : m), done[0]);
        const key = e.exerciseId;
        if (!byExercise[key]) byExercise[key] = { name: e.name, points: [] };
        byExercise[key].points.push({ date: s.date, e1: e1rm(top.weight, top.reps), w: top.weight, r: top.reps });
      }
    }

    // Top 3 movers (mayor delta e1RM absoluto)
    const movers = Object.values(byExercise)
      .filter(x => x.points.length >= 2)
      .map(x => {
        const first = x.points[0], last = x.points[x.points.length-1];
        return { ...x, first, last, delta: last.e1 - first.e1 };
      })
      .sort((a,b) => b.delta - a.delta)
      .slice(0, 3);

    const moversHtml = movers.length ? movers.map(m => {
      const cls = m.delta > 0 ? "up" : (m.delta < 0 ? "down" : "");
      const sign = m.delta === 0 ? "±" : (m.delta > 0 ? "+" : "");
      return `
        <div class="mover-row">
          <div>
            <div class="name">${esc(m.name)}</div>
            <div class="sub">${m.first.w}kg×${m.first.r} → <b style="color:var(--text)">${m.last.w}kg×${m.last.r}</b> · ${m.points.length} sesiones</div>
          </div>
          <div class="delta ${cls}">${sign}${m.delta.toFixed(1)}<small>kg e1RM</small></div>
        </div>`;
    }).join("") : `<div class="muted" style="padding:14px 0">Necesitas al menos 2 sesiones registradas.</div>`;

    // Sparklines top 6 con mas puntos
    const sparkRows = Object.values(byExercise)
      .filter(x => x.points.length >= 2)
      .sort((a,b) => b.points.length - a.points.length)
      .slice(0, 6)
      .map(x => {
        const pts = x.points;
        const last = pts[pts.length-1];
        const delta = last.e1 - pts[0].e1;
        const deltaTxt = delta === 0 ? "±0" : (delta > 0 ? "+" : "") + delta.toFixed(1);
        return `
          <div class="spark-row">
            <div class="top">
              <span class="name">${esc(x.name)}</span>
              <span class="val">${last.w}kg×${last.r} · e1RM <b>${last.e1.toFixed(0)}kg</b> · ${deltaTxt}kg</span>
            </div>
            ${sparklineSvg(pts)}
          </div>`;
      }).join("");

    // Streak: semanas consecutivas con >=3 sesiones (mirando desde la actual hacia atras)
    let streak = 0;
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i].n >= 3) streak++;
      else break;
    }

    // Peso corporal
    const bw = state.bodyweight.length ? state.bodyweight[state.bodyweight.length-1] : null;
    const bwPts = state.bodyweight.slice().sort((a,b)=>new Date(a.date)-new Date(b.date))
      .map(x => ({ date: x.date, e1: x.kg, w: x.kg, r: 0 }));
    const bwSpark = bwPts.length >= 2 ? sparklineSvg(bwPts) : "";
    const bwLast = bw ? `${bw.kg} kg` : "—";
    const bwDelta = bwPts.length >= 2 ? (bwPts[bwPts.length-1].e1 - bwPts[0].e1) : 0;
    const bwDeltaTxt = bwPts.length >= 2 ? `${bwDelta >= 0 ? "+" : ""}${bwDelta.toFixed(1)} kg desde inicio` : "sin comparativo";

    const totalSessions = state.sessions.length;

    return `
      <div class="eyebrow">Dashboard</div>
      <div class="header">
        <h1>Progreso</h1>
        <div class="sub">Semana del ${esc(fmtShort(weekStart.toISOString()))}</div>
      </div>

      <div class="hero-stat">
        <div class="lbl">Racha semanal</div>
        <div class="val">${streak}<small>semana${streak===1?"":"s"} con 3+ sesiones</small></div>
        <div class="delta">${weekSessions.length} sesion${weekSessions.length===1?"":"es"} esta semana · ${totalSessions} totales</div>
      </div>

      <div class="stat-grid">
        <div class="stat"><div class="lbl">Volumen semanal</div><div class="val">${totalWeekSets}<small>sets</small></div><div class="muted ${volDeltaClass}" style="margin-top:4px; font-size:11px;">${volDeltaTxt}</div></div>
        <div class="stat"><div class="lbl">Peso corporal</div><div class="val">${esc(bwLast)}</div><div class="muted" style="margin-top:4px; font-size:11px;">${bwDeltaTxt}</div></div>
      </div>

      <div class="section-title">Consistencia · ultimas 8 semanas</div>
      <div class="card" style="padding:16px 18px">
        <div class="consistency">${consistencyHtml}</div>
        <div class="legend"><span class="on">3+ sesiones</span><span>menos</span></div>
      </div>

      <div class="section-title">Top progresiones</div>
      ${moversHtml}

      <div class="section-title">Volumen por musculo · zonas de estimulo</div>
      ${volRows}

      <div class="section-title">Peso corporal</div>
      <div class="card">
        <div class="row" style="align-items:flex-end">
          <div class="grow">
            <div class="muted" style="margin-bottom:6px">Log rapido</div>
            <input class="input" id="bw-input" type="number" inputmode="decimal" step="0.1" placeholder="kg" style="margin:0" />
          </div>
          <button class="btn small accent" data-action="log-bw" style="width:auto; margin-left:10px">Guardar</button>
        </div>
        ${bwSpark}
      </div>

      ${sparkRows ? `<div class="section-title">Progresion por ejercicio · e1RM</div>${sparkRows}` : ""}`;
  }

  // ============================================================
  //  FOOD / NUTRICION
  // ============================================================

  // Calorias y macros a partir del perfil (Mifflin-St Jeor)
  function computeTargets(profile, bwKg) {
    if (!profile) return null;
    const { sex, age, heightCm, activity, goal } = profile;
    if (!age || !heightCm || !bwKg) return null;
    // BMR
    const bmr = sex === "F"
      ? 10 * bwKg + 6.25 * heightCm - 5 * age - 161
      : 10 * bwKg + 6.25 * heightCm - 5 * age + 5;
    const actMap = { sed: 1.375, lig: 1.55, mod: 1.725, hi: 1.9 };
    const tdee = bmr * (actMap[activity] || 1.55);
    const goalMap = { cut: 0.80, main: 1.00, bulk: 1.10 };
    const kcal = Math.round(tdee * (goalMap[goal] || 1));
    const protein = Math.round(bwKg * 2.0);     // 2 g/kg
    const fat = Math.round((kcal * 0.25) / 9);  // 25% kcal
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, carbs, fat };
  }

  function currentBw() {
    if (state.bodyweight.length) return state.bodyweight[state.bodyweight.length - 1].kg;
    return null;
  }

  function todayMealsSum() {
    const today = new Date().toISOString().slice(0,10);
    const items = state.meals.filter(m => m.date.startsWith(today));
    const tot = { kcal: 0, p: 0, c: 0, f: 0 };
    for (const m of items) {
      const food = state.foods.find(f => f.id === m.foodId);
      if (!food) continue;
      const mul = m.servings || 1;
      tot.kcal += food.kcal * mul;
      tot.p += food.p * mul;
      tot.c += food.c * mul;
      tot.f += food.f * mul;
    }
    return { items, tot };
  }

  function viewFood() {
    // Si no hay perfil, forzar setup
    if (!state.profile || !state.targets) {
      return viewFoodSetup();
    }
    const { items, tot } = todayMealsSum();
    const t = state.targets;
    const pct = (v, target) => target > 0 ? Math.min(100, Math.round((v / target) * 100)) : 0;
    const overCal = tot.kcal > t.kcal;

    // agrupar por meal type
    const groups = { Desayuno: [], Almuerzo: [], Merienda: [], Cena: [], "Pre/Post": [], Otro: [] };
    for (const m of items) {
      const g = groups[m.mealType] ? m.mealType : "Otro";
      groups[g].push(m);
    }
    const groupHtml = Object.entries(groups).map(([label, arr]) => {
      if (arr.length === 0) return "";
      let sub = { kcal: 0, p: 0, c: 0, f: 0 };
      const lines = arr.map(m => {
        const food = state.foods.find(f => f.id === m.foodId);
        if (!food) return "";
        const mul = m.servings || 1;
        const k = Math.round(food.kcal * mul);
        const p = Math.round(food.p * mul);
        const c = Math.round(food.c * mul);
        const fa = Math.round(food.f * mul);
        sub.kcal += k; sub.p += p; sub.c += c; sub.f += fa;
        const svg = mul === 1 ? esc(food.serving) : `${mul}× ${esc(food.serving)}`;
        return `
          <div class="meal-row">
            <div>
              <div class="name">${esc(food.name)}</div>
              <div class="sub">${svg} · P${p} C${c} F${fa}</div>
            </div>
            <div class="kcal">${k}<span class="muted" style="font-size:11px; font-family:var(--sans); margin-left:2px">kcal</span></div>
            <button class="rm" data-action="rm-meal" data-id="${m.id}" aria-label="quitar">✕</button>
          </div>`;
      }).join("");
      return `
        <div class="meal-section">
          <div class="head">
            <span>${esc(label)}</span>
            <span class="totals">${sub.kcal} kcal · P${sub.p} C${sub.c} F${sub.f}</span>
          </div>
          ${lines}
        </div>`;
    }).join("");

    return `
      <div class="eyebrow">Food · ${esc(new Date().toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"}))}</div>
      <div class="header">
        <h1>Macros</h1>
        <div class="sub">Objetivo: ${t.kcal} kcal · ${t.protein}p / ${t.carbs}c / ${t.fat}f</div>
      </div>

      <div class="macro-hero">
        <div class="cal-row">
          <div class="cal">${Math.round(tot.kcal)}<small>/ ${t.kcal} kcal</small></div>
          <div class="target-txt">${Math.max(0, t.kcal - Math.round(tot.kcal))} restantes</div>
        </div>
        <div class="cal-bar"><span class="${overCal ? "over" : ""}" style="width:${pct(tot.kcal, t.kcal)}%"></span></div>
      </div>

      <div class="macro-grid">
        <div class="macro p">
          <div class="lbl p">Prot</div>
          <div class="val">${Math.round(tot.p)}<small>/${t.protein}g</small></div>
          <div class="bar"><span style="width:${pct(tot.p, t.protein)}%"></span></div>
        </div>
        <div class="macro c">
          <div class="lbl c">Carbs</div>
          <div class="val">${Math.round(tot.c)}<small>/${t.carbs}g</small></div>
          <div class="bar"><span style="width:${pct(tot.c, t.carbs)}%"></span></div>
        </div>
        <div class="macro f">
          <div class="lbl f">Grasa</div>
          <div class="val">${Math.round(tot.f)}<small>/${t.fat}g</small></div>
          <div class="bar"><span style="width:${pct(tot.f, t.fat)}%"></span></div>
        </div>
      </div>

      <button class="btn accent" data-action="go-food-pick">${ICON.plus} Registrar comida</button>
      <div style="height:10px"></div>
      <button class="btn secondary" data-action="go-food-library">Ver biblioteca</button>
      <div style="height:10px"></div>
      <button class="btn ghost" data-action="go-food-setup">Ajustar objetivos</button>

      ${items.length ? `<div class="section-title">Hoy</div>${groupHtml}` : ""}
    `;
  }

  function viewFoodSetup() {
    const p = state.profile || { sex: "M", age: 25, heightCm: 175, activity: "mod", goal: "main" };
    const bw = currentBw();
    const preview = computeTargets(p, bw);
    return `
      <button class="back" data-action="go-food">${ICON.back} Food</button>
      <div class="eyebrow">Perfil</div>
      <div class="header"><h1>Objetivos</h1><div class="sub">Calculamos tus macros con Mifflin-St Jeor.</div></div>

      <div class="section-title">Peso corporal</div>
      <div class="card">
        <div class="row">
          <div class="grow">
            <div class="muted" style="margin-bottom:6px; font-size:11px; text-transform:uppercase; letter-spacing:0.2em">Actual</div>
            <input class="input" id="bw-input" type="number" inputmode="decimal" step="0.1" placeholder="${bw ?? "kg"}" style="margin:0" value="${bw ?? ""}" />
          </div>
          <button class="btn small accent" data-action="log-bw" style="width:auto; margin-left:10px">Guardar</button>
        </div>
      </div>

      <div class="section-title">Datos</div>
      <div class="input-row">
        <div>
          <div class="lbl">Sexo</div>
          <select class="select" id="pf-sex">
            <option value="M" ${p.sex==="M"?"selected":""}>Masculino</option>
            <option value="F" ${p.sex==="F"?"selected":""}>Femenino</option>
          </select>
        </div>
        <div>
          <div class="lbl">Edad</div>
          <input class="input" id="pf-age" type="number" inputmode="numeric" value="${p.age}" style="margin:0" />
        </div>
        <div>
          <div class="lbl">Altura</div>
          <input class="input" id="pf-height" type="number" inputmode="numeric" value="${p.heightCm}" style="margin:0" />
        </div>
      </div>

      <div class="section-title">Actividad</div>
      <select class="select" id="pf-activity">
        <option value="sed" ${p.activity==="sed"?"selected":""}>Sedentario</option>
        <option value="lig" ${p.activity==="lig"?"selected":""}>Ligero (1-3 sesiones)</option>
        <option value="mod" ${p.activity==="mod"?"selected":""}>Moderado (3-5 sesiones)</option>
        <option value="hi"  ${p.activity==="hi"?"selected":""}>Alto (6+ sesiones)</option>
      </select>

      <div class="section-title">Objetivo</div>
      <select class="select" id="pf-goal">
        <option value="cut"  ${p.goal==="cut"?"selected":""}>Definicion (−20%)</option>
        <option value="main" ${p.goal==="main"?"selected":""}>Mantenimiento</option>
        <option value="bulk" ${p.goal==="bulk"?"selected":""}>Volumen (+10%)</option>
      </select>

      ${preview ? `
      <div class="section-title">Preview</div>
      <div class="hero-stat">
        <div class="lbl">Calorias diarias</div>
        <div class="val">${preview.kcal}<small>kcal</small></div>
        <div class="delta">P ${preview.protein}g · C ${preview.carbs}g · F ${preview.fat}g</div>
      </div>` : `
      <div class="muted" style="padding:10px 4px">Registra tu peso corporal para calcular los objetivos.</div>`}

      <div style="height:16px"></div>
      <button class="btn accent" data-action="save-profile">${ICON.check} Guardar objetivos</button>
      <div style="height:10px"></div>
      <button class="btn ghost" data-action="edit-targets">Editar manual</button>
    `;
  }

  function viewFoodPick() {
    const mealType = view.params.mealType || "Otro";
    const q = (view.params.q || "").toLowerCase();
    const foods = state.foods
      .filter(f => !q || f.name.toLowerCase().includes(q))
      .sort((a,b) => a.name.localeCompare(b.name));

    const list = foods.map(f => `
      <div class="food-item" data-action="pick-food" data-id="${f.id}">
        <div>
          <div class="name">${esc(f.name)}</div>
          <div class="sub">${esc(f.serving)} · ${f.kcal} kcal · P${f.p} C${f.c} F${f.f}</div>
        </div>
        <button class="add" data-action="pick-food" data-id="${f.id}">+</button>
      </div>`).join("") || `<div class="muted" style="padding:14px">Sin resultados.</div>`;

    return `
      <button class="back" data-action="go-food">${ICON.back} Food</button>
      <div class="eyebrow">Registrar</div>
      <div class="header"><h1>Elegir alimento</h1></div>

      <div class="meal-tabs">
        ${["Desayuno","Almuerzo","Merienda","Cena","Pre/Post","Otro"].map(m =>
          `<button data-action="set-meal-type" data-mt="${m}" class="${mealType===m?"active":""}">${m}</button>`).join("")}
      </div>

      <input class="input" id="food-search" placeholder="Buscar (ej. pollo, arroz...)" value="${esc(q)}" data-action="search-food" />

      <div class="food-picker">${list}</div>

      <button class="btn secondary" data-action="go-food-library">${ICON.plus} Agregar alimento nuevo</button>
    `;
  }

  function viewFoodLibrary() {
    const items = state.foods.slice().sort((a,b) => a.name.localeCompare(b.name));
    const list = items.map(f => `
      <div class="food-item" data-action="edit-food" data-id="${f.id}">
        <div>
          <div class="name">${esc(f.name)}</div>
          <div class="sub">${esc(f.serving)} · ${f.kcal} kcal · P${f.p} C${f.c} F${f.f}</div>
        </div>
        <span class="chev">${ICON.chev}</span>
      </div>`).join("");

    return `
      <button class="back" data-action="go-food">${ICON.back} Food</button>
      <div class="eyebrow">Biblioteca</div>
      <div class="header"><h1>Alimentos</h1><div class="sub">${items.length} en tu biblioteca</div></div>

      <div class="food-picker">${list}</div>

      <button class="btn accent" data-action="new-food">${ICON.plus} Nuevo alimento</button>
    `;
  }

  function viewFoodEdit() {
    const f = state.foods.find(x => x.id === view.params.id) || { id: null, name: "", serving: "100 g", kcal: 0, p: 0, c: 0, f: 0 };
    return `
      <button class="back" data-action="go-food-library">${ICON.back} Biblioteca</button>
      <div class="eyebrow">${f.id ? "Editar" : "Nuevo"}</div>
      <div class="header"><h1>Alimento</h1></div>

      <div class="section-title">Nombre</div>
      <input class="input" id="food-name" value="${esc(f.name)}" placeholder="Ej. Pechuga de pollo" />

      <div class="section-title">Porcion</div>
      <input class="input" id="food-serving" value="${esc(f.serving)}" placeholder="100 g, 1 unidad, 1 scoop" />

      <div class="section-title">Macros por porcion</div>
      <div class="input-row">
        <div><div class="lbl">Kcal</div><input class="input" id="food-kcal" type="number" inputmode="decimal" step="1" value="${f.kcal}" style="margin:0" /></div>
        <div><div class="lbl">Prot (g)</div><input class="input" id="food-p" type="number" inputmode="decimal" step="0.1" value="${f.p}" style="margin:0" /></div>
        <div><div class="lbl">Carbs (g)</div><input class="input" id="food-c" type="number" inputmode="decimal" step="0.1" value="${f.c}" style="margin:0" /></div>
      </div>
      <div style="height:6px"></div>
      <div class="input-row" style="grid-template-columns: 1fr">
        <div><div class="lbl">Grasa (g)</div><input class="input" id="food-f" type="number" inputmode="decimal" step="0.1" value="${f.f}" style="margin:0" /></div>
      </div>

      <div style="height:16px"></div>
      <button class="btn accent" data-action="save-food" data-id="${f.id || ""}">${ICON.check} Guardar</button>
      ${f.id ? `<div style="height:10px"></div><button class="btn danger" data-action="del-food" data-id="${f.id}">Eliminar</button>` : ""}
    `;
  }

  function sparklineSvg(points) {
    if (!points || points.length < 2) return "";
    const W = 600, H = 40, P = 2;
    const vals = points.map(p => p.e1);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const step = (W - P*2) / (points.length - 1);
    const d = points.map((p, i) => {
      const x = P + i * step;
      const y = H - P - ((p.e1 - min) / range) * (H - P*2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const lastX = P + (points.length - 1) * step;
    const lastY = H - P - ((points[points.length-1].e1 - min) / range) * (H - P*2);
    return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="var(--accent)"/>
    </svg>`;
  }

  // ---------- bloque vacio ----------
  function emptyBlock(ico, title, text, btnLabel, action) {
    const btn = btnLabel ? `<button class="btn small" data-action="${action}">${esc(btnLabel)}</button>` : "";
    return `<div class="empty"><div class="ico">${ico}</div>
      <div class="title-lg">${esc(title)}</div><p>${esc(text)}</p>${btn}</div>`;
  }

  // ============================================================
  //  ICONOS
  // ============================================================
  const ICON = {
    chev: `<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>`,
    back: `<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>`,
    trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13"/></svg>`,
  };

  // ============================================================
  //  NAV
  // ============================================================
  function go(route, params = {}) {
    view = { route, params };
    render();
  }

  // ============================================================
  //  REST TIMER
  // ============================================================
  let restTimer = { running: false, endsAt: 0, interval: null };
  const restBar = $("#rest-bar");
  const restTimeEl = $("#rest-time");

  function startRest(sec) {
    stopRest(false);
    restTimer.endsAt = Date.now() + sec * 1000;
    restTimer.running = true;
    restBar.hidden = false;
    tickRest();
    restTimer.interval = setInterval(tickRest, 250);
    // vibrar si esta soportado
    if (navigator.vibrate) navigator.vibrate(15);
  }
  function tickRest() {
    const left = Math.max(0, restTimer.endsAt - Date.now());
    const s = Math.ceil(left / 1000);
    const mm = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    restTimeEl.textContent = `${mm}:${ss}`;
    if (left <= 0) {
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      stopRest(true);
    }
  }
  function stopRest(finished) {
    if (restTimer.interval) clearInterval(restTimer.interval);
    restTimer.interval = null;
    restTimer.running = false;
    restBar.hidden = true;
    if (finished) {
      // no hacemos toast intrusivo, pero podriamos avisar
    }
  }

  restBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rest]");
    if (!btn) return;
    const act = btn.dataset.rest;
    if (act === "skip") { stopRest(false); return; }
    if (act === "-15") { restTimer.endsAt -= 15000; tickRest(); return; }
    if (act === "+15") { restTimer.endsAt += 15000; tickRest(); return; }
  });

  // ============================================================
  //  EVENTOS
  // ============================================================

  function setVal(ei, si, kind, value) {
    const s = getSession(view.params.id);
    if (!s) return;
    const v = clamp(round1(value), LIMITS[kind]);
    s.entries[ei].sets[si][kind] = v;
    save();
    return v;
  }

  appEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "inc" || action === "dec") {
      const setRow = btn.closest(".set");
      const ei = +setRow.dataset.ei, si = +setRow.dataset.si;
      const kind = btn.dataset.kind;
      const input = setRow.querySelector(`input[data-kind="${kind}"]`);
      const cur = parseFloat(input.value) || 0;
      const next = cur + (action === "inc" ? STEP[kind] : -STEP[kind]);
      const v = setVal(ei, si, kind, next);
      input.value = v;
      return;
    }

    switch (action) {
      case "start": startSession(btn.dataset.id); break;
      case "go-hoy": go("hoy"); break;
      case "go-rutinas": go("rutinas"); break;

      case "add-set": {
        const ei = +btn.dataset.ei;
        const s = getSession(view.params.id);
        const last = s.entries[ei].sets[s.entries[ei].sets.length - 1];
        s.entries[ei].sets.push(last
          ? { ...last, done: false }
          : { weight: 0, reps: 8, rir: 2, done: false });
        save(); render(); break;
      }
      case "toggle-done": {
        const ei = +btn.dataset.ei, si = +btn.dataset.si;
        const s = getSession(view.params.id);
        const set = s.entries[ei].sets[si];
        set.done = !set.done;
        save();
        if (set.done) {
          startRest(state.settings.restSec || 120);
        }
        render();
        break;
      }
      case "rm-set": {
        const ei = +btn.dataset.ei, si = +btn.dataset.si;
        const s = getSession(view.params.id);
        if (s.entries[ei].sets.length > 1) {
          s.entries[ei].sets.splice(si, 1);
          save(); render();
        } else {
          toast("Cada ejercicio necesita al menos 1 serie");
        }
        break;
      }
      case "finish": {
        save();
        stopRest(false);
        toast("Sesion guardada");
        go("hoy"); break;
      }
      case "discard": {
        if (confirm("Descartar este registro? No se puede deshacer.")) {
          state.sessions = state.sessions.filter((x) => x.id !== view.params.id);
          save(); stopRest(false); go("hoy");
        }
        break;
      }

      // --- rutinas ---
      case "new-routine": {
        const name = prompt("Nombre del nuevo dia (ej. Push, Pull, Legs)");
        if (name && name.trim()) {
          const r = { id: uid(), name: name.trim(), exercises: [] };
          state.routines.push(r); save(); go("routine-edit", { id: r.id });
        }
        break;
      }
      case "edit-routine": go("routine-edit", { id: btn.dataset.id }); break;
      case "back-routine": go("routine-edit", { id: btn.dataset.rid }); break;
      case "add-exercise": {
        const inp = $("#new-ex-name");
        const name = inp.value.trim();
        if (!name) { inp.focus(); break; }
        const r = getRoutine(view.params.id);
        const ex = { id: uid(), name, muscle: guessMuscle(name), sets: 3, repsMin: 8, repsMax: 12 };
        r.exercises.push(ex);
        save();
        go("exercise-edit", { rid: r.id, eid: ex.id });
        break;
      }
      case "edit-exercise": {
        go("exercise-edit", { rid: view.params.id, eid: btn.dataset.id });
        break;
      }
      case "save-exercise": {
        const r = getRoutine(view.params.rid);
        const ex = r.exercises.find(x => x.id === view.params.eid);
        const name = $("#ex-name").value.trim();
        const muscle = $("#ex-muscle").value;
        if (name) ex.name = name;
        if (muscle) ex.muscle = muscle;
        ex.sets = Math.max(1, parseInt($("#ex-sets").value) || 3);
        ex.repsMin = clamp(parseInt($("#ex-repsmin").value) || 8, LIMITS.reps);
        ex.repsMax = Math.max(ex.repsMin, clamp(parseInt($("#ex-repsmax").value) || ex.repsMin, LIMITS.reps));
        save();
        toast("Guardado");
        go("routine-edit", { id: r.id });
        break;
      }
      case "del-exercise": {
        if (view.route === "exercise-edit") {
          if (confirm("Eliminar este ejercicio de la rutina?")) {
            const r = getRoutine(view.params.rid);
            r.exercises = r.exercises.filter((x) => x.id !== view.params.eid);
            save(); go("routine-edit", { id: r.id });
          }
        } else {
          const r = getRoutine(view.params.id);
          r.exercises = r.exercises.filter((x) => x.id !== btn.dataset.id);
          save(); render();
        }
        break;
      }
      case "del-routine": {
        if (confirm("Eliminar este dia? El historial se conserva.")) {
          state.routines = state.routines.filter((x) => x.id !== view.params.id);
          save(); go("rutinas");
        }
        break;
      }
      case "log-bw": {
        const inp = $("#bw-input");
        const kg = parseFloat(inp.value);
        if (kg > 0) {
          const today = new Date().toISOString().slice(0,10);
          state.bodyweight = state.bodyweight.filter(x => !x.date.startsWith(today));
          state.bodyweight.push({ date: new Date().toISOString(), kg: round1(kg) });
          // Si hay perfil, recomputar targets con nuevo peso
          if (state.profile) {
            const t = computeTargets(state.profile, round1(kg));
            if (t) state.targets = t;
          }
          save();
          toast("Peso guardado");
          render();
        }
        break;
      }

      // ---------- FOOD ----------
      case "go-food": go("food"); break;
      case "go-food-pick": go("food-pick", { mealType: "Otro", q: "" }); break;
      case "go-food-library": go("food-library"); break;
      case "go-food-setup": go("food-setup"); break;

      case "save-profile": {
        const profile = {
          sex: $("#pf-sex").value,
          age: parseInt($("#pf-age").value) || 25,
          heightCm: parseInt($("#pf-height").value) || 175,
          activity: $("#pf-activity").value,
          goal: $("#pf-goal").value,
        };
        const bw = currentBw();
        const t = computeTargets(profile, bw);
        if (!bw) {
          toast("Registra tu peso corporal primero");
          break;
        }
        state.profile = profile;
        state.targets = t;
        save();
        toast("Objetivos actualizados");
        go("food");
        break;
      }
      case "edit-targets": {
        const t = state.targets || { kcal: 2500, protein: 180, carbs: 280, fat: 70 };
        const kcal = parseInt(prompt("Kcal objetivo:", t.kcal));
        if (!kcal) break;
        const p = parseInt(prompt("Proteina (g):", t.protein));
        if (p === null || isNaN(p)) break;
        const c = parseInt(prompt("Carbos (g):", t.carbs));
        if (c === null || isNaN(c)) break;
        const fa = parseInt(prompt("Grasa (g):", t.fat));
        if (fa === null || isNaN(fa)) break;
        state.targets = { kcal, protein: p, carbs: c, fat: fa };
        save();
        toast("Objetivos manuales");
        go("food");
        break;
      }
      case "set-meal-type": {
        view.params.mealType = btn.dataset.mt;
        render();
        break;
      }
      case "pick-food": {
        const food = state.foods.find(x => x.id === btn.dataset.id);
        if (!food) break;
        const servingsStr = prompt(`Porciones de "${food.name}" (${food.serving}):`, "1");
        if (servingsStr === null) break;
        const servings = parseFloat(servingsStr);
        if (!servings || servings <= 0) break;
        state.meals.push({
          id: uid(),
          date: new Date().toISOString(),
          foodId: food.id,
          servings: round1(servings),
          mealType: view.params.mealType || "Otro",
        });
        save();
        toast(`+ ${servings}× ${food.name}`);
        go("food");
        break;
      }
      case "rm-meal": {
        state.meals = state.meals.filter(m => m.id !== btn.dataset.id);
        save(); render();
        break;
      }
      case "new-food": go("food-edit", { id: null }); break;
      case "edit-food": go("food-edit", { id: btn.dataset.id }); break;
      case "save-food": {
        const id = btn.dataset.id || null;
        const data = {
          name: $("#food-name").value.trim(),
          serving: $("#food-serving").value.trim() || "1 porcion",
          kcal: parseFloat($("#food-kcal").value) || 0,
          p: parseFloat($("#food-p").value) || 0,
          c: parseFloat($("#food-c").value) || 0,
          f: parseFloat($("#food-f").value) || 0,
        };
        if (!data.name) { toast("Falta el nombre"); break; }
        if (id) {
          const f = state.foods.find(x => x.id === id);
          Object.assign(f, data);
        } else {
          state.foods.push({ id: uid(), ...data });
        }
        save();
        toast("Alimento guardado");
        go("food-library");
        break;
      }
      case "del-food": {
        if (confirm("Eliminar este alimento? Los registros pasados se conservan.")) {
          state.foods = state.foods.filter(x => x.id !== btn.dataset.id);
          save(); go("food-library");
        }
        break;
      }
    }
  });

  // Inputs de texto: actualizar estado al cambiar (sin re-render para no perder foco).
  appEl.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches('.set input[data-kind]')) {
      const setRow = t.closest(".set");
      const ei = +setRow.dataset.ei, si = +setRow.dataset.si;
      const v = setVal(ei, si, t.dataset.kind, parseFloat(t.value) || 0);
      t.value = v;
    } else if (t.id === "routine-name") {
      const r = getRoutine(view.params.id);
      if (r) { r.name = t.value.trim() || r.name; save(); }
    } else if (t.id === "session-notes") {
      const s = getSession(view.params.id);
      if (s) { s.notes = t.value; save(); }
    }
  });

  appEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "new-ex-name") {
      e.preventDefault();
      appEl.querySelector('[data-action="add-exercise"]')?.click();
    }
  });

  // Tab bar
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => go(tab.dataset.route));
  });

  // Toast
  let toastTimer;
  function toast(msg) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // Arranque
  $("#tabbar").hidden = false;
  render();

  // Splash: minimo 1.2s en pantalla, tap para saltarla
  const splashEl = $("#splash");
  if (splashEl) {
    const dismissSplash = () => {
      splashEl.classList.add("hide");
      setTimeout(() => splashEl.remove(), 700);
    };
    splashEl.addEventListener("click", dismissSplash, { once: true });
    setTimeout(dismissSplash, 1200);
  }

  // SW
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
