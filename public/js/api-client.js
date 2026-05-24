(() => {
  const DEFAULT_API_BASE_URL = 'https://pwa-optimizacion.onrender.com';

  const STORAGE_KEYS = {
    apiBaseUrl: 'mapaApiBaseUrl',
    authToken: 'mapaApiToken'
  };

  function getApiBaseUrl() {
    return (
      localStorage.getItem(STORAGE_KEYS.apiBaseUrl) ||
      window.MAPA_API_BASE_URL ||
      DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '');
  }

  function getAuthToken() {
    return (
      localStorage.getItem(STORAGE_KEYS.authToken) ||
      window.MAPA_API_TOKEN ||
      ''
    );
  }

function buildHeaders(extraHeaders = {}) {
  const token = getAuthToken();

  return {
    Accept: 'application/json',
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

  async function request(path, options = {}) {
    const apiBaseUrl = getApiBaseUrl();
    const url = `${apiBaseUrl}${path}`;

    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      ...options,
      headers: buildHeaders(options.headers || {})
    });

    const contentType = response.headers.get('content-type') || '';

    let data = null;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();

      data = {
        ok: false,
        message: text || response.statusText
      };
    }

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || `Error HTTP ${response.status}`);
    }

    return data;
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;

    const number = Number(String(value).replace(',', '.'));

    return Number.isFinite(number) ? number : null;
  }

  function normalizeBoolean(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;

    const text = normalizeText(value);

    if (['true', '1', 'si', 'sí', 'yes', 'y'].includes(text)) return true;
    if (['false', '0', 'no', 'n'].includes(text)) return false;

    return false;
  }

  function cleanNote(value) {
    const raw = String(value || '').trim();

    if (!raw) return null;

    const normalized = normalizeText(raw).toUpperCase();

    const placeholders = new Set([
      'SIN INFORMACION',
      'S/I',
      'N/A',
      'NA',
      'NULL',
      'UNDEFINED',
      '-',
      'SI',
      'NO'
    ]);

    if (placeholders.has(normalized)) return null;

    return raw;
  }

  function normalizeDateInputValue(value) {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const text = String(value).trim();
    if (!text) return null;

    // YYYY-MM-DD o ISO: 2026-03-06 / 2026-03-06T00:00:00.000Z
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    // DD-MM-YYYY
    const dmyDash = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmyDash) return `${dmyDash[3]}-${dmyDash[2]}-${dmyDash[1]}`;

    // DD/MM/YYYY
    const dmySlash = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmySlash) return `${dmySlash[3]}-${dmySlash[2]}-${dmySlash[1]}`;

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  function formatDateDdMmYyyy(value) {
    const date = normalizeDateInputValue(value);
    if (!date) return null;

    const [year, month, day] = date.split('-');
    return `${day}-${month}-${year}`;
  }

  function getFechaArranqueFromApi(pozo = {}) {
    return normalizeDateInputValue(
      pozo.fechaUltimoServicio ??
      pozo.fecha_arranque ??
      pozo.fechaArranque ??
      pozo.fecha_ultimo_servicio ??
      null
    );
  }

  function getFechaArranqueFormateadaFromApi(pozo = {}) {
    return (
      pozo.fecha_arranque_formateada ||
      pozo.fechaArranqueFormateada ||
      formatDateDdMmYyyy(
        pozo.fechaUltimoServicio ??
        pozo.fecha_arranque ??
        pozo.fechaArranque ??
        pozo.fecha_ultimo_servicio ??
        null
      ) ||
      null
    );
  }

  function normalizeEstadoForMapa(value) {
    const text = normalizeText(value);

    if (text === 'activo') return 'activo';
    if (text === 'diferido') return 'diferido';
    if (text === 'candidato' || text === 'candidatos') return 'candidato';
    if (text === 'diagnostico') return 'diagnostico';

    if (
      text === 'en servicio' ||
      text === 'servicio' ||
      text === 'en-servicio'
    ) {
      return 'en-servicio';
    }

    if (
      text === 'inactivo en espera por servicio' ||
      text === 'en espera' ||
      text === 'espera' ||
      text === 'inactivo-servicio' ||
      text === 'inactivo por servicio'
    ) {
      return 'inactivo-servicio';
    }

    return text || 'activo';
  }

  function normalizeEstadoForApi(value) {
    const estado = normalizeEstadoForMapa(value);

    const labels = {
      activo: 'Activo',
      diferido: 'Diferido',
      candidato: 'Candidato',
      diagnostico: 'Diagnóstico',
      'en-servicio': 'En servicio',
      'inactivo-servicio': 'Inactivo en espera por servicio'
    };

    return labels[estado] || value;
  }

  function normalizeDiagrama(value) {
    const text = normalizeText(value).replace(/_/g, '-');

    const aliases = {
      'bare tradicional': 'bare-tradicional',
      'bare-tradicional': 'bare-tradicional',

      'bare 6': 'bare-6',
      'bare-6': 'bare-6',

      'bare 6 norte': 'bare-6-norte',
      'bare-6-norte': 'bare-6-norte',

      'bare este': 'bare-este',
      'bare-este': 'bare-este',

      'asfaltada y tigra': 'bare-este',
      trilla: 'bare-este',

      'sin asignar': 'sin-asignar',
      'sin-asignar': 'sin-asignar'
    };

    return aliases[text] || text || 'sin-asignar';
  }

  function normalizeZona(value) {
    const raw = String(value || '').trim();

    if (!raw) return null;

    const text = normalizeText(raw).replace(/_/g, '-');

    const aliases = {
      'bare-tradicional': 'Bare Tradicional',
      'bare tradicional': 'Bare Tradicional',
      tradicional: 'Bare Tradicional',

      'bare 6': 'Bare 6',
      'bare-6': 'Bare 6',
      'bare 6 norte': 'Bare 6',
      'bare-6-norte': 'Bare 6',

      trilla: 'Trilla',

      asfaltada: 'Asfaltada y Tigra',
      tigra: 'Asfaltada y Tigra',
      'asfaltada y tigra': 'Asfaltada y Tigra',

      guaicaipuro: 'Guaicaipuro'
    };

    return aliases[text] || raw;
  }

  function getVelocidadActualFromApi(pozo = {}) {
    return normalizeNumber(
      pozo.velocidadActual ??
      pozo.vel_actual ??
      pozo.velocidad_actual ??
      pozo.rpm ??
      null
    );
  }

  function getVelocidadOperacionalFromApi(pozo = {}) {
    return normalizeNumber(
      pozo.velocidadOperacional ??
      pozo.vel_operacional ??
      pozo.velocidad_operacional ??
      null
    );
  }

  function normalizePozoFromApi(pozo = {}) {
    const coordsMapa = Array.isArray(pozo.coordsMapa)
      ? pozo.coordsMapa
      : (
        pozo.latitud != null && pozo.longitud != null
          ? [Number(pozo.latitud), Number(pozo.longitud)]
          : null
      );

    const coordsDiagrama = Array.isArray(pozo.coordsDiagrama)
      ? pozo.coordsDiagrama
      : (
        Array.isArray(pozo.coords)
          ? pozo.coords
          : (
            pozo.coord_x != null && pozo.coord_y != null
              ? [Number(pozo.coord_y), Number(pozo.coord_x)]
              : null
          )
      );

    const estado = normalizeEstadoForMapa(pozo.estado);
    const servicioAsignado = pozo.servicioAsignado || pozo.servicio_asignado || pozo.taladro || null;
    const nota = cleanNote(pozo.nota || pozo.notaOperativa || pozo.nota_operativa);

    const velocidadActual = getVelocidadActualFromApi(pozo);
    const velocidadOperacional = getVelocidadOperacionalFromApi(pozo);

    const fechaArranque = getFechaArranqueFromApi(pozo);
    const fechaArranqueFormateada = getFechaArranqueFormateadaFromApi(pozo);

    return {
      id: pozo.codigo || String(pozo.id || ''),
      dbId: pozo.dbId || pozo.id,

      estado,
      categoria: Number(pozo.categoria) || null,

      zona: normalizeZona(pozo.zona || pozo.area),
      area: normalizeZona(pozo.area || pozo.zona),

      diagrama: normalizeDiagrama(pozo.diagrama),
      coordsMapa,
      coordsDiagrama,
      coords: coordsMapa || coordsDiagrama,

      potencial: normalizeNumber(pozo.potencial),
      nota,

      cabezal: pozo.cabezal || null,
      variador: pozo.variador || null,

      /**
       * Velocidad actual viene desde PWA/Aiven.
       * Normalmente sale de vw_mapa_pozos_sync.vel_actual,
       * alimentada por parametros_diarios / rpm.
       */
      velocidadActual,

      /**
       * Se conserva como referencia secundaria,
       * pero el mapa debe mostrar velocidadActual.
       */
      velocidadOperacional,

      /**
       * Fecha de arranque.
       * La API puede enviarla como fecha_arranque/fechaArranque/fechaUltimoServicio.
       * Internamente se guarda como YYYY-MM-DD y el main.js la muestra DD-MM-YYYY.
       */
      fechaUltimoServicio: fechaArranque,
      fechaArranque,
      fecha_arranque: fechaArranque,
      fecha_arranque_formateada: fechaArranqueFormateada,
      fechaArranqueFormateada: fechaArranqueFormateada,

      altoCorteAgua: normalizeBoolean(pozo.altoCorteAgua ?? pozo.alto_corte_agua),
      vistaMapa: pozo.vistaMapa !== false && pozo.vista_mapa !== false,

      taladro: servicioAsignado,
      servicioAsignado,
      tipoServicio: pozo.tipoServicio || pozo.tipo_servicio || null,
      estadoAsignacion: pozo.estadoAsignacion || pozo.estado_asignacion || null,
      fechaAsignacion: pozo.fechaAsignacion || pozo.fecha_asignacion || null,

      yacimiento: pozo.yacimiento || null,

      _source: 'pwa-api',
      _raw: pozo
    };
  }

  function normalizePozoToApi(pozo = {}) {
    /**
     * Importante:
     * No enviamos velocidadActual desde el mapa.
     * Esa velocidad debe venir desde parámetros/PWA, no editarse desde mapaBare.
     */
    const fechaArranque = normalizeDateInputValue(
      pozo.fechaUltimoServicio ??
      pozo.fechaArranque ??
      pozo.fecha_arranque ??
      null
    );

    return {
      codigo: pozo.id,
      estado: normalizeEstadoForApi(pozo.estado),
      categoria: pozo.categoria,

      area: pozo.zona || pozo.area,
      zona: pozo.zona || pozo.area,

      diagrama: pozo.diagrama,
      coordsMapa: pozo.coordsMapa || null,
      coordsDiagrama: pozo.coordsDiagrama || null,

      potencial: pozo.potencial,
      nota: cleanNote(pozo.nota),
      notaOperativa: cleanNote(pozo.nota),

      cabezal: pozo.cabezal,
      variador: pozo.variador,

      altoCorteAgua: pozo.altoCorteAgua,
      vistaMapa: pozo.vistaMapa,

      fechaUltimoServicio: fechaArranque,
      fechaArranque,
      fecha_arranque: fechaArranque
    };
  }

  function normalizeServicioPayload({ pozo, servicio, estadoAnterior = null, causaDiferido = null } = {}) {
    return {
      id_pozo: pozo?.dbId || pozo?.id_pozo || pozo?.idPozo || null,
      codigo: pozo?.id || pozo?.codigo || null,
      nombre_servicio: servicio,
      servicio,
      tipo_servicio: servicio === 'CT' || servicio === 'WT' ? servicio : 'Taladro',
      estado_asignacion: 'activo',
      observacion: causaDiferido || estadoAnterior || null
    };
  }

  async function getPozos(filters = {}) {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, value);
      }
    });

    const query = params.toString();
    const data = await request(`/api/mapa/pozos${query ? `?${query}` : ''}`);

    return (data.pozos || data.data || []).map(normalizePozoFromApi);
  }

  async function getPozo(id) {
    const data = await request(`/api/mapa/pozos/${encodeURIComponent(id)}`);

    return normalizePozoFromApi(data.pozo || data.data);
  }

  async function updatePozo(pozo) {
    const id = pozo.dbId || pozo.id;
    const payload = normalizePozoToApi(pozo);

    const data = await request(`/api/mapa/pozos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    return normalizePozoFromApi(data.pozo || data.data);
  }

  async function asignarServicio({ pozo, servicio, estadoAnterior = null, causaDiferido = null }) {
    const data = await request('/api/mapa/servicios/asignar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(normalizeServicioPayload({
        pozo,
        servicio,
        estadoAnterior,
        causaDiferido
      }))
    });

    return data.pozo ? normalizePozoFromApi(data.pozo) : data;
  }

  async function desasignarServicio({
    pozo,
    servicio = null,
    estadoFinal = 'Activo',
    causaDiferido = null,
    observacion = null
  } = {}) {
    const data = await request('/api/mapa/servicios/desasignar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id_pozo: pozo?.dbId || pozo?.id_pozo || pozo?.idPozo || null,
        codigo: pozo?.id || pozo?.codigo || null,
        servicio,
        estadoFinal,
        causaDiferido,
        observacion: observacion || causaDiferido || null
      })
    });

    if (Array.isArray(data.pozos)) {
      return data.pozos.map(normalizePozoFromApi);
    }

    return data.pozo ? normalizePozoFromApi(data.pozo) : data;
  }

  async function updateServicioAsignado(id, payload = {}) {
    const data = await request(`/api/mapa/servicios/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (Array.isArray(data.pozos)) {
      return data.pozos.map(normalizePozoFromApi);
    }

    return data.pozo ? normalizePozoFromApi(data.pozo) : data;
  }

  async function getServicios() {
    const data = await request('/api/mapa/servicios');

    return data.servicios || [];
  }

  window.MapaApi = {
    getApiBaseUrl,
    getAuthToken,

    getPozos,
    getPozo,
    updatePozo,

    asignarServicio,
    desasignarServicio,
    updateServicioAsignado,
    getServicios,

    normalizePozoFromApi,
    normalizePozoToApi,

    utils: {
      normalizeEstadoForMapa,
      normalizeEstadoForApi,
      normalizeDiagrama,
      normalizeZona,
      normalizeNumber,
      normalizeBoolean,
      normalizeDateInputValue,
      formatDateDdMmYyyy,
      cleanNote
    }
  };
})();