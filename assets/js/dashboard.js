/* =========================================================
   NIVO DASHBOARD JS — versión quirúrgica
   Archivo: assets/js/dashboard.js

   Alineado con Firestore real:
   - users
   - admin_profiles
   - driver_profiles
   - driver_vehicles
   - driver_wallets
   - driver_wallet_transactions
   - driver_offers
   - commerce_users
   - commerce_profiles
   - commerce_products
   - commerce_product_categories
   - delivery_orders
   - ride_requests
   - service_zones
   - fare_configs
   - platform_configs
   - notifications
   - support_tickets

   Reglas críticas:
   - Admin se valida por admin_profiles/{uid}.status == active.
   - Driver aprobado usa driver_profiles.status = "approved".
   - Commerce aprobado usa commerce_users.status = "active" y
     commerce_profiles.active/verified/canReceiveDeliveryOrders = true.
   - Tarifas se leen desde fare_configs, no desde service_zones.transportConfigs.
========================================================= */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

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

document.documentElement.classList.remove("no-js");

/* =========================================================
   CONSTANTES
========================================================= */

const COLLECTIONS = Object.freeze({
  users: "users",
  adminProfiles: "admin_profiles",

  driverProfiles: "driver_profiles",
  driverVehicles: "driver_vehicles",
  driverWallets: "driver_wallets",
  driverWalletTransactions: "driver_wallet_transactions",
  driverTopupSessions: "driver_topup_sessions",
  driverOffers: "driver_offers",

  commerceUsers: "commerce_users",
  commerceProfiles: "commerce_profiles",
  commerceProducts: "commerce_products",
  commerceProductCategories: "commerce_product_categories",
  commerceChats: "commerce_chats",

  orderDrafts: "order_drafts",

  agentProfiles: "agent_profiles",
  agentSales: "agent_sales",

  serviceZones: "service_zones",
  fareConfigs: "fare_configs",
  platformConfigs: "platform_configs",

  deliveryOrders: "delivery_orders",
  rideRequests: "ride_requests",
  packageOrders: "package_orders",

  notifications: "notifications",
  supportTickets: "support_tickets",
  safetyReports: "safety_reports",

  driverSanctions: "driver_sanctions",
  driverPolicyEvents: "driver_policy_events",
  auditLogs: "audit_logs",
  adminActions: "admin_actions",

  cashSettlements: "cash_settlements",
});

const SECTION_META = Object.freeze({
  overview: ["Centro operativo NIVO", "Dashboard / Resumen"],
  users: ["Usuarios registrados", "Dashboard / Usuarios"],
  drivers: ["Conductores y repartidores", "Dashboard / Conductores"],
  "driver-review": ["Aprobación de conductores", "Dashboard / Revisión conductores"],
  commerce: ["Comercios registrados", "Dashboard / Comercios"],
  "commerce-review": ["Aprobación de comercios", "Dashboard / Revisión comercios"],
  agents: ["Agentes NIVO", "Dashboard / Agentes"],
  zones: ["Zonas operativas", "Dashboard / Zonas"],
  "ride-types": ["Categorías de transporte", "Dashboard / Categorías transporte"],
  pricing: ["Tarifas y comisiones", "Dashboard / Tarifas"],
  delivery: ["Delivery / Órdenes", "Dashboard / Delivery"],
  rides: ["Viajes / Solicitudes", "Dashboard / Viajes"],
  locations: ["Ubicaciones operativas", "Dashboard / Ubicaciones"],
  wallet: ["Wallet / Recargas", "Dashboard / Wallet"],
  "cash-settlements": ["Liquidaciones de efectivo", "Dashboard / Liquidaciones"],
  support: ["Soporte e incidencias", "Dashboard / Soporte"],
  sanctions: ["Sanciones y bloqueos", "Dashboard / Sanciones"],
  notifications: ["Notificaciones", "Dashboard / Notificaciones"],
  audit: ["Auditoría administrativa", "Dashboard / Auditoría"],
  settings: ["Configuración general", "Dashboard / Configuración"],
});

const DRIVER_STATUSES = Object.freeze({
  pendingDocuments: "pending_documents",
  pendingReview: "pending_review",
  approved: "approved",
  rejected: "rejected",
  blocked: "blocked",
  fraudSuspected: "fraud_suspected",
  correctionRequired: "correction_required",
});

const COMMERCE_USER_STATUSES = Object.freeze({
  pendingProfile: "pending_profile",
  pendingVerification: "pending_verification",
  active: "active",
  suspended: "suspended",
});

const STATUS_LABELS = Object.freeze({
  active: "Activo",
  approved: "Aprobado",
  inactive: "Inactivo",
  pending: "Pendiente",
  pending_profile: "Perfil pendiente",
  pending_documents: "Documentos pendientes",
  pending_review: "En revisión",
  pending_verification: "En verificación",
  correction_required: "Corrección requerida",
  rejected: "Rechazado",
  blocked: "Bloqueado",
  suspended: "Suspendido",
  fraud_suspected: "Fraude sospechado",
  ready_for_pickup: "Listo para recoger",
  pending_driver: "Pendiente de repartidor",
  searching_driver: "Buscando repartidor",
  preparing: "Preparando",
  delivered: "Entregado",
  cancelled: "Cancelado",
  unread: "No leído",
  read: "Leído",
});

const ROLE_LABELS = Object.freeze({
  user: "Usuario",
  driver: "Conductor",
  commerce: "Comercio",
  agent: "Agente",
  admin: "Admin",
  super_admin: "Super admin",
  operations: "Operaciones",
  support: "Soporte",
  finance: "Finanzas",
  reviewer: "Reviewer",
  viewer: "Viewer",
});

const SERVICE_LABELS = Object.freeze({
  ride: "Viajes",
  delivery: "Delivery",
  package: "Paquetes",
  school: "Escolar",
});

const VEHICLE_LABELS = Object.freeze({
  car: "Carro",
  vehicle: "Carro",
  motorcycle: "Moto",
  moto: "Moto",
  motorbike: "Moto",
  mototaxi: "Mototaxi",
  qute: "Qute",
  quote: "Qute",
});

const DRIVER_REVIEW_STATUSES = new Set([
  DRIVER_STATUSES.pendingDocuments,
  DRIVER_STATUSES.pendingReview,
  DRIVER_STATUSES.correctionRequired,
]);

const BLOCKED_STATUSES = new Set([
  "blocked",
  "rejected",
  "fraud_suspected",
  "suspended",
  "disabled",
  "account_restricted",
]);

const WELCOME_BALANCE = 10;
const MINIMUM_DRIVER_BALANCE = 1;
const DEFAULT_CURRENCY = "USD";
const DEFAULT_COUNTRY = "SV";

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
  pendingConfirm: null,

  users: [],
  adminProfiles: [],

  drivers: [],
  driverVehicles: [],
  driverWallets: [],
  driverWalletTransactions: [],
  driverTopupSessions: [],
  driverOffers: [],

  commerceUsers: [],
  commerce: [],
  commerceProducts: [],
  commerceProductCategories: [],
  commerceChats: [],
  orderDrafts: [],

  agents: [],
  agentSales: [],

  serviceZones: [],
  fareConfigs: [],
  platformConfigs: [],
  rideTypes: [],

  deliveryOrders: [],
  rideRequests: [],
  packageOrders: [],

  notifications: [],
  supportTickets: [],
  safetyReports: [],

  sanctions: [],
  driverPolicyEvents: [],
  auditLogs: [],
  adminActions: [],

  cashSettlements: [],

  indexes: {},
};

/* =========================================================
   SELECTORES
========================================================= */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/* =========================================================
   INIT
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
}

function protectDashboard() {
  return new Promise((resolve) => {
    onAuthStateChanged(state.auth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          window.location.assign("login.html");
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
   EVENTOS
========================================================= */

function bindStaticUiEvents() {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("submit", handleDocumentSubmit);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("keydown", handleDocumentKeydown);

  $("#globalSearch")?.addEventListener("input", debounce(renderCurrentSection, 180));

  $("#refreshDashboardBtn")?.addEventListener("click", () => {
    loadDashboardData({ forceToast: true });
  });

  $("#logoutBtn")?.addEventListener("click", logout);

  $("#sidebarOpenBtn")?.addEventListener("click", () => {
    document.body.classList.add("sidebar-open", "is-locked");
  });

  $("#sidebarCloseBtn")?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open", "is-locked");
  });

  ["usersSearchInput", "usersRoleFilter", "usersStatusFilter", "usersZoneFilter"].forEach((id) => {
    bindFilter(id, renderUsersTable);
  });

  ["driversSearchInput", "driversVehicleFilter", "driversServiceFilter", "driversZoneFilter"].forEach((id) => {
    bindFilter(id, renderDriversTable);
  });

  ["commerceSearchInput", "commerceStatusFilter", "commercePlanFilter", "commerceZoneFilter"].forEach((id) => {
    bindFilter(id, renderCommerceTable);
  });
}

function bindFilter(id, callback) {
  const element = document.getElementById(id);

  if (!element) return;

  element.addEventListener("input", debounce(callback, 120));
  element.addEventListener("change", callback);
}

