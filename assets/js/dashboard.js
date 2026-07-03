/* =========================================================
   NIVO DASHBOARD JS
   Archivo: assets/js/dashboard.js

   Función:
   - Proteger dashboard solo para admin activo.
   - Cargar métricas reales desde Firestore.
   - Leer usuarios, conductores, comercios, agentes y zonas.
   - Aprobar / rechazar / pedir corrección / bloquear conductores.
   - Aprobar / rechazar / pedir corrección / bloquear comercios.
   - Convertir usuarios registrados en administradores creando admin_profiles/{uid}.
   - Crear auditoría en admin_actions/{actionId}.
   - Controlar sidebar, secciones, drawer, modales, filtros y toasts.

   Importante:
   - El admin NO se crea cambiando users/{uid}.role.
   - El admin se crea con admin_profiles/{uid}.
   - Este archivo depende de assets/js/auth.js.
========================================================= */

import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================================
   DOM READY BASE
========================================================= */

document.documentElement.classList.remove("no-js");

/* =========================================================
   CONSTANTES
========================================================= */

const COLLECTIONS = Object.freeze({
  users: "users",
  adminProfiles: "admin_profiles",
  driverProfiles: "driver_profiles",
  commerceProfiles: "commerce_profiles",
  agentProfiles: "agent_profiles",
  serviceZones: "service_zones",
  rideTypes: "ride_types",
  adminActions: "admin_actions",
  notifications: "notifications",
  notificationTokens: "notification_tokens",
  deliveryOrders: "delivery_orders",
  rideRequests: "ride_requests",
  incidents: "incidents",
  supportTickets: "support_tickets",
  sanctions: "sanctions",
  wallets: "wallets",
  walletLedger: "wallet_ledger",
  topups: "topups",
  agentTopups: "agent_topups",
  paymentTransactions: "payment_transactions",
  cashSettlements: "cash_settlements",
  driverLocations: "driver_locations",
  activeUserLocations: "active_user_locations",
  appSettings: "app_settings",
});

const SECTION_META = Object.freeze({
  overview: {
    title: "Centro operativo NIVO",
    breadcrumb: "Dashboard / Resumen",
  },
  users: {
    title: "Usuarios registrados",
    breadcrumb: "Dashboard / Usuarios",
  },
  drivers: {
    title: "Conductores y repartidores",
    breadcrumb: "Dashboard / Conductores",
  },
  "driver-review": {
    title: "Aprobación de conductores",
    breadcrumb: "Dashboard / Revisión conductores",
  },
  commerce: {
    title: "Comercios registrados",
    breadcrumb: "Dashboard / Comercios",
  },
  "commerce-review": {
    title: "Aprobación de comercios",
    breadcrumb: "Dashboard / Revisión comercios",
  },
  agents: {
    title: "Agentes NIVO",
    breadcrumb: "Dashboard / Agentes",
  },
  zones: {
    title: "Zonas operativas",
    breadcrumb: "Dashboard / Zonas",
  },
  "ride-types": {
    title: "Categorías de transporte",
    breadcrumb: "Dashboard / Categorías transporte",
  },
  pricing: {
    title: "Tarifas y comisiones",
    breadcrumb: "Dashboard / Tarifas",
  },
  delivery: {
    title: "Delivery / Órdenes",
    breadcrumb: "Dashboard / Delivery",
  },
  rides: {
    title: "Viajes / Solicitudes",
    breadcrumb: "Dashboard / Viajes",
  },
  locations: {
    title: "Ubicaciones operativas",
    breadcrumb: "Dashboard / Ubicaciones",
  },
  wallet: {
    title: "Wallet / Recargas",
    breadcrumb: "Dashboard / Wallet",
  },
  "cash-settlements": {
    title: "Liquidaciones de efectivo",
    breadcrumb: "Dashboard / Liquidaciones",
  },
  support: {
    title: "Soporte e incidencias",
    breadcrumb: "Dashboard / Soporte",
  },
  sanctions: {
    title: "Sanciones y bloqueos",
    breadcrumb: "Dashboard / Sanciones",
  },
  notifications: {
    title: "Notificaciones",
    breadcrumb: "Dashboard / Notificaciones",
  },
  audit: {
    title: "Auditoría administrativa",
    breadcrumb: "Dashboard / Auditoría",
  },
  settings: {
    title: "Configuración general",
    breadcrumb: "Dashboard / Configuración",
  },
});

const DRIVER_REVIEW_STATUSES = new Set([
  "pending_documents",
  "pending_review",
  "correction_required",
]);

const COMMERCE_REVIEW_STATUSES = new Set([
  "pending_profile",
  "pending_review",
  "correction_required",
]);

const BLOCKED_STATUSES = new Set([
  "blocked",
  "rejected",
  "suspended",
  "disabled",
  "account_restricted",
]);

const VEHICLE_LABELS = Object.freeze({
  car: "Carro",
  vehicle: "Carro",
  motorcycle: "Moto",
  moto: "Moto",
  mototaxi: "Mototaxi",
  qute: "Qute",
  bicycle: "Bicicleta",
  pickup: "Pickup",
});

const STATUS_LABELS = Object.freeze({
  active: "Activo",
  inactive: "Inactivo",
  pending_profile: "Perfil pendiente",
  pending_documents: "Documentos pendientes",
  pending_review: "En revisión",
  pending_activation: "Activación pendiente",
  correction_required: "Corrección requerida",
  rejected: "Rechazado",
  blocked: "Bloqueado",
  suspended: "Suspendido",
  disabled: "Deshabilitado",
  account_restricted: "Cuenta restringida",
  approved: "Aprobado",
});

const ROLE_LABELS = Object.freeze({
  user: "Usuario",
  driver: "Conductor",
  commerce: "Comercio",
  agent: "Agente",
  admin: "Admin",
  owner: "Owner",
  super_admin: "Super admin",
  operations: "Operaciones",
  support: "Soporte",
  finance: "Finanzas",
  reviewer: "Reviewer",
  viewer: "Viewer",
});

const DEFAULT_LIMITS = Object.freeze({
  users: 750,
  drivers: 750,
  commerce: 750,
  agents: 500,
  zones: 250,
  rideTypes: 100,
  audit: 150,
  notifications: 120,
  deliveryOrders: 200,
  rideRequests: 200,
  incidents: 200,
  sanctions: 200,
  walletLedger: 200,
  cashSettlements: 200,
  locations: 200,
});

/* =========================================================
   ESTADO GLOBAL
========================================================= */

const state = {
  initialized: false,
  authCore: null,
  auth: null,
  db: null,
  firebaseUser: null,
  adminContext: null,

  currentSection: "overview",
  currentDriverQuickFilter: "all",
  activeDetail: null,

  users: [],
  adminProfiles: [],
  drivers: [],
  commerce: [],
  agents: [],
  serviceZones: [],
  rideTypes: [],
  adminActions: [],
  notifications: [],
  deliveryOrders: [],
  rideRequests: [],
  incidents: [],
  sanctions: [],
  walletLedger: [],
  cashSettlements: [],
  driverLocations: [],
  activeUserLocations: [],
  appSettings: [],

  indexes: {
    usersById: new Map(),
    driversById: new Map(),
    commerceById: new Map(),
    agentsById: new Map(),
    adminsById: new Map(),
    zonesById: new Map(),
    rideTypesById: new Map(),
  },

  pendingConfirm: null,
};

/* =========================================================
   SELECTORES
========================================================= */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/* =========================================================
   INICIALIZACIÓN
========================================================= */

main();

async function main() {
  try {
    bindStaticUiEvents();
    await waitForAuthCore();
    await protectDashboard();
  } catch (error) {
    console.error("[NIVO Dashboard] Error inicial:", error);
    showAccessDenied(error.message || "No se pudo iniciar el dashboard.");
  }
}

async function waitForAuthCore() {
  const startedAt = Date.now();

  while (!window.NIVOAuthCore) {
    if (Date.now() - startedAt > 9000) {
      throw new Error("No se pudo cargar assets/js/auth.js correctamente.");
    }

    await sleep(100);
  }

  state.authCore = window.NIVOAuthCore;
  state.auth = state.authCore.getAuth();
  state.db = state.authCore.getDb();

  return state.authCore;
}

function protectDashboard() {
  return new Promise((resolve) => {
    onAuthStateChanged(state.auth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          safeRedirect("login.html");
          resolve(false);
          return;
        }

        state.firebaseUser = firebaseUser;

        const context = await window.NIVOResolveUserAccess(firebaseUser);

        if (!context || context.role !== "admin") {
          throw new Error("La cuenta actual no tiene perfil administrativo activo.");
        }

        state.adminContext = context;

        setAdminUi(context);
        showDashboardShell();

        if (!state.initialized) {
          state.initialized = true;
          await loadDashboardData();
        }

        resolve(true);
      } catch (error) {
        console.error("[NIVO Dashboard] Acceso denegado:", error);
        showAccessDenied(error.message || "No tienes permisos para entrar al dashboard.");
        resolve(false);
      }
    });
  });
}

/* =========================================================
   UI BASE
========================================================= */

function showDashboardShell() {
  $("#dashboardAuthGate")?.setAttribute("hidden", "");
  $("#dashboardAccessDenied")?.setAttribute("hidden", "");
  $("#dashboardShell")?.removeAttribute("hidden");
}

function showAccessDenied(message) {
  $("#dashboardAuthGate")?.setAttribute("hidden", "");
  $("#dashboardShell")?.setAttribute("hidden", "");

  const denied = $("#dashboardAccessDenied");
  if (denied) denied.removeAttribute("hidden");

  const cardText = $("#dashboardAccessDenied p:not(.eyebrow)");
  if (cardText && message) {
    cardText.textContent = message;
  }
}

function setAdminUi(context) {
  const name =
    context.displayName ||
    context.fullName ||
    context.email ||
    "Admin NIVO";

  setText("sidebarAdminName", name);
  setText("sidebarAdminEmail", context.email || "Sin correo");
  setText("sidebarAdminRole", ROLE_LABELS[context.adminRole] || context.adminRole || "admin");
}

function bindStaticUiEvents() {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("submit", handleDocumentSubmit);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("keydown", handleDocumentKeydown);

  $("#globalSearch")?.addEventListener("input", debounce(() => {
    renderCurrentSection();
  }, 180));

  $("#refreshDashboardBtn")?.addEventListener("click", () => {
    loadDashboardData({ forceToast: true });
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    await logout();
  });

  $("#sidebarOpenBtn")?.addEventListener("click", () => {
    document.body.classList.add("sidebar-open", "is-locked");
  });

  $("#sidebarCloseBtn")?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open", "is-locked");
  });

  bindFilter("usersSearchInput", renderUsersTable);
  bindFilter("usersRoleFilter", renderUsersTable);
  bindFilter("usersStatusFilter", renderUsersTable);
  bindFilter("usersZoneFilter", renderUsersTable);

  bindFilter("driversSearchInput", renderDriversTable);
  bindFilter("driversVehicleFilter", renderDriversTable);
  bindFilter("driversServiceFilter", renderDriversTable);
  bindFilter("driversZoneFilter", renderDriversTable);

  bindFilter("commerceSearchInput", renderCommerceTable);
  bindFilter("commerceStatusFilter", renderCommerceTable);
  bindFilter("commercePlanFilter", renderCommerceTable);
  bindFilter("commerceZoneFilter", renderCommerceTable);
}

function bindFilter(id, callback) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", debounce(callback, 120));
  el.addEventListener("change", callback);
}

function handleDocumentClick(event) {
  const target = event.target.closest("[data-action], [data-section-target], [data-detail-tab], [data-driver-filter]");
  if (!target) return;

  const sectionTarget = target.dataset.sectionTarget;
  if (sectionTarget) {
    showSection(sectionTarget);
    return;
  }

  const driverFilter = target.dataset.driverFilter;
  if (driverFilter) {
    setDriverQuickFilter(driverFilter);
    return;
  }

  const detailTab = target.dataset.detailTab;
  if (detailTab) {
    showDetailTab(detailTab);
    return;
  }

  const action = target.dataset.action;

  switch (action) {
    case "close-detail-drawer":
      closeDetailDrawer();
      break;

    case "close-review-modal":
      closeModal("reviewDecisionModal");
      break;

    case "close-make-admin-modal":
      closeModal("makeAdminModal");
      break;

    case "close-zone-modal":
      closeModal("zoneModal");
      break;

    case "close-ride-type-modal":
      closeModal("rideTypeModal");
      break;

    case "close-notification-modal":
      closeModal("notificationModal");
      break;

    case "close-confirm-modal":
      closeConfirmModal();
      break;

    case "close-image-viewer":
      closeImageViewer();
      break;

    case "reload-users":
      loadDashboardData({ focus: "users", forceToast: true });
      break;

    case "reload-drivers":
    case "reload-driver-review":
      loadDashboardData({ focus: "drivers", forceToast: true });
      break;

    case "reload-commerce":
    case "reload-commerce-review":
      loadDashboardData({ focus: "commerce", forceToast: true });
      break;

    case "reload-agents":
      loadDashboardData({ focus: "agents", forceToast: true });
      break;

    case "reload-pricing":
    case "reload-rides":
    case "reload-delivery":
    case "reload-wallet":
    case "reload-cash-settlements":
    case "reload-support":
    case "reload-locations":
    case "reload-audit":
      loadDashboardData({ forceToast: true });
      break;

    case "open-zone-modal":
      openZoneModal();
      break;

    case "open-ride-type-modal":
      openRideTypeModal();
      break;

    case "open-notification-modal":
      openNotificationModal();
      break;

    case "open-sanction-modal":
      showToast("El módulo de sanciones se conectará en la siguiente fase funcional.", "info", "Módulo preparado");
      break;

    case "open-user-detail":
      openUserDetail(target.dataset.id);
      break;

    case "open-driver-detail":
      openDriverDetail(target.dataset.id);
      break;

    case "open-commerce-detail":
      openCommerceDetail(target.dataset.id);
      break;

    case "open-agent-detail":
      openAgentDetail(target.dataset.id);
      break;

    case "open-zone-detail":
      openZoneDetail(target.dataset.id);
      break;

    case "open-ride-type-detail":
      openRideTypeDetail(target.dataset.id);
      break;

    case "open-review-modal":
      openReviewModal({
        targetId: target.dataset.id,
        targetCollection: target.dataset.collection,
        targetRole: target.dataset.role,
        decision: target.dataset.decision || "",
      });
      break;

    case "make-admin":
      openMakeAdminModal(target.dataset.id);
      break;

    case "block-user":
      confirmUserStatusChange(target.dataset.id, "blocked");
      break;

    case "reactivate-user":
      confirmUserStatusChange(target.dataset.id, "active");
      break;

    case "drawer-send-notification":
      openNotificationFromDrawer();
      break;

    case "drawer-require-correction":
      openReviewFromDrawer("correction_required");
      break;

    case "drawer-block-profile":
      openReviewFromDrawer("block");
      break;

    case "drawer-approve-profile":
      openReviewFromDrawer("approve");
      break;

    case "view-image":
      openImageViewer(target.dataset.src, target.dataset.title);
      break;

    case "edit-zone":
      openZoneModal(target.dataset.id);
      break;

    case "edit-ride-type":
      openRideTypeModal(target.dataset.id);
      break;

    case "export-overview":
      showToast("La exportación se agregará después de validar las métricas principales.", "info", "Exportación pendiente");
      break;

    default:
      break;
  }
}

