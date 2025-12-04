let trips = []; // viajes reconstruidos (entrada/salida)
let stations = [];
let currentRouteTrips = []; // viajes actualmente mostrados en la tabla
let currentSort = { column: null, asc: true };
const MAX_ROWS = 200;
let selectedOrigins = []; // orígenes elegidos por el usuario



document.addEventListener("DOMContentLoaded", () => {
  setupFileInput();
  setupTableSorting();
});


function setupFileInput() {
  const fileInput = document.getElementById("file-input");
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    clearError();
    parseCSVFile(file);
  });
}

function showError(msg) {
  document.getElementById("error-message").textContent = msg;
}
function clearError() {
  document.getElementById("error-message").textContent = "";
}

function normalizeStr(x) {
  return (x || "").toString().trim();
}

function parseCSVFile(file) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const rows = results.data;
      if (!rows || rows.length === 0) {
        showError("El archivo parece estar vacío o sin cabeceras.");
        return;
      }
      try {
        trips = buildTripsFromRows(rows);
        initStations();
        setupFilters();
      } catch (err) {
        console.error(err);
        showError("Ha habido un problema procesando el archivo. Revisa que las columnas se llamen como en el original.");
      }
    },
    error: (err) => {
      console.error(err);
      showError("Error leyendo el CSV.");
    },
  });
}

function parseDateTime(str) {
  if (!str) return null;
  const s = str.replace(" ", "T");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * A partir de las observaciones originales:
 * - filtra validaciones relevantes
 * - reconstruye viajes FGC (entrada + salida)
 * - genera viajes "solo entrada" para el resto
 */
function buildTripsFromRows(rows) {
  const acceptedTrans = new Set(["Validació correcta", "Validació"]);
  const excludedOps = new Set([
    "Emissió",
    "Fabricació",
    "inspecció",
    "Operació de recàrrega",
    "Venda i primera operació de càrrega",
  ]);

  // 1) Normalizar filas básicas
  const events = rows
    .map((r) => {
      const numTrans = parseInt(normalizeStr(r["Num.Transacción"]), 10);
      const dt = parseDateTime(normalizeStr(r["Data"]));

      return {
        numTrans: isNaN(numTrans) ? null : numTrans,
        date: dt,
        dateStr: dt
          ? dt.toISOString().slice(0, 19).replace("T", " ")
          : normalizeStr(r["Data"]),
        agency: normalizeStr(r["Agència"]),
        operation: normalizeStr(r["Operació"]),
        transactionType: normalizeStr(r["Transacció"]),
        stationFix: normalizeStr(r["Estació Fix"]),
      };
    })
    .filter(
      (e) =>
        e.date !== null &&
        e.transactionType &&
        acceptedTrans.has(e.transactionType) &&
        !excludedOps.has(e.operation)
    );

  // 2) Eventos FGC para emparejar entrada/salida
  const fgcEvents = events
    .filter(
      (e) =>
        e.agency === "FGC" &&
        (e.operation === "Validació d'entrada" ||
          e.operation === "Validació de Sortida")
    )
    .sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      // si misma fecha, ordena por número de transacción si existe
      if (a.numTrans != null && b.numTrans != null) {
        return a.numTrans - b.numTrans;
      }
      return 0;
    });

  const trips = [];

  for (let i = 0; i < fgcEvents.length - 1; i++) {
    const ev = fgcEvents[i];
    const next = fgcEvents[i + 1];

    if (
      ev.operation === "Validació d'entrada" &&
      next.operation === "Validació de Sortida" &&
      next.date >= ev.date
    ) {
      const diffMin = (next.date - ev.date) / (1000 * 60);
      // criterio: duración razonable y (opcionalmente) numTrans consecutivo
      const numOK =
        ev.numTrans != null &&
        next.numTrans != null &&
        next.numTrans === ev.numTrans + 1;

      if (diffMin >= 0 && diffMin <= 180 && (numOK || diffMin <= 180)) {
        trips.push({
          agency: ev.agency,
          num_in: ev.numTrans,
          start_time: ev.dateStr,
          station_in: ev.stationFix,
          num_out: next.numTrans,
          end_time: next.dateStr,
          station_out: next.stationFix,
          duration_min: diffMin,
        });
        // Opcional: saltarse la siguiente fila porque ya se ha emparejado
        // i++;
      }
    }
  }

  // 3) Resto de agencias: viaje = una validación de entrada
  const otherEvents = events.filter(
    (e) => e.agency !== "FGC" && e.operation === "Validació d'entrada"
  );

  otherEvents.forEach((ev) => {
    trips.push({
      agency: ev.agency,
      num_in: ev.numTrans,
      start_time: ev.dateStr,
      station_in: ev.stationFix,
      num_out: null,
      end_time: null,
      station_out: null,
      duration_min: null,
    });
  });

  return trips;
}