function handleDocumentClick(event) {
  const target = event.target.closest("[data-action], [data-section-target], [data-detail-tab], [data-driver-filter]");

  if (!target) return;

  if (target.dataset.sectionTarget) {
    showSection(target.dataset.sectionTarget);
    return;
  }

  if (target.dataset.driverFilter) {
    setDriverQuickFilter(target.dataset.driverFilter);
    return;
  }

  if (target.dataset.detailTab) {
    showDetailTab(target.dataset.detailTab);
    return;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;

  switch (action) {
    case "close-detail-drawer":
      closeDetailDrawer();
      return;

    case "close-review-modal":
      closeModal("reviewDecisionModal");
      return;

    case "close-make-admin-modal":
      closeModal("makeAdminModal");
      return;

    case "close-zone-modal":
      closeModal("zoneModal");
      return;

    case "close-ride-type-modal":
      closeModal("rideTypeModal");
      return;

    case "close-notification-modal":
      closeModal("notificationModal");
      return;

    case "close-confirm-modal":
      closeConfirmModal();
      return;

    case "close-image-viewer":
      closeImageViewer();
      return;

    case "reload-users":
    case "reload-drivers":
    case "reload-driver-review":
    case "reload-commerce":
    case "reload-commerce-review":
    case "reload-agents":
    case "reload-pricing":
    case "reload-delivery":
    case "reload-rides":
    case "reload-locations":
    case "reload-wallet":
    case "reload-cash-settlements":
    case "reload-support":
    case "reload-audit":
      loadDashboardData({ forceToast: true });
      return;

    case "open-zone-modal":
      openZoneModal();
      return;

    case "open-ride-type-modal":
      openRideTypeModal();
      return;

    case "open-notification-modal":
      openNotificationModal();
      return;

    case "open-sanction-modal":
      showToast("El módulo de sanciones queda preparado. La automatización disciplinaria se conectará en la siguiente fase.", "info", "Módulo preparado");
      return;

    case "open-user-detail":
      openUserDetail(id);
      return;

    case "open-driver-detail":
      openDriverDetail(id);
      return;

    case "open-commerce-detail":
      openCommerceDetail(id);
      return;

    case "open-agent-detail":
      openAgentDetail(id);
      return;

    case "open-zone-detail":
      openZoneDetail(id);
      return;

    case "open-ride-type-detail":
      openRideTypeDetail(id);
      return;

    case "open-delivery-detail":
      openDeliveryDetail(id);
      return;

    case "open-ride-detail":
      openRideDetail(id);
      return;

    case "open-review-modal":
      openReviewModal({
        targetId: id,
        targetCollection: target.dataset.collection,
        targetRole: target.dataset.role,
        decision: target.dataset.decision || "",
      });
      return;

    case "make-admin":
      openMakeAdminModal(id);
      return;

    case "block-user":
      confirmUserStatusChange(id, "blocked");
      return;

    case "reactivate-user":
      confirmUserStatusChange(id, "active");
      return;

    case "drawer-send-notification":
      openNotificationFromDrawer();
      return;

    case "drawer-require-correction":
      openReviewFromDrawer("correction_required");
      return;

    case "drawer-block-profile":
      openReviewFromDrawer("block");
      return;

    case "drawer-approve-profile":
      openReviewFromDrawer("approve");
      return;

    case "view-image":
      openImageViewer(target.dataset.src, target.dataset.title);
      return;

    case "edit-zone":
      openZoneModal(id);
      return;

    case "edit-ride-type":
      openRideTypeModal(id);
      return;

    case "export-overview":
      showToast("La exportación quedará conectada cuando definamos formato CSV/PDF.", "info", "Exportación preparada");
      return;

    default:
      return;
  }
}

function handleDocumentSubmit(event) {
  const form = event.target;

  if (form.id === "reviewDecisionForm") {
    event.preventDefault();
    handleReviewDecisionSubmit();
    return;
  }

  if (form.id === "makeAdminForm") {
    event.preventDefault();
    handleMakeAdminSubmit();
    return;
  }

  if (form.id === "zoneForm") {
    event.preventDefault();
    handleZoneSubmit();
    return;
  }

  if (form.id === "rideTypeForm") {
    event.preventDefault();
    handleRideTypeSubmit();
    return;
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

  closeAllModals();
  closeImageViewer();
  closeDetailDrawer();
  document.body.classList.remove("sidebar-open", "is-locked");
}

/* =========================================================
   CARGA DE DATOS
========================================================= */

async function loadDashboardData({ forceToast = false } = {}) {
  try {
    setDashboardLoading(true);

    const read = (collectionName, max = 250, orderField = "createdAt", direction = "desc") => {
      return fetchCollection(collectionName, { max, orderField, direction });
    };

    const [
      users,
      adminProfiles,

      drivers,
      driverVehicles,
      driverWallets,
      driverWalletTransactions,
      driverTopupSessions,
      driverOffers,

      commerceUsers,
      commerce,
      commerceProducts,
      commerceProductCategories,
      commerceChats,
      orderDrafts,

      agents,
      agentSales,

      serviceZones,
      fareConfigs,
      platformConfigs,

      deliveryOrders,
      rideRequests,
      packageOrders,

      notifications,
      supportTickets,
      safetyReports,

      sanctions,
      driverPolicyEvents,
      auditLogs,
      adminActions,

      cashSettlements,
    ] = await Promise.all([
      read(COLLECTIONS.users, 750),
      read(COLLECTIONS.adminProfiles, 300),

      read(COLLECTIONS.driverProfiles, 750),
      read(COLLECTIONS.driverVehicles, 750),
      read(COLLECTIONS.driverWallets, 750, "updatedAt"),
      read(COLLECTIONS.driverWalletTransactions, 500),
      read(COLLECTIONS.driverTopupSessions, 250),
      read(COLLECTIONS.driverOffers, 250),

      read(COLLECTIONS.commerceUsers, 750),
      read(COLLECTIONS.commerceProfiles, 750),
      read(COLLECTIONS.commerceProducts, 500),
      read(COLLECTIONS.commerceProductCategories, 500),
      read(COLLECTIONS.commerceChats, 250, "updatedAt"),
      read(COLLECTIONS.orderDrafts, 250),

      read(COLLECTIONS.agentProfiles, 500),
      read(COLLECTIONS.agentSales, 250),

      read(COLLECTIONS.serviceZones, 250),
      read(COLLECTIONS.fareConfigs, 250),
      read(COLLECTIONS.platformConfigs, 100, "updatedAt"),

      read(COLLECTIONS.deliveryOrders, 350),
      read(COLLECTIONS.rideRequests, 350),
      read(COLLECTIONS.packageOrders, 250),

      read(COLLECTIONS.notifications, 250),
      read(COLLECTIONS.supportTickets, 250),
      read(COLLECTIONS.safetyReports, 250),

      read(COLLECTIONS.driverSanctions, 250),
      read(COLLECTIONS.driverPolicyEvents, 250),
      read(COLLECTIONS.auditLogs, 250),
      read(COLLECTIONS.adminActions, 250),

      read(COLLECTIONS.cashSettlements, 250),
    ]);

    Object.assign(state, {
      users,
      adminProfiles,

      drivers,
      driverVehicles,
      driverWallets,
      driverWalletTransactions,
      driverTopupSessions,
      driverOffers,

      commerceUsers,
      commerce,
      commerceProducts,
      commerceProductCategories,
      commerceChats,
      orderDrafts,

      agents,
      agentSales,

      serviceZones,
      fareConfigs,
      platformConfigs,

      deliveryOrders,
      rideRequests,
      packageOrders,

      notifications,
      supportTickets,
      safetyReports,

      sanctions,
      driverPolicyEvents,
      auditLogs,
      adminActions,

      cashSettlements,
    });

    state.rideTypes = buildRideTypesFromFareConfigs(state.fareConfigs, state.serviceZones);

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

async function fetchCollection(collectionName, { max = 250, orderField = "createdAt", direction = "desc" } = {}) {
  const colRef = collection(state.db, collectionName);

  try {
    const snap = await getDocs(
      query(colRef, orderBy(orderField, direction), limit(max))
    );

    return snap.docs.map(normalizeDoc);
  } catch (error) {
    console.warn(`[NIVO Dashboard] Fallback leyendo ${collectionName}:`, error);

    try {
      const snap = await getDocs(query(colRef, limit(max)));
      return snap.docs.map(normalizeDoc);
    } catch (fallbackError) {
      console.warn(`[NIVO Dashboard] Sin acceso o sin datos en ${collectionName}:`, fallbackError);
      return [];
    }
  }
}

async function fetchDocument(collectionName, id) {
  if (!id) return null;

  const snap = await getDoc(doc(state.db, collectionName, id));

  if (!snap.exists()) return null;

  return normalizeDoc(snap);
}

function normalizeDoc(snap) {
  return {
    id: snap.id,
    ref: snap.ref,
    ...snap.data(),
  };
}

function rebuildIndexes() {
  state.indexes = {
    usersById: toIndex(state.users),
    adminsById: toIndex(state.adminProfiles),

    driversById: toIndex(state.drivers),
    driverVehiclesById: toIndex(state.driverVehicles),
    driverVehiclesByDriverId: groupBy(state.driverVehicles, (vehicle) => {
      return vehicle.driverId || vehicle.uid || "";
    }),
    driverWalletsById: toIndex(state.driverWallets),

    commerceUsersById: toIndex(state.commerceUsers),
    commerceUsersByCommerceId: toIndexBy(state.commerceUsers, (user) => {
      return user.commerceId || "";
    }),
    commerceById: toIndex(state.commerce),

    agentsById: toIndex(state.agents),

    zonesById: toIndex(state.serviceZones),
    fareConfigsById: toIndex(state.fareConfigs),
    rideTypesById: toIndex(state.rideTypes),
  };
}

function toIndex(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function toIndexBy(items, keyFn) {
  const map = new Map();

  items.forEach((item) => {
    const key = keyFn(item);

    if (key) {
      map.set(key, item);
    }
  });

  return map;
}

function groupBy(items, keyFn) {
  const map = new Map();

  items.forEach((item) => {
    const key = keyFn(item);

    if (!key) return;

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(item);
  });

  return map;
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
  const renderers = {
    overview: () => {
      renderMetrics();
      renderOverviewPanels();
    },
    users: renderUsersTable,
    drivers: renderDriversTable,
    "driver-review": renderDriverReview,
    commerce: renderCommerceTable,
    "commerce-review": renderCommerceReview,
    agents: renderAgentsTable,
    zones: renderZonesTable,
    "ride-types": renderRideTypesTable,
    pricing: renderPricing,
    delivery: renderDeliveryTable,
    rides: renderRidesTable,
    locations: renderLocations,
    wallet: renderWalletLedgerTable,
    "cash-settlements": renderCashSettlementsTable,
    support: renderIncidentsTable,
    sanctions: renderSanctionsTable,
    notifications: renderNotificationsTable,
    audit: renderAuditTable,
    settings: renderSettings,
  };

  const renderer = renderers[state.currentSection] || renderAll;
  renderer();
}

function renderMetrics() {
  const activeUsers = state.users.filter((user) => user.status === "active");
  const activeDrivers = state.drivers.filter(isDriverApproved);
  const pendingDrivers = state.drivers.filter((driver) => DRIVER_REVIEW_STATUSES.has(driver.status));
  const activeCommerce = state.commerce.filter(isCommerceActive);
  const pendingCommerce = state.commerce.filter(isCommercePending);

  setText("metricTotalUsers", state.users.length);
  setText("metricActiveUsers", activeUsers.length);

  setText("metricTotalDrivers", state.drivers.length);
  setText("metricActiveDrivers", activeDrivers.length);
  setText("metricPendingDrivers", pendingDrivers.length);

  setText("metricTotalCommerce", state.commerce.length);
  setText("metricActiveCommerce", activeCommerce.length);

  setText("metricTotalAgents", state.agents.length);
  setText("metricServiceZones", state.serviceZones.filter((zone) => zone.active === true).length);

  setText("metricRideRequests", state.rideRequests.length);
  setText("metricDeliveryOrders", state.deliveryOrders.length);

  setText("metricWalletVolume", money(sumBy(state.driverWalletTransactions, "amount")));

  setText("metricDriversCar", state.drivers.filter((driver) => normalizeVehicleType(driver.vehicleType) === "car").length);
  setText("metricDriversMotorcycle", state.drivers.filter((driver) => normalizeVehicleType(driver.vehicleType) === "motorcycle").length);
  setText("metricDriversMototaxi", state.drivers.filter((driver) => normalizeVehicleType(driver.vehicleType) === "mototaxi").length);
  setText("metricDriversQute", state.drivers.filter((driver) => normalizeVehicleType(driver.vehicleType) === "qute").length);
  setText("metricDriversDelivery", state.drivers.filter((driver) => get(driver, "enabledServices.delivery") === true).length);
  setText("metricDriversAvailable", state.drivers.filter((driver) => get(driver, "availability.isOnline") === true || get(driver, "availability.isAvailable") === true).length);

  setText("navPendingDriversCount", pendingDrivers.length);
  setText("navPendingCommerceCount", pendingCommerce.length);

  setText("driversCountAll", state.drivers.length);
  setText("driversCountActive", activeDrivers.length);
  setText("driversCountOnline", state.drivers.filter((driver) => get(driver, "availability.isOnline") === true).length);
  setText("driversCountReview", pendingDrivers.length);
  setText("driversCountBlocked", state.drivers.filter((driver) => BLOCKED_STATUSES.has(driver.status)).length);

  setNotificationBadge();
}

function renderOverviewPanels() {
  const alerts = [];

  const pendingDrivers = state.drivers.filter((driver) => driver.status === DRIVER_STATUSES.pendingReview);
  const pendingCommerce = state.commerce.filter(isCommercePending);
  const lowBalanceDrivers = state.drivers.filter((driver) => {
    const wallet = driverWallet(driver.driverId || driver.uid || driver.id);
    const balance = walletBalance(wallet, get(driver, "wallet.balance", 0));
    const minimum = Number(get(wallet, "rules.minimumBalanceRequired", get(driver, "wallet.minimumBalanceRequired", MINIMUM_DRIVER_BALANCE))) || MINIMUM_DRIVER_BALANCE;

    return isDriverApproved(driver) && balance < minimum;
  });

  if (pendingDrivers.length) {
    alerts.push({
      title: "Conductores pendientes",
      body: `${pendingDrivers.length} conductor(es) listos para revisión administrativa.`,
      target: "driver-review",
    });
  }

  if (pendingCommerce.length) {
    alerts.push({
      title: "Comercios pendientes",
      body: `${pendingCommerce.length} comercio(s) requieren aprobación o corrección.`,
      target: "commerce-review",
    });
  }

  if (lowBalanceDrivers.length) {
    alerts.push({
      title: "Saldo bajo en conductores",
      body: `${lowBalanceDrivers.length} conductor(es) aprobados tienen saldo por debajo del mínimo.`,
      target: "wallet",
    });
  }

  const alertsList = $("#criticalAlertsList");

  if (alertsList) {
    alertsList.innerHTML = alerts.length
      ? alerts.map((alert) => `
          <button class="alert-item" type="button" data-section-target="${e(alert.target)}">
            <strong>${e(alert.title)}</strong>
            <span>${e(alert.body)}</span>
          </button>
        `).join("")
      : `<div class="empty-inline">No hay alertas críticas cargadas todavía.</div>`;
  }

  const activity = [...state.adminActions, ...state.auditLogs]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, 8);

  const feed = $("#recentAdminActions");

  if (feed) {
    feed.innerHTML = activity.length
      ? activity.map((item) => `
          <div class="activity-item">
            <strong>${e(item.action || "Acción administrativa")}</strong>
            <span>${e(item.adminEmail || item.adminId || "Admin NIVO")} · ${date(item.createdAt)}</span>
            <small>${e(item.reason || item.targetId || "")}</small>
          </div>
        `).join("")
      : `<div class="empty-inline">Todavía no hay acciones administrativas registradas.</div>`;
  }
}

/* =========================================================
   USERS
========================================================= */

function renderUsersTable() {
  const tbody = $("#usersTableBody");
  if (!tbody) return;

  const search = lower($("#usersSearchInput")?.value);
  const role = $("#usersRoleFilter")?.value || "all";
  const status = $("#usersStatusFilter")?.value || "all";
  const zone = $("#usersZoneFilter")?.value || "all";

  let items = [...state.users];

  if (search) {
    items = items.filter((user) => {
      return searchable(user, ["fullName", "email", "phone", "uid", "role"]).includes(search);
    });
  }

  if (role !== "all") {
    items = items.filter((user) => (user.role || "user") === role);
  }

  if (status !== "all") {
    items = items.filter((user) => (user.status || "active") === status);
  }

  if (zone !== "all") {
    items = items.filter((user) => userZone(user) === zone);
  }

  setText("usersTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(7, "No hay usuarios para mostrar.");
    return;
  }

  tbody.innerHTML = items.map((user) => `
    <tr>
      <td>
        <div class="person-cell">
          ${avatar(user.fullName || user.email)}
          <div>
            <strong>${e(user.fullName || "Usuario NIVO")}</strong>
            <span>${e(user.email || "Sin correo")}</span>
            <small>${e(user.phone || user.uid || "")}</small>
          </div>
        </div>
      </td>
      <td>${pill(ROLE_LABELS[user.role] || user.role || "Usuario", "neutral")}</td>
      <td>${statusPill(user.status || "active")}</td>
      <td>${e(formatZone(userZone(user), user.department, user.municipality))}</td>
      <td>${date(user.createdAt)}</td>
      <td>${date(user.lastLoginAt)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button" data-action="open-user-detail" data-id="${ea(user.id)}">Ver</button>
        <button class="text-btn" type="button" data-action="make-admin" data-id="${ea(user.id)}">Admin</button>
      </td>
    </tr>
  `).join("");
}

/* =========================================================
   DRIVERS
========================================================= */

function renderDriversTable() {
  const tbody = $("#driversTableBody");
  if (!tbody) return;

  const search = lower($("#driversSearchInput")?.value);
  const vehicle = $("#driversVehicleFilter")?.value || "all";
  const service = $("#driversServiceFilter")?.value || "all";
  const zone = $("#driversZoneFilter")?.value || "all";

  let items = [...state.drivers];

  if (state.currentDriverQuickFilter !== "all") {
    const filter = state.currentDriverQuickFilter;

    items = items.filter((driver) => {
      if (filter === "active") return isDriverApproved(driver);
      if (filter === "online") return get(driver, "availability.isOnline") === true;
      if (filter === "pending_review") return DRIVER_REVIEW_STATUSES.has(driver.status);
      if (filter === "blocked") return BLOCKED_STATUSES.has(driver.status);
      return true;
    });
  }

  if (search) {
    items = items.filter((driver) => {
      const vehicleDoc = primaryVehicle(driver);

      return [
        searchable(driver, ["fullName", "email", "phone", "driverId", "uid", "vehicleType", "vehicleLabel"]),
        searchable(vehicleDoc || {}, ["plate", "brand", "model", "color", "vehicleLabel"]),
      ].join(" ").toLowerCase().includes(search);
    });
  }

  if (vehicle !== "all") {
    items = items.filter((driver) => normalizeVehicleType(driver.vehicleType) === vehicle);
  }

  if (service !== "all") {
    items = items.filter((driver) => get(driver, `enabledServices.${service}`) === true);
  }

  if (zone !== "all") {
    items = items.filter((driver) => driver.serviceZoneId === zone);
  }

  setText("driversTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "No hay conductores para mostrar.");
    return;
  }

  tbody.innerHTML = items.map((driver) => {
    const id = driver.driverId || driver.uid || driver.id;
    const vehicleDoc = primaryVehicle(driver);
    const wallet = driverWallet(id);

    return `
      <tr>
        <td>
          <div class="person-cell">
            ${avatar(driver.fullName || driver.email)}
            <div>
              <strong>${e(driver.fullName || "Conductor NIVO")}</strong>
              <span>${e(driver.email || "Sin correo")}</span>
              <small>${e(driver.phone || id)}</small>
            </div>
          </div>
        </td>
        <td>
          <strong>${e(driver.vehicleLabel || vehicleLabel(driver.vehicleType))}</strong>
          <span>${e(vehicleDoc?.plate || get(driver, "documentNumbers.plate", ""))}</span>
        </td>
        <td>${servicesBadges(driver.enabledServices)}</td>
        <td>${statusPill(driver.status || "pending_documents")}</td>
        <td>
          ${get(driver, "availability.isOnline") === true ? pill("Online", "success") : pill("Offline", "neutral")}
          <small>${wallet ? `Saldo ${money(walletBalance(wallet))}` : "Wallet pendiente"}</small>
        </td>
        <td>${e(formatZone(driver.serviceZoneId, driver.department, driver.municipality))}</td>
        <td>${e(driverRating(driver))}</td>
        <td class="table-actions">
          <button class="text-btn" type="button" data-action="open-driver-detail" data-id="${ea(driver.id)}">Ver</button>
          ${driver.status === DRIVER_STATUSES.pendingReview ? `
            <button class="text-btn primary" type="button" data-action="open-review-modal" data-id="${ea(driver.id)}" data-collection="${COLLECTIONS.driverProfiles}" data-role="driver" data-decision="approve">Aprobar</button>
          ` : ""}
        </td>
      </tr>
    `;
  }).join("");
}

function renderDriverReview() {
  const pendingDocuments = state.drivers.filter((driver) => driver.status === DRIVER_STATUSES.pendingDocuments);
  const pendingReview = state.drivers.filter((driver) => driver.status === DRIVER_STATUSES.pendingReview);
  const correctionRequired = state.drivers.filter((driver) => driver.status === DRIVER_STATUSES.correctionRequired);

  setText("reviewPendingDocumentsCount", pendingDocuments.length);
  setText("reviewPendingReviewCount", pendingReview.length);
  setText("reviewCorrectionRequiredCount", correctionRequired.length);

  renderDriverReviewList("reviewPendingDocumentsList", pendingDocuments);
  renderDriverReviewList("reviewPendingReviewList", pendingReview);
  renderDriverReviewList("reviewCorrectionRequiredList", correctionRequired);

  const tbody = $("#driverReviewTableBody");
  if (!tbody) return;

  const items = [...pendingDocuments, ...pendingReview, ...correctionRequired];

  setText("driverReviewTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(6, "No hay conductores pendientes de decisión.");
    return;
  }

  tbody.innerHTML = items.map((driver) => {
    const documents = driver.documents || {};
    const verification = driver.verification || {};
    const documentCount = countTruthy(documents);
    const vehicleDoc = primaryVehicle(driver);

    return `
      <tr>
        <td>
          <strong>${e(driver.fullName || "Conductor NIVO")}</strong>
          <span>${e(driver.email || "")}</span>
        </td>
        <td>
          <strong>${e(driver.vehicleLabel || vehicleLabel(driver.vehicleType))}</strong>
          <span>${e(vehicleDoc?.plate || get(driver, "documentNumbers.plate", ""))}</span>
        </td>
        <td>${documentCount}/10 archivos</td>
        <td>${statusPill(driver.status || "pending_documents")}</td>
        <td>${date(verification.documentsSubmittedAt || driver.updatedAt || driver.createdAt)}</td>
        <td class="table-actions">
          <button class="text-btn" type="button" data-action="open-driver-detail" data-id="${ea(driver.id)}">Ver</button>
          <button class="text-btn primary" type="button" data-action="open-review-modal" data-id="${ea(driver.id)}" data-collection="${COLLECTIONS.driverProfiles}" data-role="driver" data-decision="approve">Aprobar</button>
          <button class="text-btn" type="button" data-action="open-review-modal" data-id="${ea(driver.id)}" data-collection="${COLLECTIONS.driverProfiles}" data-role="driver" data-decision="correction_required">Corrección</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderDriverReviewList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<div class="empty-state compact">Sin conductores en esta etapa.</div>`;
    return;
  }

  container.innerHTML = items.slice(0, 8).map((driver) => `
    <article class="review-card">
      <strong>${e(driver.fullName || "Conductor NIVO")}</strong>
      <span>${e(vehicleLabel(driver.vehicleType))} · ${e(formatZone(driver.serviceZoneId, driver.department, driver.municipality))}</span>
      <small>${date(get(driver, "verification.documentsSubmittedAt") || driver.updatedAt || driver.createdAt)}</small>
      <button class="text-btn" type="button" data-action="open-driver-detail" data-id="${ea(driver.id)}">Revisar</button>
    </article>
  `).join("");
}

/* =========================================================
   COMMERCE
========================================================= */

function renderCommerceTable() {
  const tbody = $("#commerceTableBody");
  if (!tbody) return;

  const search = lower($("#commerceSearchInput")?.value);
  const status = $("#commerceStatusFilter")?.value || "all";
  const plan = $("#commercePlanFilter")?.value || "all";
  const zone = $("#commerceZoneFilter")?.value || "all";

  let items = [...state.commerce];

  if (search) {
    items = items.filter((commerce) => {
      const owner = commerceOwner(commerce);

      return [
        searchable(commerce, ["businessName", "legalName", "email", "phone", "commerceId", "category", "categoryId"]),
        searchable(owner || {}, ["fullName", "email", "phone"]),
      ].join(" ").toLowerCase().includes(search);
    });
  }

  if (status !== "all") {
    items = items.filter((commerce) => commerceStatus(commerce) === normalizeCommerceFilterStatus(status));
  }

  if (plan !== "all") {
    items = items.filter((commerce) => {
      const currentPlan = commerce.subscriptionPlan || commerce.plan || "free";

      if (plan === "none") {
        return currentPlan === "none" || currentPlan === "free" || !currentPlan;
      }

      return currentPlan === plan;
    });
  }

  if (zone !== "all") {
    items = items.filter((commerce) => commerceZone(commerce) === zone);
  }

  setText("commerceTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "No hay comercios para mostrar.");
    return;
  }

  tbody.innerHTML = items.map((commerce) => {
    const owner = commerceOwner(commerce);
    const currentStatus = commerceStatus(commerce);

    return `
      <tr>
        <td>
          <div class="person-cell">
            ${avatar(commerce.businessName || commerce.email)}
            <div>
              <strong>${e(commerce.businessName || "Comercio NIVO")}</strong>
              <span>${e(commerce.email || owner?.email || "Sin correo")}</span>
              <small>${e(commerce.commerceId || commerce.id)}</small>
            </div>
          </div>
        </td>
        <td>
          <strong>${e(owner?.fullName || commerce.legalName || commerce.ownerName || "Propietario")}</strong>
          <span>${e(owner?.phone || commerce.phone || "")}</span>
        </td>
        <td>${e(commerce.category || commerce.categoryName || commerce.categoryId || "Sin categoría")}</td>
        <td>${statusPill(currentStatus)}</td>
        <td>${isCommerceVisible(commerce) ? pill("Visible", "success") : pill("No visible", "warning")}</td>
        <td>${e(planLabel(commerce.subscriptionPlan || commerce.plan || "free"))}</td>
        <td>${e(formatZone(commerceZone(commerce), commerce.department, commerce.municipality))}</td>
        <td class="table-actions">
          <button class="text-btn" type="button" data-action="open-commerce-detail" data-id="${ea(commerce.id)}">Ver</button>
          ${isCommercePending(commerce) ? `
            <button class="text-btn primary" type="button" data-action="open-review-modal" data-id="${ea(commerce.id)}" data-collection="${COLLECTIONS.commerceProfiles}" data-role="commerce" data-decision="approve">Aprobar</button>
          ` : ""}
        </td>
      </tr>
    `;
  }).join("");
}

function renderCommerceReview() {
  const tbody = $("#commerceReviewTableBody");
  if (!tbody) return;

  const items = state.commerce.filter(isCommercePending);

  setText("commerceReviewTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(7, "No hay comercios pendientes de decisión.");
    return;
  }

  tbody.innerHTML = items.map((commerce) => {
    const owner = commerceOwner(commerce);
    const currentStatus = commerceStatus(commerce);

    return `
      <tr>
        <td>
          <strong>${e(commerce.businessName || "Comercio NIVO")}</strong>
          <span>${e(commerce.email || owner?.email || "")}</span>
        </td>
        <td>
          <strong>${e(owner?.fullName || commerce.legalName || commerce.ownerName || "Propietario")}</strong>
          <span>${e(owner?.uid || commerce.ownerUid || "")}</span>
        </td>
        <td>${statusPill(currentStatus)}</td>
        <td>${e(commerce.category || commerce.categoryName || commerce.categoryId || "Sin categoría")}</td>
        <td>${e(formatZone(commerceZone(commerce), commerce.department, commerce.municipality))}</td>
        <td>${date(commerce.createdAt || commerce.updatedAt)}</td>
        <td class="table-actions">
          <button class="text-btn" type="button" data-action="open-commerce-detail" data-id="${ea(commerce.id)}">Ver</button>
          <button class="text-btn primary" type="button" data-action="open-review-modal" data-id="${ea(commerce.id)}" data-collection="${COLLECTIONS.commerceProfiles}" data-role="commerce" data-decision="approve">Aprobar</button>
          <button class="text-btn" type="button" data-action="open-review-modal" data-id="${ea(commerce.id)}" data-collection="${COLLECTIONS.commerceProfiles}" data-role="commerce" data-decision="correction_required">Corrección</button>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   AGENTS
========================================================= */

function renderAgentsTable() {
  const tbody = $("#agentsTableBody");
  if (!tbody) return;

  const items = [...state.agents];

  setText("agentsTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "Aún no existen agentes NIVO registrados.");
    return;
  }

  tbody.innerHTML = items.map((agent) => `
    <tr>
      <td>
        <strong>${e(agent.fullName || agent.businessName || "Agente NIVO")}</strong>
        <span>${e(agent.email || agent.phone || "")}</span>
      </td>
      <td>${statusPill(agent.status || "pending_review")}</td>
      <td>${e(formatZone(agent.serviceZoneId, agent.department, agent.municipality))}</td>
      <td>${agent.canProcessTopups || agent.canSellDriverTopUps ? pill("Sí", "success") : pill("No", "neutral")}</td>
      <td>${money(agent.dailyLimit || 0)}</td>
      <td>${money(agent.monthlyLimit || 0)}</td>
      <td>${rate(agent.commissionRate || 0)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button" data-action="open-agent-detail" data-id="${ea(agent.id)}">Ver</button>
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

  const items = [...state.serviceZones];

  setText("zonesTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(7, "No hay zonas operativas configuradas.");
    return;
  }

  tbody.innerHTML = items.map((zone) => {
    const fareTransport = fareTransportEnabled(zone.id);
    const enabledRideTypes = normalizeEnabledRideTypes(zone.enabledRideTypes || fareTransport);

    return `
      <tr>
        <td>
          <strong>${e(zone.displayName || zone.id)}</strong>
          <span>${e(zone.id)}</span>
        </td>
        <td>${e(zone.department || "—")}</td>
        <td>${e(zone.municipality || "—")}</td>
        <td>${servicesBadges(zone.enabledServices)}</td>
        <td>${rideTypeBadges(enabledRideTypes)}</td>
        <td>${zone.active === true ? statusPill("active") : statusPill("inactive")}</td>
        <td class="table-actions">
          <button class="text-btn" type="button" data-action="open-zone-detail" data-id="${ea(zone.id)}">Ver</button>
          <button class="text-btn" type="button" data-action="edit-zone" data-id="${ea(zone.id)}">Editar</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderRideTypesTable() {
  const tbody = $("#rideTypesTableBody");
  if (!tbody) return;

  const items = [...state.rideTypes];

  setText("rideTypesTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(7, "Las categorías se derivarán desde fare_configs.transportConfigs.");
    return;
  }

  tbody.innerHTML = items.map((type) => `
    <tr>
      <td>
        <strong>${e(type.transportTitle || vehicleLabel(type.transportId))}</strong>
        <span>${e(type.sourceZoneLabel || type.serviceZoneId || "")}</span>
      </td>
      <td>${e(type.transportId || type.id)}</td>
      <td>${type.active === true ? statusPill("active") : statusPill("inactive")}</td>
      <td>${e(type.maxPassengers || 1)}</td>
      <td>${type.chargesPerPassenger ? pill("Sí", "success") : pill("No", "neutral")}</td>
      <td>${type.requiresPassengerSelection ? pill("Sí", "success") : pill("No", "neutral")}</td>
      <td class="table-actions">
        <button class="text-btn" type="button" data-action="open-ride-type-detail" data-id="${ea(type.id)}">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderPricing() {
  const grid = $("#pricingConfigGrid");
  if (!grid) return;

  const items = [...state.fareConfigs];

  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-state">
        No hay documentos en fare_configs. Las tarifas oficiales deben vivir en fare_configs/{serviceZoneId}.
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map((fare) => {
    const zone = state.indexes.zonesById.get(fare.serviceZoneId || fare.id);
    const configs = transportConfigs(fare.transportConfigs);
    const deliveryConfig = fare.delivery || {};
    const commissions = fare.commissions || {};
    const title = zone?.displayName || fare.displayName || `${fare.municipality || ""}, ${fare.department || ""}`.trim() || fare.id;

    return `
      <article class="panel pricing-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">${e(fare.id)}</p>
            <h3>${e(title)}</h3>
          </div>
          ${fare.active === true ? statusPill("active") : statusPill("inactive")}
        </div>

        <div class="config-list">
          <div><strong>Moneda</strong><span>${e(fare.currencyCode || DEFAULT_CURRENCY)}</span></div>
          <div><strong>Comisión general</strong><span>${rate(fare.platformCommissionRate || 0)}</span></div>
          <div><strong>Delivery ciudad</strong><span>${money(deliveryConfig.cityFixedFee || fare.cityFixedFee || 0)}</span></div>
          <div><strong>Máx. ciudad delivery</strong><span>${num(deliveryConfig.cityFixedMaxDistanceKm || 0)} km</span></div>
        </div>

        <h4>Transporte</h4>
        <div class="config-grid compact">
          ${Object.values(configs).length ? Object.values(configs).map((config) => `
            <div class="mini-config-card">
              <strong>${e(config.transportTitle || vehicleLabel(config.transportId))}</strong>
              <span>${config.active === true ? "Activo" : "Inactivo"}</span>
              <small>Base ${money(config.baseFare)} · Mín. ${money(config.minimumFare)}</small>
              <small>${money(config.pricePerKm)}/km · ${money(config.pricePerMinute)}/min</small>
              ${config.chargesPerPassenger ? `<small>Cobra por persona</small>` : ""}
            </div>
          `).join("") : `<div class="empty-state compact">Sin transportConfigs en esta zona.</div>`}
        </div>

        <h4>Comisiones</h4>
        <div class="config-list">
          ${Object.entries(commissions).length ? Object.entries(commissions).map(([key, value]) => `
            <div><strong>${e(key)}</strong><span>${rate(value?.ratePercent || value?.rate || 0)}</span></div>
          `).join("") : `<div><strong>Default</strong><span>8%</span></div>`}
        </div>
      </article>
    `;
  }).join("");
}

/* =========================================================
   DELIVERY / RIDES
========================================================= */

function renderDeliveryTable() {
  const tbody = $("#deliveryTableBody");
  if (!tbody) return;

  const items = [...state.deliveryOrders]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  setText("deliveryTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "No hay órdenes de delivery registradas.");
    return;
  }

  tbody.innerHTML = items.map((order) => `
    <tr>
      <td>
        <strong>${e(order.orderCode || order.orderId || order.id)}</strong>
        <span>${e(order.logisticsStatus || order.driverDispatchStatus || "")}</span>
      </td>
      <td>
        <strong>${e(order.customerName || order.userName || "Cliente")}</strong>
        <span>${e(order.customerPhone || order.userId || "")}</span>
      </td>
      <td>
        <strong>${e(order.commerceName || order.commerceId || "Comercio")}</strong>
        <span>${e(order.paymentMethodLabel || order.paymentMethod || "")}</span>
      </td>
      <td>
        <strong>${e(order.driverName || "Sin asignar")}</strong>
        <span>${e(order.driverId || "")}</span>
      </td>
      <td>
        ${statusPill(order.status || "pending")}
        <small>${e(order.driverDispatchStatus || "")}</small>
      </td>
      <td>
        <strong>${money(order.total || 0)}</strong>
        <span>Fee ${money(order.deliveryFee || 0)} · Driver ${money(order.driverEarnings || 0)}</span>
      </td>
      <td>${date(order.createdAt)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button" data-action="open-delivery-detail" data-id="${ea(order.id)}">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderRidesTable() {
  const tbody = $("#ridesTableBody");
  if (!tbody) return;

  const items = [...state.rideRequests]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  setText("ridesTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "No hay solicitudes de viaje registradas.");
    return;
  }

  tbody.innerHTML = items.map((ride) => `
    <tr>
      <td>
        <strong>${e(ride.rideCode || ride.rideId || ride.id)}</strong>
        <span>${e(ride.serviceZoneId || ride.zoneId || "")}</span>
      </td>
      <td>${e(ride.userName || ride.userId || "Usuario")}</td>
      <td>${e(ride.driverName || ride.driverId || "Sin asignar")}</td>
      <td>${e(vehicleLabel(ride.transportType || ride.vehicleType || ride.rideType))}</td>
      <td>${statusPill(ride.status || "pending")}</td>
      <td>${money(ride.totalFare || ride.estimatedFare || ride.fare || 0)}</td>
      <td>${date(ride.createdAt)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button" data-action="open-ride-detail" data-id="${ea(ride.id)}">Ver</button>
      </td>
    </tr>
  `).join("");
}

/* =========================================================
   LOCATIONS / WALLET / SUPPORT / SANCTIONS / NOTIFICATIONS / AUDIT / SETTINGS
========================================================= */

function renderLocations() {
  const container = $("#onlineDriversList");
  if (!container) return;

  const onlineDrivers = state.drivers.filter((driver) => get(driver, "availability.isOnline") === true);

  if (!onlineDrivers.length) {
    container.innerHTML = `<div class="empty-state compact">Sin conductores online cargados.</div>`;
    return;
  }

  container.innerHTML = onlineDrivers.map((driver) => `
    <div class="compact-list-item">
      <strong>${e(driver.fullName || "Conductor NIVO")}</strong>
      <span>${e(vehicleLabel(driver.vehicleType))} · ${e(formatZone(driver.serviceZoneId, driver.department, driver.municipality))}</span>
    </div>
  `).join("");
}

function renderWalletLedgerTable() {
  const tbody = $("#walletLedgerTableBody");
  if (!tbody) return;

  const items = [...state.driverWalletTransactions]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  setText("walletLedgerTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "No hay movimientos de wallet todavía.");
    return;
  }

  tbody.innerHTML = items.map((movement) => {
    const driver = state.indexes.driversById.get(movement.driverId);

    return `
      <tr>
        <td>
          <strong>${e(movement.description || walletMovementTitle(movement.type))}</strong>
          <span>${e(movement.id)}</span>
        </td>
        <td>
          <strong>${e(driver?.fullName || movement.driverId || "Conductor")}</strong>
          <span>${e(movement.driverId || "")}</span>
        </td>
        <td>${e(walletMovementTitle(movement.type))}</td>
        <td>${movement.direction === "debit" ? "-" : "+"}${money(movement.amount || 0)}</td>
        <td>${e(movement.source || "dashboard")}</td>
        <td>${statusPill(movement.status || "confirmed")}</td>
        <td>${date(movement.createdAt)}</td>
        <td class="table-actions">
          <button class="text-btn" type="button" data-action="open-driver-detail" data-id="${ea(movement.driverId || "")}">Conductor</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderCashSettlementsTable() {
  const tbody = $("#cashSettlementsTableBody");
  if (!tbody) return;

  const items = [...state.cashSettlements];

  setText("cashSettlementsTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(7, "No hay liquidaciones registradas todavía.");
    return;
  }

  tbody.innerHTML = items.map((item) => `
    <tr>
      <td>${e(item.driverName || item.driverId || "Conductor")}</td>
      <td>${money(item.cashPendingSettlement || item.pendingAmount || 0)}</td>
      <td>${money(item.cashOverdueSettlement || item.overdueAmount || 0)}</td>
      <td>${date(item.cashDueAt || item.dueAt)}</td>
      <td>${statusPill(item.status || item.cashStatus || "pending")}</td>
      <td>${item.proofUrl ? `<button class="text-btn" type="button" data-action="view-image" data-src="${ea(item.proofUrl)}" data-title="Comprobante">Ver</button>` : "—"}</td>
      <td class="table-actions">
        <button class="text-btn" type="button">Detalle</button>
      </td>
    </tr>
  `).join("");
}

function renderIncidentsTable() {
  const tbody = $("#incidentsTableBody");
  if (!tbody) return;

  const items = [...state.supportTickets, ...state.safetyReports]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  setText("incidentsTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "No hay incidencias registradas.");
    return;
  }

  tbody.innerHTML = items.map((ticket) => `
    <tr>
      <td>
        <strong>${e(ticket.title || ticket.subject || ticket.reportType || ticket.id)}</strong>
        <span>${e(ticket.message || ticket.description || "")}</span>
      </td>
      <td>${e(ticket.reporterName || ticket.createdBy || ticket.userId || "—")}</td>
      <td>${e(ticket.reportedName || ticket.driverId || ticket.targetId || "—")}</td>
      <td>${e(ticket.type || ticket.reportType || "general")}</td>
      <td>${e(ticket.severity || ticket.priority || "normal")}</td>
      <td>${statusPill(ticket.status || "pending")}</td>
      <td>${date(ticket.createdAt)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderSanctionsTable() {
  const tbody = $("#sanctionsTableBody");
  if (!tbody) return;

  const items = [...state.sanctions, ...state.driverPolicyEvents]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  setText("sanctionsTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(8, "No hay sanciones registradas.");
    return;
  }

  tbody.innerHTML = items.map((sanction) => `
    <tr>
      <td>${e(sanction.targetName || sanction.driverName || sanction.driverId || sanction.targetId || "Perfil")}</td>
      <td>${e(ROLE_LABELS[sanction.targetRole] || sanction.targetRole || "driver")}</td>
      <td>${e(sanction.type || sanction.reportType || sanction.action || "sanción")}</td>
      <td>${e(sanction.severity || "normal")}</td>
      <td>${sanction.active === false ? pill("No", "neutral") : pill("Sí", "warning")}</td>
      <td>${date(sanction.createdAt || sanction.startedAt)}</td>
      <td>${date(sanction.endsAt || sanction.sanctionUntil)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button">Detalle</button>
      </td>
    </tr>
  `).join("");
}

function renderNotificationsTable() {
  const tbody = $("#notificationsTableBody");
  if (!tbody) return;

  const items = [...state.notifications]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  setText("notificationsTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(6, "No hay notificaciones registradas.");
    return;
  }

  tbody.innerHTML = items.map((notification) => `
    <tr>
      <td>
        <strong>${e(notification.title || "Notificación NIVO")}</strong>
        <span>${e(notification.body || notification.message || "")}</span>
      </td>
      <td>${e(notification.recipientRole || notification.targetRole || "perfil")} · ${e(notification.recipientId || notification.uid || notification.userId || "—")}</td>
      <td>${e(notification.type || "info")}</td>
      <td>${statusPill(notification.status || (notification.read ? "read" : "unread"))}</td>
      <td>${date(notification.createdAt)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button">Ver</button>
      </td>
    </tr>
  `).join("");
}

function renderAuditTable() {
  const tbody = $("#auditTableBody");
  if (!tbody) return;

  const items = [...state.adminActions, ...state.auditLogs]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  setText("auditTableCount", `${items.length} registro${items.length === 1 ? "" : "s"}`);

  if (!items.length) {
    tbody.innerHTML = emptyRow(7, "No hay acciones administrativas registradas.");
    return;
  }

  tbody.innerHTML = items.map((item) => `
    <tr>
      <td>${e(item.action || "Acción")}</td>
      <td>${e(item.adminEmail || item.adminId || "Admin")}</td>
      <td>${e(item.targetId || "—")}</td>
      <td>${e(item.targetRole || item.targetCollection || "—")}</td>
      <td>${e(item.reason || "—")}</td>
      <td>${date(item.createdAt)}</td>
      <td class="table-actions">
        <button class="text-btn" type="button">Detalle</button>
      </td>
    </tr>
  `).join("");
}

function renderSettings() {
  const container = $("#appSettingsList");
  if (!container) return;

  if (!state.platformConfigs.length) {
    container.innerHTML = `<div class="empty-state compact">No hay configuraciones en platform_configs.</div>`;
    return;
  }

  container.innerHTML = state.platformConfigs.map((config) => `
    <div class="config-item">
      <strong>${e(config.configId || config.id)}</strong>
      <span>${config.active === true ? "Activo" : "Inactivo"}</span>
    </div>
  `).join("");
}

/* =========================================================
   DETALLE / DRAWER
========================================================= */

function openUserDetail(id) {
  const item = state.indexes.usersById.get(id);
  if (!item) return;

  openDetailDrawer({
    type: "user",
    collection: COLLECTIONS.users,
    id,
    title: item.fullName || item.email || "Usuario NIVO",
    subtitle: item.email || item.uid || id,
    summary: profileSummaryHtml(item),
    documents: `<div class="empty-state compact">Los usuarios no tienen documentos administrativos en este módulo.</div>`,
    operation: jsonBlock(item),
    finance: `<div class="empty-state compact">Sin datos financieros directos.</div>`,
    history: historyHtml(COLLECTIONS.users, id),
  });
}

function openDriverDetail(id) {
  const item = state.indexes.driversById.get(id);
  if (!item) return;

  const driverId = item.driverId || item.uid || item.id;
  const vehicle = primaryVehicle(item);
  const wallet = driverWallet(driverId);

  openDetailDrawer({
    type: "driver",
    collection: COLLECTIONS.driverProfiles,
    id: item.id,
    title: item.fullName || "Conductor NIVO",
    subtitle: `${vehicleLabel(item.vehicleType)} · ${formatZone(item.serviceZoneId, item.department, item.municipality)}`,
    summary: driverSummaryHtml(item, vehicle, wallet),
    documents: documentsHtml(item.documents, vehicle?.documents),
    operation: driverOperationHtml(item, vehicle),
    finance: driverFinanceHtml(item, wallet),
    history: historyHtml(COLLECTIONS.driverProfiles, item.id),
  });
}

function openCommerceDetail(id) {
  const item = state.indexes.commerceById.get(id);
  if (!item) return;

  const owner = commerceOwner(item);

  openDetailDrawer({
    type: "commerce",
    collection: COLLECTIONS.commerceProfiles,
    id: item.id,
    title: item.businessName || "Comercio NIVO",
    subtitle: `${item.category || item.categoryId || "Comercio"} · ${formatZone(commerceZone(item), item.department, item.municipality)}`,
    summary: commerceSummaryHtml(item, owner),
    documents: commerceImagesHtml(item),
    operation: commerceOperationHtml(item, owner),
    finance: commerceFinanceHtml(item),
    history: historyHtml(COLLECTIONS.commerceProfiles, item.id),
  });
}

function openAgentDetail(id) {
  const item = state.indexes.agentsById.get(id);
  if (!item) return;

  openDetailDrawer({
    type: "agent",
    collection: COLLECTIONS.agentProfiles,
    id,
    title: item.fullName || item.businessName || "Agente NIVO",
    subtitle: item.email || item.phone || id,
    summary: profileSummaryHtml(item),
    documents: `<div class="empty-state compact">Documentos de agente pendientes de definir.</div>`,
    operation: jsonBlock(item),
    finance: jsonBlock(item),
    history: historyHtml(COLLECTIONS.agentProfiles, id),
  });
}

function openZoneDetail(id) {
  const item = state.indexes.zonesById.get(id);
  if (!item) return;

  const fare = state.indexes.fareConfigsById.get(id) || state.indexes.fareConfigsById.get(item.serviceZoneId);

  openDetailDrawer({
    type: "zone",
    collection: COLLECTIONS.serviceZones,
    id,
    title: item.displayName || id,
    subtitle: `${item.municipality || ""}, ${item.department || ""}`,
    summary: zoneSummaryHtml(item, fare),
    documents: `<div class="empty-state compact">Sin documentos para zonas.</div>`,
    operation: jsonBlock(item),
    finance: fare ? jsonBlock(fare) : `<div class="empty-state compact">No hay fare_config para esta zona.</div>`,
    history: historyHtml(COLLECTIONS.serviceZones, id),
  });
}

function openRideTypeDetail(id) {
  const item = state.indexes.rideTypesById.get(id);
  if (!item) return;

  openDetailDrawer({
    type: "ride-type",
    collection: COLLECTIONS.fareConfigs,
    id,
    title: item.transportTitle || vehicleLabel(item.transportId),
    subtitle: item.serviceZoneId || id,
    summary: jsonBlock(item),
    documents: `<div class="empty-state compact">Sin documentos.</div>`,
    operation: jsonBlock(item),
    finance: jsonBlock(item),
    history: `<div class="empty-state compact">Categoría derivada de fare_configs.</div>`,
  });
}

function openDeliveryDetail(id) {
  const item = state.deliveryOrders.find((order) => order.id === id);
  if (!item) return;

  openDetailDrawer({
    type: "delivery",
    collection: COLLECTIONS.deliveryOrders,
    id,
    title: item.orderCode || item.orderId || id,
    subtitle: `${item.commerceName || item.commerceId || "Comercio"} · ${item.customerName || item.userName || "Cliente"}`,
    summary: deliverySummaryHtml(item),
    documents: deliveryProofHtml(item),
    operation: jsonBlock({
      status: item.status,
      logisticsStatus: item.logisticsStatus,
      driverDispatchStatus: item.driverDispatchStatus,
      statusEvents: item.statusEvents || [],
    }),
    finance: jsonBlock({
      subtotal: item.subtotal,
      deliveryFee: item.deliveryFee,
      driverEarnings: item.driverEarnings,
      commerceEarnings: item.commerceEarnings,
      total: item.total,
      paymentMethod: item.paymentMethod,
      paymentStatus: item.paymentStatus,
    }),
    history: deliveryEventsHtml(item),
  });
}

function openRideDetail(id) {
  const item = state.rideRequests.find((ride) => ride.id === id);
  if (!item) return;

  openDetailDrawer({
    type: "ride",
    collection: COLLECTIONS.rideRequests,
    id,
    title: item.rideCode || item.rideId || id,
    subtitle: `${item.userName || item.userId || "Usuario"} · ${vehicleLabel(item.transportType || item.vehicleType)}`,
    summary: jsonBlock(item),
    documents: `<div class="empty-state compact">Sin documentos.</div>`,
    operation: jsonBlock(item),
    finance: jsonBlock({
      estimatedFare: item.estimatedFare,
      totalFare: item.totalFare,
      fare: item.fare,
      commission: item.commission,
    }),
    history: historyHtml(COLLECTIONS.rideRequests, id),
  });
}

function openDetailDrawer(payload) {
  state.activeDetail = payload;

  setText("detailDrawerEyebrow", payload.collection || "Detalle");
  setText("detailDrawerTitle", payload.title || "Perfil seleccionado");
  setText("detailDrawerSubtitle", payload.subtitle || "");

  setHtml("detailSummaryPanel", payload.summary || "");
  setHtml("detailDocumentsPanel", payload.documents || "");
  setHtml("detailOperationPanel", payload.operation || "");
  setHtml("detailFinancePanel", payload.finance || "");
  setHtml("detailHistoryPanel", payload.history || "");

  showDetailTab("summary");

  const drawer = $("#detailDrawer");
  if (!drawer) return;

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");
}

function closeDetailDrawer() {
  const drawer = $("#detailDrawer");
  if (!drawer) return;

  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-locked");
}

function showDetailTab(tabName) {
  $$(".drawer-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.detailTab === tabName);
  });

  $$(".drawer-tab-panel").forEach((panel) => {
    const active = panel.dataset.detailPanel === tabName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

/* =========================================================
   MODALES / DECISIONES
========================================================= */

function openReviewModal({ targetId, targetCollection, targetRole, decision = "" }) {
  if (!targetId || !targetCollection || !targetRole) {
    showToast("No se pudo abrir la revisión: faltan datos del objetivo.", "error", "Revisión");
    return;
  }

  $("#reviewTargetId").value = targetId;
  $("#reviewTargetCollection").value = targetCollection;
  $("#reviewTargetRole").value = targetRole;
  $("#reviewDecisionType").value = decision || "";
  $("#reviewDecisionReason").value = "";

  openModal("reviewDecisionModal");
}

async function handleReviewDecisionSubmit() {
  const targetId = $("#reviewTargetId")?.value;
  const collectionName = $("#reviewTargetCollection")?.value;
  const targetRole = $("#reviewTargetRole")?.value;
  const decision = $("#reviewDecisionType")?.value;
  const reason = $("#reviewDecisionReason")?.value?.trim() || "";

  if (!targetId || !collectionName || !targetRole || !decision) {
    showToast("Selecciona una decisión válida.", "error", "Decisión incompleta");
    return;
  }

  try {
    setModalBusy("reviewDecisionModal", true);

    if (targetRole === "driver" || collectionName === COLLECTIONS.driverProfiles) {
      await applyDriverDecision(targetId, decision, reason);
    } else if (targetRole === "commerce" || collectionName === COLLECTIONS.commerceProfiles) {
      await applyCommerceDecision(targetId, decision, reason);
    } else {
      throw new Error("Tipo de perfil no soportado por esta decisión.");
    }

    closeModal("reviewDecisionModal");
    showToast("La decisión fue aplicada correctamente.", "success", "Decisión guardada");
    await loadDashboardData();
  } catch (error) {
    console.error("[NIVO Dashboard] Error aplicando decisión:", error);
    showToast(error.message || "No se pudo aplicar la decisión.", "error", "Error");
  } finally {
    setModalBusy("reviewDecisionModal", false);
  }
}

async function applyDriverDecision(driverDocId, decision, reason) {
  const driver = state.indexes.driversById.get(driverDocId) || await fetchDocument(COLLECTIONS.driverProfiles, driverDocId);

  if (!driver) {
    throw new Error("No se encontró el perfil del conductor.");
  }

  const driverId = driver.driverId || driver.uid || driver.id;
  const profileRef = doc(state.db, COLLECTIONS.driverProfiles, driver.id);
  const vehicle = primaryVehicle(driver);
  const vehicleId = vehicle?.id || driver.primaryVehicleId || `${driverId}_primary_vehicle`;
  const vehicleRef = doc(state.db, COLLECTIONS.driverVehicles, vehicleId);
  const walletRef = doc(state.db, COLLECTIONS.driverWallets, driverId);
  const transactionRef = doc(state.db, COLLECTIONS.driverWalletTransactions, `${driverId}_welcome_bonus`);

  const adminId = state.adminContext?.uid || state.firebaseUser?.uid || "";
  const adminEmail = state.adminContext?.email || state.firebaseUser?.email || "";
  const now = serverTimestamp();

  const batch = writeBatch(state.db);

  if (decision === "approve") {
    const enabledServices = normalizeServices(driver.enabledServices);

    batch.set(profileRef, {
      status: DRIVER_STATUSES.approved,
      statusReason: "",
      approvedAt: now,
      approvedBy: adminId,
      rejectedAt: null,
      rejectedBy: "",
      blockedAt: null,
      blockedBy: "",
      manualReviewRequired: false,
      registration: {
        currentStep: "approved",
        profileCompleted: true,
        zoneSelected: true,
        vehicleSelected: true,
        servicesSelected: true,
        documentsCompleted: true,
      },
      verification: {
        documentsCompleted: true,
        duplicateCheckStatus: "approved",
        duplicateCheckReason: "",
        selfieVerified: true,
        vehicleVerified: true,
        reviewedAt: now,
        reviewedBy: adminId,
        adminNote: reason,
      },
      policy: {
        canReceiveTasks: true,
        currentSanctionStatus: "none",
        manualReviewRequired: false,
        activePenaltyPoints: Number(get(driver, "policy.activePenaltyPoints", 0)) || 0,
        trustScore: Number(get(driver, "policy.trustScore", 100)) || 100,
      },
      availability: {
        isOnline: false,
        isAvailable: false,
        canReceiveRideOffers: enabledServices.ride,
        canReceiveDeliveryOffers: enabledServices.delivery,
        canReceivePackageOffers: enabledServices.package,
        currentTaskId: get(driver, "availability.currentTaskId", "") || "",
        currentTaskType: get(driver, "availability.currentTaskType", "none") || "none",
      },
      wallet: {
        balance: WELCOME_BALANCE,
        currencyCode: DEFAULT_CURRENCY,
        minimumBalanceRequired: MINIMUM_DRIVER_BALANCE,
        welcomeBalanceAmount: WELCOME_BALANCE,
        welcomeBalanceGranted: true,
        canReceiveCommissionedTasks: true,
        lowBalanceWarning: false,
        lastWalletUpdateAt: now,
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(vehicleRef, {
      vehicleId,
      uid: driverId,
      driverId,
      status: DRIVER_STATUSES.approved,
      isActive: true,
      isPrimary: true,
      approvedAt: now,
      approvedBy: adminId,
      rejectedAt: null,
      rejectedBy: "",
      rejectionReason: "",
      updatedAt: now,
    }, { merge: true });

    batch.set(walletRef, {
      driverId,
      uid: driverId,
      currencyCode: DEFAULT_CURRENCY,
      status: "active",
      balance: {
        availableBalance: WELCOME_BALANCE,
        rechargedBalance: 0,
        welcomeBalance: WELCOME_BALANCE,
        totalCredited: WELCOME_BALANCE,
        totalDebited: 0,
      },
      rules: {
        minimumBalanceRequired: MINIMUM_DRIVER_BALANCE,
        canReceiveCommissionedTasks: true,
        lowBalanceWarning: false,
        allowNegativeBalance: false,
      },
      welcome: {
        enabled: true,
        amount: WELCOME_BALANCE,
        granted: true,
        grantedAt: now,
        grantedBy: adminId,
        reason: "Saldo de bienvenida NIVO",
      },
      createdAt: get(driverWallet(driverId), "createdAt", now),
      updatedAt: now,
    }, { merge: true });

    batch.set(transactionRef, {
      transactionId: `${driverId}_welcome_bonus`,
      driverId,
      type: "welcome_bonus",
      direction: "credit",
      amount: WELCOME_BALANCE,
      currencyCode: DEFAULT_CURRENCY,
      description: "Saldo de bienvenida NIVO",
      serviceType: "",
      serviceId: "",
      source: "dashboard_admin",
      status: "confirmed",
      createdAt: now,
      createdBy: adminId,
      createdByEmail: adminEmail,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Cuenta aprobada",
      body: "Tu cuenta NIVO Driver fue aprobada. Ya puedes entrar al panel y conectarte cuando tengas saldo disponible.",
      type: "account",
      source: "dashboard_admin",
    });
  }

  if (decision === "correction_required") {
    batch.set(profileRef, {
      status: DRIVER_STATUSES.correctionRequired,
      statusReason: reason || "NIVO necesita que corrijas o actualices información de tu registro.",
      manualReviewRequired: true,
      verification: {
        duplicateCheckStatus: "correction_required",
        reviewReason: reason,
        adminNote: reason,
        reviewedAt: now,
        reviewedBy: adminId,
      },
      policy: {
        canReceiveTasks: false,
        manualReviewRequired: true,
      },
      availability: {
        isOnline: false,
        isAvailable: false,
        canReceiveRideOffers: false,
        canReceiveDeliveryOffers: false,
        canReceivePackageOffers: false,
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(vehicleRef, {
      status: DRIVER_STATUSES.correctionRequired,
      isActive: false,
      rejectionReason: reason,
      updatedAt: now,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Corrección requerida",
      body: reason || "NIVO necesita que revises tus documentos o datos del vehículo.",
      type: "documents",
      source: "dashboard_admin",
    });
  }

  if (decision === "reject") {
    batch.set(profileRef, {
      status: DRIVER_STATUSES.rejected,
      statusReason: reason || "Tu solicitud fue rechazada por NIVO.",
      rejectedAt: now,
      rejectedBy: adminId,
      verification: {
        duplicateCheckStatus: "rejected",
        rejectionReason: reason,
        adminNote: reason,
        reviewedAt: now,
        reviewedBy: adminId,
      },
      policy: {
        canReceiveTasks: false,
      },
      availability: {
        isOnline: false,
        isAvailable: false,
        canReceiveRideOffers: false,
        canReceiveDeliveryOffers: false,
        canReceivePackageOffers: false,
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(vehicleRef, {
      status: DRIVER_STATUSES.rejected,
      isActive: false,
      rejectedAt: now,
      rejectedBy: adminId,
      rejectionReason: reason,
      updatedAt: now,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Solicitud rechazada",
      body: reason || "Tu solicitud de conductor fue rechazada por NIVO.",
      type: "account",
      source: "dashboard_admin",
    });
  }

  if (decision === "block") {
    batch.set(profileRef, {
      status: DRIVER_STATUSES.blocked,
      statusReason: reason || "Tu cuenta fue bloqueada por administración NIVO.",
      blockedAt: now,
      blockedBy: adminId,
      policy: {
        canReceiveTasks: false,
        currentSanctionStatus: "blocked",
        manualReviewRequired: true,
      },
      availability: {
        isOnline: false,
        isAvailable: false,
        canReceiveRideOffers: false,
        canReceiveDeliveryOffers: false,
        canReceivePackageOffers: false,
      },
      wallet: {
        canReceiveCommissionedTasks: false,
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(vehicleRef, {
      status: DRIVER_STATUSES.blocked,
      isActive: false,
      updatedAt: now,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Cuenta bloqueada",
      body: reason || "Tu cuenta NIVO Driver fue bloqueada. Contacta a soporte para más información.",
      type: "warning",
      source: "dashboard_admin",
    });
  }

  addAdminActionToBatch(batch, {
    action: `driver_${decision}`,
    targetCollection: COLLECTIONS.driverProfiles,
    targetId: driver.id,
    targetRole: "driver",
    reason,
  });

  await batch.commit();
}

async function applyCommerceDecision(commerceDocId, decision, reason) {
  const commerce = state.indexes.commerceById.get(commerceDocId) || await fetchDocument(COLLECTIONS.commerceProfiles, commerceDocId);

  if (!commerce) {
    throw new Error("No se encontró el perfil del comercio.");
  }

  const owner = commerceOwner(commerce);
  const ownerUid = commerce.ownerUid || commerce.uid || owner?.uid;

  if (!ownerUid) {
    throw new Error("El comercio no tiene ownerUid para actualizar commerce_users.");
  }

  const commerceId = commerce.commerceId || commerce.id;
  const profileRef = doc(state.db, COLLECTIONS.commerceProfiles, commerce.id);
  const ownerRef = doc(state.db, COLLECTIONS.commerceUsers, ownerUid);

  const adminId = state.adminContext?.uid || state.firebaseUser?.uid || "";
  const now = serverTimestamp();

  const batch = writeBatch(state.db);

  if (decision === "approve") {
    batch.set(profileRef, {
      commerceId,
      ownerUid,
      active: true,
      verified: true,
      deliveryEnabled: commerce.deliveryEnabled !== false,
      chatEnabled: commerce.chatEnabled !== false,
      catalogEnabled: commerce.catalogEnabled !== false,
      canReceiveDeliveryOrders: true,
      openStatus: commerce.openStatus || "closed",
      openStatusLabel: commerce.openStatusLabel || "Cerrado",
      isCurrentlyOpen: commerce.isCurrentlyOpen === true,
      verification: {
        status: "approved",
        reviewedAt: now,
        reviewedBy: adminId,
        adminNote: reason,
      },
      status: "active",
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, {
      uid: ownerUid,
      commerceId,
      status: COMMERCE_USER_STATUSES.active,
      role: owner?.role || "commerce_owner",
      permissions: owner?.permissions || {
        canManageProfile: true,
        canManageCatalog: true,
        canManageOrders: true,
        canManageChats: true,
        canManageStaff: true,
        canViewStats: true,
      },
      updatedAt: now,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: ownerUid,
      recipientRole: "commerce",
      title: "Comercio aprobado",
      body: "Tu comercio fue aprobado por NIVO. Ya puedes entrar al panel y preparar tu operación.",
      type: "account",
      source: "dashboard_admin",
    });
  }

  if (decision === "correction_required") {
    batch.set(profileRef, {
      active: false,
      verified: false,
      canReceiveDeliveryOrders: false,
      status: "correction_required",
      verification: {
        status: "correction_required",
        reviewReason: reason,
        adminNote: reason,
        reviewedAt: now,
        reviewedBy: adminId,
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, {
      status: COMMERCE_USER_STATUSES.pendingVerification,
      updatedAt: now,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: ownerUid,
      recipientRole: "commerce",
      title: "Corrección requerida",
      body: reason || "NIVO necesita que revises la información de tu comercio.",
      type: "account",
      source: "dashboard_admin",
    });
  }

  if (decision === "reject") {
    batch.set(profileRef, {
      active: false,
      verified: false,
      canReceiveDeliveryOrders: false,
      status: "rejected",
      verification: {
        status: "rejected",
        rejectionReason: reason,
        adminNote: reason,
        reviewedAt: now,
        reviewedBy: adminId,
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, {
      status: COMMERCE_USER_STATUSES.suspended,
      updatedAt: now,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: ownerUid,
      recipientRole: "commerce",
      title: "Solicitud rechazada",
      body: reason || "Tu solicitud de comercio fue rechazada por NIVO.",
      type: "account",
      source: "dashboard_admin",
    });
  }

  if (decision === "block") {
    batch.set(profileRef, {
      active: false,
      verified: false,
      canReceiveDeliveryOrders: false,
      isCurrentlyOpen: false,
      openStatus: "forced_closed",
      openStatusLabel: "Cerrado por NIVO",
      status: "blocked",
      verification: {
        status: "blocked",
        adminNote: reason,
        reviewedAt: now,
        reviewedBy: adminId,
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, {
      status: COMMERCE_USER_STATUSES.suspended,
      updatedAt: now,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: ownerUid,
      recipientRole: "commerce",
      title: "Comercio bloqueado",
      body: reason || "Tu comercio fue bloqueado por administración NIVO.",
      type: "warning",
      source: "dashboard_admin",
    });
  }

  addAdminActionToBatch(batch, {
    action: `commerce_${decision}`,
    targetCollection: COLLECTIONS.commerceProfiles,
    targetId: commerce.id,
    targetRole: "commerce",
    reason,
  });

  await batch.commit();
}

/* =========================================================
   MAKE ADMIN
========================================================= */

function openMakeAdminModal(uid) {
  const user = state.indexes.usersById.get(uid);

  if (!user) {
    showToast("No se encontró el usuario seleccionado.", "error", "Admin");
    return;
  }

  $("#makeAdminUid").value = user.uid || user.id;
  $("#makeAdminEmail").value = user.email || "";
  $("#makeAdminDisplayName").value = user.fullName || user.email || "";
  $("#makeAdminRole").value = "";

  $$('input[name="permissions"]').forEach((input) => {
    input.checked = false;
  });

  openModal("makeAdminModal");
}

function applyDefaultPermissionsForAdminRole(role) {
  const permissionsByRole = {
    super_admin: ["users", "drivers", "commerce", "agents", "zones", "settings", "finance", "locations", "sanctions", "notifications"],
    admin: ["users", "drivers", "commerce", "agents", "zones", "finance", "notifications"],
    operations: ["drivers", "commerce", "agents", "zones", "locations"],
    support: ["users", "drivers", "commerce", "notifications"],
    finance: ["finance", "drivers", "commerce", "agents"],
    reviewer: ["drivers", "commerce"],
    viewer: [],
  };

  const permissions = new Set(permissionsByRole[role] || []);

  $$('input[name="permissions"]').forEach((input) => {
    input.checked = permissions.has(input.value);
  });
}

async function handleMakeAdminSubmit() {
  const uid = $("#makeAdminUid")?.value?.trim();
  const email = $("#makeAdminEmail")?.value?.trim();
  const displayName = $("#makeAdminDisplayName")?.value?.trim();
  const role = $("#makeAdminRole")?.value?.trim();

  if (!uid || !role) {
    showToast("Selecciona usuario y rol administrativo.", "error", "Admin incompleto");
    return;
  }

  const permissions = {};
  $$('input[name="permissions"]').forEach((input) => {
    permissions[input.value] = input.checked;
  });

  try {
    setModalBusy("makeAdminModal", true);

    const batch = writeBatch(state.db);
    const adminRef = doc(state.db, COLLECTIONS.adminProfiles, uid);

    batch.set(adminRef, {
      uid,
      email,
      displayName,
      role,
      status: "active",
      permissions,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: state.adminContext?.uid || state.firebaseUser?.uid || "",
      createdByEmail: state.adminContext?.email || state.firebaseUser?.email || "",
      lastLoginAt: null,
    }, { merge: true });

    addAdminActionToBatch(batch, {
      action: "make_admin",
      targetCollection: COLLECTIONS.adminProfiles,
      targetId: uid,
      targetRole: "admin",
      reason: `Rol asignado: ${role}`,
    });

    await batch.commit();

    closeModal("makeAdminModal");
    showToast("Admin creado o actualizado correctamente.", "success", "Admin guardado");
    await loadDashboardData();
  } catch (error) {
    console.error("[NIVO Dashboard] Error creando admin:", error);
    showToast(error.message || "No se pudo crear el admin.", "error", "Error");
  } finally {
    setModalBusy("makeAdminModal", false);
  }
}

async function confirmUserStatusChange(uid, status) {
  const user = state.indexes.usersById.get(uid);

  if (!user) {
    showToast("No se encontró el usuario.", "error", "Usuario");
    return;
  }

  openConfirmModal({
    message: `¿Confirmas cambiar el estado de ${user.fullName || user.email || uid} a ${STATUS_LABELS[status] || status}?`,
    onAccept: async () => {
      await updateDoc(doc(state.db, COLLECTIONS.users, uid), {
        status,
        updatedAt: serverTimestamp(),
      });

      showToast("Estado actualizado.", "success", "Usuario");
      await loadDashboardData();
    },
  });
}

/* =========================================================
   ZONE / RIDE TYPE
========================================================= */

function openZoneModal(zoneId = "") {
  const zone = zoneId ? state.indexes.zonesById.get(zoneId) : null;

  $("#zoneId").value = zone?.id || "";
  $("#zoneCountry").value = zone?.country || DEFAULT_COUNTRY;
  $("#zoneDepartment").value = zone?.department || "";
  $("#zoneMunicipality").value = zone?.municipality || "";
  $("#zoneDisplayName").value = zone?.displayName || "";

  const services = normalizeServices(zone?.enabledServices || {});
  const rideTypes = normalizeEnabledRideTypes(zone?.enabledRideTypes || fareTransportEnabled(zone?.id));

  $("#zoneServiceRide").checked = services.ride;
  $("#zoneServiceDelivery").checked = services.delivery;
  $("#zoneServicePackage").checked = services.package;
  $("#zoneServiceSchool").checked = services.school;

  $("#zoneTransportCar").checked = rideTypes.car;
  $("#zoneTransportMotorcycle").checked = rideTypes.motorcycle;
  $("#zoneTransportMototaxi").checked = rideTypes.mototaxi;
  $("#zoneTransportQute").checked = rideTypes.qute;

  $("#zoneActive").checked = zone?.active === true;

  openModal("zoneModal");
}

async function handleZoneSubmit() {
  const currentId = $("#zoneId")?.value?.trim();
  const country = ($("#zoneCountry")?.value || DEFAULT_COUNTRY).trim().toUpperCase();
  const department = $("#zoneDepartment")?.value?.trim();
  const municipality = $("#zoneMunicipality")?.value?.trim();
  const displayName = $("#zoneDisplayName")?.value?.trim();

  if (!country || !department || !municipality || !displayName) {
    showToast("Completa país, departamento, municipio y nombre visible.", "error", "Zona incompleta");
    return;
  }

  const zoneId = currentId || buildZoneId(country, department, municipality);

  const enabledServices = {
    ride: $("#zoneServiceRide")?.checked === true,
    delivery: $("#zoneServiceDelivery")?.checked === true,
    package: $("#zoneServicePackage")?.checked === true,
    school: $("#zoneServiceSchool")?.checked === true,
  };

  const enabledRideTypes = {
    car: $("#zoneTransportCar")?.checked === true,
    motorcycle: $("#zoneTransportMotorcycle")?.checked === true,
    mototaxi: $("#zoneTransportMototaxi")?.checked === true,
    qute: $("#zoneTransportQute")?.checked === true,
  };

  try {
    setModalBusy("zoneModal", true);

    const batch = writeBatch(state.db);
    const zoneRef = doc(state.db, COLLECTIONS.serviceZones, zoneId);
    const fareRef = doc(state.db, COLLECTIONS.fareConfigs, zoneId);

    batch.set(zoneRef, {
      id: zoneId,
      serviceZoneId: zoneId,
      country,
      department,
      municipality,
      displayName,
      active: $("#zoneActive")?.checked === true,
      enabledServices,
      enabledRideTypes,
      updatedAt: serverTimestamp(),
      createdAt: currentId ? undefined : serverTimestamp(),
    }, { merge: true });

    batch.set(fareRef, {
      id: zoneId,
      serviceZoneId: zoneId,
      country,
      department,
      municipality,
      currencyCode: DEFAULT_CURRENCY,
      active: $("#zoneActive")?.checked === true,
      platformCommissionRate: 0,
      transportConfigs: defaultTransportConfigs(enabledRideTypes),
      delivery: {
        enabled: enabledServices.delivery,
        pricingMode: "city_fixed_driver_quote_outside",
        cityFixedFee: 1.5,
        cityFixedMaxDistanceKm: 4,
        outsideCityMinSuggestedFee: 2,
        outsideCityRequiresDriverQuote: true,
        updatedAt: serverTimestamp(),
        updatedBy: state.adminContext?.uid || "",
      },
      commissions: {
        ride: defaultCommission("ride_fare"),
        delivery: defaultCommission("delivery_fee"),
        package: defaultCommission("package_fee"),
      },
      updatedAt: serverTimestamp(),
      createdAt: currentId ? undefined : serverTimestamp(),
    }, { merge: true });

    addAdminActionToBatch(batch, {
      action: currentId ? "update_zone" : "create_zone",
      targetCollection: COLLECTIONS.serviceZones,
      targetId: zoneId,
      targetRole: "zone",
      reason: displayName,
    });

    await batch.commit();

    closeModal("zoneModal");
    showToast("Zona y fare_config guardados correctamente.", "success", "Zona guardada");
    await loadDashboardData();
  } catch (error) {
    console.error("[NIVO Dashboard] Error guardando zona:", error);
    showToast(error.message || "No se pudo guardar la zona.", "error", "Error");
  } finally {
    setModalBusy("zoneModal", false);
  }
}

function openRideTypeModal() {
  $("#rideTypeId").value = "";
  $("#rideTypeTitle").value = "";
  $("#rideTypeDescription").value = "";
  $("#rideTypeMaxPassengers").value = "1";
  $("#rideTypeSortOrder").value = "0";
  $("#rideTypeActiveGlobally").checked = false;
  $("#rideTypeChargesPerPassenger").checked = false;
  $("#rideTypeRequiresPassengerSelection").checked = false;

  openModal("rideTypeModal");
}

function handleRideTypeSubmit() {
  showToast(
    "Las categorías de transporte actuales se derivan desde fare_configs.transportConfigs por zona. No se guardará una colección global ride_types todavía.",
    "info",
    "Categorías transporte"
  );

  closeModal("rideTypeModal");
}

/* =========================================================
   NOTIFICACIONES
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
  const detail = state.activeDetail;

  if (!detail) {
    openNotificationModal();
    return;
  }

  openNotificationModal();

  const recipient = resolveRecipientFromDetail(detail);

  if (recipient) {
    $("#notificationTargetType").value = "single_uid";
    $("#notificationTargetValue").value = recipient.id;
  }
}

async function handleNotificationSubmit() {
  const targetType = $("#notificationTargetType")?.value;
  const targetValue = $("#notificationTargetValue")?.value?.trim();
  const title = $("#notificationTitle")?.value?.trim();
  const body = $("#notificationBody")?.value?.trim();
  const type = $("#notificationType")?.value || "info";

  if (!targetType || !title || !body) {
    showToast("Completa destino, título y mensaje.", "error", "Notificación incompleta");
    return;
  }

  const recipients = notificationRecipients(targetType, targetValue);

  if (!recipients.length) {
    showToast("No se encontraron destinatarios para esta notificación.", "error", "Sin destinatarios");
    return;
  }

  try {
    setModalBusy("notificationModal", true);

    const batch = writeBatch(state.db);

    recipients.forEach((recipient) => {
      addNotificationToBatch(batch, {
        recipientId: recipient.id,
        recipientRole: recipient.role,
        title,
        body,
        type,
        source: "dashboard_manual",
      });
    });

    addAdminActionToBatch(batch, {
      action: "send_notification",
      targetCollection: COLLECTIONS.notifications,
      targetId: targetValue || targetType,
      targetRole: "notification",
      reason: `${title} (${recipients.length} destinatario/s)`,
    });

    await batch.commit();

    closeModal("notificationModal");
    showToast(`Notificación creada para ${recipients.length} destinatario(s).`, "success", "Notificación");
    await loadDashboardData();
  } catch (error) {
    console.error("[NIVO Dashboard] Error creando notificación:", error);
    showToast(error.message || "No se pudo crear la notificación.", "error", "Error");
  } finally {
    setModalBusy("notificationModal", false);
  }
}

function addNotificationToBatch(batch, payload) {
  const recipientId = payload.recipientId || "";
  const recipientRole = payload.recipientRole || "user";
  const ref = doc(collection(state.db, COLLECTIONS.notifications));

  batch.set(ref, {
    notificationId: ref.id,
    recipientId,
    recipientRole,
    uid: recipientId,
    userId: recipientId,
    targetRole: recipientRole,
    title: payload.title || "NIVO",
    body: payload.body || "",
    message: payload.body || "",
    type: payload.type || "info",
    source: payload.source || "dashboard",
    status: "unread",
    read: false,
    readAt: null,
    createdAt: serverTimestamp(),
    createdBy: state.adminContext?.uid || state.firebaseUser?.uid || "",
    createdByEmail: state.adminContext?.email || state.firebaseUser?.email || "",
  });
}

function setNotificationBadge() {
  const badge = $("#notificationBadge");

  if (!badge) return;

  const unread = state.notifications.filter((notification) => {
    return notification.read !== true && notification.status !== "read";
  }).length;

  badge.textContent = String(unread);
  badge.hidden = unread <= 0;
}

/* =========================================================
   ADMIN ACTIONS / AUDIT
========================================================= */

function addAdminActionToBatch(batch, payload) {
  const ref = doc(collection(state.db, COLLECTIONS.adminActions));

  batch.set(ref, {
    actionId: ref.id,
    action: payload.action || "admin_action",
    targetCollection: payload.targetCollection || "",
    targetId: payload.targetId || "",
    targetRole: payload.targetRole || "",
    reason: payload.reason || "",
    adminId: state.adminContext?.uid || state.firebaseUser?.uid || "",
    adminEmail: state.adminContext?.email || state.firebaseUser?.email || "",
    createdAt: serverTimestamp(),
  });
}

/* =========================================================
   CONFIRM MODAL
========================================================= */

function openConfirmModal({ message, onAccept }) {
  state.pendingConfirm = onAccept;
  setText("confirmModalMessage", message || "¿Confirmas que deseas realizar esta acción?");
  openModal("confirmModal");
}

function closeConfirmModal() {
  state.pendingConfirm = null;
  closeModal("confirmModal");
}

$("#confirmModalAcceptBtn")?.addEventListener("click", async () => {
  const action = state.pendingConfirm;

  if (!action) {
    closeConfirmModal();
    return;
  }

  try {
    await action();
  } catch (error) {
    console.error("[NIVO Dashboard] Error confirmando acción:", error);
    showToast(error.message || "No se pudo completar la acción.", "error", "Error");
  } finally {
    closeConfirmModal();
  }
});

/* =========================================================
   UI SHELL
========================================================= */

function setAdminUi(context) {
  setText("sidebarAdminName", context.displayName || context.email || "Admin NIVO");
  setText("sidebarAdminEmail", context.email || "Sin correo");
  setText("sidebarAdminRole", context.adminRole || "admin");
}

function showDashboardShell() {
  const gate = $("#dashboardAuthGate");
  const denied = $("#dashboardAccessDenied");
  const shell = $("#dashboardShell");

  if (gate) gate.hidden = true;
  if (denied) denied.hidden = true;
  if (shell) shell.hidden = false;
}

function showAccessDenied(message) {
  const gate = $("#dashboardAuthGate");
  const denied = $("#dashboardAccessDenied");
  const shell = $("#dashboardShell");

  if (gate) gate.hidden = true;
  if (shell) shell.hidden = true;

  if (denied) {
    denied.hidden = false;

    const paragraph = denied.querySelector("p:not(.eyebrow)");

    if (paragraph && message) {
      paragraph.textContent = message;
    }
  }
}

function setDashboardLoading(isLoading) {
  const gate = $("#dashboardAuthGate");

  if (gate && !$("#dashboardShell")?.hidden) {
    gate.hidden = true;
  }

  document.body.classList.toggle("dashboard-loading", isLoading);
}

function showSection(sectionName) {
  if (!sectionName) return;

  state.currentSection = sectionName;

  $$(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.sectionTarget === sectionName);
  });

  $$(".dashboard-section").forEach((section) => {
    const active = section.dataset.section === sectionName;
    section.classList.toggle("active", active);
    section.hidden = !active;
  });

  const [title, breadcrumb] = SECTION_META[sectionName] || SECTION_META.overview;

  setText("dashboardPageTitle", title);
  setText("dashboardBreadcrumb", breadcrumb);

  document.body.classList.remove("sidebar-open", "is-locked");

  renderCurrentSection();

  $("#dashboardMain")?.focus({ preventScroll: true });
}

function setDriverQuickFilter(filter) {
  state.currentDriverQuickFilter = filter || "all";

  $$("[data-driver-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.driverFilter === state.currentDriverQuickFilter);
  });

  renderDriversTable();
}

/* =========================================================
   MODAL HELPERS
========================================================= */

function openModal(id) {
  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");

  const focusable = modal.querySelector("input, select, textarea, button");

  if (focusable) {
    window.setTimeout(() => focusable.focus(), 50);
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-locked");
}

function closeAllModals() {
  $$(".modal.open").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });

  document.body.classList.remove("is-locked");
}

function setModalBusy(id, busy) {
  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.toggle("is-busy", busy);

  $$("button, input, textarea, select", modal).forEach((element) => {
    element.disabled = busy;
  });
}

/* =========================================================
   IMAGE VIEWER
========================================================= */

function openImageViewer(src, title = "Documento") {
  if (!src) {
    showToast("No hay imagen disponible.", "warning", "Documento");
    return;
  }

  const modal = $("#imageViewerModal");
  const img = $("#imageViewerImg");

  setText("imageViewerTitle", title || "Documento");

  if (img) {
    img.src = src;
    img.alt = title || "Documento seleccionado";
  }

  if (modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
  }
}

function closeImageViewer() {
  const modal = $("#imageViewerModal");
  const img = $("#imageViewerImg");

  if (img) {
    img.src = "";
  }

  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-locked");
  }
}

/* =========================================================
   HTML DETAILS
========================================================= */

function profileSummaryHtml(item) {
  return `
    <div class="detail-grid">
      ${detailItem("ID", item.id)}
      ${detailItem("Nombre", item.fullName || item.displayName || item.businessName)}
      ${detailItem("Email", item.email)}
      ${detailItem("Teléfono", item.phone)}
      ${detailItem("Rol", ROLE_LABELS[item.role] || item.role)}
      ${detailItem("Estado", STATUS_LABELS[item.status] || item.status)}
      ${detailItem("Zona", formatZone(userZone(item) || item.serviceZoneId || item.zoneId, item.department, item.municipality))}
      ${detailItem("Creado", date(item.createdAt))}
    </div>
  `;
}

function driverSummaryHtml(driver, vehicle, wallet) {
  const driverId = driver.driverId || driver.uid || driver.id;

  return `
    <div class="detail-grid">
      ${detailItem("Driver ID", driverId)}
      ${detailItem("Nombre", driver.fullName)}
      ${detailItem("Email", driver.email)}
      ${detailItem("Teléfono", driver.phone)}
      ${detailItem("Estado", STATUS_LABELS[driver.status] || driver.status)}
      ${detailItem("Zona", formatZone(driver.serviceZoneId, driver.department, driver.municipality))}
      ${detailItem("Vehículo", driver.vehicleLabel || vehicleLabel(driver.vehicleType))}
      ${detailItem("Placa", vehicle?.plate || get(driver, "documentNumbers.plate", ""))}
      ${detailItem("Servicios", servicesText(driver.enabledServices))}
      ${detailItem("Wallet", wallet ? money(walletBalance(wallet)) : "Pendiente")}
      ${detailItem("Rating", driverRating(driver))}
      ${detailItem("Creado", date(driver.createdAt))}
    </div>
  `;
}

function driverOperationHtml(driver, vehicle) {
  return `
    <div class="detail-grid">
      ${detailItem("Online", get(driver, "availability.isOnline") ? "Sí" : "No")}
      ${detailItem("Disponible", get(driver, "availability.isAvailable") ? "Sí" : "No")}
      ${detailItem("Puede recibir tareas", get(driver, "policy.canReceiveTasks") ? "Sí" : "No")}
      ${detailItem("Sanción actual", get(driver, "policy.currentSanctionStatus", "none"))}
      ${detailItem("Puntos penalización", get(driver, "policy.activePenaltyPoints", 0))}
      ${detailItem("Vehículo aprobado", vehicle?.status || "Sin vehículo")}
      ${detailItem("Vehículo activo", vehicle?.isActive ? "Sí" : "No")}
    </div>
    ${jsonBlock({
      availability: driver.availability || {},
      policy: driver.policy || {},
      vehicle: vehicle || {},
    })}
  `;
}

function driverFinanceHtml(driver, wallet) {
  const driverId = driver.driverId || driver.uid || driver.id;
  const txs = state.driverWalletTransactions
    .filter((tx) => tx.driverId === driverId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, 20);

  return `
    <div class="detail-grid">
      ${detailItem("Saldo disponible", wallet ? money(walletBalance(wallet)) : money(get(driver, "wallet.balance", 0)))}
      ${detailItem("Mínimo requerido", money(get(wallet, "rules.minimumBalanceRequired", get(driver, "wallet.minimumBalanceRequired", MINIMUM_DRIVER_BALANCE))))}
      ${detailItem("Puede recibir tareas comisionadas", get(wallet, "rules.canReceiveCommissionedTasks", get(driver, "wallet.canReceiveCommissionedTasks", false)) ? "Sí" : "No")}
      ${detailItem("Bono bienvenida", get(wallet, "balance.welcomeBalance", get(driver, "wallet.welcomeBalanceAmount", 0)))}
    </div>

    <h4>Últimos movimientos</h4>
    ${txs.length ? `
      <div class="activity-feed">
        ${txs.map((tx) => `
          <div class="activity-item">
            <strong>${e(walletMovementTitle(tx.type))} · ${tx.direction === "debit" ? "-" : "+"}${money(tx.amount)}</strong>
            <span>${e(tx.description || "")}</span>
            <small>${date(tx.createdAt)}</small>
          </div>
        `).join("")}
      </div>
    ` : `<div class="empty-state compact">Sin movimientos wallet.</div>`}
  `;
}

function commerceSummaryHtml(commerce, owner) {
  return `
    <div class="detail-grid">
      ${detailItem("Commerce ID", commerce.commerceId || commerce.id)}
      ${detailItem("Negocio", commerce.businessName)}
      ${detailItem("Propietario", owner?.fullName || commerce.legalName || commerce.ownerName)}
      ${detailItem("Email", commerce.email || owner?.email)}
      ${detailItem("Teléfono", commerce.phone || owner?.phone)}
      ${detailItem("Categoría", commerce.category || commerce.categoryName || commerce.categoryId)}
      ${detailItem("Estado usuario", owner?.status)}
      ${detailItem("Activo", commerce.active ? "Sí" : "No")}
      ${detailItem("Verificado", commerce.verified ? "Sí" : "No")}
      ${detailItem("Puede recibir órdenes", commerce.canReceiveDeliveryOrders ? "Sí" : "No")}
      ${detailItem("Open status", commerce.openStatus || "closed")}
      ${detailItem("Zona", formatZone(commerceZone(commerce), commerce.department, commerce.municipality))}
    </div>
  `;
}

function commerceOperationHtml(commerce, owner) {
  return `
    <div class="detail-grid">
      ${detailItem("Visible User App", isCommerceVisible(commerce) ? "Sí" : "No")}
      ${detailItem("Delivery", commerce.deliveryEnabled ? "Sí" : "No")}
      ${detailItem("Chat", commerce.chatEnabled ? "Sí" : "No")}
      ${detailItem("Catálogo", commerce.catalogEnabled ? "Sí" : "No")}
      ${detailItem("Abierto ahora", commerce.isCurrentlyOpen ? "Sí" : "No")}
      ${detailItem("Plan", planLabel(commerce.subscriptionPlan || commerce.plan || "free"))}
      ${detailItem("Prioridad", commerce.priorityPlacement ? "Sí" : "No")}
      ${detailItem("Banner", commerce.bannerEnabled ? "Sí" : "No")}
    </div>
    ${jsonBlock({
      commerce,
      owner,
    })}
  `;
}

function commerceFinanceHtml(commerce) {
  return `
    <div class="detail-grid">
      ${detailItem("Total órdenes", commerce.totalOrders || get(commerce, "metrics.ordersCompleted", 0))}
      ${detailItem("Ventas totales", money(commerce.totalSales || get(commerce, "metrics.totalSales", 0)))}
      ${detailItem("Rating", commerce.ratingAverage || get(commerce, "metrics.rating", 0))}
      ${detailItem("Plan", planLabel(commerce.subscriptionPlan || commerce.plan || "free"))}
      ${detailItem("Comisión", rate(commerce.commissionRate || 0))}
    </div>
  `;
}

function commerceImagesHtml(commerce) {
  const images = [
    ["Logo", commerce.logoUrl || commerce.logoThumbnailUrl],
    ["Portada", commerce.coverUrl || commerce.coverImageUrl || commerce.coverThumbnailUrl],
  ].filter(([, url]) => url);

  if (!images.length) {
    return `<div class="empty-state compact">Este comercio no tiene imágenes cargadas.</div>`;
  }

  return `
    <div class="documents-grid">
      ${images.map(([label, url]) => `
        <button class="document-thumb" type="button" data-action="view-image" data-src="${ea(url)}" data-title="${ea(label)}">
          <img src="${ea(url)}" alt="${ea(label)}" />
          <span>${e(label)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function documentsHtml(profileDocs = {}, vehicleDocs = {}) {
  const docs = {
    ...profileDocs,
    ...vehicleDocs,
  };

  const entries = Object.entries(docs)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0);

  if (!entries.length) {
    return `<div class="empty-state compact">No hay documentos cargados.</div>`;
  }

  return `
    <div class="documents-grid">
      ${entries.map(([key, url]) => `
        <button class="document-thumb" type="button" data-action="view-image" data-src="${ea(url)}" data-title="${ea(labelKey(key))}">
          <img src="${ea(url)}" alt="${ea(labelKey(key))}" />
          <span>${e(labelKey(key))}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function zoneSummaryHtml(zone, fare) {
  return `
    <div class="detail-grid">
      ${detailItem("Zona", zone.id)}
      ${detailItem("Nombre", zone.displayName)}
      ${detailItem("País", zone.country)}
      ${detailItem("Departamento", zone.department)}
      ${detailItem("Municipio", zone.municipality)}
      ${detailItem("Activa", zone.active ? "Sí" : "No")}
      ${detailItem("Servicios", servicesText(zone.enabledServices))}
      ${detailItem("Fare config", fare ? "Existe" : "No encontrado")}
    </div>
  `;
}

function deliverySummaryHtml(order) {
  return `
    <div class="detail-grid">
      ${detailItem("Orden", order.orderCode || order.orderId || order.id)}
      ${detailItem("Cliente", order.customerName || order.userName)}
      ${detailItem("Teléfono", order.customerPhone)}
      ${detailItem("Comercio", order.commerceName || order.commerceId)}
      ${detailItem("Repartidor", order.driverName || order.driverId || "Sin asignar")}
      ${detailItem("Estado", STATUS_LABELS[order.status] || order.status)}
      ${detailItem("Logística", order.logisticsStatus)}
      ${detailItem("Dispatch", order.driverDispatchStatus)}
      ${detailItem("Código entrega", order.deliveryCode)}
      ${detailItem("Código verificado", order.deliveryCodeVerified ? "Sí" : "No")}
      ${detailItem("Total", money(order.total || 0))}
      ${detailItem("Creada", date(order.createdAt))}
    </div>
  `;
}

function deliveryProofHtml(order) {
  const urls = [
    order.deliveryProofUrl,
    ...(Array.isArray(order.deliveryProofPhotoUrls) ? order.deliveryProofPhotoUrls : []),
    ...(Array.isArray(order.pickupProofPhotoUrls) ? order.pickupProofPhotoUrls : []),
    ...(Array.isArray(order.proofPhotoUrls) ? order.proofPhotoUrls : []),
  ].filter(Boolean);

  if (!urls.length) {
    return `<div class="empty-state compact">No hay pruebas de entrega cargadas.</div>`;
  }

  return `
    <div class="documents-grid">
      ${urls.map((url, index) => `
        <button class="document-thumb" type="button" data-action="view-image" data-src="${ea(url)}" data-title="Prueba ${index + 1}">
          <img src="${ea(url)}" alt="Prueba ${index + 1}" />
          <span>Prueba ${index + 1}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function deliveryEventsHtml(order) {
  const events = Array.isArray(order.statusEvents) ? order.statusEvents : [];

  if (!events.length) {
    return `<div class="empty-state compact">Sin eventos internos en la orden.</div>`;
  }

  return `
    <div class="activity-feed">
      ${events.map((event) => `
        <div class="activity-item">
          <strong>${e(event.statusLabel || event.status || event.nextStatus || "Evento")}</strong>
          <span>${e(event.message || event.note || "")}</span>
          <small>${date(event.createdAt)}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function historyHtml(collectionName, targetId) {
  const items = [...state.adminActions, ...state.auditLogs]
    .filter((item) => item.targetCollection === collectionName && item.targetId === targetId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  if (!items.length) {
    return `<div class="empty-state compact">No hay historial administrativo para este registro.</div>`;
  }

  return `
    <div class="activity-feed">
      ${items.map((item) => `
        <div class="activity-item">
          <strong>${e(item.action || "Acción")}</strong>
          <span>${e(item.adminEmail || "Admin")} · ${date(item.createdAt)}</span>
          <small>${e(item.reason || "")}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function jsonBlock(value) {
  return `
    <pre class="json-block">${e(JSON.stringify(toPlain(value), null, 2))}</pre>
  `;
}

function detailItem(label, value) {
  return `
    <div class="detail-item">
      <span>${e(label)}</span>
      <strong>${e(value === undefined || value === null || value === "" ? "—" : value)}</strong>
    </div>
  `;
}

/* =========================================================
   FILTROS / DERIVADOS
========================================================= */

function populateZoneFilters() {
  const zones = [...state.serviceZones]
    .sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)));

  const options = zones
    .map((zone) => `<option value="${ea(zone.id)}">${e(zone.displayName || zone.id)}</option>`)
    .join("");

  ["usersZoneFilter", "driversZoneFilter", "commerceZoneFilter"].forEach((id) => {
    const select = document.getElementById(id);

    if (!select) return;

    const current = select.value || "all";

    select.innerHTML = `<option value="all">Todas las zonas</option>${options}`;
    select.value = current !== "all" && state.indexes.zonesById.has(current) ? current : "all";
  });
}

function buildRideTypesFromFareConfigs(fares, zones) {
  const rows = [];
  const zoneMap = new Map(zones.map((zone) => [zone.id, zone]));

  fares.forEach((fare) => {
    const configs = transportConfigs(fare.transportConfigs);
    const zoneId = fare.serviceZoneId || fare.id;
    const zone = zoneMap.get(zoneId) || {};

    Object.entries(configs).forEach(([transportId, config]) => {
      rows.push({
        id: `${zoneId}_${transportId}`,
        serviceZoneId: zoneId,
        sourceZoneLabel: zone.displayName || fare.municipality || zoneId,
        ...config,
        transportId,
      });
    });
  });

  return rows;
}

function isDriverApproved(driver) {
  return driver?.status === DRIVER_STATUSES.approved || driver?.status === "active";
}

function commerceOwner(commerce) {
  const uid = commerce?.ownerUid || commerce?.uid || commerce?.ownerId;

  return state.indexes.commerceUsersById.get(uid) ||
    state.indexes.commerceUsersByCommerceId.get(commerce?.commerceId || commerce?.id) ||
    null;
}

function isCommerceActive(commerce) {
  const owner = commerceOwner(commerce);

  return commerce?.active === true &&
    commerce?.verified === true &&
    owner?.status === COMMERCE_USER_STATUSES.active;
}

function isCommerceVisible(commerce) {
  return commerce?.active === true &&
    commerce?.verified === true &&
    commerce?.deliveryEnabled === true;
}

function isCommercePending(commerce) {
  const owner = commerceOwner(commerce);

  if (owner && [COMMERCE_USER_STATUSES.pendingProfile, COMMERCE_USER_STATUSES.pendingVerification].includes(owner.status)) {
    return true;
  }

  if (commerce?.active !== true || commerce?.verified !== true) {
    return true;
  }

  return ["pending_profile", "pending_review", "pending_verification", "correction_required"].includes(commerceStatus(commerce));
}

function commerceStatus(commerce) {
  const owner = commerceOwner(commerce);

  if (owner?.status === COMMERCE_USER_STATUSES.suspended) return "suspended";

  if (owner?.status === COMMERCE_USER_STATUSES.active && commerce.active === true && commerce.verified === true) {
    return "active";
  }

  return commerce.status ||
    owner?.status ||
    (commerce.active !== true || commerce.verified !== true ? "pending_verification" : "active");
}

function normalizeCommerceFilterStatus(value) {
  if (value === "pending_review") return "pending_verification";
  if (value === "blocked") return "suspended";
  return value;
}

function driverWallet(driverId) {
  return state.indexes.driverWalletsById.get(driverId) || null;
}

function primaryVehicle(driver) {
  const driverId = driver.driverId || driver.uid || driver.id;
  const vehicles = state.indexes.driverVehiclesByDriverId.get(driverId) || [];

  return vehicles.find((vehicle) => vehicle.isPrimary === true) ||
    state.indexes.driverVehiclesById.get(driver.primaryVehicleId || "") ||
    vehicles[0] ||
    null;
}

function userZone(user) {
  return user.registeredZoneId || user.serviceZoneId || user.zoneId || "";
}

function commerceZone(commerce) {
  return commerce.zoneId || commerce.serviceZoneId || commerce.registeredZoneId || "";
}

function walletBalance(wallet, fallback = 0) {
  return Number(get(wallet, "balance.availableBalance", wallet?.availableBalance ?? fallback ?? 0)) || 0;
}

function driverRating(driver) {
  const rating = Number(get(driver, "metrics.averageRating", get(driver, "metrics.rating", 0))) || 0;
  const count = Number(get(driver, "metrics.ratingCount", 0)) || 0;

  if (count <= 0 && rating <= 0) return "Nuevo";

  return `${rating.toFixed(1)} (${count})`;
}

function normalizeServices(value) {
  return {
    ride: get(value, "ride", false) === true,
    delivery: get(value, "delivery", false) === true,
    package: get(value, "package", false) === true,
    school: get(value, "school", false) === true,
  };
}

function normalizeEnabledRideTypes(value) {
  return {
    car: get(value, "car", false) === true || get(value, "vehicle", false) === true,
    motorcycle: get(value, "motorcycle", false) === true || get(value, "moto", false) === true,
    mototaxi: get(value, "mototaxi", false) === true,
    qute: get(value, "qute", false) === true || get(value, "quote", false) === true,
  };
}

function normalizeVehicleType(value) {
  const clean = txt(value).toLowerCase();

  if (["vehicle", "vehiculo", "vehículo"].includes(clean)) return "car";
  if (["moto", "motorbike"].includes(clean)) return "motorcycle";
  if (clean === "quote") return "qute";

  return clean || "car";
}

function vehicleLabel(value) {
  const clean = normalizeVehicleType(value);

  return VEHICLE_LABELS[clean] || VEHICLE_LABELS[value] || txt(value) || "Vehículo";
}

function transportConfigs(value) {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value).reduce((acc, [key, config]) => {
    if (!config || typeof config !== "object") return acc;

    const id = normalizeVehicleType(config.transportId || key);

    acc[id] = {
      ...config,
      transportId: id,
    };

    return acc;
  }, {});
}

function fareTransportEnabled(zoneId) {
  const fare = state.indexes.fareConfigsById.get(zoneId);
  const configs = transportConfigs(fare?.transportConfigs);

  return Object.values(configs).reduce((acc, config) => {
    acc[config.transportId] = config.active === true;
    return acc;
  }, {});
}

function defaultTransportConfigs(enabledRideTypes = {}) {
  const enabled = normalizeEnabledRideTypes(enabledRideTypes);

  return {
    car: {
      active: enabled.car,
      transportId: "car",
      transportTitle: "Vehículo",
      baseFare: 1,
      minimumFare: 1.5,
      pricePerKm: 0.55,
      pricePerMinute: 0.07,
      maxPassengers: 4,
      chargesPerPassenger: false,
      requiresPassengerSelection: false,
      maxAutoPricedZoneLevel: 3,
      outOfZoneRequiresConfirmation: true,
      zoneFixedFareIsPerPassenger: false,
      zoneFixedFares: {},
    },
    motorcycle: {
      active: enabled.motorcycle,
      transportId: "motorcycle",
      transportTitle: "Moto",
      baseFare: 0.75,
      minimumFare: 1,
      pricePerKm: 0.4,
      pricePerMinute: 0.05,
      maxPassengers: 1,
      chargesPerPassenger: false,
      requiresPassengerSelection: false,
      maxAutoPricedZoneLevel: 3,
      outOfZoneRequiresConfirmation: true,
      zoneFixedFareIsPerPassenger: false,
      zoneFixedFares: {},
    },
    mototaxi: {
      active: enabled.mototaxi,
      transportId: "mototaxi",
      transportTitle: "Mototaxi",
      baseFare: 0.5,
      minimumFare: 0.5,
      pricePerKm: 0.35,
      pricePerMinute: 0.03,
      maxPassengers: 3,
      chargesPerPassenger: true,
      requiresPassengerSelection: true,
      maxAutoPricedZoneLevel: 3,
      outOfZoneRequiresConfirmation: true,
      zoneFixedFareIsPerPassenger: true,
      zoneFixedFares: {
        1: 0.5,
        2: 1,
        3: 1.5,
        4: 2,
      },
    },
    qute: {
      active: enabled.qute,
      transportId: "qute",
      transportTitle: "Qute",
      baseFare: 0.5,
      minimumFare: 0.5,
      pricePerKm: 0.35,
      pricePerMinute: 0.03,
      maxPassengers: 3,
      chargesPerPassenger: true,
      requiresPassengerSelection: true,
      maxAutoPricedZoneLevel: 3,
      outOfZoneRequiresConfirmation: true,
      zoneFixedFareIsPerPassenger: true,
      zoneFixedFares: {
        1: 0.5,
        2: 1,
        3: 1.5,
        4: 2,
      },
    },
  };
}

function defaultCommission(appliesTo) {
  return {
    enabled: true,
    rate: 0.08,
    ratePercent: 8,
    label: "Comisión NIVO 8%",
    chargedTo: "driver_wallet",
    walletDebitEnabled: true,
    blockIfInsufficientBalance: true,
    minimumDriverWalletBalance: MINIMUM_DRIVER_BALANCE,
    appliesTo,
  };
}

function notificationRecipients(type, value) {
  if (type === "all_users") {
    return state.users.map((user) => ({
      id: user.id,
      role: user.role || "user",
    }));
  }

  if (type === "users_by_zone") {
    return state.users
      .filter((user) => userZone(user) === value)
      .map((user) => ({
        id: user.id,
        role: user.role || "user",
      }));
  }

  if (type === "drivers_by_zone") {
    return state.drivers
      .filter((driver) => driver.serviceZoneId === value)
      .map((driver) => ({
        id: driver.uid || driver.driverId || driver.id,
        role: "driver",
      }));
  }

  if (type === "commerce_by_zone") {
    return state.commerce
      .filter((commerce) => commerceZone(commerce) === value)
      .map((commerce) => ({
        id: commerce.ownerUid || commerce.uid || commerce.id,
        role: "commerce",
      }));
  }

  if (type === "agents_by_zone") {
    return state.agents
      .filter((agent) => agent.serviceZoneId === value)
      .map((agent) => ({
        id: agent.uid || agent.agentId || agent.id,
        role: "agent",
      }));
  }

  if (type === "single_uid") {
    return value
      ? [{
          id: value,
          role: inferRole(value),
        }]
      : [];
  }

  return [];
}

function inferRole(uid) {
  if (state.indexes.driversById.has(uid)) return "driver";
  if (state.indexes.commerceUsersById.has(uid)) return "commerce";
  if (state.indexes.agentsById.has(uid)) return "agent";

  return state.indexes.usersById.get(uid)?.role || "user";
}

function resolveRecipientFromDetail(detail) {
  if (!detail) return null;

  if (detail.type === "driver") {
    const driver = state.indexes.driversById.get(detail.id);
    return {
      id: driver?.uid || driver?.driverId || detail.id,
      role: "driver",
    };
  }

  if (detail.type === "commerce") {
    const commerce = state.indexes.commerceById.get(detail.id);
    const owner = commerceOwner(commerce);

    return {
      id: commerce?.ownerUid || owner?.uid || commerce?.uid || detail.id,
      role: "commerce",
    };
  }

  if (detail.type === "user") {
    const user = state.indexes.usersById.get(detail.id);

    return {
      id: user?.uid || detail.id,
      role: user?.role || "user",
    };
  }

  return null;
}

/* =========================================================
   UI HELPERS
========================================================= */

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value ?? "";
  }
}

function setHtml(id, html) {
  const element = document.getElementById(id);

  if (element) {
    element.innerHTML = html || "";
  }
}

function emptyRow(colspan, message) {
  return `
    <tr>
      <td colspan="${colspan}">
        <div class="empty-state compact">${e(message)}</div>
      </td>
    </tr>
  `;
}

function avatar(value) {
  const initial = txt(value).charAt(0).toUpperCase() || "N";

  return `<span class="avatar">${e(initial)}</span>`;
}

function pill(label, tone = "neutral") {
  return `<span class="status-pill ${e(tone)}">${e(label)}</span>`;
}

function statusPill(status) {
  const clean = status || "pending";
  const label = STATUS_LABELS[clean] || clean;
  let tone = "neutral";

  if (["active", "approved", "delivered", "confirmed", "read"].includes(clean)) {
    tone = "success";
  } else if (["pending", "pending_review", "pending_documents", "pending_verification", "ready_for_pickup", "pending_driver", "correction_required"].includes(clean)) {
    tone = "warning";
  } else if (["blocked", "rejected", "suspended", "cancelled", "fraud_suspected"].includes(clean)) {
    tone = "danger";
  }

  return pill(label, tone);
}

function servicesBadges(value = {}) {
  const services = normalizeServices(value);

  const html = Object.entries(services)
    .filter(([, enabled]) => enabled)
    .map(([key]) => pill(SERVICE_LABELS[key] || key, "neutral"))
    .join("");

  return html || pill("Sin servicios", "warning");
}

function rideTypeBadges(value = {}) {
  const types = normalizeEnabledRideTypes(value);

  const html = Object.entries(types)
    .filter(([, enabled]) => enabled)
    .map(([key]) => pill(vehicleLabel(key), "neutral"))
    .join("");

  return html || pill("Sin transportes", "warning");
}

function servicesText(value = {}) {
  const services = normalizeServices(value);

  const list = Object.entries(services)
    .filter(([, enabled]) => enabled)
    .map(([key]) => SERVICE_LABELS[key] || key);

  return list.length ? list.join(", ") : "Sin servicios";
}

function walletMovementTitle(type) {
  switch (type) {
    case "topup":
      return "Recarga NIVO";
    case "welcome_bonus":
      return "Bono de bienvenida";
    case "commission_debit":
      return "Comisión NIVO";
    case "adjustment":
      return "Ajuste administrativo";
    case "refund":
      return "Reembolso";
    default:
      return "Movimiento";
  }
}

function showToast(message, type = "info", title = "") {
  const region = $("#toastRegion");

  if (!region) {
    console[type === "error" ? "error" : "log"](`[${title || "NIVO"}] ${message}`);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    ${title ? `<strong>${e(title)}</strong>` : ""}
    <span>${e(message)}</span>
  `;

  region.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("show");
  }, 20);

  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 300);
  }, 5200);
}

/* =========================================================
   UTILIDADES GENERALES
========================================================= */

function get(source, path, fallback = undefined) {
  if (!source || !path) return fallback;

  let current = source;

  for (const key of String(path).split(".")) {
    if (current === null || current === undefined || typeof current !== "object" || !(key in current)) {
      return fallback;
    }

    current = current[key];
  }

  return current === null || current === undefined ? fallback : current;
}

function txt(value) {
  return String(value || "").trim();
}

function lower(value) {
  return txt(value).toLowerCase();
}

function searchable(item, keys) {
  return keys
    .map((key) => String(get(item, key, "") || "").toLowerCase())
    .join(" ");
}

function countTruthy(value) {
  if (!value || typeof value !== "object") return 0;

  return Object.values(value).filter(Boolean).length;
}

function sumBy(items, key) {
  return items.reduce((sum, item) => {
    return sum + (Number(get(item, key, 0)) || 0);
  }, 0);
}

function money(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function num(value) {
  const number = Number(value) || 0;

  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function rate(value) {
  const number = Number(value) || 0;

  if (number <= 0) return "0%";

  return number <= 1 ? `${(number * 100).toFixed(0)}%` : `${number.toFixed(0)}%`;
}

function date(value) {
  const dateValue = toDate(value);

  if (!dateValue) return "—";

  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(dateValue);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "number") return new Date(value);

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function ms(value) {
  return toDate(value)?.getTime() || 0;
}

function formatZone(zoneId, department, municipality) {
  const zone = state.indexes.zonesById?.get(zoneId || "");

  if (zone?.displayName) return zone.displayName;

  if (municipality && department) {
    return `${municipality}, ${department}`;
  }

  return zoneId || "Sin zona";
}

function planLabel(plan) {
  return {
    basic: "Básico",
    premium: "Premium",
    none: "Sin plan",
    free: "Gratis",
  }[plan] || plan || "Gratis";
}

function labelKey(key) {
  return String(key || "")
    .replace(/Url$/i, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (item && typeof item.toDate === "function") {
      return item.toDate().toISOString();
    }

    return item;
  }));
}

function e(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ea(value) {
  return e(value).replace(/`/g, "&#096;");
}

function debounce(fn, delay = 120) {
  let timeout;

  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildZoneId(country, department, municipality) {
  return `${slugify(country || DEFAULT_COUNTRY)}-${slugify(department)}-${slugify(municipality)}`;
}

async function logout() {
  if (state.authCore?.logout) {
    return state.authCore.logout();
  }

  window.location.assign("login.html");
}
