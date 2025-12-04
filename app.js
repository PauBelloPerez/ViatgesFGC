let trips = []; // viajes reconstruidos (entrada/salida)
let stations = [];

document.addEventListener("DOMContentLoaded", () => {
  setupFileInput();
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

  // limpiar opciones antiguas
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
  document.getElementById("route-button").disabled = false;
}

function setupFilters() {
  const singleSelect = document.getElementById("single-station-select");
  const routeButton = document.getElementById("route-button");

  singleSelect.addEventListener("change", () => {
    const station = singleSelect.value;
    if (!station) {
      document.getElementById("single-station-results").innerHTML = "";
      return;
    }
    const stats = computeSingleStationStats(station);
    renderSingleStationStats(station, stats);
  });

  routeButton.addEventListener("click", () => {
    const from = document.getElementById("from-station-select").value;
    const to = document.getElementById("to-station-select").value;

    if (!from || !to) {
      alert("Selecciona origen y destino.");
      return;
    }
    const stats = computeRouteStats(from, to);
    renderRouteStats(from, to, stats);
  });
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
function computeRouteStats(from, to) {
  const routeTrips = trips.filter(
    (t) => t.station_in === from && t.station_out === to
  );

  if (routeTrips.length === 0) {
    return null;
  }

  const durations = routeTrips
    .map((t) => t.duration_min)
    .filter((d) => typeof d === "number" && !Number.isNaN(d));

  let avg = null,
    min = null,
    max = null;

  if (durations.length > 0) {
    const sum = durations.reduce((acc, d) => acc + d, 0);
    avg = sum / durations.length;
    min = Math.min(...durations);
    max = Math.max(...durations);
  }

  const byAgency = groupByAgency(routeTrips);

  return {
    count: routeTrips.length,
    avgDuration: avg,
    minDuration: min,
    maxDuration: max,
    byAgency,
    trips: routeTrips,
  };
}

function renderRouteStats(from, to, stats) {
  const summary = document.getElementById("route-results");
  const tbody = document.getElementById("route-trips-body");
  tbody.innerHTML = "";

  if (!stats) {
    summary.innerHTML = `
      <p class="muted">No se han encontrado viajes de <strong>${from}</strong> a <strong>${to}</strong> (en esa dirección).</p>
    `;
    return;
  }

  const byAgencyPills = Object.entries(stats.byAgency)
    .map(
      ([agency, count]) =>
        `<span class="pill"><span class="key">${agency}</span><span>${count} viajes</span></span>`
    )
    .join("");

  summary.innerHTML = `
    <div class="summary-row">
      <div class="summary-item"><strong>${stats.count}</strong> viajes de ${from} a ${to}</div>
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
    </div>
    <div style="margin-top:0.5rem;">
      ${byAgencyPills}
    </div>
  `;

  const maxRows = 200;
  stats.trips.slice(0, maxRows).forEach((t) => {
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

  if (stats.trips.length > maxRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="5" class="muted">Mostrando solo los primeros ${maxRows} viajes…</td>
    `;
    tbody.appendChild(tr);
  }
}