function handleDocumentSubmit(event) {
  const form = event.target;

  if (form.id === "reviewDecisionForm") {
    event.preventDefault();
    handleReviewDecisionSubmit();
  }

  if (form.id === "makeAdminForm") {
    event.preventDefault();
    handleMakeAdminSubmit();
  }

  if (form.id === "zoneForm") {
    event.preventDefault();
    handleZoneSubmit();
  }

  if (form.id === "rideTypeForm") {
    event.preventDefault();
    handleRideTypeSubmit();
  }

  if (form.id === "notificationForm") {
    event.preventDefault();
    handleNotificationSubmit();
  }
}

function handleDocumentInput(event) {
  if (event.target.id === "makeAdminRole") {
    applyDefaultPermissionsForAdminRole(event.target.value);
  }
}

function handleDocumentChange(event) {
  if (event.target.id === "makeAdminRole") {
    applyDefaultPermissionsForAdminRole(event.target.value);
  }
}

function handleDocumentKeydown(event) {
  if (event.key !== "Escape") return;

  if ($("#imageViewerModal")?.classList.contains("is-open")) {
    closeImageViewer();
    return;
  }

  if ($(".modal.is-open")) {
    closeAllModals();
    return;
  }

  if ($("#detailDrawer")?.classList.contains("is-open")) {
    closeDetailDrawer();
    return;
  }

  document.body.classList.remove("sidebar-open", "is-locked");
}

/* =========================================================
   CARGA DE DATOS
========================================================= */

