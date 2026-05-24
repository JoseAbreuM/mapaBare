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

  function normalizeEstadoForMapa(value) {
    const text = String(value || '').trim().toLowerCase();

    if (text === 'activo') return 'activo';
    if (text === 'diferido') return 'diferido';
    if (text === 'candidato') return 'candidato';
    if (text === 'diagnóstico' || text === 'diagnostico') return 'diagnostico';
    if (text === 'en servicio') return 'en-servicio';
    if (text === 'inactivo en espera por servicio') return 'inactivo-servicio';
    if (text === 'en espera') return 'inactivo-servicio';

    return text || 'activo';
  }

  function normalizeDiagrama(value) {
    const text = String(value || '').trim().toLowerCase();

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
      'trilla': 'bare-este'
    };

    return aliases[text] || text || 'sin-asignar';
  }

  function normalizeZona(value) {
    const text = String(value || '').trim();

    if (!text) return null;

    return text;
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
          : null
      );

    const estado = normalizeEstadoForMapa(pozo.estado);
    const taladro = pozo.servicioAsignado || pozo.taladro || null;

    return {
      id: pozo.codigo || String(pozo.id || ''),
      dbId: pozo.id,

      estado,
      categoria: Number(pozo.categoria) || null,

      zona: normalizeZona(pozo.zona || pozo.area),
      area: pozo.area || pozo.zona || null,

      diagrama: normalizeDiagrama(pozo.diagrama),
      coordsMapa,
      coordsDiagrama,
      coords: coordsMapa || coordsDiagrama,

      potencial: pozo.potencial != null ? Number(pozo.potencial) : null,
      nota: pozo.nota || pozo.notaOperativa || null,

      cabezal: pozo.cabezal || null,
      variador: pozo.variador || null,

      velocidadOperacional: pozo.velocidadOperacional ?? pozo.vel_operacional ?? null,
      velocidadActual: pozo.velocidadActual ?? pozo.vel_actual ?? null,

      altoCorteAgua: Boolean(pozo.altoCorteAgua),
      vistaMapa: pozo.vistaMapa !== false,

      taladro,
      servicioAsignado: taladro,
      tipoServicio: pozo.tipoServicio || pozo.tipo_servicio || null,
      estadoAsignacion: pozo.estadoAsignacion || pozo.estado_asignacion || null,
      fechaUltimoServicio: pozo.fechaAsignacion || pozo.fecha_asignacion || null,

      yacimiento: pozo.yacimiento || null,

      _source: 'pwa-api',
      _raw: pozo
    };
  }

  function normalizePozoToApi(pozo = {}) {
    return {
      codigo: pozo.id,
      estado: pozo.estado,
      categoria: pozo.categoria,

      area: pozo.zona || pozo.area,
      zona: pozo.zona || pozo.area,

      diagrama: pozo.diagrama,
      coordsMapa: pozo.coordsMapa || null,
      coordsDiagrama: pozo.coordsDiagrama || null,

      potencial: pozo.potencial,
      nota: pozo.nota,
      notaOperativa: pozo.nota,

      cabezal: pozo.cabezal,
      variador: pozo.variador,

      velocidadOperacional: pozo.velocidadOperacional,
      altoCorteAgua: pozo.altoCorteAgua,
      vistaMapa: pozo.vistaMapa
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
      body: JSON.stringify({
        id_pozo: pozo.dbId || pozo.id,
        nombre_servicio: servicio,
        tipo_servicio: 'servicio',
        estado_asignacion: 'activo',
        observacion: causaDiferido || estadoAnterior || null
      })
    });

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
    getServicios,
    normalizePozoFromApi,
    normalizePozoToApi
  };
})();