/** Rellena los selects de estaciones */
function initStations() {
  const set = new Set();

  trips.forEach((t) => {
    if (t.station_in) set.add(t.station_in);
    if (t.station_out) set.add(t.station_out);
  });

  stations = Array.from(set).sort((a, b) => a.localeCompare(b, "es"));

  const singleSelect = document.getElementById("single-station-select");
  const fromSelect = document.getElementById("from-station-select");
  const toSelect = document.getElementById("to-station-select");
  const addOriginBtn = document.getElementById("add-origin-btn");

  [singleSelect, fromSelect, toSelect].forEach((sel) => {
    sel.innerHTML = "";
  });

  singleSelect.add(new Option("Selecciona una estación...", ""));
  fromSelect.add(new Option("Selecciona origen...", ""));
  toSelect.add(new Option("Selecciona destino...", ""));

  stations.forEach((st) => {
    singleSelect.add(new Option(st, st));
    fromSelect.add(new Option(st, st));
    toSelect.add(new Option(st, st));
  });

  singleSelect.disabled = false;
  fromSelect.disabled = false;
  toSelect.disabled = false;
  addOriginBtn.disabled = false;
  document.getElementById("route-button").disabled = false;

  // reiniciamos la lista de orígenes
  selectedOrigins = [];
  renderSelectedOrigins();
}


function setupFilters() {
  const singleSelect = document.getElementById("single-station-select");
  const routeButton = document.getElementById("route-button");
  const addOriginBtn = document.getElementById("add-origin-btn");
  const fromSelect = document.getElementById("from-station-select");

  // Estación individual
  singleSelect.addEventListener("change", () => {
    const station = singleSelect.value;
    if (!station) {
      document.getElementById("single-station-results").innerHTML = "";
      return;
    }
    const stats = computeSingleStationStats(station);
    renderSingleStationStats(station, stats);
  });

  // Añadir origen a la lista
  addOriginBtn.addEventListener("click", () => {
    const value = fromSelect.value;
    if (!value) return;
    if (!selectedOrigins.includes(value)) {
      selectedOrigins.push(value);
      renderSelectedOrigins();
    }
  });

  // Botón de calcular ruta
  routeButton.addEventListener("click", () => {
    const to = document.getElementById("to-station-select").value;
    const bidirectional = document.getElementById("bidirectional-toggle").checked;

    if (selectedOrigins.length === 0 || !to) {
      alert("Selecciona al menos una estación de origen (añadiéndola) y una de destino.");
      return;
    }

    const stats = computeRouteStats(selectedOrigins, to, bidirectional);
    renderRouteStats(selectedOrigins, to, stats, bidirectional);
  });
}

function renderSelectedOrigins() {
  const container = document.getElementById("selected-origins");
  if (!selectedOrigins.length) {
    container.textContent = "Ningún origen seleccionado.";
    return;
  }

  container.innerHTML = selectedOrigins
    .map(
      (st) => `
      <span class="origin-pill">
        ${st}
        <button type="button" onclick="removeOrigin('${st.replace(/'/g, "\\'")}')">×</button>
      </span>
    `
    )
    .join("");
}

function removeOrigin(station) {
  selectedOrigins = selectedOrigins.filter((s) => s !== station);
  renderSelectedOrigins();
}