async function loadDashboardData(options = {}) {
  const { forceToast = false } = options;

  try {
    setDashboardLoading(true);

    const [
      users,
      adminProfiles,
      drivers,
      commerce,
      agents,
      serviceZones,
      rideTypes,
      adminActions,
      notifications,
      deliveryOrders,
      rideRequests,
      incidents,
      sanctions,
      walletLedger,
      cashSettlements,
      driverLocations,
      activeUserLocations,
      appSettings,
    ] = await Promise.all([
      fetchCollection(COLLECTIONS.users, { max: DEFAULT_LIMITS.users, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.adminProfiles, { max: 300, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.driverProfiles, { max: DEFAULT_LIMITS.drivers, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.commerceProfiles, { max: DEFAULT_LIMITS.commerce, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.agentProfiles, { max: DEFAULT_LIMITS.agents, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.serviceZones, { max: DEFAULT_LIMITS.zones, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.rideTypes, { max: DEFAULT_LIMITS.rideTypes, orderField: "sortOrder", direction: "asc" }),
      fetchCollection(COLLECTIONS.adminActions, { max: DEFAULT_LIMITS.audit, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.notifications, { max: DEFAULT_LIMITS.notifications, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.deliveryOrders, { max: DEFAULT_LIMITS.deliveryOrders, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.rideRequests, { max: DEFAULT_LIMITS.rideRequests, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.incidents, { max: DEFAULT_LIMITS.incidents, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.sanctions, { max: DEFAULT_LIMITS.sanctions, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.walletLedger, { max: DEFAULT_LIMITS.walletLedger, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.cashSettlements, { max: DEFAULT_LIMITS.cashSettlements, orderField: "createdAt" }),
      fetchCollection(COLLECTIONS.driverLocations, { max: DEFAULT_LIMITS.locations, orderField: "updatedAt" }),
      fetchCollection(COLLECTIONS.activeUserLocations, { max: DEFAULT_LIMITS.locations, orderField: "updatedAt" }),
      fetchCollection(COLLECTIONS.appSettings, { max: 100, orderField: "updatedAt" }),
    ]);

    state.users = users;
    state.adminProfiles = adminProfiles;
    state.drivers = drivers;
    state.commerce = commerce;
    state.agents = agents;
    state.serviceZones = serviceZones;
    state.rideTypes = rideTypes;
    state.adminActions = adminActions;
    state.notifications = notifications;
    state.deliveryOrders = deliveryOrders;
    state.rideRequests = rideRequests;
    state.incidents = incidents;
    state.sanctions = sanctions;
    state.walletLedger = walletLedger;
    state.cashSettlements = cashSettlements;
    state.driverLocations = driverLocations;
    state.activeUserLocations = activeUserLocations;
    state.appSettings = appSettings;

    rebuildIndexes();
    populateZoneFilters();
    renderAll();

    if (forceToast) {
      showToast("Los datos del dashboard fueron actualizados correctamente.", "success", "Datos actualizados");
    }
  } catch (error) {
    console.error("[NIVO Dashboard] Error cargando datos:", error);
    showToast(error.message || "No se pudieron cargar los datos.", "error", "Error de carga");
  } finally {
    setDashboardLoading(false);
  }
}

async function fetchCollection(collectionName, config = {}) {
  const {
    max = 250,
    orderField = "createdAt",
    direction = "desc",
  } = config;

  const colRef = collection(state.db, collectionName);

  try {
    const q = query(colRef, orderBy(orderField, direction), limit(max));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((documentSnapshot) => normalizeDoc(documentSnapshot));
  } catch (error) {
    console.warn(`[NIVO Dashboard] Fallback leyendo ${collectionName}:`, error);

    try {
      const q = query(colRef, limit(max));
      const snapshot = await getDocs(q);

      return snapshot.docs.map((documentSnapshot) => normalizeDoc(documentSnapshot));
    } catch (fallbackError) {
      console.warn(`[NIVO Dashboard] Sin acceso o sin datos en ${collectionName}:`, fallbackError);
      return [];
    }
  }
}

async function fetchDocument(collectionName, id) {
  if (!id) return null;

  const ref = doc(state.db, collectionName, id);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return normalizeDoc(snap);
}

function normalizeDoc(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ref: documentSnapshot.ref,
    ...documentSnapshot.data(),
  };
}

function rebuildIndexes() {
  state.indexes.usersById = toIndex(state.users);
  state.indexes.driversById = toIndex(state.drivers);
  state.indexes.commerceById = toIndex(state.commerce);
  state.indexes.agentsById = toIndex(state.agents);
  state.indexes.adminsById = toIndex(state.adminProfiles);
  state.indexes.zonesById = toIndex(state.serviceZones);
  state.indexes.rideTypesById = toIndex(state.rideTypes);
}

function toIndex(items) {
  return new Map(items.map((item) => [item.id, item]));
}

/* =========================================================
   RENDER GENERAL
========================================================= */

function renderAll() {
  renderMetrics();
  renderOverviewPanels();

  renderUsersTable();
  renderDriversTable();
  renderDriverReview();
  renderCommerceTable();
  renderCommerceReview();
  renderAgentsTable();
  renderZonesTable();
  renderRideTypesTable();
  renderPricing();
  renderDeliveryTable();
  renderRidesTable();
  renderLocations();
  renderWalletLedgerTable();
  renderCashSettlementsTable();
  renderIncidentsTable();
  renderSanctionsTable();
  renderNotificationsTable();
  renderAuditTable();
  renderSettings();
}

function renderCurrentSection() {
  switch (state.currentSection) {
    case "users":
      renderUsersTable();
      break;
    case "drivers":
      renderDriversTable();
      break;
    case "driver-review":
      renderDriverReview();
      break;
    case "commerce":
      renderCommerceTable();
      break;
    case "commerce-review":
      renderCommerceReview();
      break;
    case "agents":
      renderAgentsTable();
      break;
    case "zones":
      renderZonesTable();
      break;
    case "ride-types":
      renderRideTypesTable();
      break;
    case "audit":
      renderAuditTable();
      break;
    default:
      renderAll();
      break;
  }
}

function renderMetrics() {
  const activeUsers = state.users.filter((item) => item.status === "active");
  const registeredClients = state.users.filter((item) => item.role === "user");

  const activeDrivers = state.drivers.filter((item) => item.status === "active");
  const pendingDrivers = state.drivers.filter((item) => DRIVER_REVIEW_STATUSES.has(item.status));

  const activeCommerce = state.commerce.filter((item) => item.status === "active");
  const pendingCommerce = state.commerce.filter((item) => COMMERCE_REVIEW_STATUSES.has(item.status));

  const activeZones = state.serviceZones.filter((item) => item.active === true);

  const driversCar = state.drivers.filter((item) => normalizeVehicleType(item.vehicleType) === "car");
  const driversMotorcycle = state.drivers.filter((item) => normalizeVehicleType(item.vehicleType) === "motorcycle");
  const driversMototaxi = state.drivers.filter((item) => normalizeVehicleType(item.vehicleType) === "mototaxi");
  const driversQute = state.drivers.filter((item) => normalizeVehicleType(item.vehicleType) === "qute");
  const driversDelivery = state.drivers.filter((item) => get(item, "enabledServices.delivery", false) === true);
  const driversAvailable = state.drivers.filter((item) => get(item, "availability.isAvailable", false) === true);

  setText("metricTotalUsers", String(state.users.length));
  setText("metricActiveUsers", String(activeUsers.length));
  setText("metricTotalDrivers", String(state.drivers.length));
  setText("metricActiveDrivers", String(activeDrivers.length));
  setText("metricPendingDrivers", String(pendingDrivers.length));
  setText("metricTotalCommerce", String(state.commerce.length));
  setText("metricActiveCommerce", String(activeCommerce.length));
  setText("metricTotalAgents", String(state.agents.length));
  setText("metricServiceZones", String(activeZones.length));
  setText("metricRideRequests", String(state.rideRequests.length));
  setText("metricDeliveryOrders", String(state.deliveryOrders.length));
  setText("metricWalletVolume", formatMoney(sumBy(state.walletLedger, "amount")));

  setText("metricDriversCar", String(driversCar.length));
  setText("metricDriversMotorcycle", String(driversMotorcycle.length));
  setText("metricDriversMototaxi", String(driversMototaxi.length));
  setText("metricDriversQute", String(driversQute.length));
  setText("metricDriversDelivery", String(driversDelivery.length));
  setText("metricDriversAvailable", String(driversAvailable.length));

  setText("navPendingDriversCount", String(pendingDrivers.length));
  setText("navPendingCommerceCount", String(pendingCommerce.length));

  setText("driversCountAll", String(state.drivers.length));
  setText("driversCountActive", String(activeDrivers.length));
  setText("driversCountOnline", String(state.drivers.filter((item) => get(item, "availability.isOnline", false) === true).length));
  setText("driversCountReview", String(state.drivers.filter((item) => item.status === "pending_review").length));
  setText("driversCountBlocked", String(state.drivers.filter((item) => item.status === "blocked").length));

  const notificationUnread = state.notifications.filter((item) => item.read === false).length;
  const badge = $("#notificationBadge");
  if (badge) {
    badge.textContent = String(notificationUnread);
    badge.hidden = notificationUnread <= 0;
  }

  setText("metricUsersTrend", `${registeredClients.length} clientes con role user`);
}

function renderOverviewPanels() {
  renderCriticalAlerts();
  renderRecentAdminActions();
}

function renderCriticalAlerts() {
  const alerts = [];

  const driversPendingReview = state.drivers.filter((item) => item.status === "pending_review");
  const commercePendingReview = state.commerce.filter((item) => item.status === "pending_review");
  const blockedUsers = state.users.filter((item) => BLOCKED_STATUSES.has(item.status));
  const cashPending = state.cashSettlements.filter((item) => item.status === "pending" || item.cashStatus === "overdue");

  if (driversPendingReview.length) {
    alerts.push({
      title: "Conductores listos para revisión",
      body: `${driversPendingReview.length} conductor(es) esperan aprobación administrativa.`,
      type: "warning",
    });
  }

  if (commercePendingReview.length) {
    alerts.push({
      title: "Comercios listos para revisión",
      body: `${commercePendingReview.length} comercio(s) esperan aprobación administrativa.`,
      type: "warning",
    });
  }

  if (blockedUsers.length) {
    alerts.push({
      title: "Cuentas bloqueadas o restringidas",
      body: `${blockedUsers.length} cuenta(s) tienen estado restrictivo.`,
      type: "danger",
    });
  }

  if (cashPending.length) {
    alerts.push({
      title: "Liquidaciones pendientes",
      body: `${cashPending.length} liquidación(es) requieren seguimiento.`,
      type: "warning",
    });
  }

  const html = alerts.length
    ? alerts.map((alert) => `
        <div class="review-card">
          <strong>${escapeHtml(alert.title)}</strong>
          <span>${escapeHtml(alert.body)}</span>
        </div>
      `).join("")
    : `<div class="empty-inline">No hay alertas críticas cargadas todavía.</div>`;

  setHTML("criticalAlertsList", html);
}

function renderRecentAdminActions() {
  const latest = state.adminActions.slice(0, 8);

  const html = latest.length
    ? latest.map((action) => `
        <div class="review-card">
          <strong>${escapeHtml(action.action || "Acción administrativa")}</strong>
          <span>${escapeHtml(action.adminEmail || "admin")} · ${escapeHtml(action.targetCollection || "")}/${escapeHtml(action.targetId || "")}</span>
          <span>${formatDate(action.createdAt)}</span>
        </div>
      `).join("")
    : `<div class="empty-inline">Todavía no hay acciones administrativas registradas.</div>`;

  setHTML("recentAdminActions", html);
}

/* =========================================================
   SECCIONES
========================================================= */

function showSection(sectionName) {
  const safeSection = SECTION_META[sectionName] ? sectionName : "overview";

  state.currentSection = safeSection;

  $$(".dashboard-section").forEach((section) => {
    const active = section.dataset.section === safeSection;
    section.classList.toggle("active", active);
    section.hidden = !active;
  });

  $$(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.sectionTarget === safeSection);
  });

  const meta = SECTION_META[safeSection];
  setText("dashboardPageTitle", meta.title);
  setText("dashboardBreadcrumb", meta.breadcrumb);

  document.body.classList.remove("sidebar-open", "is-locked");

  const main = $("#dashboardMain");
  if (main) main.focus({ preventScroll: true });

  renderCurrentSection();
}

function setDriverQuickFilter(filter) {
  state.currentDriverQuickFilter = filter || "all";

  $$("[data-driver-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.driverFilter === state.currentDriverQuickFilter);
  });

  renderDriversTable();
}

/* =========================================================
   USERS
========================================================= */

function renderUsersTable() {
  const tbody = $("#usersTableBody");
  if (!tbody) return;

  const search = normalizeText($("#usersSearchInput")?.value || $("#globalSearch")?.value || "").toLowerCase();
  const role = $("#usersRoleFilter")?.value || "all";
  const status = $("#usersStatusFilter")?.value || "all";
  const zone = $("#usersZoneFilter")?.value || "all";

  let items = [...state.users];

  if (role !== "all") items = items.filter((item) => item.role === role);
  if (status !== "all") items = items.filter((item) => item.status === status);
  if (zone !== "all") items = items.filter((item) => item.registeredZoneId === zone);

  if (search) {
    items = items.filter((item) => searchable(item, [
      "fullName",
      "email",
      "phone",
      "role",
      "status",
      "department",
      "municipality",
      "registeredZoneId",
      "uid",
      "id",
    ]).includes(search));
  }

  setText("usersTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(7, "No hay usuarios con esos filtros.");
    return;
  }

  tbody.innerHTML = items.map((user) => {
    const adminExists = state.indexes.adminsById.has(user.id);
    const canReactivate = BLOCKED_STATUSES.has(user.status);

    return `
      <tr>
        <td>
          ${profileCell({
            name: user.fullName || user.displayName || "Usuario NIVO",
            subtitle: user.email || user.phone || user.id,
            imageUrl: user.photoUrl,
          })}
        </td>
        <td>${badge(ROLE_LABELS[user.role] || user.role || "user", "vehicle-badge")}</td>
        <td>${statusBadge(user.status)}</td>
        <td>${escapeHtml(formatZone(user.registeredZoneId, user.department, user.municipality))}</td>
        <td>${formatDate(user.createdAt)}</td>
        <td>${formatDate(user.lastLoginAt)}</td>
        <td class="table-actions-col">
          <div class="table-actions">
            <button class="btn btn-secondary" type="button" data-action="open-user-detail" data-id="${escapeAttr(user.id)}">
              Ver
            </button>
            ${
              adminExists
                ? `<span class="status-badge active">Admin</span>`
                : `<button class="btn btn-primary" type="button" data-action="make-admin" data-id="${escapeAttr(user.id)}">
                    Hacer admin
                  </button>`
            }
            ${
              canReactivate
                ? `<button class="btn btn-secondary" type="button" data-action="reactivate-user" data-id="${escapeAttr(user.id)}">Reactivar</button>`
                : `<button class="btn btn-danger" type="button" data-action="block-user" data-id="${escapeAttr(user.id)}">Bloquear</button>`
            }
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   DRIVERS
========================================================= */

function renderDriversTable() {
  const tbody = $("#driversTableBody");
  if (!tbody) return;

  const search = normalizeText($("#driversSearchInput")?.value || $("#globalSearch")?.value || "").toLowerCase();
  const vehicle = $("#driversVehicleFilter")?.value || "all";
  const service = $("#driversServiceFilter")?.value || "all";
  const zone = $("#driversZoneFilter")?.value || "all";
  const quick = state.currentDriverQuickFilter;

  let items = [...state.drivers];

  if (quick === "active") items = items.filter((item) => item.status === "active");
  if (quick === "online") items = items.filter((item) => get(item, "availability.isOnline", false) === true);
  if (quick === "pending_review") items = items.filter((item) => item.status === "pending_review");
  if (quick === "blocked") items = items.filter((item) => item.status === "blocked");

  if (vehicle !== "all") items = items.filter((item) => normalizeVehicleType(item.vehicleType) === vehicle);
  if (service !== "all") items = items.filter((item) => get(item, `enabledServices.${service}`, false) === true);
  if (zone !== "all") items = items.filter((item) => item.serviceZoneId === zone);

  if (search) {
    items = items.filter((item) => searchable(item, [
      "fullName",
      "email",
      "phone",
      "vehicleType",
      "vehicleLabel",
      "serviceZoneId",
      "department",
      "municipality",
      "driverId",
      "uid",
      "documentNumbers.plate",
      "documentNumbers.duiNumber",
      "documentNumbers.licenseNumber",
    ]).includes(search));
  }

  setText("driversTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay conductores con esos filtros.");
    return;
  }

  tbody.innerHTML = items.map((driver) => `
    <tr>
      <td>
        ${profileCell({
          name: driver.fullName || "Conductor NIVO",
          subtitle: driver.email || driver.phone || driver.id,
          imageUrl: driver.photoUrl || get(driver, "documents.selfieUrl"),
        })}
      </td>
      <td>${badge(vehicleLabel(driver.vehicleType), "vehicle-badge")}</td>
      <td>${servicesBadges(driver.enabledServices)}</td>
      <td>${statusBadge(driver.status)}</td>
      <td>${availabilityBadge(driver.availability)}</td>
      <td>${escapeHtml(formatZone(driver.serviceZoneId, driver.department, driver.municipality))}</td>
      <td>${escapeHtml(String(get(driver, "metrics.rating", 0)))}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-driver-detail" data-id="${escapeAttr(driver.id)}">
            Ver
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(driver.id)}"
            data-collection="${COLLECTIONS.driverProfiles}"
            data-role="driver"
            data-decision="approve"
          >
            Decidir
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderDriverReview() {
  renderDriverReviewColumns();
  renderDriverReviewTable();
}

function renderDriverReviewColumns() {
  const pendingDocuments = state.drivers.filter((item) => item.status === "pending_documents");
  const pendingReview = state.drivers.filter((item) => item.status === "pending_review");
  const correctionRequired = state.drivers.filter((item) => item.status === "correction_required");

  setText("reviewPendingDocumentsCount", String(pendingDocuments.length));
  setText("reviewPendingReviewCount", String(pendingReview.length));
  setText("reviewCorrectionRequiredCount", String(correctionRequired.length));

  setHTML("reviewPendingDocumentsList", renderReviewCards(pendingDocuments, "driver"));
  setHTML("reviewPendingReviewList", renderReviewCards(pendingReview, "driver"));
  setHTML("reviewCorrectionRequiredList", renderReviewCards(correctionRequired, "driver"));
}

function renderDriverReviewTable() {
  const tbody = $("#driverReviewTableBody");
  if (!tbody) return;

  const items = state.drivers.filter((driver) => DRIVER_REVIEW_STATUSES.has(driver.status));

  setText("driverReviewTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(6, "No hay conductores pendientes de decisión.");
    return;
  }

  tbody.innerHTML = items.map((driver) => `
    <tr>
      <td>
        ${profileCell({
          name: driver.fullName || "Conductor NIVO",
          subtitle: driver.email || driver.phone || driver.id,
          imageUrl: driver.photoUrl || get(driver, "documents.selfieUrl"),
        })}
      </td>
      <td>${badge(vehicleLabel(driver.vehicleType), "vehicle-badge")}</td>
      <td>${documentsSummary(driver.documents)}</td>
      <td>${statusBadge(driver.status)}</td>
      <td>${formatDate(get(driver, "verification.documentsSubmittedAt") || driver.updatedAt)}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-driver-detail" data-id="${escapeAttr(driver.id)}">
            Ver
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(driver.id)}"
            data-collection="${COLLECTIONS.driverProfiles}"
            data-role="driver"
            data-decision="approve"
          >
            Aprobar
          </button>
          <button
            class="btn btn-warning"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(driver.id)}"
            data-collection="${COLLECTIONS.driverProfiles}"
            data-role="driver"
            data-decision="correction_required"
          >
            Corrección
          </button>
          <button
            class="btn btn-danger"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(driver.id)}"
            data-collection="${COLLECTIONS.driverProfiles}"
            data-role="driver"
            data-decision="reject"
          >
            Rechazar
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

/* =========================================================
   COMMERCE
========================================================= */

function renderCommerceTable() {
  const tbody = $("#commerceTableBody");
  if (!tbody) return;

  const search = normalizeText($("#commerceSearchInput")?.value || $("#globalSearch")?.value || "").toLowerCase();
  const status = $("#commerceStatusFilter")?.value || "all";
  const plan = $("#commercePlanFilter")?.value || "all";
  const zone = $("#commerceZoneFilter")?.value || "all";

  let items = [...state.commerce];

  if (status !== "all") items = items.filter((item) => item.status === status);
  if (plan !== "all") items = items.filter((item) => (item.plan || "none") === plan);
  if (zone !== "all") items = items.filter((item) => item.serviceZoneId === zone);

  if (search) {
    items = items.filter((item) => searchable(item, [
      "businessName",
      "ownerName",
      "email",
      "phone",
      "categoryName",
      "categoryId",
      "serviceZoneId",
      "department",
      "municipality",
      "commerceId",
      "uid",
    ]).includes(search));
  }

  setText("commerceTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay comercios con esos filtros.");
    return;
  }

  tbody.innerHTML = items.map((commerce) => `
    <tr>
      <td>
        ${profileCell({
          name: commerce.businessName || "Comercio sin completar",
          subtitle: commerce.email || commerce.phone || commerce.id,
          imageUrl: commerce.logoUrl || commerce.coverUrl,
        })}
      </td>
      <td>${escapeHtml(commerce.ownerName || commerce.uid || "Sin dueño")}</td>
      <td>${escapeHtml(commerce.categoryName || commerce.categoryId || "Sin categoría")}</td>
      <td>${statusBadge(commerce.status)}</td>
      <td>${booleanBadge(commerce.isVisible, "Visible", "Oculto")}</td>
      <td>${badge(commerce.plan || "none", "vehicle-badge")}</td>
      <td>${escapeHtml(formatZone(commerce.serviceZoneId, commerce.department, commerce.municipality))}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-commerce-detail" data-id="${escapeAttr(commerce.id)}">
            Ver
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(commerce.id)}"
            data-collection="${COLLECTIONS.commerceProfiles}"
            data-role="commerce"
            data-decision="approve"
          >
            Decidir
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderCommerceReview() {
  const tbody = $("#commerceReviewTableBody");
  if (!tbody) return;

  const items = state.commerce.filter((commerce) => COMMERCE_REVIEW_STATUSES.has(commerce.status));

  setText("commerceReviewTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(7, "No hay comercios pendientes de decisión.");
    return;
  }

  tbody.innerHTML = items.map((commerce) => `
    <tr>
      <td>
        ${profileCell({
          name: commerce.businessName || "Comercio sin completar",
          subtitle: commerce.email || commerce.phone || commerce.id,
          imageUrl: commerce.logoUrl || commerce.coverUrl,
        })}
      </td>
      <td>${escapeHtml(commerce.ownerName || commerce.uid || "Sin dueño")}</td>
      <td>${statusBadge(commerce.status)}</td>
      <td>${escapeHtml(commerce.categoryName || commerce.categoryId || "Sin categoría")}</td>
      <td>${escapeHtml(formatZone(commerce.serviceZoneId, commerce.department, commerce.municipality))}</td>
      <td>${formatDate(get(commerce, "verification.documentsSubmittedAt") || commerce.updatedAt)}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-commerce-detail" data-id="${escapeAttr(commerce.id)}">
            Ver
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(commerce.id)}"
            data-collection="${COLLECTIONS.commerceProfiles}"
            data-role="commerce"
            data-decision="approve"
          >
            Aprobar
          </button>
          <button
            class="btn btn-warning"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(commerce.id)}"
            data-collection="${COLLECTIONS.commerceProfiles}"
            data-role="commerce"
            data-decision="correction_required"
          >
            Corrección
          </button>
          <button
            class="btn btn-danger"
            type="button"
            data-action="open-review-modal"
            data-id="${escapeAttr(commerce.id)}"
            data-collection="${COLLECTIONS.commerceProfiles}"
            data-role="commerce"
            data-decision="reject"
          >
            Rechazar
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

/* =========================================================
   AGENTS
========================================================= */

function renderAgentsTable() {
  const tbody = $("#agentsTableBody");
  if (!tbody) return;

  const search = normalizeText($("#globalSearch")?.value || "").toLowerCase();

  let items = [...state.agents];

  if (search) {
    items = items.filter((item) => searchable(item, [
      "fullName",
      "email",
      "phone",
      "businessName",
      "department",
      "municipality",
      "serviceZoneId",
      "agentId",
      "uid",
    ]).includes(search));
  }

  setText("agentsTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay agentes registrados.");
    return;
  }

  tbody.innerHTML = items.map((agent) => `
    <tr>
      <td>
        ${profileCell({
          name: agent.fullName || "Agente NIVO",
          subtitle: agent.email || agent.phone || agent.id,
        })}
      </td>
      <td>${statusBadge(agent.status)}</td>
      <td>${escapeHtml(formatZone(agent.serviceZoneId, agent.department, agent.municipality))}</td>
      <td>${booleanBadge(agent.canProcessTopups, "Sí", "No")}</td>
      <td>${formatMoney(agent.dailyLimit || 0)}</td>
      <td>${formatMoney(agent.monthlyLimit || 0)}</td>
      <td>${formatPercent(agent.commissionRate || 0)}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-agent-detail" data-id="${escapeAttr(agent.id)}">
            Ver
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

/* =========================================================
   ZONES / RIDE TYPES / PRICING
========================================================= */

function renderZonesTable() {
  const tbody = $("#zonesTableBody");
  if (!tbody) return;

  const search = normalizeText($("#globalSearch")?.value || "").toLowerCase();

  let items = [...state.serviceZones];

  if (search) {
    items = items.filter((item) => searchable(item, [
      "id",
      "displayName",
      "country",
      "department",
      "municipality",
      "serviceZoneId",
    ]).includes(search));
  }

  setText("zonesTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(7, "No hay zonas operativas creadas.");
    return;
  }

  tbody.innerHTML = items.map((zone) => `
    <tr>
      <td>
        <strong>${escapeHtml(zone.displayName || zone.id)}</strong>
        <br />
        <span class="muted">${escapeHtml(zone.id)}</span>
      </td>
      <td>${escapeHtml(zone.department || "—")}</td>
      <td>${escapeHtml(zone.municipality || "—")}</td>
      <td>${servicesBadges(zone.enabledServices)}</td>
      <td>${transportConfigsBadges(zone.transportConfigs)}</td>
      <td>${booleanBadge(zone.active, "Activa", "Inactiva")}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-zone-detail" data-id="${escapeAttr(zone.id)}">
            Ver
          </button>
          <button class="btn btn-primary" type="button" data-action="edit-zone" data-id="${escapeAttr(zone.id)}">
            Editar
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderRideTypesTable() {
  const tbody = $("#rideTypesTableBody");
  if (!tbody) return;

  const search = normalizeText($("#globalSearch")?.value || "").toLowerCase();

  let items = [...state.rideTypes];

  if (search) {
    items = items.filter((item) => searchable(item, [
      "id",
      "title",
      "description",
    ]).includes(search));
  }

  setText("rideTypesTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(7, "No hay categorías de transporte creadas.");
    return;
  }

  tbody.innerHTML = items.map((type) => `
    <tr>
      <td>
        <strong>${escapeHtml(type.title || type.id)}</strong>
        <br />
        <span class="muted">${escapeHtml(type.description || "Sin descripción")}</span>
      </td>
      <td>${escapeHtml(type.id)}</td>
      <td>${booleanBadge(type.activeGlobally, "Activa", "Inactiva")}</td>
      <td>${escapeHtml(String(type.maxPassengers || 1))}</td>
      <td>${booleanBadge(type.chargesPerPassenger, "Sí", "No")}</td>
      <td>${booleanBadge(type.requiresPassengerSelection, "Sí", "No")}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-ride-type-detail" data-id="${escapeAttr(type.id)}">
            Ver
          </button>
          <button class="btn btn-primary" type="button" data-action="edit-ride-type" data-id="${escapeAttr(type.id)}">
            Editar
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderPricing() {
  const container = $("#pricingConfigGrid");
  if (!container) return;

  if (!state.serviceZones.length) {
    container.innerHTML = `<div class="empty-state">Las tarifas se cargarán desde service_zones y transportConfigs.</div>`;
    return;
  }

  container.innerHTML = state.serviceZones.map((zone) => {
    const configs = zone.transportConfigs || {};

    return `
      <article class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">${escapeHtml(zone.id)}</p>
            <h3>${escapeHtml(zone.displayName || `${zone.department || ""} ${zone.municipality || ""}`)}</h3>
          </div>
          ${booleanBadge(zone.active, "Activa", "Inactiva")}
        </div>

        <div class="detail-grid">
          ${Object.keys(configs).length ? Object.entries(configs).map(([key, cfg]) => `
            <div class="detail-field">
              <span>${escapeHtml(vehicleLabel(key))}</span>
              <strong>
                Base ${formatMoney(cfg.baseFare || 0)} · Mín. ${formatMoney(cfg.minimumFare || 0)}
                <br />
                Km ${formatMoney(cfg.pricePerKm || 0)} · Min ${formatMoney(cfg.pricePerMinute || 0)}
              </strong>
            </div>
          `).join("") : `
            <div class="empty-state compact">Sin transportConfigs.</div>
          `}
        </div>
      </article>
    `;
  }).join("");
}

/* =========================================================
   SERVICE TABLES FUTURE MODULES
========================================================= */

function renderDeliveryTable() {
  const tbody = $("#deliveryTableBody");
  if (!tbody) return;

  setText("deliveryTableCount", `${state.deliveryOrders.length} registro${state.deliveryOrders.length === 1 ? "" : "s"}`);

  if (!state.deliveryOrders.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay órdenes de delivery registradas.");
    return;
  }

  tbody.innerHTML = state.deliveryOrders.map((order) => `
    <tr>
      <td>${escapeHtml(order.id)}</td>
      <td>${escapeHtml(order.userId || order.uid || "—")}</td>
      <td>${escapeHtml(order.commerceId || "—")}</td>
      <td>${escapeHtml(order.driverId || "—")}</td>
      <td>${statusBadge(order.status)}</td>
      <td>${formatMoney(order.total || order.totalAmount || 0)}</td>
      <td>${formatDate(order.createdAt)}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderRidesTable() {
  const tbody = $("#ridesTableBody");
  if (!tbody) return;

  setText("ridesTableCount", `${state.rideRequests.length} registro${state.rideRequests.length === 1 ? "" : "s"}`);

  if (!state.rideRequests.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay solicitudes de viaje registradas.");
    return;
  }

  tbody.innerHTML = state.rideRequests.map((ride) => `
    <tr>
      <td>${escapeHtml(ride.id)}</td>
      <td>${escapeHtml(ride.userId || ride.uid || "—")}</td>
      <td>${escapeHtml(ride.driverId || "—")}</td>
      <td>${escapeHtml(vehicleLabel(ride.vehicleType || ride.transportType || "—"))}</td>
      <td>${statusBadge(ride.status)}</td>
      <td>${formatMoney(ride.fare || ride.total || ride.estimatedFare || 0)}</td>
      <td>${formatDate(ride.createdAt)}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderLocations() {
  const list = $("#onlineDriversList");
  if (!list) return;

  const online = state.drivers.filter((driver) => get(driver, "availability.isOnline", false) === true);

  if (!online.length) {
    list.innerHTML = `<div class="empty-state compact">Sin conductores online cargados.</div>`;
    return;
  }

  list.innerHTML = online.map((driver) => {
    const location = state.driverLocations.find((item) => item.id === driver.id || item.driverId === driver.id);

    return `
      <div class="review-card">
        <strong>${escapeHtml(driver.fullName || driver.email || driver.id)}</strong>
        <span>${escapeHtml(vehicleLabel(driver.vehicleType))} · ${escapeHtml(driver.serviceZoneId || "Sin zona")}</span>
        <span>${location ? `Última ubicación: ${formatDate(location.updatedAt)}` : "Sin ubicación reciente"}</span>
      </div>
    `;
  }).join("");
}

function renderWalletLedgerTable() {
  const tbody = $("#walletLedgerTableBody");
  if (!tbody) return;

  setText("walletLedgerTableCount", `${state.walletLedger.length} registro${state.walletLedger.length === 1 ? "" : "s"}`);

  if (!state.walletLedger.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay movimientos wallet cargados.");
    return;
  }

  tbody.innerHTML = state.walletLedger.map((movement) => `
    <tr>
      <td>${escapeHtml(movement.id)}</td>
      <td>${escapeHtml(movement.uid || movement.userId || "—")}</td>
      <td>${escapeHtml(movement.type || "—")}</td>
      <td>${formatMoney(movement.amount || 0)}</td>
      <td>${escapeHtml(movement.source || "—")}</td>
      <td>${statusBadge(movement.status)}</td>
      <td>${formatDate(movement.createdAt)}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderCashSettlementsTable() {
  const tbody = $("#cashSettlementsTableBody");
  if (!tbody) return;

  setText("cashSettlementsTableCount", `${state.cashSettlements.length} registro${state.cashSettlements.length === 1 ? "" : "s"}`);

  if (!state.cashSettlements.length) {
    tbody.innerHTML = emptyTableRow(7, "No hay liquidaciones cargadas.");
    return;
  }

  tbody.innerHTML = state.cashSettlements.map((settlement) => `
    <tr>
      <td>${escapeHtml(settlement.driverId || settlement.uid || "—")}</td>
      <td>${formatMoney(settlement.cashPendingSettlement || settlement.pendingAmount || 0)}</td>
      <td>${formatMoney(settlement.cashOverdueSettlement || settlement.overdueAmount || 0)}</td>
      <td>${formatDate(settlement.cashDueAt || settlement.dueAt)}</td>
      <td>${statusBadge(settlement.cashStatus || settlement.status)}</td>
      <td>${settlement.proofUrl ? `<button class="btn btn-secondary" type="button" data-action="view-image" data-src="${escapeAttr(settlement.proofUrl)}" data-title="Comprobante">Ver</button>` : "—"}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderIncidentsTable() {
  const tbody = $("#incidentsTableBody");
  if (!tbody) return;

  setText("incidentsTableCount", `${state.incidents.length} registro${state.incidents.length === 1 ? "" : "s"}`);

  if (!state.incidents.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay incidencias registradas.");
    return;
  }

  tbody.innerHTML = state.incidents.map((incident) => `
    <tr>
      <td>${escapeHtml(incident.id)}</td>
      <td>${escapeHtml(incident.reporterId || "—")}</td>
      <td>${escapeHtml(incident.reportedUserId || "—")}</td>
      <td>${escapeHtml(incident.type || "—")}</td>
      <td>${escapeHtml(incident.severity || "—")}</td>
      <td>${statusBadge(incident.status)}</td>
      <td>${formatDate(incident.createdAt)}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderSanctionsTable() {
  const tbody = $("#sanctionsTableBody");
  if (!tbody) return;

  setText("sanctionsTableCount", `${state.sanctions.length} registro${state.sanctions.length === 1 ? "" : "s"}`);

  if (!state.sanctions.length) {
    tbody.innerHTML = emptyTableRow(8, "No hay sanciones registradas.");
    return;
  }

  tbody.innerHTML = state.sanctions.map((sanction) => `
    <tr>
      <td>${escapeHtml(sanction.targetUid || "—")}</td>
      <td>${escapeHtml(ROLE_LABELS[sanction.targetRole] || sanction.targetRole || "—")}</td>
      <td>${escapeHtml(sanction.type || "—")}</td>
      <td>${escapeHtml(sanction.severity || "—")}</td>
      <td>${booleanBadge(sanction.active, "Sí", "No")}</td>
      <td>${formatDate(sanction.startsAt)}</td>
      <td>${formatDate(sanction.endsAt)}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderNotificationsTable() {
  const tbody = $("#notificationsTableBody");
  if (!tbody) return;

  setText("notificationsTableCount", `${state.notifications.length} registro${state.notifications.length === 1 ? "" : "s"}`);

  if (!state.notifications.length) {
    tbody.innerHTML = emptyTableRow(6, "No hay notificaciones registradas.");
    return;
  }

  tbody.innerHTML = state.notifications.map((notification) => `
    <tr>
      <td>
        <strong>${escapeHtml(notification.title || "Notificación")}</strong>
        <br />
        <span class="muted">${escapeHtml(notification.body || "")}</span>
      </td>
      <td>${escapeHtml(notification.uid || notification.userId || notification.targetValue || notification.targetType || "—")}</td>
      <td>${escapeHtml(notification.type || "info")}</td>
      <td>${notification.read === false ? statusBadge("pending_review") : statusBadge("active")}</td>
      <td>${formatDate(notification.createdAt)}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderAuditTable() {
  const tbody = $("#auditTableBody");
  if (!tbody) return;

  const search = normalizeText($("#globalSearch")?.value || "").toLowerCase();

  let items = [...state.adminActions];

  if (search) {
    items = items.filter((item) => searchable(item, [
      "action",
      "adminEmail",
      "targetCollection",
      "targetId",
      "targetRole",
      "reason",
    ]).includes(search));
  }

  setText("auditTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyTableRow(7, "No hay acciones administrativas registradas.");
    return;
  }

  tbody.innerHTML = items.map((action) => `
    <tr>
      <td>${escapeHtml(action.action || "—")}</td>
      <td>${escapeHtml(action.adminEmail || action.adminId || "—")}</td>
      <td>
        <strong>${escapeHtml(action.targetCollection || "—")}</strong>
        <br />
        <span class="muted">${escapeHtml(action.targetId || "—")}</span>
      </td>
      <td>${escapeHtml(action.targetRole || "—")}</td>
      <td>${escapeHtml(action.reason || "Sin motivo")}</td>
      <td>${formatDate(action.createdAt)}</td>
      <td class="table-actions-col">
        <button class="btn btn-secondary" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderSettings() {
  const list = $("#appSettingsList");
  if (!list) return;

  if (!state.appSettings.length) {
    list.innerHTML = `<div class="empty-state compact">Configuraciones pendientes de cargar.</div>`;
    return;
  }

  list.innerHTML = state.appSettings.map((setting) => `
    <div class="review-card">
      <strong>${escapeHtml(setting.id)}</strong>
      <span>${escapeHtml(setting.description || setting.key || "Configuración")}</span>
    </div>
  `).join("");
}

/* =========================================================
   DETAILS DRAWER
========================================================= */

function openUserDetail(id) {
  const user = state.indexes.usersById.get(id);
  if (!user) return showToast("No se encontró el usuario.", "error");

  state.activeDetail = {
    type: "user",
    collection: COLLECTIONS.users,
    id,
    data: user,
  };

  openDetailDrawer({
    eyebrow: "Usuario",
    title: user.fullName || user.email || id,
    subtitle: `${ROLE_LABELS[user.role] || user.role || "user"} · ${STATUS_LABELS[user.status] || user.status || "Sin estado"}`,
    summaryHtml: renderUserSummary(user),
    documentsHtml: `<div class="empty-state compact">Los usuarios base no tienen documentos administrativos.</div>`,
    operationHtml: renderUserOperation(user),
    financeHtml: `<div class="empty-state compact">Datos financieros pendientes de conectar.</div>`,
    historyHtml: renderAuditForTarget(COLLECTIONS.users, id),
  });
}

function openDriverDetail(id) {
  const driver = state.indexes.driversById.get(id);
  if (!driver) return showToast("No se encontró el conductor.", "error");

  state.activeDetail = {
    type: "driver",
    collection: COLLECTIONS.driverProfiles,
    id,
    data: driver,
  };

  openDetailDrawer({
    eyebrow: "Conductor / Repartidor",
    title: driver.fullName || driver.email || id,
    subtitle: `${vehicleLabel(driver.vehicleType)} · ${STATUS_LABELS[driver.status] || driver.status || "Sin estado"}`,
    summaryHtml: renderDriverSummary(driver),
    documentsHtml: renderDriverDocuments(driver),
    operationHtml: renderDriverOperation(driver),
    financeHtml: renderDriverFinance(driver),
    historyHtml: renderAuditForTarget(COLLECTIONS.driverProfiles, id),
  });
}

function openCommerceDetail(id) {
  const commerce = state.indexes.commerceById.get(id);
  if (!commerce) return showToast("No se encontró el comercio.", "error");

  state.activeDetail = {
    type: "commerce",
    collection: COLLECTIONS.commerceProfiles,
    id,
    data: commerce,
  };

  openDetailDrawer({
    eyebrow: "Comercio",
    title: commerce.businessName || "Comercio sin completar",
    subtitle: `${commerce.ownerName || commerce.email || id} · ${STATUS_LABELS[commerce.status] || commerce.status || "Sin estado"}`,
    summaryHtml: renderCommerceSummary(commerce),
    documentsHtml: renderCommerceDocuments(commerce),
    operationHtml: renderCommerceOperation(commerce),
    financeHtml: renderCommerceFinance(commerce),
    historyHtml: renderAuditForTarget(COLLECTIONS.commerceProfiles, id),
  });
}

function openAgentDetail(id) {
  const agent = state.indexes.agentsById.get(id);
  if (!agent) return showToast("No se encontró el agente.", "error");

  state.activeDetail = {
    type: "agent",
    collection: COLLECTIONS.agentProfiles,
    id,
    data: agent,
  };

  openDetailDrawer({
    eyebrow: "Agente NIVO",
    title: agent.fullName || agent.email || id,
    subtitle: `${STATUS_LABELS[agent.status] || agent.status || "Sin estado"} · ${agent.serviceZoneId || "Sin zona"}`,
    summaryHtml: renderAgentSummary(agent),
    documentsHtml: `<div class="empty-state compact">Documentos de agente pendientes de conectar.</div>`,
    operationHtml: renderAgentOperation(agent),
    financeHtml: renderAgentFinance(agent),
    historyHtml: renderAuditForTarget(COLLECTIONS.agentProfiles, id),
  });
}

function openZoneDetail(id) {
  const zone = state.indexes.zonesById.get(id);
  if (!zone) return showToast("No se encontró la zona.", "error");

  state.activeDetail = {
    type: "zone",
    collection: COLLECTIONS.serviceZones,
    id,
    data: zone,
  };

  openDetailDrawer({
    eyebrow: "Zona operativa",
    title: zone.displayName || id,
    subtitle: `${zone.department || "—"} · ${zone.municipality || "—"}`,
    summaryHtml: renderZoneSummary(zone),
    documentsHtml: `<div class="empty-state compact">Las zonas no tienen documentos.</div>`,
    operationHtml: renderZoneOperation(zone),
    financeHtml: renderZonePricing(zone),
    historyHtml: renderAuditForTarget(COLLECTIONS.serviceZones, id),
  });
}

function openRideTypeDetail(id) {
  const rideType = state.indexes.rideTypesById.get(id);
  if (!rideType) return showToast("No se encontró la categoría.", "error");

  state.activeDetail = {
    type: "rideType",
    collection: COLLECTIONS.rideTypes,
    id,
    data: rideType,
  };

  openDetailDrawer({
    eyebrow: "Categoría transporte",
    title: rideType.title || id,
    subtitle: rideType.description || "Catálogo global de transporte",
    summaryHtml: renderRideTypeSummary(rideType),
    documentsHtml: `<div class="empty-state compact">Las categorías no tienen documentos.</div>`,
    operationHtml: renderRideTypeOperation(rideType),
    financeHtml: `<div class="empty-state compact">La tarifa por zona se administra en service_zones.</div>`,
    historyHtml: renderAuditForTarget(COLLECTIONS.rideTypes, id),
  });
}

function openDetailDrawer({ eyebrow, title, subtitle, summaryHtml, documentsHtml, operationHtml, financeHtml, historyHtml }) {
  setText("detailDrawerEyebrow", eyebrow);
  setText("detailDrawerTitle", title);
  setText("detailDrawerSubtitle", subtitle);

  setHTML("detailSummaryPanel", summaryHtml || "");
  setHTML("detailDocumentsPanel", documentsHtml || "");
  setHTML("detailOperationPanel", operationHtml || "");
  setHTML("detailFinancePanel", financeHtml || "");
  setHTML("detailHistoryPanel", historyHtml || "");

  updateDrawerFooter();

  const drawer = $("#detailDrawer");
  if (!drawer) return;

  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");

  showDetailTab("summary");
}

function closeDetailDrawer() {
  const drawer = $("#detailDrawer");
  if (!drawer) return;

  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-locked");

  state.activeDetail = null;
}

function showDetailTab(tabName) {
  $$(".drawer-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.detailTab === tabName);
  });

  $$(".drawer-tab-panel").forEach((panel) => {
    const active = panel.dataset.detailPanel === tabName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function updateDrawerFooter() {
  const footer = $(".drawer-footer");
  if (!footer) return;

  const active = state.activeDetail;
  const isReviewable = active && (active.type === "driver" || active.type === "commerce");

  $$("[data-action='drawer-require-correction'], [data-action='drawer-block-profile'], [data-action='drawer-approve-profile']", footer)
    .forEach((button) => {
      button.hidden = !isReviewable;
    });
}

/* =========================================================
   DETAIL RENDERERS
========================================================= */

function renderUserSummary(user) {
  const adminProfile = state.indexes.adminsById.get(user.id);

  return `
    <div class="detail-card">
      <h3>Identidad</h3>
      <div class="detail-grid">
        ${detailField("UID", user.uid || user.id)}
        ${detailField("Nombre", user.fullName || "—")}
        ${detailField("Correo", user.email || "—")}
        ${detailField("Teléfono", user.phone || "—")}
        ${detailField("Rol base", ROLE_LABELS[user.role] || user.role || "—")}
        ${detailField("Estado", STATUS_LABELS[user.status] || user.status || "—")}
        ${detailField("Admin", adminProfile ? `Sí · ${adminProfile.role}` : "No")}
        ${detailField("Proveedor", user.provider || "—")}
      </div>
    </div>

    <div class="detail-card">
      <h3>Zona</h3>
      <div class="detail-grid">
        ${detailField("País", user.country || "—")}
        ${detailField("Departamento", user.department || "—")}
        ${detailField("Municipio", user.municipality || "—")}
        ${detailField("registeredZoneId", user.registeredZoneId || "—")}
      </div>
    </div>
  `;
}

function renderUserOperation(user) {
  return `
    <div class="detail-card">
      <h3>Actividad de cuenta</h3>
      <div class="detail-grid">
        ${detailField("Perfil completo", user.profileCompleted ? "Sí" : "No")}
        ${detailField("Reglas aceptadas", user.acceptedCommunityRules ? "Sí" : "No")}
        ${detailField("Versión reglas", user.acceptedCommunityRulesVersion || "—")}
        ${detailField("Fuente", user.source || "—")}
        ${detailField("Registro", formatDate(user.createdAt))}
        ${detailField("Último login", formatDate(user.lastLoginAt))}
      </div>
    </div>
  `;
}

function renderDriverSummary(driver) {
  return `
    <div class="detail-card">
      <h3>Conductor</h3>
      <div class="detail-grid">
        ${detailField("Driver ID", driver.driverId || driver.id)}
        ${detailField("Nombre", driver.fullName || "—")}
        ${detailField("Correo", driver.email || "—")}
        ${detailField("Teléfono", driver.phone || "—")}
        ${detailField("Estado", STATUS_LABELS[driver.status] || driver.status || "—")}
        ${detailField("Motivo estado", driver.statusReason || "—")}
        ${detailField("Vehículo", vehicleLabel(driver.vehicleType))}
        ${detailField("Placa", get(driver, "documentNumbers.plate", "—"))}
      </div>
    </div>

    <div class="detail-card">
      <h3>Zona y servicios</h3>
      <div class="detail-grid">
        ${detailField("País", driver.country || "—")}
        ${detailField("Departamento", driver.department || "—")}
        ${detailField("Municipio", driver.municipality || "—")}
        ${detailField("serviceZoneId", driver.serviceZoneId || "—")}
        ${detailField("Viajes", get(driver, "enabledServices.ride", false) ? "Sí" : "No")}
        ${detailField("Delivery", get(driver, "enabledServices.delivery", false) ? "Sí" : "No")}
        ${detailField("Paquetes", get(driver, "enabledServices.package", false) ? "Sí" : "No")}
        ${detailField("Escolar", get(driver, "enabledServices.school", false) ? "Sí" : "No")}
      </div>
    </div>
  `;
}

function renderDriverDocuments(driver) {
  const docs = driver.documents || {};
  const docItems = [
    ["Selfie", docs.selfieUrl],
    ["DUI frontal", docs.duiFrontUrl],
    ["DUI reverso", docs.duiBackUrl],
    ["Licencia frontal", docs.licenseFrontUrl],
    ["Licencia reverso", docs.licenseBackUrl],
    ["Tarjeta circulación", docs.circulationCardUrl],
    ["Vehículo frente", docs.vehicleFrontUrl],
    ["Vehículo atrás", docs.vehicleBackUrl],
    ["Vehículo izquierda", docs.vehicleLeftUrl],
    ["Vehículo derecha", docs.vehicleRightUrl],
  ];

  return `
    <div class="detail-card">
      <h3>Documentos del conductor</h3>
      <div class="document-grid">
        ${docItems.map(([label, url]) => documentCard(label, url)).join("")}
      </div>
    </div>

    <div class="detail-card">
      <h3>Números/documentos</h3>
      <div class="detail-grid">
        ${detailField("DUI", get(driver, "documentNumbers.duiNumber", "—"))}
        ${detailField("Licencia", get(driver, "documentNumbers.licenseNumber", "—"))}
        ${detailField("Tarjeta circulación", get(driver, "documentNumbers.circulationCardNumber", "—"))}
        ${detailField("Placa", get(driver, "documentNumbers.plate", "—"))}
      </div>
    </div>
  `;
}

function renderDriverOperation(driver) {
  return `
    <div class="detail-card">
      <h3>Disponibilidad</h3>
      <div class="detail-grid">
        ${detailField("Online", get(driver, "availability.isOnline", false) ? "Sí" : "No")}
        ${detailField("Disponible", get(driver, "availability.isAvailable", false) ? "Sí" : "No")}
        ${detailField("Puede viajes", get(driver, "availability.canReceiveRideOffers", false) ? "Sí" : "No")}
        ${detailField("Puede delivery", get(driver, "availability.canReceiveDeliveryOffers", false) ? "Sí" : "No")}
        ${detailField("Tarea actual", get(driver, "availability.currentTaskId", "—"))}
        ${detailField("Tipo tarea actual", get(driver, "availability.currentTaskType", "—"))}
      </div>
    </div>

    <div class="detail-card">
      <h3>Revisión</h3>
      <div class="detail-grid">
        ${detailField("Documentos completos", get(driver, "verification.documentsCompleted", false) ? "Sí" : "No")}
        ${detailField("Selfie verificada", get(driver, "verification.selfieVerified", false) ? "Sí" : "No")}
        ${detailField("Vehículo verificado", get(driver, "verification.vehicleVerified", false) ? "Sí" : "No")}
        ${detailField("Enviado", formatDate(get(driver, "verification.documentsSubmittedAt")))}
        ${detailField("Revisado", formatDate(get(driver, "verification.reviewedAt")))}
        ${detailField("Revisado por", get(driver, "verification.reviewedBy", "—"))}
        ${detailField("Motivo rechazo", get(driver, "verification.rejectionReason", "—"))}
        ${detailField("Corrección", get(driver, "verification.reviewReason", "—"))}
      </div>
    </div>

    <div class="detail-card">
      <h3>Política operativa</h3>
      <div class="detail-grid">
        ${detailField("Puede recibir tareas", get(driver, "policy.canReceiveTasks", false) ? "Sí" : "No")}
        ${detailField("Bloqueo", get(driver, "policy.blockReason", "—"))}
        ${detailField("Bloqueado por", get(driver, "policy.blockedBy", "—"))}
        ${detailField("Bloqueado en", formatDate(get(driver, "policy.blockedAt")))}
      </div>
    </div>
  `;
}

function renderDriverFinance(driver) {
  return `
    <div class="detail-card">
      <h3>Métricas</h3>
      <div class="detail-grid">
        ${detailField("Tareas completadas", get(driver, "metrics.completedTasks", 0))}
        ${detailField("Tareas canceladas", get(driver, "metrics.cancelledTasks", 0))}
        ${detailField("Rating", get(driver, "metrics.rating", 0))}
        ${detailField("Ganancias", formatMoney(get(driver, "metrics.totalEarnings", 0)))}
      </div>
    </div>
  `;
}

function renderCommerceSummary(commerce) {
  return `
    <div class="detail-card">
      <h3>Comercio</h3>
      <div class="detail-grid">
        ${detailField("Commerce ID", commerce.commerceId || commerce.id)}
        ${detailField("Nombre negocio", commerce.businessName || "—")}
        ${detailField("Razón legal", commerce.legalName || "—")}
        ${detailField("Dueño", commerce.ownerName || commerce.ownerUid || "—")}
        ${detailField("Correo", commerce.email || "—")}
        ${detailField("Teléfono", commerce.phone || "—")}
        ${detailField("Categoría", commerce.categoryName || commerce.categoryId || "—")}
        ${detailField("Estado", STATUS_LABELS[commerce.status] || commerce.status || "—")}
      </div>
    </div>

    <div class="detail-card">
      <h3>Zona</h3>
      <div class="detail-grid">
        ${detailField("Departamento", commerce.department || "—")}
        ${detailField("Municipio", commerce.municipality || "—")}
        ${detailField("Dirección", commerce.address || "—")}
        ${detailField("serviceZoneId", commerce.serviceZoneId || "—")}
      </div>
    </div>
  `;
}

function renderCommerceDocuments(commerce) {
  return `
    <div class="detail-card">
      <h3>Imágenes del comercio</h3>
      <div class="document-grid">
        ${documentCard("Logo", commerce.logoUrl)}
        ${documentCard("Portada", commerce.coverUrl)}
      </div>
    </div>
  `;
}

function renderCommerceOperation(commerce) {
  return `
    <div class="detail-card">
      <h3>Operación</h3>
      <div class="detail-grid">
        ${detailField("Puede recibir órdenes", commerce.canReceiveOrders ? "Sí" : "No")}
        ${detailField("Visible en app", commerce.isVisible ? "Sí" : "No")}
        ${detailField("Catálogo activo", commerce.catalogEnabled ? "Sí" : "No")}
        ${detailField("Plan", commerce.plan || "none")}
        ${detailField("Acepta efectivo", get(commerce, "settings.acceptsCash", false) ? "Sí" : "No")}
        ${detailField("Acepta tarjeta", get(commerce, "settings.acceptsCard", false) ? "Sí" : "No")}
        ${detailField("Tiempo preparación", `${get(commerce, "settings.preparationTimeMinutes", 30)} min`)}
        ${detailField("Auto aceptar", get(commerce, "settings.autoAcceptOrders", false) ? "Sí" : "No")}
      </div>
    </div>

    <div class="detail-card">
      <h3>Verificación</h3>
      <div class="detail-grid">
        ${detailField("Estado", get(commerce, "verification.status", "—"))}
        ${detailField("Enviado", formatDate(get(commerce, "verification.documentsSubmittedAt")))}
        ${detailField("Revisado", formatDate(get(commerce, "verification.reviewedAt")))}
        ${detailField("Revisado por", get(commerce, "verification.reviewedBy", "—"))}
        ${detailField("Motivo rechazo", get(commerce, "verification.rejectionReason", "—"))}
        ${detailField("Corrección", get(commerce, "verification.reviewReason", "—"))}
      </div>
    </div>
  `;
}

function renderCommerceFinance(commerce) {
  return `
    <div class="detail-card">
      <h3>Métricas comerciales</h3>
      <div class="detail-grid">
        ${detailField("Órdenes completadas", get(commerce, "metrics.ordersCompleted", 0))}
        ${detailField("Órdenes canceladas", get(commerce, "metrics.ordersCancelled", 0))}
        ${detailField("Rating", get(commerce, "metrics.rating", 0))}
        ${detailField("Ventas totales", formatMoney(get(commerce, "metrics.totalSales", 0)))}
        ${detailField("Comisión", formatPercent(commerce.commissionRate || 0))}
        ${detailField("Prep. promedio", `${get(commerce, "metrics.averagePreparationMinutes", 0)} min`)}
      </div>
    </div>
  `;
}

function renderAgentSummary(agent) {
  return `
    <div class="detail-card">
      <h3>Agente</h3>
      <div class="detail-grid">
        ${detailField("Agent ID", agent.agentId || agent.id)}
        ${detailField("Nombre", agent.fullName || "—")}
        ${detailField("Correo", agent.email || "—")}
        ${detailField("Teléfono", agent.phone || "—")}
        ${detailField("Negocio", agent.businessName || "—")}
        ${detailField("Estado", STATUS_LABELS[agent.status] || agent.status || "—")}
      </div>
    </div>
  `;
}

function renderAgentOperation(agent) {
  return `
    <div class="detail-card">
      <h3>Operación</h3>
      <div class="detail-grid">
        ${detailField("Puede procesar recargas", agent.canProcessTopups ? "Sí" : "No")}
        ${detailField("Zona", agent.serviceZoneId || "—")}
        ${detailField("Departamento", agent.department || "—")}
        ${detailField("Municipio", agent.municipality || "—")}
        ${detailField("Revisado", formatDate(agent.reviewedAt))}
        ${detailField("Revisado por", agent.reviewedBy || "—")}
      </div>
    </div>
  `;
}

function renderAgentFinance(agent) {
  return `
    <div class="detail-card">
      <h3>Límites y comisión</h3>
      <div class="detail-grid">
        ${detailField("Límite diario", formatMoney(agent.dailyLimit || 0))}
        ${detailField("Límite mensual", formatMoney(agent.monthlyLimit || 0))}
        ${detailField("Comisión", formatPercent(agent.commissionRate || 0))}
      </div>
    </div>
  `;
}

function renderZoneSummary(zone) {
  return `
    <div class="detail-card">
      <h3>Zona</h3>
      <div class="detail-grid">
        ${detailField("ID", zone.id)}
        ${detailField("Nombre", zone.displayName || "—")}
        ${detailField("País", zone.country || "SV")}
        ${detailField("Departamento", zone.department || "—")}
        ${detailField("Municipio", zone.municipality || "—")}
        ${detailField("Activa", zone.active ? "Sí" : "No")}
      </div>
    </div>
  `;
}

function renderZoneOperation(zone) {
  return `
    <div class="detail-card">
      <h3>Servicios</h3>
      <div class="detail-grid">
        ${detailField("Viajes", get(zone, "enabledServices.ride", false) ? "Sí" : "No")}
        ${detailField("Delivery", get(zone, "enabledServices.delivery", false) ? "Sí" : "No")}
        ${detailField("Paquetes", get(zone, "enabledServices.package", false) ? "Sí" : "No")}
        ${detailField("Escolar", get(zone, "enabledServices.school", false) ? "Sí" : "No")}
      </div>
    </div>

    <div class="detail-card">
      <h3>Transportes</h3>
      <div class="detail-grid">
        ${Object.entries(zone.transportConfigs || {}).map(([key, value]) => (
          detailField(vehicleLabel(key), value?.active ? "Activo" : "Inactivo")
        )).join("") || detailField("Transportes", "Sin configurar")}
      </div>
    </div>
  `;
}

function renderZonePricing(zone) {
  const configs = zone.transportConfigs || {};

  return `
    <div class="detail-card">
      <h3>Tarifas por transporte</h3>
      <div class="detail-grid">
        ${Object.entries(configs).map(([key, cfg]) => `
          ${detailField(`${vehicleLabel(key)} base`, formatMoney(cfg.baseFare || 0))}
          ${detailField(`${vehicleLabel(key)} mínimo`, formatMoney(cfg.minimumFare || 0))}
          ${detailField(`${vehicleLabel(key)} km`, formatMoney(cfg.pricePerKm || 0))}
          ${detailField(`${vehicleLabel(key)} minuto`, formatMoney(cfg.pricePerMinute || 0))}
        `).join("") || detailField("Tarifas", "Sin configurar")}
      </div>
    </div>
  `;
}

function renderRideTypeSummary(type) {
  return `
    <div class="detail-card">
      <h3>Categoría</h3>
      <div class="detail-grid">
        ${detailField("ID", type.id)}
        ${detailField("Nombre", type.title || "—")}
        ${detailField("Descripción", type.description || "—")}
        ${detailField("Activo globalmente", type.activeGlobally ? "Sí" : "No")}
        ${detailField("Pasajeros máximos", type.maxPassengers || 1)}
        ${detailField("Orden", type.sortOrder || 0)}
      </div>
    </div>
  `;
}

function renderRideTypeOperation(type) {
  return `
    <div class="detail-card">
      <h3>Reglas</h3>
      <div class="detail-grid">
        ${detailField("Cobra por persona", type.chargesPerPassenger ? "Sí" : "No")}
        ${detailField("Requiere selección pasajeros", type.requiresPassengerSelection ? "Sí" : "No")}
        ${detailField("Creado", formatDate(type.createdAt))}
        ${detailField("Actualizado", formatDate(type.updatedAt))}
      </div>
    </div>
  `;
}

function renderAuditForTarget(collectionName, targetId) {
  const items = state.adminActions.filter((action) => {
    return action.targetCollection === collectionName && action.targetId === targetId;
  });

  if (!items.length) {
    return `<div class="empty-state compact">No hay historial administrativo para este perfil.</div>`;
  }

  return `
    <div class="detail-card">
      <h3>Historial administrativo</h3>
      <div class="compact-list">
        ${items.map((action) => `
          <div class="review-card">
            <strong>${escapeHtml(action.action || "Acción")}</strong>
            <span>${escapeHtml(action.adminEmail || action.adminId || "Admin")} · ${formatDate(action.createdAt)}</span>
            <span>${escapeHtml(action.reason || "Sin motivo")}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

/* =========================================================
   REVIEW / APPROVAL ACTIONS
========================================================= */

function openReviewModal({ targetId, targetCollection, targetRole, decision = "" }) {
  const modal = $("#reviewDecisionModal");
  if (!modal) return;

  $("#reviewTargetId").value = targetId || "";
  $("#reviewTargetCollection").value = targetCollection || "";
  $("#reviewTargetRole").value = targetRole || "";
  $("#reviewDecisionType").value = decision || "";
  $("#reviewDecisionReason").value = "";

  const title = targetRole === "commerce"
    ? "Revisar comercio"
    : "Revisar conductor";

  setText("reviewDecisionTitle", title);

  openModal("reviewDecisionModal");
}

async function handleReviewDecisionSubmit() {
  const targetId = normalizeText($("#reviewTargetId")?.value);
  const targetCollection = normalizeText($("#reviewTargetCollection")?.value);
  const targetRole = normalizeText($("#reviewTargetRole")?.value);
  const decision = normalizeText($("#reviewDecisionType")?.value);
  const reason = normalizeText($("#reviewDecisionReason")?.value);

  if (!targetId || !targetCollection || !targetRole || !decision) {
    showToast("Selecciona una decisión válida.", "warning", "Falta decisión");
    return;
  }

  if (["reject", "block", "correction_required"].includes(decision) && reason.length < 5) {
    showToast("Escribe un motivo claro para esta decisión.", "warning", "Motivo requerido");
    return;
  }

  try {
    setFormLoading("reviewDecisionForm", true);

    if (targetRole === "driver") {
      await applyDriverDecision(targetId, decision, reason);
    } else if (targetRole === "commerce") {
      await applyCommerceDecision(targetId, decision, reason);
    } else {
      throw new Error("Tipo de perfil no soportado para revisión.");
    }

    closeModal("reviewDecisionModal");
    closeDetailDrawer();

    await loadDashboardData();

    showToast("La decisión administrativa fue aplicada correctamente.", "success", "Decisión guardada");
  } catch (error) {
    console.error("[NIVO Dashboard] Error aplicando decisión:", error);
    showToast(error.message || "No se pudo aplicar la decisión.", "error", "Error");
  } finally {
    setFormLoading("reviewDecisionForm", false);
  }
}

async function applyDriverDecision(driverId, decision, reason) {
  const driver = state.indexes.driversById.get(driverId) || await fetchDocument(COLLECTIONS.driverProfiles, driverId);

  if (!driver) {
    throw new Error("No se encontró el conductor.");
  }

  const batch = writeBatch(state.db);
  const driverRef = doc(state.db, COLLECTIONS.driverProfiles, driverId);
  const userRef = doc(state.db, COLLECTIONS.users, driver.uid || driverId);

  const baseVerification = {
    "verification.reviewedAt": serverTimestamp(),
    "verification.reviewedBy": state.firebaseUser.uid,
    "verification.adminNote": reason || null,
  };

  let profileUpdate = {};
  let userUpdate = {};
  let action = "";
  let notification = null;

  if (decision === "approve") {
    profileUpdate = {
      status: "active",
      statusReason: null,

      ...baseVerification,

      "verification.selfieVerified": true,
      "verification.vehicleVerified": true,
      "verification.rejectionReason": null,
      "verification.reviewReason": null,

      "policy.canReceiveTasks": true,
      "policy.blockReason": null,
      "policy.blockedAt": null,
      "policy.blockedBy": null,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "active",
      profileCompleted: true,
      updatedAt: serverTimestamp(),
    };

    action = "driver_approved";

    notification = {
      title: "Tu cuenta fue aprobada",
      body: "Ya puedes empezar a operar en NIVO cuando completes tu disponibilidad.",
      type: "driver_approved",
    };
  }

  if (decision === "correction_required") {
    profileUpdate = {
      status: "correction_required",
      statusReason: reason || "Documentos requieren corrección",

      ...baseVerification,

      "verification.reviewReason": reason || "Debes corregir tus documentos.",
      "verification.rejectionReason": null,

      "policy.canReceiveTasks": false,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "pending_profile",
      profileCompleted: false,
      updatedAt: serverTimestamp(),
    };

    action = "driver_correction_required";

    notification = {
      title: "Debes corregir tus documentos",
      body: reason || "Revisa tu app NIVO Driver para completar la corrección.",
      type: "driver_correction_required",
    };
  }

  if (decision === "reject") {
    profileUpdate = {
      status: "rejected",
      statusReason: reason || "Solicitud rechazada",

      ...baseVerification,

      "verification.rejectionReason": reason || "Solicitud rechazada.",
      "verification.reviewReason": null,

      "policy.canReceiveTasks": false,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "rejected",
      profileCompleted: false,
      updatedAt: serverTimestamp(),
    };

    action = "driver_rejected";

    notification = {
      title: "Tu solicitud no fue aprobada",
      body: reason || "Tu perfil de conductor no fue aprobado.",
      type: "driver_rejected",
    };
  }

  if (decision === "block") {
    profileUpdate = {
      status: "blocked",
      statusReason: reason || "Cuenta bloqueada",

      ...baseVerification,

      "policy.canReceiveTasks": false,
      "policy.blockReason": reason || "Bloqueo administrativo",
      "policy.blockedAt": serverTimestamp(),
      "policy.blockedBy": state.firebaseUser.uid,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "blocked",
      updatedAt: serverTimestamp(),
    };

    action = "driver_blocked";

    notification = {
      title: "Tu cuenta de conductor fue bloqueada",
      body: reason || "Contacta a soporte NIVO para más información.",
      type: "driver_blocked",
    };
  }

  if (!action) {
    throw new Error("Decisión de conductor no reconocida.");
  }

  batch.update(driverRef, profileUpdate);
  batch.update(userRef, userUpdate);

  addAdminActionToBatch(batch, {
    action,
    targetCollection: COLLECTIONS.driverProfiles,
    targetId: driverId,
    targetRole: "driver",
    reason: reason || null,
    before: auditSnapshot(driver),
    after: {
      status: profileUpdate.status,
      userStatus: userUpdate.status,
      policyCanReceiveTasks: profileUpdate["policy.canReceiveTasks"] ?? null,
    },
    metadata: {
      decision,
    },
  });

  if (notification) {
    addNotificationToBatch(batch, {
      uid: driver.uid || driverId,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      targetRole: "driver",
    });
  }

  await batch.commit();
}

async function applyCommerceDecision(commerceId, decision, reason) {
  const commerce = state.indexes.commerceById.get(commerceId) || await fetchDocument(COLLECTIONS.commerceProfiles, commerceId);

  if (!commerce) {
    throw new Error("No se encontró el comercio.");
  }

  const batch = writeBatch(state.db);
  const commerceRef = doc(state.db, COLLECTIONS.commerceProfiles, commerceId);
  const userRef = doc(state.db, COLLECTIONS.users, commerce.uid || commerce.ownerUid || commerceId);

  const baseVerification = {
    "verification.reviewedAt": serverTimestamp(),
    "verification.reviewedBy": state.firebaseUser.uid,
    "verification.adminNote": reason || null,
  };

  let profileUpdate = {};
  let userUpdate = {};
  let action = "";
  let notification = null;

  if (decision === "approve") {
    profileUpdate = {
      status: "active",

      ...baseVerification,

      "verification.status": "approved",
      "verification.rejectionReason": null,
      "verification.reviewReason": null,

      canReceiveOrders: true,
      isVisible: true,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "active",
      profileCompleted: true,
      updatedAt: serverTimestamp(),
    };

    action = "commerce_approved";

    notification = {
      title: "Tu comercio fue aprobado",
      body: "Tu comercio ya puede operar en NIVO.",
      type: "commerce_approved",
    };
  }

  if (decision === "correction_required") {
    profileUpdate = {
      status: "correction_required",

      ...baseVerification,

      "verification.status": "correction_required",
      "verification.reviewReason": reason || "Debes corregir la información del comercio.",
      "verification.rejectionReason": null,

      canReceiveOrders: false,
      isVisible: false,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "pending_profile",
      profileCompleted: false,
      updatedAt: serverTimestamp(),
    };

    action = "commerce_correction_required";

    notification = {
      title: "Tu comercio necesita corrección",
      body: reason || "Revisa tu app NIVO Commerce para completar la corrección.",
      type: "commerce_correction_required",
    };
  }

  if (decision === "reject") {
    profileUpdate = {
      status: "rejected",

      ...baseVerification,

      "verification.status": "rejected",
      "verification.rejectionReason": reason || "Comercio rechazado.",
      "verification.reviewReason": null,

      canReceiveOrders: false,
      isVisible: false,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "rejected",
      profileCompleted: false,
      updatedAt: serverTimestamp(),
    };

    action = "commerce_rejected";

    notification = {
      title: "Tu comercio no fue aprobado",
      body: reason || "Tu comercio no fue aprobado para operar en NIVO.",
      type: "commerce_rejected",
    };
  }

  if (decision === "block") {
    profileUpdate = {
      status: "blocked",

      ...baseVerification,

      "verification.status": "blocked",

      canReceiveOrders: false,
      isVisible: false,

      updatedAt: serverTimestamp(),
    };

    userUpdate = {
      status: "blocked",
      updatedAt: serverTimestamp(),
    };

    action = "commerce_blocked";

    notification = {
      title: "Tu comercio fue bloqueado",
      body: reason || "Contacta a soporte NIVO para más información.",
      type: "commerce_blocked",
    };
  }

  if (!action) {
    throw new Error("Decisión de comercio no reconocida.");
  }

  batch.update(commerceRef, profileUpdate);
  batch.update(userRef, userUpdate);

  addAdminActionToBatch(batch, {
    action,
    targetCollection: COLLECTIONS.commerceProfiles,
    targetId: commerceId,
    targetRole: "commerce",
    reason: reason || null,
    before: auditSnapshot(commerce),
    after: {
      status: profileUpdate.status,
      userStatus: userUpdate.status,
      canReceiveOrders: profileUpdate.canReceiveOrders,
      isVisible: profileUpdate.isVisible,
    },
    metadata: {
      decision,
    },
  });

  if (notification) {
    addNotificationToBatch(batch, {
      uid: commerce.uid || commerce.ownerUid || commerceId,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      targetRole: "commerce",
    });
  }

  await batch.commit();
}

/* =========================================================
   USER STATUS / MAKE ADMIN
========================================================= */

function confirmUserStatusChange(userId, nextStatus) {
  const user = state.indexes.usersById.get(userId);
  if (!user) return showToast("No se encontró el usuario.", "error");

  const label = nextStatus === "active" ? "reactivar" : "bloquear";

  openConfirmModal({
    title: `Confirmar ${label}`,
    message: `¿Confirmas que deseas ${label} la cuenta de ${user.fullName || user.email || userId}?`,
    onConfirm: async () => {
      await updateUserStatus(userId, nextStatus);
    },
  });
}

async function updateUserStatus(userId, nextStatus) {
  const user = state.indexes.usersById.get(userId);
  if (!user) throw new Error("No se encontró el usuario.");

  const batch = writeBatch(state.db);
  const userRef = doc(state.db, COLLECTIONS.users, userId);

  batch.update(userRef, {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  addAdminActionToBatch(batch, {
    action: nextStatus === "active" ? "user_reactivated" : "user_blocked",
    targetCollection: COLLECTIONS.users,
    targetId: userId,
    targetRole: user.role || null,
    reason: nextStatus === "active" ? "Reactivación administrativa" : "Bloqueo administrativo",
    before: auditSnapshot(user),
    after: {
      status: nextStatus,
    },
  });

  await batch.commit();
  await loadDashboardData();

  showToast("Estado de usuario actualizado.", "success", "Usuario actualizado");
}

function openMakeAdminModal(userId) {
  const user = state.indexes.usersById.get(userId);

  if (!user) {
    showToast("No se encontró el usuario seleccionado.", "error");
    return;
  }

  if (state.indexes.adminsById.has(userId)) {
    showToast("Este usuario ya tiene perfil administrativo.", "warning", "Ya es admin");
    return;
  }

  $("#makeAdminUid").value = userId;
  $("#makeAdminEmail").value = user.email || "";
  $("#makeAdminDisplayName").value = user.fullName || user.email || userId;
  $("#makeAdminRole").value = "admin";

  $$("input[name='permissions']").forEach((checkbox) => {
    checkbox.checked = false;
  });

  applyDefaultPermissionsForAdminRole("admin");

  openModal("makeAdminModal");
}

function applyDefaultPermissionsForAdminRole(role) {
  const presets = {
    super_admin: ["users", "drivers", "commerce", "agents", "zones", "settings", "finance", "locations", "sanctions", "notifications"],
    admin: ["users", "drivers", "commerce", "agents", "sanctions", "notifications"],
    operations: ["users", "drivers", "commerce", "agents", "zones", "locations", "notifications"],
    support: ["users", "drivers", "commerce", "agents", "sanctions", "notifications"],
    finance: ["finance", "users", "drivers", "agents"],
    reviewer: ["drivers", "commerce", "agents", "notifications"],
    viewer: [],
  };

  const allowed = new Set(presets[role] || []);

  $$("input[name='permissions']").forEach((checkbox) => {
    checkbox.checked = allowed.has(checkbox.value);
  });
}

async function handleMakeAdminSubmit() {
  const uid = normalizeText($("#makeAdminUid")?.value);
  const email = normalizeEmail($("#makeAdminEmail")?.value);
  const displayName = normalizeText($("#makeAdminDisplayName")?.value);
  const role = normalizeText($("#makeAdminRole")?.value);

  if (!uid || !email || !displayName || !role) {
    showToast("Faltan datos para crear el perfil admin.", "warning", "Datos incompletos");
    return;
  }

  const user = state.indexes.usersById.get(uid);

  if (!user) {
    showToast("No se encontró el usuario base.", "error");
    return;
  }

  const permissions = {};

  $$("input[name='permissions']").forEach((checkbox) => {
    permissions[checkbox.value] = checkbox.checked === true;
  });

  try {
    setFormLoading("makeAdminForm", true);

    const batch = writeBatch(state.db);
    const adminRef = doc(state.db, COLLECTIONS.adminProfiles, uid);

    const adminProfile = {
      uid,
      email,
      displayName,
      role,
      status: "active",
      permissions,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastLoginAt: null,
      createdBy: state.firebaseUser.uid,
      updatedBy: state.firebaseUser.uid,
    };

    batch.set(adminRef, adminProfile);

    addAdminActionToBatch(batch, {
      action: "admin_profile_created",
      targetCollection: COLLECTIONS.adminProfiles,
      targetId: uid,
      targetRole: role,
      reason: "Usuario convertido en administrador desde dashboard",
      before: null,
      after: {
        uid,
        email,
        displayName,
        role,
        status: "active",
        permissions,
      },
      metadata: {
        baseUserRole: user.role || null,
        baseUserStatus: user.status || null,
      },
    });

    await batch.commit();

    closeModal("makeAdminModal");
    await loadDashboardData();

    showToast("Perfil administrativo creado correctamente.", "success", "Admin creado");
  } catch (error) {
    console.error("[NIVO Dashboard] Error creando admin:", error);
    showToast(
      error.message || "No se pudo crear el perfil administrativo. Revisa permisos owner/super_admin.",
      "error",
      "Error creando admin"
    );
  } finally {
    setFormLoading("makeAdminForm", false);
  }
}

/* =========================================================
   ZONES
========================================================= */

function openZoneModal(zoneId = null) {
  const zone = zoneId ? state.indexes.zonesById.get(zoneId) : null;

  $("#zoneId").value = zone?.id || "";
  $("#zoneCountry").value = zone?.country || "SV";
  $("#zoneDepartment").value = zone?.department || "";
  $("#zoneMunicipality").value = zone?.municipality || "";
  $("#zoneDisplayName").value = zone?.displayName || "";

  $("#zoneServiceRide").checked = get(zone, "enabledServices.ride", false);
  $("#zoneServiceDelivery").checked = get(zone, "enabledServices.delivery", false);
  $("#zoneServicePackage").checked = get(zone, "enabledServices.package", false);
  $("#zoneServiceSchool").checked = get(zone, "enabledServices.school", false);

  $("#zoneTransportCar").checked = get(zone, "transportConfigs.car.active", false);
  $("#zoneTransportMotorcycle").checked = get(zone, "transportConfigs.motorcycle.active", false);
  $("#zoneTransportMototaxi").checked = get(zone, "transportConfigs.mototaxi.active", false);
  $("#zoneTransportQute").checked = get(zone, "transportConfigs.qute.active", false);

  $("#zoneActive").checked = zone?.active === true;

  setText("zoneModalTitle", zone ? "Editar zona operativa" : "Crear zona operativa");

  openModal("zoneModal");
}

async function handleZoneSubmit() {
  const existingId = normalizeText($("#zoneId")?.value);
  const country = normalizeText($("#zoneCountry")?.value || "SV").toUpperCase();
  const department = normalizeText($("#zoneDepartment")?.value);
  const municipality = normalizeText($("#zoneMunicipality")?.value);
  const displayName = normalizeText($("#zoneDisplayName")?.value);
  const zoneId = existingId || buildServiceZoneId(country, department, municipality);

  if (!country || !department || !municipality || !displayName || !zoneId) {
    showToast("Completa país, departamento, municipio y nombre visible.", "warning", "Zona incompleta");
    return;
  }

  const exists = state.indexes.zonesById.has(zoneId);

  const data = {
    id: zoneId,
    serviceZoneId: zoneId,
    country,
    department,
    municipality,
    displayName,
    currencyCode: "USD",
    active: $("#zoneActive")?.checked === true,

    enabledServices: {
      ride: $("#zoneServiceRide")?.checked === true,
      delivery: $("#zoneServiceDelivery")?.checked === true,
      package: $("#zoneServicePackage")?.checked === true,
      school: $("#zoneServiceSchool")?.checked === true,
    },

    transportConfigs: {
      car: buildDefaultTransportConfig("car", $("#zoneTransportCar")?.checked === true),
      motorcycle: buildDefaultTransportConfig("motorcycle", $("#zoneTransportMotorcycle")?.checked === true),
      mototaxi: buildDefaultTransportConfig("mototaxi", $("#zoneTransportMototaxi")?.checked === true),
      qute: buildDefaultTransportConfig("qute", $("#zoneTransportQute")?.checked === true),
    },

    platformCommissionRate: 0,
    updatedAt: serverTimestamp(),
  };

  if (!exists) {
    data.createdAt = serverTimestamp();
  }

  try {
    setFormLoading("zoneForm", true);

    const batch = writeBatch(state.db);
    const zoneRef = doc(state.db, COLLECTIONS.serviceZones, zoneId);

    batch.set(zoneRef, data, { merge: true });

    addAdminActionToBatch(batch, {
      action: exists ? "service_zone_updated" : "service_zone_created",
      targetCollection: COLLECTIONS.serviceZones,
      targetId: zoneId,
      targetRole: null,
      reason: exists ? "Zona actualizada desde dashboard" : "Zona creada desde dashboard",
      before: exists ? auditSnapshot(state.indexes.zonesById.get(zoneId)) : null,
      after: {
        country,
        department,
        municipality,
        displayName,
        active: data.active,
        enabledServices: data.enabledServices,
      },
    });

    await batch.commit();

    closeModal("zoneModal");
    await loadDashboardData();

    showToast("Zona guardada correctamente.", "success", "Zona actualizada");
  } catch (error) {
    console.error("[NIVO Dashboard] Error guardando zona:", error);
    showToast(error.message || "No se pudo guardar la zona.", "error", "Error");
  } finally {
    setFormLoading("zoneForm", false);
  }
}

function buildDefaultTransportConfig(type, active) {
  const base = {
    active,
    transportId: type,
    transportTitle: vehicleLabel(type),
    maxPassengers: type === "car" ? 4 : 1,
    baseFare: type === "car" ? 1.0 : 0.5,
    minimumFare: type === "car" ? 1.5 : 0.5,
    pricePerKm: type === "car" ? 0.55 : 0,
    pricePerMinute: type === "car" ? 0.07 : 0,
    chargesPerPassenger: type !== "car",
    requiresPassengerSelection: type !== "car",
    maxAutoPricedZoneLevel: 3,
    outOfZoneRequiresConfirmation: true,
    zoneFixedFareIsPerPassenger: type !== "car",
  };

  if (type === "mototaxi" || type === "qute") {
    base.urbanFarePerPassenger = 0.5;
    base.outOfUrbanFarePerPassenger = 1.0;
  }

  return base;
}

/* =========================================================
   RIDE TYPES
========================================================= */

function openRideTypeModal(typeId = null) {
  const type = typeId ? state.indexes.rideTypesById.get(typeId) : null;

  $("#rideTypeId").value = type?.id || "";
  $("#rideTypeId").disabled = Boolean(type);
  $("#rideTypeTitle").value = type?.title || "";
  $("#rideTypeDescription").value = type?.description || "";
  $("#rideTypeMaxPassengers").value = type?.maxPassengers || 1;
  $("#rideTypeSortOrder").value = type?.sortOrder || 0;
  $("#rideTypeActiveGlobally").checked = type?.activeGlobally === true;
  $("#rideTypeChargesPerPassenger").checked = type?.chargesPerPassenger === true;
  $("#rideTypeRequiresPassengerSelection").checked = type?.requiresPassengerSelection === true;

  setText("rideTypeModalTitle", type ? "Editar categoría" : "Crear categoría");

  openModal("rideTypeModal");
}

async function handleRideTypeSubmit() {
  const id = slugify($("#rideTypeId")?.value);
  const existing = state.indexes.rideTypesById.get(id);

  const title = normalizeText($("#rideTypeTitle")?.value);
  const description = normalizeText($("#rideTypeDescription")?.value);
  const maxPassengers = Number($("#rideTypeMaxPassengers")?.value || 1);
  const sortOrder = Number($("#rideTypeSortOrder")?.value || 0);

  if (!id || !title) {
    showToast("Ingresa ID y nombre visible de la categoría.", "warning", "Categoría incompleta");
    return;
  }

  const data = {
    id,
    title,
    description: description || null,
    activeGlobally: $("#rideTypeActiveGlobally")?.checked === true,
    chargesPerPassenger: $("#rideTypeChargesPerPassenger")?.checked === true,
    requiresPassengerSelection: $("#rideTypeRequiresPassengerSelection")?.checked === true,
    maxPassengers: Number.isFinite(maxPassengers) && maxPassengers > 0 ? maxPassengers : 1,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    updatedAt: serverTimestamp(),
  };

  if (!existing) {
    data.createdAt = serverTimestamp();
  }

  try {
    setFormLoading("rideTypeForm", true);

    const batch = writeBatch(state.db);
    const ref = doc(state.db, COLLECTIONS.rideTypes, id);

    batch.set(ref, data, { merge: true });

    addAdminActionToBatch(batch, {
      action: existing ? "ride_type_updated" : "ride_type_created",
      targetCollection: COLLECTIONS.rideTypes,
      targetId: id,
      reason: existing ? "Categoría actualizada desde dashboard" : "Categoría creada desde dashboard",
      before: existing ? auditSnapshot(existing) : null,
      after: {
        id,
        title,
        activeGlobally: data.activeGlobally,
        maxPassengers: data.maxPassengers,
      },
    });

    await batch.commit();

    $("#rideTypeId").disabled = false;
    closeModal("rideTypeModal");
    await loadDashboardData();

    showToast("Categoría guardada correctamente.", "success", "Categoría actualizada");
  } catch (error) {
    console.error("[NIVO Dashboard] Error guardando categoría:", error);
    showToast(error.message || "No se pudo guardar la categoría.", "error", "Error");
  } finally {
    setFormLoading("rideTypeForm", false);
  }
}

/* =========================================================
   NOTIFICATIONS
========================================================= */

function openNotificationModal() {
  $("#notificationTargetType").value = "";
  $("#notificationTargetValue").value = "";
  $("#notificationTitle").value = "";
  $("#notificationBody").value = "";
  $("#notificationType").value = "info";

  openModal("notificationModal");
}

function openNotificationFromDrawer() {
  const active = state.activeDetail;

  if (!active) {
    openNotificationModal();
    return;
  }

  const data = active.data || {};

  $("#notificationTargetType").value = "single_uid";
  $("#notificationTargetValue").value = data.uid || data.ownerUid || data.driverId || data.agentId || active.id;
  $("#notificationTitle").value = "";
  $("#notificationBody").value = "";
  $("#notificationType").value = "account";

  openModal("notificationModal");
}

async function handleNotificationSubmit() {
  const targetType = normalizeText($("#notificationTargetType")?.value);
  const targetValue = normalizeText($("#notificationTargetValue")?.value);
  const title = normalizeText($("#notificationTitle")?.value);
  const body = normalizeText($("#notificationBody")?.value);
  const type = normalizeText($("#notificationType")?.value || "info");

  if (!targetType || !title || !body) {
    showToast("Completa destino, título y mensaje.", "warning", "Notificación incompleta");
    return;
  }

  try {
    setFormLoading("notificationForm", true);

    const ref = doc(collection(state.db, COLLECTIONS.notifications));

    const data = {
      notificationId: ref.id,
      targetType,
      targetValue: targetValue || null,
      uid: targetType === "single_uid" ? targetValue : null,
      userId: targetType === "single_uid" ? targetValue : null,
      title,
      body,
      type,
      read: false,
      status: "created",
      createdBy: state.firebaseUser.uid,
      createdByEmail: state.firebaseUser.email || null,
      createdAt: serverTimestamp(),
    };

    await setDoc(ref, data);

    await createAdminAction({
      action: "notification_created",
      targetCollection: COLLECTIONS.notifications,
      targetId: ref.id,
      reason: `Notificación creada para ${targetType}`,
      after: {
        targetType,
        targetValue: targetValue || null,
        title,
        type,
      },
    });

    closeModal("notificationModal");
    await loadDashboardData();

    showToast("Notificación creada correctamente.", "success", "Notificación guardada");
  } catch (error) {
    console.error("[NIVO Dashboard] Error creando notificación:", error);
    showToast(error.message || "No se pudo crear la notificación.", "error", "Error");
  } finally {
    setFormLoading("notificationForm", false);
  }
}

/* =========================================================
   DRAWER QUICK ACTIONS
========================================================= */

function openReviewFromDrawer(decision) {
  const active = state.activeDetail;

  if (!active || !["driver", "commerce"].includes(active.type)) {
    showToast("Esta acción solo aplica para conductores o comercios.", "warning");
    return;
  }

  openReviewModal({
    targetId: active.id,
    targetCollection: active.collection,
    targetRole: active.type,
    decision,
  });
}

/* =========================================================
   AUDITORÍA / BATCH HELPERS
========================================================= */

function addAdminActionToBatch(batch, payload) {
  const actionRef = doc(collection(state.db, COLLECTIONS.adminActions));

  batch.set(actionRef, sanitizeForFirestore({
    action: payload.action,
    adminId: state.firebaseUser.uid,
    adminEmail: state.firebaseUser.email || state.adminContext?.email || null,
    targetCollection: payload.targetCollection || null,
    targetId: payload.targetId || null,
    targetRole: payload.targetRole || null,
    reason: payload.reason || null,
    before: payload.before || null,
    after: payload.after || null,
    metadata: payload.metadata || null,
    createdAt: serverTimestamp(),
  }));
}

async function createAdminAction(payload) {
  const actionRef = doc(collection(state.db, COLLECTIONS.adminActions));

  await setDoc(actionRef, sanitizeForFirestore({
    action: payload.action,
    adminId: state.firebaseUser.uid,
    adminEmail: state.firebaseUser.email || state.adminContext?.email || null,
    targetCollection: payload.targetCollection || null,
    targetId: payload.targetId || null,
    targetRole: payload.targetRole || null,
    reason: payload.reason || null,
    before: payload.before || null,
    after: payload.after || null,
    metadata: payload.metadata || null,
    createdAt: serverTimestamp(),
  }));
}

function addNotificationToBatch(batch, payload) {
  const notificationRef = doc(collection(state.db, COLLECTIONS.notifications));

  batch.set(notificationRef, sanitizeForFirestore({
    notificationId: notificationRef.id,
    uid: payload.uid,
    userId: payload.uid,
    targetRole: payload.targetRole || null,
    title: payload.title,
    body: payload.body,
    type: payload.type || "info",
    read: false,
    status: "created",
    createdBy: state.firebaseUser.uid,
    createdByEmail: state.firebaseUser.email || null,
    createdAt: serverTimestamp(),
  }));
}

function auditSnapshot(data) {
  if (!data) return null;

  return sanitizeForFirestore({
    id: data.id || null,
    uid: data.uid || null,
    email: data.email || null,
    fullName: data.fullName || data.ownerName || data.businessName || null,
    role: data.role || null,
    status: data.status || null,
    serviceZoneId: data.serviceZoneId || data.registeredZoneId || null,
    vehicleType: data.vehicleType || null,
    canReceiveOrders: data.canReceiveOrders ?? null,
    isVisible: data.isVisible ?? null,
  });
}

/* =========================================================
   MODALS / CONFIRM / IMAGE VIEWER
========================================================= */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");

  const firstInput = $("input, select, textarea, button", modal);
  if (firstInput) {
    window.setTimeout(() => firstInput.focus(), 60);
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");

  if (!$(".modal.is-open") && !$("#detailDrawer")?.classList.contains("is-open")) {
    document.body.classList.remove("is-locked");
  }

  if (id === "rideTypeModal") {
    const rideTypeId = $("#rideTypeId");
    if (rideTypeId) rideTypeId.disabled = false;
  }
}

function closeAllModals() {
  $$(".modal.is-open").forEach((modal) => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  });

  if (!$("#detailDrawer")?.classList.contains("is-open")) {
    document.body.classList.remove("is-locked");
  }

  const rideTypeId = $("#rideTypeId");
  if (rideTypeId) rideTypeId.disabled = false;
}

function openConfirmModal({ title, message, onConfirm }) {
  setText("confirmModalTitle", title || "Confirmar acción");
  setText("confirmModalMessage", message || "¿Confirmas que deseas realizar esta acción?");

  state.pendingConfirm = onConfirm;

  openModal("confirmModal");

  const acceptBtn = $("#confirmModalAcceptBtn");
  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      try {
        acceptBtn.disabled = true;

        if (typeof state.pendingConfirm === "function") {
          await state.pendingConfirm();
        }

        closeConfirmModal();
      } catch (error) {
        console.error("[NIVO Dashboard] Error en confirmación:", error);
        showToast(error.message || "No se pudo realizar la acción.", "error", "Error");
      } finally {
        acceptBtn.disabled = false;
      }
    };
  }
}

function closeConfirmModal() {
  state.pendingConfirm = null;
  closeModal("confirmModal");
}

function openImageViewer(src, title = "Documento") {
  if (!src) {
    showToast("No hay imagen para mostrar.", "warning");
    return;
  }

  setText("imageViewerTitle", title || "Documento");

  const img = $("#imageViewerImg");
  if (img) {
    img.src = src;
    img.alt = title || "Documento seleccionado";
  }

  const modal = $("#imageViewerModal");
  if (!modal) return;

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");
}

function closeImageViewer() {
  const modal = $("#imageViewerModal");
  if (!modal) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");

  const img = $("#imageViewerImg");
  if (img) {
    img.src = "";
  }

  if (!$(".modal.is-open") && !$("#detailDrawer")?.classList.contains("is-open")) {
    document.body.classList.remove("is-locked");
  }
}

/* =========================================================
   FILTERS / ZONES
========================================================= */

function populateZoneFilters() {
  const filters = [
    "usersZoneFilter",
    "driversZoneFilter",
    "commerceZoneFilter",
  ];

  const options = state.serviceZones
    .slice()
    .sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)))
    .map((zone) => {
      const label = zone.displayName || `${zone.department || ""} ${zone.municipality || ""}`.trim() || zone.id;
      return `<option value="${escapeAttr(zone.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  filters.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;

    const current = select.value || "all";
    select.innerHTML = `<option value="all">Todas las zonas</option>${options}`;
    select.value = current;
  });
}

/* =========================================================
   COMPONENTES HTML
========================================================= */

function profileCell({ name, subtitle, imageUrl }) {
  const safeName = name || "NIVO";
  const initials = getInitials(safeName);

  return `
    <div class="profile-cell">
      <div class="profile-avatar">
        ${
          imageUrl
            ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(safeName)}" loading="lazy" />`
            : `<span>${escapeHtml(initials)}</span>`
        }
      </div>
      <div class="profile-meta">
        <strong>${escapeHtml(safeName)}</strong>
        <span>${escapeHtml(subtitle || "Sin información")}</span>
      </div>
    </div>
  `;
}

function statusBadge(status) {
  const raw = status || "pending";
  const label = STATUS_LABELS[raw] || raw;

  return `<span class="status-badge ${escapeAttr(raw)}">${escapeHtml(label)}</span>`;
}

function booleanBadge(value, trueText = "Sí", falseText = "No") {
  return value
    ? `<span class="status-badge active">${escapeHtml(trueText)}</span>`
    : `<span class="status-badge">${escapeHtml(falseText)}</span>`;
}

function badge(label, className = "status-badge") {
  return `<span class="${escapeAttr(className)}">${escapeHtml(label || "—")}</span>`;
}

function servicesBadges(services = {}) {
  const serviceLabels = {
    ride: "Viajes",
    delivery: "Delivery",
    package: "Paquetes",
    school: "Escolar",
  };

  const active = Object.entries(serviceLabels)
    .filter(([key]) => services?.[key] === true)
    .map(([, label]) => `<span class="service-badge active">${escapeHtml(label)}</span>`);

  return `<div class="badge-row">${active.length ? active.join("") : `<span class="service-badge">Sin servicios</span>`}</div>`;
}

function transportConfigsBadges(configs = {}) {
  const items = Object.entries(configs || {})
    .filter(([, config]) => config?.active === true)
    .map(([key]) => `<span class="vehicle-badge">${escapeHtml(vehicleLabel(key))}</span>`);

  return `<div class="badge-row">${items.length ? items.join("") : `<span class="vehicle-badge">Sin transportes</span>`}</div>`;
}

function availabilityBadge(availability = {}) {
  if (availability?.currentTaskId) {
    return `<span class="status-badge pending_review">Ocupado</span>`;
  }

  if (availability?.isOnline && availability?.isAvailable) {
    return `<span class="status-badge active">Disponible</span>`;
  }

  if (availability?.isOnline) {
    return `<span class="status-badge correction_required">Online</span>`;
  }

  return `<span class="status-badge">Offline</span>`;
}

function documentsSummary(documents = {}) {
  const values = Object.values(documents || {});
  const completed = values.filter(Boolean).length;
  const total = values.length || 10;

  const className = completed >= total
    ? "active"
    : completed > 0
      ? "pending_review"
      : "pending_documents";

  return `<span class="status-badge ${className}">${completed}/${total}</span>`;
}

function renderReviewCards(items, role) {
  if (!items.length) {
    return `<div class="empty-state compact">Sin registros en esta etapa.</div>`;
  }

  return items.slice(0, 8).map((item) => {
    const name = role === "commerce"
      ? item.businessName || item.ownerName || item.email || item.id
      : item.fullName || item.email || item.id;

    return `
      <div class="review-card">
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(item.serviceZoneId || item.registeredZoneId || "Sin zona")}</span>
        <span>${escapeHtml(STATUS_LABELS[item.status] || item.status || "Sin estado")}</span>
      </div>
    `;
  }).join("");
}

function detailField(label, value) {
  return `
    <div class="detail-field">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value === undefined || value === null || value === "" ? "—" : String(value))}</strong>
    </div>
  `;
}

function documentCard(label, url) {
  if (!url) {
    return `
      <div class="document-card">
        <button type="button" disabled>
          <span>${escapeHtml(label)} no cargado</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="document-card">
      <button
        type="button"
        data-action="view-image"
        data-src="${escapeAttr(url)}"
        data-title="${escapeAttr(label)}"
      >
        <img src="${escapeAttr(url)}" alt="${escapeAttr(label)}" loading="lazy" />
      </button>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function emptyTableRow(colspan, message) {
  return `
    <tr>
      <td colspan="${Number(colspan) || 1}">
        <div class="empty-state compact">${escapeHtml(message)}</div>
      </td>
    </tr>
  `;
}

/* =========================================================
   HELPERS DE DATOS
========================================================= */

function normalizeVehicleType(value) {
  const raw = normalizeText(value).toLowerCase();

  if (raw === "vehicle") return "car";
  if (raw === "moto") return "motorcycle";

  return raw || "unknown";
}

function vehicleLabel(value) {
  const safe = normalizeVehicleType(value);
  return VEHICLE_LABELS[safe] || VEHICLE_LABELS[value] || value || "Sin vehículo";
}

function formatZone(zoneId, department, municipality) {
  const zone = zoneId ? state.indexes.zonesById.get(zoneId) : null;

  if (zone) {
    return zone.displayName || `${zone.department || ""} ${zone.municipality || ""}`.trim() || zone.id;
  }

  if (department || municipality) {
    return `${department || ""}${department && municipality ? " / " : ""}${municipality || ""}`;
  }

  return zoneId || "Sin zona";
}

function getInitials(value) {
  const parts = normalizeText(value).split(/\s+/).filter(Boolean);

  if (!parts.length) return "N";

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function searchable(item, keys) {
  const values = keys.map((key) => get(item, key, ""));
  return values.join(" ").toLowerCase();
}

function get(obj, path, fallback = undefined) {
  if (!obj || !path) return fallback;

  const parts = String(path).split(".");
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }

  return current === undefined || current === null ? fallback : current;
}

function sumBy(items, field) {
  return items.reduce((total, item) => {
    const value = Number(get(item, field, 0));
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function formatMoney(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(number) ? number : 0);
}

function formatPercent(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) return "0%";

  if (number > 0 && number <= 1) {
    return `${(number * 100).toFixed(2)}%`;
  }

  return `${number.toFixed(2)}%`;
}

function formatDate(value) {
  if (!value) return "—";

  try {
    let date = null;

    if (typeof value.toDate === "function") {
      date = value.toDate();
    } else if (value instanceof Date) {
      date = value;
    } else if (typeof value === "string" || typeof value === "number") {
      date = new Date(value);
    }

    if (!date || Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("es-SV", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch (_) {
    return "—";
  }
}

function buildServiceZoneId(country, department, municipality) {
  const safeCountry = slugify(country || "SV");
  const safeDepartment = slugify(department);
  const safeMunicipality = slugify(municipality);

  if (!safeDepartment || !safeMunicipality) return null;

  return `${safeCountry}-${safeDepartment}-${safeMunicipality}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function removeAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function slugify(value) {
  return removeAccents(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeForFirestore(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirestore(item)).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") return value;

    const cleaned = {};

    Object.entries(value).forEach(([key, item]) => {
      if (item === undefined) return;
      cleaned[key] = sanitizeForFirestore(item);
    });

    return cleaned;
  }

  return value;
}

/* =========================================================
   DOM HELPERS
========================================================= */

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value === undefined || value === null ? "" : String(value);
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html || "";
}

function setFormLoading(formId, loading) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.classList.toggle("is-loading", Boolean(loading));

  $$("input, select, textarea, button", form).forEach((field) => {
    field.disabled = Boolean(loading);
  });
}

function setDashboardLoading(loading) {
  const shell = $("#dashboardShell");
  if (shell) shell.classList.toggle("is-loading", Boolean(loading));
}

function showToast(message, type = "info", title = null) {
  const region = $("#toastRegion");
  if (!region) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <strong>${escapeHtml(title || toastTitle(type))}</strong>
    <span>${escapeHtml(message || "")}</span>
  `;

  region.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";

    window.setTimeout(() => {
      toast.remove();
    }, 220);
  }, 4600);
}

function toastTitle(type) {
  if (type === "success") return "Listo";
  if (type === "warning") return "Atención";
  if (type === "error") return "Error";
  return "NIVO";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function debounce(fn, wait = 160) {
  let timeout = null;

  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), wait);
  };
}

async function logout() {
  try {
    await window.NIVOAuthLogoutHandler();
  } catch (error) {
    console.error("[NIVO Dashboard] Error cerrando sesión:", error);
    safeRedirect("login.html");
  }
}

function safeRedirect(url) {
  window.location.assign(url);
}

/* =========================================================
   API DEBUG
========================================================= */

window.NIVODashboard = {
  state,
  reload: loadDashboardData,
  showSection,
};