/** Agrupación genérica por agencia */
function groupByAgency(items) {
  return items.reduce((acc, t) => {
    const key = t.agency || "Desconocida";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

/** Estadísticas de una sola estación */
function computeSingleStationStats(station) {
  const entries = trips.filter((t) => t.station_in === station);
  const exits = trips.filter((t) => t.station_out === station);

  const entriesByAgency = groupByAgency(entries);
  const exitsByAgency = groupByAgency(exits);

  return {
    entriesCount: entries.length,
    exitsCount: exits.length,
    entriesByAgency,
    exitsByAgency,
  };
}

function renderSingleStationStats(station, stats) {
  const container = document.getElementById("single-station-results");

  const entriesBadges = Object.entries(stats.entriesByAgency)
    .map(
      ([agency, count]) =>
        `<span class="badge">${agency}: ${count} entradas</span>`
    )
    .join("");

  const exitsBadges = Object.entries(stats.exitsByAgency)
    .map(
      ([agency, count]) =>
        `<span class="badge">${agency}: ${count} salidas</span>`
    )
    .join("");

  container.innerHTML = `
    <h3>${station}</h3>
    <div class="summary-row">
      <div class="summary-item"><strong>${stats.entriesCount}</strong> entradas</div>
      <div class="summary-item"><strong>${stats.exitsCount}</strong> salidas</div>
    </div>

    <p class="muted" style="margin-top:0.6rem;">Por agencia (entradas):</p>
    ${entriesBadges || '<span class="muted">Ninguna entrada registrada.</span>'}

    <p class="muted" style="margin-top:0.6rem;">Por agencia (salidas):</p>
    ${exitsBadges || '<span class="muted">Ninguna salida registrada.</span>'}
  `;
}

/** Estadísticas de un trayecto origen–destino */
/** Estadísticas de un trayecto origen–destino (opcionalmente bidireccional) */
/** Estadísticas de uno o varios orígenes hacia un destino (opcionalmente bidireccional) */
function computeRouteStats(fromStations, to, bidirectional = false) {
  const routeTrips = trips.filter((t) => {
    const forward =
      fromStations.includes(t.station_in) && t.station_out === to;

    const backward =
      bidirectional &&
      fromStations.includes(t.station_out) &&
      t.station_in === to;

    return forward || backward;
  });

  if (routeTrips.length === 0) {
    return null;
  }

  const durations = routeTrips
    .map((t) => t.duration_min)
    .filter((d) => typeof d === "number" && !Number.isNaN(d));

  let avg = null,
    min = null,
    max = null,
    totalMinutes = null;

  if (durations.length > 0) {
    totalMinutes = durations.reduce((acc, d) => acc + d, 0);
    avg = totalMinutes / durations.length;
    min = Math.min(...durations);
    max = Math.max(...durations);
  }

  const byAgency = groupByAgency(routeTrips);

  return {
    count: routeTrips.length,
    avgDuration: avg,
    minDuration: min,
    maxDuration: max,
    totalMinutes,
    byAgency,
    trips: routeTrips,
  };
}



function renderRouteStats(fromStations, to, stats, bidirectional = false) {
  const summary = document.getElementById("route-results");
  const tbody = document.getElementById("route-trips-body");
  tbody.innerHTML = "";

  const originsLabel =
    fromStations.length === 1
      ? fromStations[0]
      : fromStations.length <= 3
      ? fromStations.join(", ")
      : `${fromStations.length} estaciones de origen`;

  if (!stats) {
    summary.innerHTML = `
      <p class="muted">No se han encontrado viajes de <strong>${originsLabel}</strong> a <strong>${to}</strong>.</p>
    `;
    currentRouteTrips = [];
    updateHeaderSortIndicators();
    return;
  }

  const directionText = bidirectional
    ? `entre ${originsLabel} y ${to} (ambos sentidos)`
    : `de ${originsLabel} a ${to}`;

  const byAgencyPills = Object.entries(stats.byAgency)
    .map(
      ([agency, count]) =>
        `<span class="pill"><span class="key">${agency}</span><span>${count} viajes</span></span>`
    )
    .join("");

  let totalBlock = "";
  if (stats.totalMinutes != null) {
    const hours = stats.totalMinutes / 60;
    const days = stats.totalMinutes / (60 * 24);
    totalBlock = `<div class="summary-item">
      Total: <strong>${stats.totalMinutes.toFixed(
        1
      )}</strong> min (~${hours.toFixed(1)} h, ~${days.toFixed(2)} días)
    </div>`;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <div class="summary-item"><strong>${stats.count}</strong> viajes ${directionText}</div>
      ${
        stats.avgDuration !== null
          ? `<div class="summary-item">Media: <strong>${stats.avgDuration.toFixed(
              1
            )}</strong> min</div>`
          : ""
      }
      ${
        stats.minDuration !== null
          ? `<div class="summary-item">Mín: <strong>${stats.minDuration.toFixed(
              1
            )}</strong> min</div>`
          : ""
      }
      ${
        stats.maxDuration !== null
          ? `<div class="summary-item">Máx: <strong>${stats.maxDuration.toFixed(
              1
            )}</strong> min</div>`
          : ""
      }
      ${totalBlock}
    </div>
    <div style="margin-top:0.5rem;">
      ${byAgencyPills}
    </div>
  `;

  // Guardamos los viajes actuales para poder ordenarlos
  currentRouteTrips = stats.trips.slice();
  currentSort = { column: null, asc: true };
  updateHeaderSortIndicators();
  renderRouteTable();
}

function setupTableSorting() {
  const headers = document.querySelectorAll("table thead th");

  headers.forEach((th, index) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      if (!currentRouteTrips || currentRouteTrips.length === 0) return;

      if (currentSort.column === index) {
        currentSort.asc = !currentSort.asc; // alterna asc/desc
      } else {
        currentSort.column = index;
        currentSort.asc = true;
      }

      sortCurrentTrips();
      updateHeaderSortIndicators();
      renderRouteTable();
    });
  });
}

function sortCurrentTrips() {
  const col = currentSort.column;
  const ascFactor = currentSort.asc ? 1 : -1;

  currentRouteTrips.sort((a, b) => {
    let va, vb;
    switch (col) {
      case 0: // Fecha inicio
        va = a.start_time || "";
        vb = b.start_time || "";
        return va.localeCompare(vb) * ascFactor;
      case 1: // Agencia
        va = a.agency || "";
        vb = b.agency || "";
        return va.localeCompare(vb) * ascFactor;
      case 2: // Desde
        va = a.station_in || "";
        vb = b.station_in || "";
        return va.localeCompare(vb) * ascFactor;
      case 3: // Hasta
        va = a.station_out || "";
        vb = b.station_out || "";
        return va.localeCompare(vb) * ascFactor;
      case 4: // Duración
        va =
          typeof a.duration_min === "number" && !Number.isNaN(a.duration_min)
            ? a.duration_min
            : Infinity;
        vb =
          typeof b.duration_min === "number" && !Number.isNaN(b.duration_min)
            ? b.duration_min
            : Infinity;
        return (va - vb) * ascFactor;
      default:
        return 0;
    }
  });
}

function renderRouteTable() {
  const tbody = document.getElementById("route-trips-body");
  tbody.innerHTML = "";

  currentRouteTrips.slice(0, MAX_ROWS).forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.start_time || ""}</td>
      <td>${t.agency || ""}</td>
      <td>${t.station_in || ""}</td>
      <td>${t.station_out || ""}</td>
      <td>${t.duration_min != null ? t.duration_min.toFixed(1) : ""}</td>
    `;
    tbody.appendChild(tr);
  });

  if (currentRouteTrips.length > MAX_ROWS) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="5" class="muted">Mostrando solo los primeros ${MAX_ROWS} viajes…</td>
    `;
    tbody.appendChild(tr);
  }
}

function updateHeaderSortIndicators() {
  const headers = document.querySelectorAll("table thead th");

  headers.forEach((th, idx) => {
    const base = th.dataset.label || th.textContent.replace(/[▲▼]/g, "").trim();
    if (currentSort.column === idx) {
      th.textContent = base + (currentSort.asc ? " ▲" : " ▼");
    } else {
      th.textContent = base;
    }
  });
}



