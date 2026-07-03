/* =========================================================
   NIVO DASHBOARD JS — PRODUCCIÓN
   Archivo: assets/js/dashboard.js

   Objetivo:
   - Dashboard administrativo NIVO conectado a Firebase Web SDK CDN.
   - Admin se valida desde admin_profiles/{uid}.status == active.
   - Driver se aprueba con status == "approved".
   - Commerce se aprueba con commerce_users + commerce_profiles.
   - Tarifas oficiales se leen desde fare_configs/{serviceZoneId}.
   - Todos los botones Ver abren drawer de detalle.
   - Drawer, modales e image viewer usan clases is-open/open para compatibilidad CSS.
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
  driverSanctions: "driver_sanctions",
  driverPolicyEvents: "driver_policy_events",

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

  adminActions: "admin_actions",
  auditLogs: "audit_logs",
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

const DRIVER_STATUS = Object.freeze({
  pendingDocuments: "pending_documents",
  pendingReview: "pending_review",
  approved: "approved",
  correctionRequired: "correction_required",
  rejected: "rejected",
  blocked: "blocked",
  fraudSuspected: "fraud_suspected",
});

const COMMERCE_USER_STATUS = Object.freeze({
  pendingProfile: "pending_profile",
  pendingVerification: "pending_verification",
  active: "active",
  suspended: "suspended",
});

const DRIVER_REVIEW_STATUSES = new Set([
  DRIVER_STATUS.pendingDocuments,
  DRIVER_STATUS.pendingReview,
  DRIVER_STATUS.correctionRequired,
]);

const BLOCKED_STATUSES = new Set([
  "blocked",
  "rejected",
  "fraud_suspected",
  "suspended",
  "disabled",
  "account_restricted",
]);

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
  open: "Abierto",
  closed: "Cerrado",
  unread: "No leído",
  read: "Leído",
  confirmed: "Confirmado",
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

const DEFAULT_COUNTRY = "SV";
const DEFAULT_CURRENCY = "USD";
const WELCOME_BALANCE = 10;
const MINIMUM_DRIVER_BALANCE = 1;

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
  driverSanctions: [],
  driverPolicyEvents: [],

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

  adminActions: [],
  auditLogs: [],
  cashSettlements: [],

  indexes: {},
};

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
  $("#refreshDashboardBtn")?.addEventListener("click", () => loadDashboardData({ forceToast: true }));
  $("#logoutBtn")?.addEventListener("click", logout);
  $("#openNotificationsBtn")?.addEventListener("click", () => showSection("notifications"));

  $("#sidebarOpenBtn")?.addEventListener("click", () => {
    document.body.classList.add("sidebar-open", "is-locked");
  });

  $("#sidebarCloseBtn")?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    releaseBodyLockIfClean();
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
    case "close-detail-drawer": closeDetailDrawer(); return;
    case "close-review-modal": closeModal("reviewDecisionModal"); return;
    case "close-make-admin-modal": closeModal("makeAdminModal"); return;
    case "close-zone-modal": closeModal("zoneModal"); return;
    case "close-ride-type-modal": closeModal("rideTypeModal"); return;
    case "close-notification-modal": closeModal("notificationModal"); return;
    case "close-confirm-modal": closeConfirmModal(); return;
    case "close-image-viewer": closeImageViewer(); return;

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

    case "open-zone-modal": openZoneModal(); return;
    case "open-ride-type-modal": openRideTypeModal(); return;
    case "open-notification-modal": openNotificationModal(); return;
    case "open-sanction-modal": openSanctionCreateNotice(); return;

    case "open-user-detail": openUserDetail(id); return;
    case "open-driver-detail": openDriverDetail(id); return;
    case "open-commerce-detail": openCommerceDetail(id); return;
    case "open-agent-detail": openAgentDetail(id); return;
    case "open-zone-detail": openZoneDetail(id); return;
    case "open-ride-type-detail": openRideTypeDetail(id); return;
    case "open-delivery-detail": openDeliveryDetail(id); return;
    case "open-ride-detail": openRideDetail(id); return;
    case "open-cash-settlement-detail": openCashSettlementDetail(id); return;
    case "open-incident-detail": openIncidentDetail(id); return;
    case "open-sanction-detail": openSanctionDetail(id); return;
    case "open-notification-detail": openNotificationDetail(id); return;
    case "open-audit-detail": openAuditDetail(id); return;

    case "open-review-modal":
      openReviewModal({
        targetId: id,
        targetCollection: target.dataset.collection,
        targetRole: target.dataset.role,
        decision: target.dataset.decision || "",
      });
      return;

    case "make-admin": openMakeAdminModal(id); return;
    case "block-user": confirmUserStatusChange(id, "blocked"); return;
    case "reactivate-user": confirmUserStatusChange(id, "active"); return;

    case "drawer-send-notification": openNotificationFromDrawer(); return;
    case "drawer-require-correction": openReviewFromDrawer("correction_required"); return;
    case "drawer-block-profile": openReviewFromDrawer("block"); return;
    case "drawer-approve-profile": openReviewFromDrawer("approve"); return;

    case "view-image": openImageViewer(target.dataset.src, target.dataset.title || "Documento"); return;
    case "edit-zone": openZoneModal(id); return;
    case "edit-ride-type": openRideTypeModal(id); return;
    case "export-overview": showToast("Exportación pendiente de conectar a CSV/PDF.", "info", "Exportación"); return;
    default: return;
  }
}

function handleDocumentSubmit(event) {
  const form = event.target;
  if (form.id === "reviewDecisionForm") { event.preventDefault(); handleReviewDecisionSubmit(); return; }
  if (form.id === "makeAdminForm") { event.preventDefault(); handleMakeAdminSubmit(); return; }
  if (form.id === "zoneForm") { event.preventDefault(); handleZoneSubmit(); return; }
  if (form.id === "rideTypeForm") { event.preventDefault(); handleRideTypeSubmit(); return; }
  if (form.id === "notificationForm") { event.preventDefault(); handleNotificationSubmit(); }
}

function handleDocumentInput(event) {
  if (event.target.id === "makeAdminRole") applyDefaultPermissionsForAdminRole(event.target.value);
}

function handleDocumentChange(event) {
  if (event.target.id === "makeAdminRole") applyDefaultPermissionsForAdminRole(event.target.value);
}

function handleDocumentKeydown(event) {
  if (event.key !== "Escape") return;
  closeAllModals();
  closeImageViewer();
  closeDetailDrawer();
  document.body.classList.remove("sidebar-open");
  releaseBodyLockIfClean();
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
      users, adminProfiles,
      drivers, driverVehicles, driverWallets, driverWalletTransactions, driverTopupSessions, driverOffers, driverSanctions, driverPolicyEvents,
      commerceUsers, commerce, commerceProducts, commerceProductCategories, commerceChats, orderDrafts,
      agents, agentSales,
      serviceZones, fareConfigs, platformConfigs,
      deliveryOrders, rideRequests, packageOrders,
      notifications, supportTickets, safetyReports,
      adminActions, auditLogs, cashSettlements,
    ] = await Promise.all([
      read(COLLECTIONS.users, 750),
      read(COLLECTIONS.adminProfiles, 300),

      read(COLLECTIONS.driverProfiles, 750),
      read(COLLECTIONS.driverVehicles, 750),
      read(COLLECTIONS.driverWallets, 750, "updatedAt"),
      read(COLLECTIONS.driverWalletTransactions, 500),
      read(COLLECTIONS.driverTopupSessions, 250),
      read(COLLECTIONS.driverOffers, 250),
      read(COLLECTIONS.driverSanctions, 250),
      read(COLLECTIONS.driverPolicyEvents, 250),

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
      read(COLLECTIONS.platformConfigs, 120, "updatedAt"),

      read(COLLECTIONS.deliveryOrders, 350),
      read(COLLECTIONS.rideRequests, 350),
      read(COLLECTIONS.packageOrders, 250),

      read(COLLECTIONS.notifications, 300),
      read(COLLECTIONS.supportTickets, 250),
      read(COLLECTIONS.safetyReports, 250),

      read(COLLECTIONS.adminActions, 250),
      read(COLLECTIONS.auditLogs, 250),
      read(COLLECTIONS.cashSettlements, 250),
    ]);

    Object.assign(state, {
      users, adminProfiles,
      drivers, driverVehicles, driverWallets, driverWalletTransactions, driverTopupSessions, driverOffers, driverSanctions, driverPolicyEvents,
      commerceUsers, commerce, commerceProducts, commerceProductCategories, commerceChats, orderDrafts,
      agents, agentSales,
      serviceZones, fareConfigs, platformConfigs,
      deliveryOrders, rideRequests, packageOrders,
      notifications, supportTickets, safetyReports,
      adminActions, auditLogs, cashSettlements,
    });

    state.rideTypes = buildRideTypesFromFareConfigs(state.fareConfigs, state.serviceZones);

    rebuildIndexes();
    populateZoneFilters();
    renderAll();

    if (forceToast) showToast("Los datos fueron actualizados correctamente.", "success", "Datos actualizados");
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
    const snap = await getDocs(query(colRef, orderBy(orderField, direction), limit(max)));
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
  return snap.exists() ? normalizeDoc(snap) : null;
}

function normalizeDoc(snap) {
  return { id: snap.id, ref: snap.ref, ...snap.data() };
}

function rebuildIndexes() {
  state.indexes = {
    usersById: toIndex(state.users),
    adminsById: toIndex(state.adminProfiles),

    driversById: toIndex(state.drivers),
    driverVehiclesById: toIndex(state.driverVehicles),
    driverVehiclesByDriverId: groupBy(state.driverVehicles, (vehicle) => vehicle.driverId || vehicle.uid || ""),
    driverWalletsById: toIndex(state.driverWallets),

    commerceById: toIndex(state.commerce),
    commerceUsersById: toIndex(state.commerceUsers),
    commerceUsersByCommerceId: toIndexBy(state.commerceUsers, (user) => user.commerceId || ""),

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
    if (key) map.set(key, item);
  });
  return map;
}

function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
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
    overview: () => { renderMetrics(); renderOverviewPanels(); },
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

  (renderers[state.currentSection] || renderAll)();
}

function renderMetrics() {
  const activeDrivers = state.drivers.filter(isDriverApproved);
  const pendingDrivers = state.drivers.filter((driver) => DRIVER_REVIEW_STATUSES.has(driver.status));
  const activeCommerce = state.commerce.filter(isCommerceActive);
  const pendingCommerce = state.commerce.filter(isCommercePending);

  setText("metricTotalUsers", state.users.length);
  setText("metricActiveUsers", state.users.filter((u) => u.status === "active").length);
  setText("metricUsersTrend", `${state.users.filter((u) => u.role === "user").length} clientes con role user`);

  setText("metricTotalDrivers", state.drivers.length);
  setText("metricActiveDrivers", activeDrivers.length);
  setText("metricPendingDrivers", pendingDrivers.length);

  setText("metricTotalCommerce", state.commerce.length);
  setText("metricActiveCommerce", activeCommerce.length);

  setText("metricTotalAgents", state.agents.length);
  setText("metricServiceZones", state.serviceZones.filter((z) => z.active === true).length);
  setText("metricRideRequests", state.rideRequests.length);
  setText("metricDeliveryOrders", state.deliveryOrders.length);
  setText("metricWalletVolume", money(sumBy(state.driverWalletTransactions, "amount")));

  setText("metricDriversCar", state.drivers.filter((d) => normalizeVehicleType(d.vehicleType) === "car").length);
  setText("metricDriversMotorcycle", state.drivers.filter((d) => normalizeVehicleType(d.vehicleType) === "motorcycle").length);
  setText("metricDriversMototaxi", state.drivers.filter((d) => normalizeVehicleType(d.vehicleType) === "mototaxi").length);
  setText("metricDriversQute", state.drivers.filter((d) => normalizeVehicleType(d.vehicleType) === "qute").length);
  setText("metricDriversDelivery", state.drivers.filter((d) => get(d, "enabledServices.delivery") === true).length);
  setText("metricDriversAvailable", state.drivers.filter((d) => get(d, "availability.isAvailable") === true).length);

  setText("navPendingDriversCount", pendingDrivers.length);
  setText("navPendingCommerceCount", pendingCommerce.length);

  setText("driversCountAll", state.drivers.length);
  setText("driversCountActive", activeDrivers.length);
  setText("driversCountOnline", state.drivers.filter((d) => get(d, "availability.isOnline") === true).length);
  setText("driversCountReview", state.drivers.filter((d) => DRIVER_REVIEW_STATUSES.has(d.status)).length);
  setText("driversCountBlocked", state.drivers.filter((d) => BLOCKED_STATUSES.has(d.status)).length);

  const unread = state.notifications.filter((n) => n.read !== true && n.status !== "read").length;
  const badge = $("#notificationBadge");
  if (badge) {
    badge.textContent = String(unread);
    badge.hidden = unread <= 0;
  }
}

function renderOverviewPanels() {
  const alerts = [];
  const pendingDrivers = state.drivers.filter((d) => d.status === DRIVER_STATUS.pendingReview);
  const pendingCommerce = state.commerce.filter(isCommercePending);

  if (pendingDrivers.length) alerts.push(["Conductores pendientes", `${pendingDrivers.length} conductor(es) listos para revisión.`, "driver-review"]);
  if (pendingCommerce.length) alerts.push(["Comercios pendientes", `${pendingCommerce.length} comercio(s) requieren aprobación.`, "commerce-review"]);

  setHTML("criticalAlertsList", alerts.length
    ? alerts.map(([title, body, section]) => `<button class="alert-item" type="button" data-section-target="${ea(section)}"><strong>${e(title)}</strong><span>${e(body)}</span></button>`).join("")
    : `<div class="empty-inline">No hay alertas críticas cargadas todavía.</div>`);

  const actions = [...state.adminActions, ...state.auditLogs].sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 8);
  setHTML("recentAdminActions", actions.length
    ? actions.map((a) => `<div class="activity-item"><strong>${e(a.action || "Acción administrativa")}</strong><span>${e(a.adminEmail || a.createdByEmail || a.adminUid || "Admin")} · ${date(a.createdAt)}</span><small>${e(a.reason || a.targetId || "")}</small></div>`).join("")
    : `<div class="empty-inline">Todavía no hay acciones administrativas registradas.</div>`);
}

/* =========================================================
   TABLAS
========================================================= */

function renderUsersTable() {
  const tbody = $("#usersTableBody");
  if (!tbody) return;

  let items = [...state.users];
  const global = lower($("#globalSearch")?.value);
  const search = lower($("#usersSearchInput")?.value) || global;
  const role = $("#usersRoleFilter")?.value || "all";
  const status = $("#usersStatusFilter")?.value || "all";
  const zone = $("#usersZoneFilter")?.value || "all";

  if (role !== "all") items = items.filter((x) => (x.role || "user") === role);
  if (status !== "all") items = items.filter((x) => (x.status || "active") === status);
  if (zone !== "all") items = items.filter((x) => userZone(x) === zone);
  if (search) items = items.filter((x) => searchable(x, ["fullName", "displayName", "email", "phone", "role", "status", "department", "municipality", "registeredZoneId", "uid", "id"]).includes(search));

  setText("usersTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map(userRow).join("") : emptyRow(7, "No hay usuarios con esos filtros.");
}

function userRow(user) {
  const admin = state.indexes.adminsById.has(user.id);
  const blocked = BLOCKED_STATUSES.has(user.status);
  return `
    <tr>
      <td>${profileCell(user.fullName || user.displayName || "Usuario NIVO", user.email || user.phone || user.id, user.photoUrl)}</td>
      <td>${badge(ROLE_LABELS[user.role] || user.role || "user")}</td>
      <td>${statusBadge(user.status || "active")}</td>
      <td>${e(formatZone(userZone(user), user.department, user.municipality))}</td>
      <td>${date(user.createdAt)}</td>
      <td>${date(user.lastLoginAt)}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-user-detail" data-id="${ea(user.id)}">Ver</button>
          ${admin ? `<span class="status-badge active">Admin</span>` : `<button class="btn btn-primary" type="button" data-action="make-admin" data-id="${ea(user.id)}">Hacer admin</button>`}
          ${blocked ? `<button class="btn btn-secondary" type="button" data-action="reactivate-user" data-id="${ea(user.id)}">Reactivar</button>` : `<button class="btn btn-danger" type="button" data-action="block-user" data-id="${ea(user.id)}">Bloquear</button>`}
        </div>
      </td>
    </tr>`;
}

function renderDriversTable() {
  const tbody = $("#driversTableBody");
  if (!tbody) return;

  let items = [...state.drivers];
  const global = lower($("#globalSearch")?.value);
  const search = lower($("#driversSearchInput")?.value) || global;
  const vehicle = $("#driversVehicleFilter")?.value || "all";
  const service = $("#driversServiceFilter")?.value || "all";
  const zone = $("#driversZoneFilter")?.value || "all";

  if (state.currentDriverQuickFilter !== "all") {
    const filter = state.currentDriverQuickFilter;
    items = items.filter((d) => {
      if (filter === "active") return isDriverApproved(d);
      if (filter === "online") return get(d, "availability.isOnline") === true;
      if (filter === "pending_review") return DRIVER_REVIEW_STATUSES.has(d.status);
      if (filter === "blocked") return BLOCKED_STATUSES.has(d.status);
      return true;
    });
  }

  if (vehicle !== "all") items = items.filter((d) => normalizeVehicleType(d.vehicleType) === vehicle);
  if (service !== "all") items = items.filter((d) => get(d, `enabledServices.${service}`) === true);
  if (zone !== "all") items = items.filter((d) => d.serviceZoneId === zone);
  if (search) items = items.filter((d) => searchable(d, ["fullName", "email", "phone", "driverId", "uid", "vehicleType", "vehicleLabel", "status", "serviceZoneId"]).includes(search) || searchable(primaryVehicle(d) || {}, ["plate", "brand", "model", "color"]).includes(search));

  setText("driversTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map(driverRow).join("") : emptyRow(8, "No hay conductores con esos filtros.");
}

function driverRow(driver) {
  const driverId = driver.driverId || driver.uid || driver.id;
  const vehicle = primaryVehicle(driver);
  const wallet = driverWallet(driverId);
  const balance = walletBalance(wallet, get(driver, "wallet.balance", 0));

  return `
    <tr>
      <td>${profileCell(driver.fullName || "Conductor NIVO", driver.email || driver.phone || driverId, driver.photoUrl)}</td>
      <td><strong>${e(driver.vehicleLabel || vehicleLabel(driver.vehicleType))}</strong><br><small>${e(vehicle?.plate || get(driver, "documentNumbers.plate", "Sin placa"))}</small></td>
      <td>${servicesBadges(driver.enabledServices)}</td>
      <td>${statusBadge(driver.status || "pending_documents")}<br><small>Wallet: ${money(balance)}</small></td>
      <td>${get(driver, "availability.isOnline") ? badge("Online", "status-badge active") : badge("Offline", "status-badge neutral")}</td>
      <td>${e(formatZone(driver.serviceZoneId, driver.department, driver.municipality))}</td>
      <td>${e(driverRating(driver))}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-driver-detail" data-id="${ea(driver.id)}">Ver</button>
          ${DRIVER_REVIEW_STATUSES.has(driver.status) ? `<button class="btn btn-primary" type="button" data-action="open-review-modal" data-id="${ea(driver.id)}" data-collection="${COLLECTIONS.driverProfiles}" data-role="driver" data-decision="approve">Revisar</button>` : ""}
        </div>
      </td>
    </tr>`;
}

function renderDriverReview() {
  const pendingDocuments = state.drivers.filter((d) => d.status === DRIVER_STATUS.pendingDocuments);
  const pendingReview = state.drivers.filter((d) => d.status === DRIVER_STATUS.pendingReview);
  const correctionRequired = state.drivers.filter((d) => d.status === DRIVER_STATUS.correctionRequired);
  const all = [...pendingDocuments, ...pendingReview, ...correctionRequired];

  setText("reviewPendingDocumentsCount", pendingDocuments.length);
  setText("reviewPendingReviewCount", pendingReview.length);
  setText("reviewCorrectionRequiredCount", correctionRequired.length);

  renderDriverReviewList("reviewPendingDocumentsList", pendingDocuments);
  renderDriverReviewList("reviewPendingReviewList", pendingReview);
  renderDriverReviewList("reviewCorrectionRequiredList", correctionRequired);

  const tbody = $("#driverReviewTableBody");
  if (!tbody) return;

  setText("driverReviewTableCount", countLabel(all));
  tbody.innerHTML = all.length ? all.map((driver) => {
    const vehicle = primaryVehicle(driver);
    const docCount = countTruthy(driver.documents) + countTruthy(vehicle?.documents);
    return `
      <tr>
        <td><strong>${e(driver.fullName || "Conductor NIVO")}</strong><br><small>${e(driver.email || driver.phone || driver.id)}</small></td>
        <td><strong>${e(driver.vehicleLabel || vehicleLabel(driver.vehicleType))}</strong><br><small>${e(vehicle?.plate || get(driver, "documentNumbers.plate", "Sin placa"))}</small></td>
        <td>${docCount} archivo(s)</td>
        <td>${statusBadge(driver.status)}</td>
        <td>${date(get(driver, "verification.documentsSubmittedAt", driver.updatedAt || driver.createdAt))}</td>
        <td class="table-actions-col">
          <div class="table-actions">
            <button class="btn btn-secondary" type="button" data-action="open-driver-detail" data-id="${ea(driver.id)}">Ver</button>
            <button class="btn btn-primary" type="button" data-action="open-review-modal" data-id="${ea(driver.id)}" data-collection="${COLLECTIONS.driverProfiles}" data-role="driver" data-decision="approve">Aprobar</button>
            <button class="btn btn-warning" type="button" data-action="open-review-modal" data-id="${ea(driver.id)}" data-collection="${COLLECTIONS.driverProfiles}" data-role="driver" data-decision="correction_required">Corrección</button>
          </div>
        </td>
      </tr>`;
  }).join("") : emptyRow(6, "No hay conductores pendientes de decisión.");
}

function renderDriverReviewList(containerId, items) {
  setHTML(containerId, items.length
    ? items.slice(0, 10).map((d) => `<article class="review-card"><strong>${e(d.fullName || "Conductor NIVO")}</strong><span>${e(vehicleLabel(d.vehicleType))} · ${e(formatZone(d.serviceZoneId, d.department, d.municipality))}</span><button class="text-btn" type="button" data-action="open-driver-detail" data-id="${ea(d.id)}">Revisar</button></article>`).join("")
    : `<div class="empty-state compact">Sin conductores en esta etapa.</div>`);
}

function renderCommerceTable() {
  const tbody = $("#commerceTableBody");
  if (!tbody) return;

  let items = [...state.commerce];
  const global = lower($("#globalSearch")?.value);
  const search = lower($("#commerceSearchInput")?.value) || global;
  const status = $("#commerceStatusFilter")?.value || "all";
  const plan = $("#commercePlanFilter")?.value || "all";
  const zone = $("#commerceZoneFilter")?.value || "all";

  if (status !== "all") items = items.filter((c) => commerceStatus(c) === normalizeCommerceFilter(status));
  if (plan !== "all") items = items.filter((c) => (plan === "none" ? ["none", "free", ""].includes(c.subscriptionPlan || c.plan || "free") : (c.subscriptionPlan || c.plan) === plan));
  if (zone !== "all") items = items.filter((c) => commerceZone(c) === zone);
  if (search) items = items.filter((c) => searchable(c, ["businessName", "legalName", "email", "phone", "category", "categoryId", "commerceId", "ownerUid", "status"]).includes(search) || searchable(commerceOwner(c) || {}, ["fullName", "email", "phone", "status"]).includes(search));

  setText("commerceTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map(commerceRow).join("") : emptyRow(8, "No hay comercios con esos filtros.");
}

function commerceRow(commerce) {
  const owner = commerceOwner(commerce);
  return `
    <tr>
      <td>${profileCell(commerce.businessName || commerce.displayName || "Comercio NIVO", commerce.email || commerce.phone || commerce.id, commerce.logoThumbnailUrl || commerce.logoUrl)}</td>
      <td>${e(owner?.fullName || commerce.legalName || commerce.ownerName || commerce.ownerUid || "Sin dueño")}</td>
      <td>${e(commerce.category || commerce.categoryName || commerce.categoryId || "Sin categoría")}</td>
      <td>${statusBadge(commerceStatus(commerce))}</td>
      <td>${isCommerceVisible(commerce) ? badge("Visible", "status-badge active") : badge("Oculto", "status-badge neutral")}</td>
      <td>${badge(planLabel(commerce.subscriptionPlan || commerce.plan || "free"))}</td>
      <td>${e(formatZone(commerceZone(commerce), commerce.department, commerce.municipality))}</td>
      <td class="table-actions-col">
        <div class="table-actions">
          <button class="btn btn-secondary" type="button" data-action="open-commerce-detail" data-id="${ea(commerce.id)}">Ver</button>
          ${isCommercePending(commerce) ? `<button class="btn btn-primary" type="button" data-action="open-review-modal" data-id="${ea(commerce.id)}" data-collection="${COLLECTIONS.commerceProfiles}" data-role="commerce" data-decision="approve">Revisar</button>` : ""}
        </div>
      </td>
    </tr>`;
}

function renderCommerceReview() {
  const tbody = $("#commerceReviewTableBody");
  if (!tbody) return;

  const items = state.commerce.filter(isCommercePending);
  setText("commerceReviewTableCount", countLabel(items));

  tbody.innerHTML = items.length ? items.map((commerce) => {
    const owner = commerceOwner(commerce);
    return `
      <tr>
        <td><strong>${e(commerce.businessName || "Comercio NIVO")}</strong><br><small>${e(commerce.email || commerce.phone || commerce.id)}</small></td>
        <td>${e(owner?.fullName || commerce.ownerUid || "Sin owner")}</td>
        <td>${statusBadge(commerceStatus(commerce))}</td>
        <td>${e(commerce.category || commerce.categoryId || "Sin categoría")}</td>
        <td>${e(formatZone(commerceZone(commerce), commerce.department, commerce.municipality))}</td>
        <td>${date(commerce.createdAt || commerce.updatedAt)}</td>
        <td class="table-actions-col">
          <div class="table-actions">
            <button class="btn btn-secondary" type="button" data-action="open-commerce-detail" data-id="${ea(commerce.id)}">Ver</button>
            <button class="btn btn-primary" type="button" data-action="open-review-modal" data-id="${ea(commerce.id)}" data-collection="${COLLECTIONS.commerceProfiles}" data-role="commerce" data-decision="approve">Aprobar</button>
            <button class="btn btn-warning" type="button" data-action="open-review-modal" data-id="${ea(commerce.id)}" data-collection="${COLLECTIONS.commerceProfiles}" data-role="commerce" data-decision="correction_required">Corrección</button>
          </div>
        </td>
      </tr>`;
  }).join("") : emptyRow(7, "No hay comercios pendientes de decisión.");
}

function renderAgentsTable() {
  const tbody = $("#agentsTableBody");
  if (!tbody) return;
  const items = [...state.agents];
  setText("agentsTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((agent) => `
    <tr>
      <td>${profileCell(agent.fullName || agent.businessName || "Agente NIVO", agent.email || agent.phone || agent.id, agent.photoUrl)}</td>
      <td>${statusBadge(agent.status || "pending_review")}</td>
      <td>${e(formatZone(agent.serviceZoneId, agent.department, agent.municipality))}</td>
      <td>${agent.canProcessTopups || agent.canSellDriverTopUps ? badge("Sí", "status-badge active") : badge("No", "status-badge neutral")}</td>
      <td>${money(agent.dailyLimit || 0)}</td>
      <td>${money(agent.monthlyLimit || 0)}</td>
      <td>${rate(agent.commissionRate || 0)}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-agent-detail" data-id="${ea(agent.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(8, "Aún no existen agentes NIVO registrados.");
}

function renderZonesTable() {
  const tbody = $("#zonesTableBody");
  if (!tbody) return;
  const items = [...state.serviceZones];
  setText("zonesTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((zone) => `
    <tr>
      <td><strong>${e(zone.displayName || zone.id)}</strong><br><small>${e(zone.id)}</small></td>
      <td>${e(zone.department || "")}</td>
      <td>${e(zone.municipality || "")}</td>
      <td>${servicesBadges(zone.enabledServices)}</td>
      <td>${transportBadges(zone.enabledRideTypes || fareTransportEnabled(zone.id))}</td>
      <td>${zone.active ? statusBadge("active") : statusBadge("inactive")}</td>
      <td class="table-actions-col"><div class="table-actions"><button class="btn btn-secondary" type="button" data-action="open-zone-detail" data-id="${ea(zone.id)}">Ver</button><button class="btn btn-primary" type="button" data-action="edit-zone" data-id="${ea(zone.id)}">Editar</button></div></td>
    </tr>`).join("") : emptyRow(7, "No hay zonas operativas creadas.");
}

function renderRideTypesTable() {
  const tbody = $("#rideTypesTableBody");
  if (!tbody) return;
  const items = [...state.rideTypes];
  setText("rideTypesTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((type) => `
    <tr>
      <td><strong>${e(type.transportTitle || vehicleLabel(type.transportId))}</strong><br><small>${e(type.sourceZoneLabel || type.serviceZoneId || "Global")}</small></td>
      <td>${e(type.transportId)}</td>
      <td>${type.active ? statusBadge("active") : statusBadge("inactive")}</td>
      <td>${e(type.maxPassengers || 1)}</td>
      <td>${type.chargesPerPassenger ? badge("Sí", "status-badge active") : badge("No", "status-badge neutral")}</td>
      <td>${type.requiresPassengerSelection ? badge("Sí", "status-badge active") : badge("No", "status-badge neutral")}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-ride-type-detail" data-id="${ea(type.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(7, "Las categorías se derivan de fare_configs/{zoneId}.transportConfigs.");
}

function renderPricing() {
  const grid = $("#pricingConfigGrid");
  if (!grid) return;

  if (!state.fareConfigs.length) {
    grid.innerHTML = `<div class="empty-state">No hay fare_configs cargados todavía.</div>`;
    return;
  }

  grid.innerHTML = state.fareConfigs.map((fare) => {
    const zone = state.indexes.zonesById.get(fare.serviceZoneId || fare.id) || {};
    const transports = transportConfigs(fare.transportConfigs);
    const commissions = fare.commissions || {};
    const delivery = fare.delivery || {};

    return `
      <article class="panel">
        <div class="panel-header">
          <div><p class="eyebrow">${e(fare.id)}</p><h3>${e(zone.displayName || fare.municipality || fare.id)}</h3></div>
          ${fare.active ? statusBadge("active") : statusBadge("inactive")}
        </div>
        <div class="config-list">
          <div class="config-row"><span>Zona</span><strong>${e(formatZone(fare.serviceZoneId || fare.id, fare.department, fare.municipality))}</strong></div>
          <div class="config-row"><span>Delivery fijo ciudad</span><strong>${money(delivery.cityFixedFee || 0)}</strong></div>
          <div class="config-row"><span>Máx. ciudad</span><strong>${num(delivery.cityFixedMaxDistanceKm || 0)} km</strong></div>
          <div class="config-row"><span>Comisión ride</span><strong>${rate(commissions.ride?.rate ?? commissions.rideRate ?? 0)}</strong></div>
          <div class="config-row"><span>Comisión delivery</span><strong>${rate(commissions.delivery?.rate ?? commissions.deliveryRate ?? 0)}</strong></div>
          <div class="config-row"><span>Comisión package</span><strong>${rate(commissions.package?.rate ?? commissions.packageRate ?? 0)}</strong></div>
        </div>
        <div class="transport-config-grid">
          ${Object.values(transports).length ? Object.values(transports).map((config) => `
            <div class="review-card">
              <strong>${e(config.transportTitle || vehicleLabel(config.transportId))}</strong>
              <span>Base: ${money(config.baseFare || 0)} · Mínima: ${money(config.minimumFare || 0)}</span>
              <span>Km: ${money(config.pricePerKm || 0)} · Min: ${money(config.pricePerMinute || 0)}</span>
              <span>${config.chargesPerPassenger ? "Cobra por persona" : "No cobra por persona"}</span>
            </div>`).join("") : `<div class="empty-state compact">Sin transportConfigs.</div>`}
        </div>
      </article>`;
  }).join("");
}

function renderDeliveryTable() {
  const tbody = $("#deliveryTableBody");
  if (!tbody) return;
  let items = [...state.deliveryOrders];
  const search = lower($("#globalSearch")?.value);
  if (search) items = items.filter((o) => searchable(o, ["orderId", "orderCode", "publicCode", "customerName", "userName", "commerceName", "driverName", "status", "logisticsStatus", "driverDispatchStatus", "paymentMethod", "deliveryCode"]).includes(search));
  setText("deliveryTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((order) => `
    <tr>
      <td><strong>${e(order.orderCode || order.publicCode || order.orderId || order.id)}</strong><br><small>Código: ${e(order.deliveryCode || "—")}</small></td>
      <td>${e(order.customerName || order.userName || order.customerEmail || order.userId || "Usuario")}</td>
      <td>${e(order.commerceName || order.commerceId || "Comercio")}</td>
      <td>${e(order.driverName || order.driverId || "Sin asignar")}</td>
      <td>${statusBadge(order.status)}<br><small>${e([order.logisticsStatus, order.driverDispatchStatus].filter(Boolean).join(" · ") || "Sin logística")}</small></td>
      <td><strong>${money(order.total || 0)}</strong><br><small>Driver: ${money(order.driverEarnings || 0)}</small></td>
      <td>${date(order.createdAt)}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-delivery-detail" data-id="${ea(order.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(8, "No hay órdenes de delivery registradas.");
}

function renderRidesTable() {
  const tbody = $("#ridesTableBody");
  if (!tbody) return;
  const items = [...state.rideRequests];
  setText("ridesTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((ride) => `
    <tr>
      <td><strong>${e(ride.publicCode || ride.rideCode || ride.id)}</strong><br><small>${e(ride.serviceZoneId || ride.zoneId || "")}</small></td>
      <td>${e(ride.userName || ride.customerName || ride.userId || "Usuario")}</td>
      <td>${e(ride.driverName || ride.driverId || "Sin asignar")}</td>
      <td>${e(vehicleLabel(ride.vehicleType || ride.transportType || ride.transportId))}</td>
      <td>${statusBadge(ride.status)}</td>
      <td>${money(ride.total || ride.estimatedFare || ride.fare || 0)}</td>
      <td>${date(ride.createdAt)}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-ride-detail" data-id="${ea(ride.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(8, "No hay solicitudes de viaje registradas.");
}

function renderLocations() {
  const drivers = state.drivers.filter((d) => get(d, "availability.isOnline") === true);
  setHTML("onlineDriversList", drivers.length
    ? drivers.map((d) => `<div class="review-card"><strong>${e(d.fullName || d.id)}</strong><span>${e(d.vehicleLabel || d.vehicleType || "Vehículo")} · ${e(d.serviceZoneId || "Sin zona")}</span><span>${get(d, "availability.isAvailable") ? "Disponible" : "Online no disponible"}</span></div>`).join("")
    : `<div class="empty-state compact">Sin conductores online cargados.</div>`);
}

function renderWalletLedgerTable() {
  const tbody = $("#walletLedgerTableBody");
  if (!tbody) return;
  const items = [...state.driverWalletTransactions].sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  setText("walletLedgerTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((movement) => {
    const driver = state.indexes.driversById.get(movement.driverId) || {};
    return `
      <tr>
        <td><strong>${e(movement.description || movement.type || "Movimiento")}</strong><br><small>${e(movement.id)}</small></td>
        <td>${e(driver.fullName || movement.driverId || "Driver")}</td>
        <td>${e(movement.type || "movement")}</td>
        <td><strong>${movement.direction === "debit" ? "-" : "+"}${money(movement.amount || 0)}</strong></td>
        <td>${e(movement.source || "dashboard")}</td>
        <td>${statusBadge(movement.status || "confirmed")}</td>
        <td>${date(movement.createdAt)}</td>
        <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-driver-detail" data-id="${ea(movement.driverId || "")}">Driver</button></td>
      </tr>`;
  }).join("") : emptyRow(8, "No hay movimientos de wallet registrados.");
}

function renderCashSettlementsTable() {
  const tbody = $("#cashSettlementsTableBody");
  if (!tbody) return;
  const items = [...state.cashSettlements];
  setText("cashSettlementsTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((item) => `
    <tr>
      <td>${e(item.driverName || item.driverId || item.id)}</td>
      <td>${money(item.cashPendingSettlement || item.pendingAmount || 0)}</td>
      <td>${money(item.cashOverdueSettlement || item.overdueAmount || 0)}</td>
      <td>${date(item.cashDueAt || item.dueAt)}</td>
      <td>${statusBadge(item.cashStatus || item.status)}</td>
      <td>${item.proofUrl ? `<button class="btn btn-secondary" type="button" data-action="view-image" data-src="${ea(item.proofUrl)}" data-title="Comprobante">Ver</button>` : "Sin comprobante"}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-cash-settlement-detail" data-id="${ea(item.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(7, "El módulo de liquidaciones todavía no tiene registros.");
}

function renderIncidentsTable() {
  const tbody = $("#incidentsTableBody");
  if (!tbody) return;
  const items = [...state.supportTickets, ...state.safetyReports].sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  setText("incidentsTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((item) => `
    <tr>
      <td><strong>${e(item.title || item.reportType || item.id)}</strong><br><small>${e(item.message || item.description || "")}</small></td>
      <td>${e(item.reporterRole || item.createdByRole || item.userId || item.driverId || "")}</td>
      <td>${e(item.reportedId || item.targetId || item.recipientId || "")}</td>
      <td>${e(item.reportType || item.category || item.supportCategory || "soporte")}</td>
      <td>${e(item.severity || item.priority || "normal")}</td>
      <td>${statusBadge(item.status || "open")}</td>
      <td>${date(item.createdAt)}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-incident-detail" data-id="${ea(item.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(8, "No hay tickets o reportes registrados.");
}

function renderSanctionsTable() {
  const tbody = $("#sanctionsTableBody");
  if (!tbody) return;
  const items = [...state.driverSanctions, ...state.driverPolicyEvents].sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  setText("sanctionsTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((item) => `
    <tr>
      <td>${e(item.targetName || item.driverName || item.uid || item.driverId || item.id)}</td>
      <td>${e(item.targetRole || "driver")}</td>
      <td>${e(item.type || item.sanctionType || item.action || "sanction")}</td>
      <td>${e(item.severity || "medium")}</td>
      <td>${item.active !== false ? badge("Sí", "status-badge active") : badge("No", "status-badge neutral")}</td>
      <td>${date(item.startedAt || item.createdAt)}</td>
      <td>${date(item.endsAt || item.sanctionUntil)}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-sanction-detail" data-id="${ea(item.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(8, "No hay sanciones registradas.");
}

function renderNotificationsTable() {
  const tbody = $("#notificationsTableBody");
  if (!tbody) return;
  const items = [...state.notifications].sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  setText("notificationsTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((notification) => `
    <tr>
      <td><strong>${e(notification.title || "Notificación")}</strong><br><small>${e(notification.body || notification.message || "")}</small></td>
      <td>${e(notification.recipientRole || notification.targetRole || "")}: ${e(notification.recipientId || notification.uid || notification.userId || notification.driverId || "")}</td>
      <td>${e(notification.type || notification.category || "info")}</td>
      <td>${statusBadge(notification.status || (notification.read ? "read" : "unread"))}</td>
      <td>${date(notification.createdAt)}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-notification-detail" data-id="${ea(notification.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(6, "No hay notificaciones registradas.");
}

function renderAuditTable() {
  const tbody = $("#auditTableBody");
  if (!tbody) return;
  const items = [...state.adminActions, ...state.auditLogs].sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  setText("auditTableCount", countLabel(items));
  tbody.innerHTML = items.length ? items.map((item) => `
    <tr>
      <td>${e(item.action || "Acción")}</td>
      <td>${e(item.adminEmail || item.createdByEmail || item.adminUid || "admin")}</td>
      <td>${e(item.targetCollection || "")}/${e(item.targetId || "")}</td>
      <td>${e(item.targetRole || "")}</td>
      <td>${e(item.reason || item.note || "")}</td>
      <td>${date(item.createdAt)}</td>
      <td class="table-actions-col"><button class="btn btn-secondary" type="button" data-action="open-audit-detail" data-id="${ea(item.id)}">Ver</button></td>
    </tr>`).join("") : emptyRow(7, "No hay acciones administrativas registradas.");
}

function renderSettings() {
  setHTML("appSettingsList", state.platformConfigs.length
    ? state.platformConfigs.map((config) => `<div class="config-row"><span>${e(config.id)}</span><strong>${config.active === false ? "Inactivo" : "Activo"}</strong></div>`).join("")
    : `<div class="empty-state compact">No hay configuraciones en platform_configs.</div>`);
}

/* =========================================================
   DETAIL DRAWER
========================================================= */

function setDetail(role, id, collectionName, data, title, subtitle, eyebrow) {
  state.activeDetail = { role, id, collection: collectionName, data };

  setText("detailDrawerTitle", title || "Detalle");
  setText("detailDrawerSubtitle", subtitle || id || "");
  setText("detailDrawerEyebrow", eyebrow || "Detalle");

  setHTML("detailSummaryPanel", `<div class="empty-state compact">No hay resumen cargado.</div>`);
  setHTML("detailDocumentsPanel", `<div class="empty-state compact">No hay documentos cargados.</div>`);
  setHTML("detailOperationPanel", jsonPanel(data));
  setHTML("detailFinancePanel", `<div class="empty-state compact">Sin datos financieros.</div>`);
  setHTML("detailHistoryPanel", historyPanel(collectionName, id));

  updateDrawerFooter();
  showDetailTab("summary");

  const drawer = $("#detailDrawer");
  if (drawer) {
    drawer.classList.add("is-open", "open");
    drawer.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("is-locked");
}

function detail(obj) {
  setHTML("detailSummaryPanel", detailGrid(obj));
}

function closeDetailDrawer() {
  const drawer = $("#detailDrawer");
  if (drawer) {
    drawer.classList.remove("is-open", "open");
    drawer.setAttribute("aria-hidden", "true");
  }
  state.activeDetail = null;
  releaseBodyLockIfClean();
}

function showDetailTab(tabName) {
  $$(".drawer-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.detailTab === tabName));
  $$(".drawer-tab-panel").forEach((panel) => {
    const active = panel.dataset.detailPanel === tabName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function updateDrawerFooter() {
  const detail = state.activeDetail;
  const reviewable = Boolean(detail && ["driver", "commerce"].includes(detail.role));
  $$("[data-action='drawer-require-correction'], [data-action='drawer-block-profile'], [data-action='drawer-approve-profile']").forEach((button) => {
    button.hidden = !reviewable;
  });
}

function openUserDetail(id) {
  const user = state.indexes.usersById.get(id);
  if (!user) return showToast("No se encontró el usuario.", "error");

  setDetail("user", id, COLLECTIONS.users, user, user.fullName || user.email || "Usuario NIVO", user.email || user.phone || id, "Usuario");
  detail({
    UID: user.uid || user.id,
    Nombre: user.fullName || user.displayName,
    Email: user.email,
    Teléfono: user.phone,
    Rol: ROLE_LABELS[user.role] || user.role,
    Estado: STATUS_LABELS[user.status] || user.status,
    Zona: formatZone(userZone(user), user.department, user.municipality),
    Registro: date(user.createdAt),
    ÚltimoLogin: date(user.lastLoginAt),
  });
}

function openDriverDetail(id) {
  const driver = state.indexes.driversById.get(id);
  if (!driver) return showToast("No se encontró el conductor.", "error");

  const driverId = driver.driverId || driver.uid || driver.id;
  const wallet = driverWallet(driverId);
  const vehicle = primaryVehicle(driver);
  const balance = walletBalance(wallet, get(driver, "wallet.balance", 0));

  setDetail("driver", id, COLLECTIONS.driverProfiles, driver, driver.fullName || "Conductor NIVO", driver.email || driver.phone || id, "Conductor");
  detail({
    DriverID: driverId,
    Nombre: driver.fullName,
    Email: driver.email,
    Teléfono: driver.phone,
    Estado: STATUS_LABELS[driver.status] || driver.status,
    Zona: formatZone(driver.serviceZoneId, driver.department, driver.municipality),
    Vehículo: `${vehicleLabel(driver.vehicleLabel || driver.vehicleType)} · ${vehicle?.plate || get(driver, "documentNumbers.plate", "Sin placa")}`,
    Servicios: servicesText(driver.enabledServices),
    Wallet: money(balance),
    Rating: driverRating(driver),
  });
  setHTML("detailDocumentsPanel", documentsPanel(driver.documents, vehicle?.documents));
  setHTML("detailOperationPanel", jsonPanel({ availability: driver.availability || {}, policy: driver.policy || {}, vehicle: cleanDoc(vehicle || {}) }));
  setHTML("detailFinancePanel", detailGrid({
    Wallet: wallet ? "Creada" : "No creada",
    Saldo: money(balance),
    Bienvenida: money(get(wallet, "balance.welcomeBalance", get(driver, "wallet.welcomeBalanceAmount", 0))),
    PuedeComisiones: get(wallet, "rules.canReceiveCommissionedTasks", get(driver, "wallet.canReceiveCommissionedTasks", false)) ? "Sí" : "No",
  }) + walletTxPanel(driverId));
}

function openCommerceDetail(id) {
  const commerce = state.indexes.commerceById.get(id);
  if (!commerce) return showToast("No se encontró el comercio.", "error");

  const owner = commerceOwner(commerce);
  setDetail("commerce", id, COLLECTIONS.commerceProfiles, commerce, commerce.businessName || commerce.displayName || "Comercio NIVO", commerce.email || commerce.phone || id, "Comercio");
  detail({
    CommerceID: commerce.commerceId || commerce.id,
    Negocio: commerce.businessName,
    Dueño: owner?.fullName || commerce.legalName || commerce.ownerUid,
    Email: commerce.email || owner?.email,
    Teléfono: commerce.phone || owner?.phone,
    Categoría: commerce.category || commerce.categoryId,
    Estado: STATUS_LABELS[commerceStatus(commerce)] || commerceStatus(commerce),
    Visible: isCommerceVisible(commerce) ? "Sí" : "No",
    RecibeÓrdenes: commerce.canReceiveDeliveryOrders ? "Sí" : "No",
    Zona: formatZone(commerceZone(commerce), commerce.department, commerce.municipality),
  });
  setHTML("detailDocumentsPanel", documentsPanel({ logoUrl: commerce.logoUrl, coverUrl: commerce.coverUrl || commerce.coverImageUrl || commerce.coverThumbnailUrl }));
  setHTML("detailOperationPanel", detailGrid({
    Activo: commerce.active ? "Sí" : "No",
    Verificado: commerce.verified ? "Sí" : "No",
    Delivery: commerce.deliveryEnabled ? "Sí" : "No",
    Chat: commerce.chatEnabled ? "Sí" : "No",
    Catálogo: commerce.catalogEnabled ? "Sí" : "No",
    OpenStatus: commerce.openStatus || "closed",
    Abierto: commerce.isCurrentlyOpen ? "Sí" : "No",
  }) + jsonPanel({ owner: cleanDoc(owner || {}), commerce: cleanDoc(commerce) }));
}

function openAgentDetail(id) {
  const agent = state.indexes.agentsById.get(id);
  if (!agent) return showToast("No se encontró el agente.", "error");

  setDetail("agent", id, COLLECTIONS.agentProfiles, agent, agent.fullName || agent.businessName || "Agente NIVO", agent.email || agent.phone || id, "Agente");
  detail({
    AgentID: agent.agentId || agent.id,
    Nombre: agent.fullName,
    Email: agent.email,
    Teléfono: agent.phone,
    Estado: agent.status,
    Zona: formatZone(agent.serviceZoneId, agent.department, agent.municipality),
    PuedeRecargar: agent.canProcessTopups || agent.canSellDriverTopUps ? "Sí" : "No",
  });
}

function openZoneDetail(id) {
  const zone = state.indexes.zonesById.get(id);
  if (!zone) return showToast("No se encontró la zona.", "error");
  const fare = state.indexes.fareConfigsById.get(id) || state.indexes.fareConfigsById.get(zone.serviceZoneId || "");

  setDetail("zone", id, COLLECTIONS.serviceZones, zone, zone.displayName || id, formatZone(id, zone.department, zone.municipality), "Zona");
  detail({
    ID: zone.id,
    País: zone.country,
    Departamento: zone.department,
    Municipio: zone.municipality,
    Activa: zone.active ? "Sí" : "No",
    Servicios: servicesText(zone.enabledServices),
    Transportes: transportText(zone.enabledRideTypes || fareTransportEnabled(zone.id)),
    FareConfig: fare ? "Existe" : "No encontrado",
  });
  setHTML("detailFinancePanel", fare ? jsonPanel(fare) : `<div class="empty-state compact">No hay fare_config para esta zona.</div>`);
}

function openRideTypeDetail(id) {
  const type = state.indexes.rideTypesById.get(id);
  if (!type) return showToast("No se encontró la categoría.", "error");

  setDetail("ride-type", id, COLLECTIONS.fareConfigs, type, type.transportTitle || vehicleLabel(type.transportId), type.serviceZoneId || "fare_configs", "Transporte");
  detail({
    ID: type.transportId,
    Zona: type.serviceZoneId,
    Activo: type.active ? "Sí" : "No",
    Pasajeros: type.maxPassengers || 1,
    Base: money(type.baseFare || 0),
    Mínima: money(type.minimumFare || 0),
    Km: money(type.pricePerKm || 0),
    Minuto: money(type.pricePerMinute || 0),
    PorPersona: type.chargesPerPassenger ? "Sí" : "No",
  });
}

function openDeliveryDetail(id) {
  const order = state.deliveryOrders.find((o) => o.id === id);
  if (!order) return showToast("No se encontró la orden.", "error");

  setDetail("delivery", id, COLLECTIONS.deliveryOrders, order, order.orderCode || order.orderId || id, `${order.customerName || order.userName || "Usuario"} → ${order.commerceName || "Comercio"}`, "Delivery");
  detail({
    Orden: order.orderCode || order.orderId || id,
    Estado: STATUS_LABELS[order.status] || order.status,
    Logística: order.logisticsStatus,
    Dispatch: order.driverDispatchStatus,
    Usuario: order.customerName || order.userName,
    Comercio: order.commerceName,
    Driver: order.driverName || order.driverId || "Sin asignar",
    Total: money(order.total || 0),
    DeliveryFee: money(order.deliveryFee || 0),
    DriverEarnings: money(order.driverEarnings || 0),
    Código: order.deliveryCode || "—",
  });
  setHTML("detailDocumentsPanel", itemsPanel(order.items) + documentsPanel({ deliveryProofUrl: order.deliveryProofUrl, pickupProofUrl: order.pickupProofUrl }));
  setHTML("detailOperationPanel", jsonPanel({ statusEvents: order.statusEvents || [], raw: cleanDoc(order) }));
}

function openRideDetail(id) {
  const ride = state.rideRequests.find((r) => r.id === id);
  if (!ride) return showToast("No se encontró el viaje.", "error");

  setDetail("ride", id, COLLECTIONS.rideRequests, ride, ride.publicCode || ride.rideCode || id, ride.userName || ride.userId || "Usuario", "Viaje");
  detail({
    ID: id,
    Estado: ride.status,
    Usuario: ride.userName || ride.userId,
    Driver: ride.driverName || ride.driverId,
    Tipo: vehicleLabel(ride.vehicleType || ride.transportType || ride.transportId),
    Tarifa: money(ride.total || ride.estimatedFare || ride.fare || 0),
  });
}

function openCashSettlementDetail(id) {
  const item = state.cashSettlements.find((x) => x.id === id);
  if (!item) return showToast("No se encontró la liquidación.", "error");

  setDetail("cash", id, COLLECTIONS.cashSettlements, item, item.driverName || item.driverId || "Liquidación", item.status || item.cashStatus || id, "Liquidación");
  detail({
    Conductor: item.driverName || item.driverId,
    Pendiente: money(item.cashPendingSettlement || item.pendingAmount || 0),
    Vencido: money(item.cashOverdueSettlement || item.overdueAmount || 0),
    FechaLímite: date(item.cashDueAt || item.dueAt),
    Estado: item.cashStatus || item.status,
    Comprobante: item.proofUrl ? "Cargado" : "Sin comprobante",
  });
  setHTML("detailDocumentsPanel", documentsPanel({ proofUrl: item.proofUrl, receiptUrl: item.receiptUrl, depositProofUrl: item.depositProofUrl }));
}

function openIncidentDetail(id) {
  const item = [...state.supportTickets, ...state.safetyReports].find((x) => x.id === id);
  if (!item) return showToast("No se encontró la incidencia.", "error");

  setDetail("support", id, COLLECTIONS.supportTickets, item, item.title || item.subject || item.reportType || "Incidencia", item.status || id, "Soporte");
  detail({
    ID: id,
    Título: item.title || item.subject,
    Tipo: item.reportType || item.category || item.supportCategory,
    Estado: item.status,
    Severidad: item.severity || item.priority,
    Reporta: item.reporterName || item.reporterRole || item.userId || item.createdBy,
    Reportado: item.reportedId || item.targetId || item.driverId,
    Creada: date(item.createdAt),
  });
}

function openSanctionDetail(id) {
  const item = [...state.driverSanctions, ...state.driverPolicyEvents].find((x) => x.id === id);
  if (!item) return showToast("No se encontró la sanción.", "error");

  setDetail("sanction", id, COLLECTIONS.driverSanctions, item, item.targetName || item.driverName || item.driverId || "Sanción", item.type || item.sanctionType || id, "Sanción");
  detail({
    Persona: item.targetName || item.driverName || item.driverId,
    Rol: item.targetRole || "driver",
    Tipo: item.type || item.sanctionType || item.action,
    Severidad: item.severity,
    Activa: item.active !== false ? "Sí" : "No",
    Inicio: date(item.startedAt || item.createdAt),
    Fin: date(item.endsAt || item.sanctionUntil),
    Motivo: item.reason || item.note,
  });
}

function openNotificationDetail(id) {
  const item = state.notifications.find((x) => x.id === id);
  if (!item) return showToast("No se encontró la notificación.", "error");

  setDetail("notification", id, COLLECTIONS.notifications, item, item.title || "Notificación", item.recipientId || item.uid || id, "Notificación");
  detail({
    Título: item.title,
    Mensaje: item.body || item.message,
    Destino: `${item.recipientRole || item.targetRole || "perfil"}: ${item.recipientId || item.uid || item.userId || item.driverId || ""}`,
    Tipo: item.type || item.category,
    Estado: item.status || (item.read ? "read" : "unread"),
    Creada: date(item.createdAt),
  });
}

function openAuditDetail(id) {
  const item = [...state.adminActions, ...state.auditLogs].find((x) => x.id === id);
  if (!item) return showToast("No se encontró el registro de auditoría.", "error");

  setDetail("audit", id, item.targetCollection || COLLECTIONS.adminActions, item, item.action || "Acción administrativa", item.adminEmail || item.adminUid || id, "Auditoría");
  detail({
    Acción: item.action,
    Admin: item.adminEmail || item.createdByEmail || item.adminUid,
    Objetivo: `${item.targetCollection || ""}/${item.targetId || ""}`,
    Rol: item.targetRole,
    Motivo: item.reason || item.note,
    Fecha: date(item.createdAt),
  });
}

function detailGrid(obj) {
  return `<div class="config-list">${Object.entries(obj || {}).map(([key, value]) => `<div class="config-row"><span>${e(key)}</span><strong>${e(value === null || value === undefined || value === "" ? "—" : value)}</strong></div>`).join("")}</div>`;
}

function documentsPanel(...maps) {
  const merged = Object.assign({}, ...maps.filter(Boolean));

  const ordered = [
    ["Selfie", merged.selfieUrl],
    ["DUI frontal", merged.duiFrontUrl],
    ["DUI reverso", merged.duiBackUrl],
    ["Licencia frontal", merged.licenseFrontUrl],
    ["Licencia reverso", merged.licenseBackUrl],
    ["Tarjeta circulación", merged.circulationCardUrl],
    ["Vehículo frente", merged.vehicleFrontUrl],
    ["Vehículo atrás", merged.vehicleBackUrl],
    ["Vehículo izquierda", merged.vehicleLeftUrl],
    ["Vehículo derecha", merged.vehicleRightUrl],
    ["Logo", merged.logoUrl || merged.logoThumbnailUrl],
    ["Portada", merged.coverUrl || merged.coverImageUrl || merged.coverThumbnailUrl],
    ["Comprobante", merged.proofUrl || merged.receiptUrl || merged.depositProofUrl],
    ["Prueba entrega", merged.deliveryProofUrl],
    ["Prueba retiro", merged.pickupProofUrl],
  ];

  const known = new Set([
    "selfieUrl", "duiFrontUrl", "duiBackUrl", "licenseFrontUrl", "licenseBackUrl", "circulationCardUrl",
    "vehicleFrontUrl", "vehicleBackUrl", "vehicleLeftUrl", "vehicleRightUrl", "logoUrl", "logoThumbnailUrl",
    "coverUrl", "coverImageUrl", "coverThumbnailUrl", "proofUrl", "receiptUrl", "depositProofUrl", "deliveryProofUrl", "pickupProofUrl",
  ]);

  const extra = Object.entries(merged)
    .filter(([key, value]) => !known.has(key) && typeof value === "string" && value.startsWith("http"))
    .map(([key, value]) => [labelKey(key), value]);

  const items = [...ordered, ...extra].filter(([, url]) => typeof url === "string" && url.startsWith("http"));

  return items.length
    ? `<div class="documents-grid document-grid">${items.map(([label, url]) => documentCard(label, url)).join("")}</div>`
    : `<div class="empty-state compact">No hay documentos o imágenes cargadas.</div>`;
}

function documentCard(label, url) {
  return `
    <button class="document-thumb document-card" type="button" data-action="view-image" data-src="${ea(url)}" data-title="${ea(label)}">
      <img src="${ea(url)}" alt="${ea(label)}" loading="lazy" />
      <span>${e(label)}</span>
    </button>`;
}

function itemsPanel(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return `<div class="empty-state compact">No hay productos/items cargados.</div>`;
  }

  return `<div class="config-list">${items.map((item) => `
    <div class="config-row">
      <span>${item.imageUrl || item.thumbnailUrl ? `<button class="text-btn" type="button" data-action="view-image" data-src="${ea(item.imageUrl || item.thumbnailUrl)}" data-title="${ea(item.name || "Producto")}">Foto</button>` : "Producto"}</span>
      <strong>${e(item.name || item.productName || "Producto")} · x${e(item.quantity || 1)} · ${money(item.price || item.unitPrice || 0)}</strong>
    </div>`).join("")}</div>`;
}

function jsonPanel(value) {
  return `<pre class="json-block">${e(JSON.stringify(toPlain(value), null, 2))}</pre>`;
}

function historyPanel(collectionName, targetId) {
  const items = [...state.adminActions, ...state.auditLogs]
    .filter((x) => x.targetCollection === collectionName && x.targetId === targetId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

  return items.length
    ? `<div class="activity-feed">${items.map((item) => `<div class="review-card"><strong>${e(item.action || "Acción")}</strong><span>${e(item.adminEmail || item.createdByEmail || "admin")} · ${date(item.createdAt)}</span><span>${e(item.reason || "")}</span></div>`).join("")}</div>`
    : `<div class="empty-state compact">No hay historial administrativo para este registro.</div>`;
}

function walletTxPanel(driverId) {
  const txs = state.driverWalletTransactions
    .filter((tx) => tx.driverId === driverId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, 20);

  return txs.length
    ? `<h3>Últimos movimientos</h3><div class="activity-feed">${txs.map((tx) => `<div class="review-card"><strong>${tx.direction === "debit" ? "-" : "+"}${money(tx.amount || 0)} · ${e(tx.type || "movement")}</strong><span>${e(tx.description || "")}</span><small>${date(tx.createdAt)}</small></div>`).join("")}</div>`
    : `<div class="empty-state compact">Sin movimientos wallet.</div>`;
}

/* =========================================================
   DECISIONES ADMINISTRATIVAS
========================================================= */

function openReviewModal({ targetId, targetCollection, targetRole, decision = "" }) {
  if (!targetId || !targetRole) {
    showToast("No se recibió el perfil para revisar.", "error", "Revisión");
    return;
  }

  $("#reviewTargetId").value = targetId;
  $("#reviewTargetCollection").value = targetCollection || "";
  $("#reviewTargetRole").value = targetRole;
  $("#reviewDecisionType").value = decision || "";
  $("#reviewDecisionReason").value = "";
  setText("reviewDecisionTitle", targetRole === "driver" ? "Revisar conductor" : "Revisar comercio");
  openModal("reviewDecisionModal");
}

function openReviewFromDrawer(decision) {
  if (!state.activeDetail) return showToast("Selecciona primero un perfil.", "warning", "Sin perfil");
  if (!["driver", "commerce"].includes(state.activeDetail.role)) return showToast("Esta acción solo aplica a conductores o comercios.", "warning", "Acción no disponible");

  openReviewModal({
    targetId: state.activeDetail.id,
    targetCollection: state.activeDetail.collection,
    targetRole: state.activeDetail.role,
    decision,
  });
}

async function handleReviewDecisionSubmit() {
  const targetId = txt($("#reviewTargetId")?.value);
  const targetCollection = txt($("#reviewTargetCollection")?.value);
  const targetRole = txt($("#reviewTargetRole")?.value);
  const decision = txt($("#reviewDecisionType")?.value);
  const reason = txt($("#reviewDecisionReason")?.value);

  if (!targetId || !targetRole || !decision) {
    showToast("Selecciona una decisión válida.", "warning", "Decisión incompleta");
    return;
  }

  try {
    setFormLoading("reviewDecisionForm", true);
    if (targetRole === "driver" || targetCollection === COLLECTIONS.driverProfiles) {
      await applyDriverDecision(targetId, decision, reason);
    } else if (targetRole === "commerce" || targetCollection === COLLECTIONS.commerceProfiles) {
      await applyCommerceDecision(targetId, decision, reason);
    } else {
      throw new Error("Tipo de perfil no soportado.");
    }

    closeModal("reviewDecisionModal");
    await loadDashboardData();
    showToast("La decisión fue aplicada correctamente.", "success", "Decisión guardada");
  } catch (error) {
    console.error("[NIVO Dashboard] Error aplicando decisión:", error);
    showToast(error.message || "No se pudo aplicar la decisión.", "error", "Error");
  } finally {
    setFormLoading("reviewDecisionForm", false);
  }
}

async function applyDriverDecision(driverDocId, decision, reason) {
  const driver = state.indexes.driversById.get(driverDocId) || await fetchDocument(COLLECTIONS.driverProfiles, driverDocId);
  if (!driver) throw new Error("No se encontró el perfil del conductor.");

  const driverId = driver.driverId || driver.uid || driver.id;
  const vehicle = primaryVehicle(driver);
  const vehicleId = vehicle?.id || driver.primaryVehicleId || `${driverId}_primary_vehicle`;
  const enabled = normalizeServices(driver.enabledServices);

  const batch = writeBatch(state.db);
  const now = serverTimestamp();
  const adminUid = state.firebaseUser?.uid || state.adminContext?.uid || "dashboard";
  const adminEmail = state.firebaseUser?.email || state.adminContext?.email || "";

  const profileRef = doc(state.db, COLLECTIONS.driverProfiles, driver.id);
  const vehicleRef = doc(state.db, COLLECTIONS.driverVehicles, vehicleId);
  const walletRef = doc(state.db, COLLECTIONS.driverWallets, driverId);
  const txRef = doc(state.db, COLLECTIONS.driverWalletTransactions, `${driverId}_welcome_bonus`);

  if (decision === "approve") {
    batch.set(profileRef, {
      status: DRIVER_STATUS.approved,
      statusReason: "",
      approvedAt: now,
      approvedBy: adminUid,
      manualReviewRequired: false,
      registration: {
        profileCompleted: true,
        zoneSelected: true,
        vehicleSelected: true,
        servicesSelected: true,
        documentsCompleted: true,
        currentStep: "approved",
      },
      verification: {
        documentsCompleted: true,
        duplicateCheckStatus: "approved",
        selfieVerified: true,
        vehicleVerified: true,
        reviewedAt: now,
        reviewedBy: adminUid,
        adminNote: reason || "Aprobado desde dashboard NIVO",
      },
      policy: {
        canReceiveTasks: true,
        currentSanctionStatus: "none",
        manualReviewRequired: false,
        trustScore: Number(get(driver, "policy.trustScore", 100)) || 100,
      },
      availability: {
        isOnline: false,
        isAvailable: false,
        canReceiveRideOffers: enabled.ride,
        canReceiveDeliveryOffers: enabled.delivery,
        canReceivePackageOffers: enabled.package,
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
      status: DRIVER_STATUS.approved,
      isActive: true,
      isPrimary: true,
      approvedAt: now,
      approvedBy: adminUid,
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
        welcomeBalance: WELCOME_BALANCE,
        rechargedBalance: 0,
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
        grantedBy: adminUid,
        reason: "Saldo de bienvenida NIVO",
      },
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    batch.set(txRef, {
      transactionId: `${driverId}_welcome_bonus`,
      driverId,
      type: "welcome_bonus",
      direction: "credit",
      amount: WELCOME_BALANCE,
      currencyCode: DEFAULT_CURRENCY,
      description: "Saldo de bienvenida NIVO",
      source: "dashboard_admin",
      status: "confirmed",
      createdAt: now,
      createdBy: adminUid,
      createdByEmail: adminEmail,
    }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Cuenta aprobada",
      body: "Tu cuenta NIVO Driver fue aprobada. Ya puedes operar cuando estés disponible.",
      type: "account",
    });
  }

  if (decision === "correction_required") {
    batch.set(profileRef, {
      status: DRIVER_STATUS.correctionRequired,
      statusReason: reason || "NIVO necesita que corrijas información o documentos.",
      manualReviewRequired: true,
      verification: {
        duplicateCheckStatus: "correction_required",
        reviewReason: reason,
        adminNote: reason,
        reviewedAt: now,
        reviewedBy: adminUid,
      },
      policy: { canReceiveTasks: false, manualReviewRequired: true },
      availability: { isOnline: false, isAvailable: false, canReceiveRideOffers: false, canReceiveDeliveryOffers: false, canReceivePackageOffers: false },
      updatedAt: now,
    }, { merge: true });

    batch.set(vehicleRef, { status: DRIVER_STATUS.correctionRequired, isActive: false, rejectionReason: reason, updatedAt: now }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Corrección requerida",
      body: reason || "NIVO necesita que revises tus documentos o datos del vehículo.",
      type: "documents",
    });
  }

  if (decision === "reject") {
    batch.set(profileRef, {
      status: DRIVER_STATUS.rejected,
      statusReason: reason || "Tu solicitud fue rechazada por NIVO.",
      rejectedAt: now,
      rejectedBy: adminUid,
      verification: {
        duplicateCheckStatus: "rejected",
        rejectionReason: reason,
        adminNote: reason,
        reviewedAt: now,
        reviewedBy: adminUid,
      },
      policy: { canReceiveTasks: false },
      availability: { isOnline: false, isAvailable: false, canReceiveRideOffers: false, canReceiveDeliveryOffers: false, canReceivePackageOffers: false },
      updatedAt: now,
    }, { merge: true });

    batch.set(vehicleRef, { status: DRIVER_STATUS.rejected, isActive: false, rejectedAt: now, rejectedBy: adminUid, rejectionReason: reason, updatedAt: now }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Solicitud rechazada",
      body: reason || "Tu solicitud de conductor fue rechazada por NIVO.",
      type: "account",
    });
  }

  if (decision === "block") {
    batch.set(profileRef, {
      status: DRIVER_STATUS.blocked,
      statusReason: reason || "Tu cuenta fue bloqueada por administración NIVO.",
      blockedAt: now,
      blockedBy: adminUid,
      policy: { canReceiveTasks: false, currentSanctionStatus: "blocked", manualReviewRequired: true },
      availability: { isOnline: false, isAvailable: false, canReceiveRideOffers: false, canReceiveDeliveryOffers: false, canReceivePackageOffers: false },
      wallet: { canReceiveCommissionedTasks: false },
      updatedAt: now,
    }, { merge: true });

    batch.set(vehicleRef, { status: DRIVER_STATUS.blocked, isActive: false, updatedAt: now }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: driverId,
      recipientRole: "driver",
      title: "Cuenta bloqueada",
      body: reason || "Tu cuenta NIVO Driver fue bloqueada. Contacta a soporte.",
      type: "warning",
    });
  }

  addAdminActionToBatch(batch, {
    action: `driver_${decision}`,
    targetCollection: COLLECTIONS.driverProfiles,
    targetId: driver.id,
    targetRole: "driver",
    reason,
    before: auditSnapshot(driver),
    after: { decision },
  });

  await batch.commit();
}

async function applyCommerceDecision(commerceDocId, decision, reason) {
  const commerce = state.indexes.commerceById.get(commerceDocId) || await fetchDocument(COLLECTIONS.commerceProfiles, commerceDocId);
  if (!commerce) throw new Error("No se encontró el perfil del comercio.");

  const owner = commerceOwner(commerce);
  const ownerUid = commerce.ownerUid || commerce.uid || owner?.uid;
  if (!ownerUid) throw new Error("El comercio no tiene ownerUid para actualizar commerce_users.");

  const commerceId = commerce.commerceId || commerce.id;
  const batch = writeBatch(state.db);
  const now = serverTimestamp();
  const adminUid = state.firebaseUser?.uid || state.adminContext?.uid || "dashboard";

  const profileRef = doc(state.db, COLLECTIONS.commerceProfiles, commerce.id);
  const ownerRef = doc(state.db, COLLECTIONS.commerceUsers, ownerUid);

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
      status: "active",
      verification: {
        status: "approved",
        reviewedAt: now,
        reviewedBy: adminUid,
        adminNote: reason || "Aprobado desde dashboard NIVO",
      },
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, {
      uid: ownerUid,
      commerceId,
      status: COMMERCE_USER_STATUS.active,
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
    });
  }

  if (decision === "correction_required") {
    batch.set(profileRef, {
      active: false,
      verified: false,
      canReceiveDeliveryOrders: false,
      status: "correction_required",
      verification: { status: "correction_required", reviewReason: reason, adminNote: reason, reviewedAt: now, reviewedBy: adminUid },
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, { status: COMMERCE_USER_STATUS.pendingVerification, updatedAt: now }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: ownerUid,
      recipientRole: "commerce",
      title: "Corrección requerida",
      body: reason || "NIVO necesita que revises la información de tu comercio.",
      type: "account",
    });
  }

  if (decision === "reject") {
    batch.set(profileRef, {
      active: false,
      verified: false,
      canReceiveDeliveryOrders: false,
      status: "rejected",
      verification: { status: "rejected", rejectionReason: reason, adminNote: reason, reviewedAt: now, reviewedBy: adminUid },
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, { status: COMMERCE_USER_STATUS.suspended, updatedAt: now }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: ownerUid,
      recipientRole: "commerce",
      title: "Solicitud rechazada",
      body: reason || "Tu solicitud de comercio fue rechazada por NIVO.",
      type: "account",
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
      verification: { status: "blocked", adminNote: reason, reviewedAt: now, reviewedBy: adminUid },
      updatedAt: now,
    }, { merge: true });

    batch.set(ownerRef, { status: COMMERCE_USER_STATUS.suspended, updatedAt: now }, { merge: true });

    addNotificationToBatch(batch, {
      recipientId: ownerUid,
      recipientRole: "commerce",
      title: "Comercio bloqueado",
      body: reason || "Tu comercio fue bloqueado por administración NIVO.",
      type: "warning",
    });
  }

  addAdminActionToBatch(batch, {
    action: `commerce_${decision}`,
    targetCollection: COLLECTIONS.commerceProfiles,
    targetId: commerce.id,
    targetRole: "commerce",
    reason,
    before: auditSnapshot(commerce),
    after: { decision },
  });

  await batch.commit();
}

/* =========================================================
   ADMIN / ZONAS / NOTIFICACIONES
========================================================= */

function openMakeAdminModal(userId) {
  const user = state.indexes.usersById.get(userId);
  if (!user) return showToast("No se encontró el usuario seleccionado.", "error");

  $("#makeAdminUid").value = user.id;
  $("#makeAdminEmail").value = user.email || "";
  $("#makeAdminDisplayName").value = user.fullName || user.email || user.id;
  $("#makeAdminRole").value = "admin";
  $$('input[name="permissions"]').forEach((c) => { c.checked = false; });
  applyDefaultPermissionsForAdminRole("admin");
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
  $$('input[name="permissions"]').forEach((input) => { input.checked = permissions.has(input.value); });
}

async function handleMakeAdminSubmit() {
  const uid = txt($("#makeAdminUid")?.value);
  const email = txt($("#makeAdminEmail")?.value);
  const displayName = txt($("#makeAdminDisplayName")?.value);
  const role = txt($("#makeAdminRole")?.value);

  if (!uid || !role) return showToast("Selecciona usuario y rol administrativo.", "warning", "Admin incompleto");

  const permissions = {};
  $$('input[name="permissions"]').forEach((input) => { permissions[input.value] = input.checked; });

  try {
    setFormLoading("makeAdminForm", true);
    const batch = writeBatch(state.db);

    batch.set(doc(state.db, COLLECTIONS.adminProfiles, uid), {
      uid,
      email,
      displayName,
      role,
      status: "active",
      permissions,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: state.firebaseUser?.uid || "dashboard",
      createdByEmail: state.firebaseUser?.email || "",
      lastLoginAt: null,
    }, { merge: true });

    addAdminActionToBatch(batch, {
      action: "make_admin",
      targetCollection: COLLECTIONS.adminProfiles,
      targetId: uid,
      targetRole: "admin",
      reason: `Rol asignado: ${role}`,
      after: { role, permissions },
    });

    await batch.commit();
    closeModal("makeAdminModal");
    await loadDashboardData();
    showToast("Admin creado o actualizado correctamente.", "success", "Admin guardado");
  } catch (error) {
    showToast(error.message || "No se pudo crear el admin.", "error", "Error");
  } finally {
    setFormLoading("makeAdminForm", false);
  }
}

function confirmUserStatusChange(uid, status) {
  const user = state.indexes.usersById.get(uid);
  if (!user) return showToast("No se encontró el usuario.", "error");

  openConfirmModal({
    title: status === "active" ? "Reactivar usuario" : "Bloquear usuario",
    message: `¿Confirmas cambiar el estado de ${user.fullName || user.email || uid} a ${STATUS_LABELS[status] || status}?`,
    onConfirm: async () => {
      const batch = writeBatch(state.db);
      batch.set(doc(state.db, COLLECTIONS.users, uid), { status, updatedAt: serverTimestamp() }, { merge: true });
      addAdminActionToBatch(batch, { action: `user_${status}`, targetCollection: COLLECTIONS.users, targetId: uid, targetRole: user.role || "user", reason: `Cambio de estado a ${status}`, before: auditSnapshot(user), after: { status } });
      await batch.commit();
      await loadDashboardData();
      showToast("Estado actualizado.", "success", "Usuario");
    },
  });
}

function openZoneModal(zoneId = "") {
  const zone = zoneId ? state.indexes.zonesById.get(zoneId) : null;

  $("#zoneId").value = zone?.id || "";
  $("#zoneCountry").value = zone?.country || DEFAULT_COUNTRY;
  $("#zoneDepartment").value = zone?.department || "";
  $("#zoneMunicipality").value = zone?.municipality || "";
  $("#zoneDisplayName").value = zone?.displayName || "";

  const services = normalizeServices(zone?.enabledServices);
  const transports = normalizeEnabledRideTypes(zone?.enabledRideTypes || fareTransportEnabled(zone?.id || ""));

  $("#zoneServiceRide").checked = services.ride;
  $("#zoneServiceDelivery").checked = services.delivery;
  $("#zoneServicePackage").checked = services.package;
  $("#zoneServiceSchool").checked = services.school;

  $("#zoneTransportCar").checked = transports.car;
  $("#zoneTransportMotorcycle").checked = transports.motorcycle;
  $("#zoneTransportMototaxi").checked = transports.mototaxi;
  $("#zoneTransportQute").checked = transports.qute;

  $("#zoneActive").checked = zone?.active !== false;
  setText("zoneModalTitle", zone ? "Editar zona" : "Crear zona");
  openModal("zoneModal");
}

async function handleZoneSubmit() {
  const currentId = txt($("#zoneId")?.value);
  const country = txt($("#zoneCountry")?.value || DEFAULT_COUNTRY).toUpperCase();
  const department = txt($("#zoneDepartment")?.value);
  const municipality = txt($("#zoneMunicipality")?.value);
  const displayName = txt($("#zoneDisplayName")?.value);

  if (!country || !department || !municipality || !displayName) {
    return showToast("Completa país, departamento, municipio y nombre visible.", "warning", "Zona incompleta");
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
  const active = $("#zoneActive")?.checked === true;

  try {
    setFormLoading("zoneForm", true);
    const batch = writeBatch(state.db);

    const zoneData = {
      id: zoneId,
      serviceZoneId: zoneId,
      country,
      department,
      municipality,
      displayName,
      active,
      enabledServices,
      enabledRideTypes,
      updatedAt: serverTimestamp(),
    };
    if (!currentId) zoneData.createdAt = serverTimestamp();

    const fareData = {
      id: zoneId,
      serviceZoneId: zoneId,
      country,
      department,
      municipality,
      currencyCode: DEFAULT_CURRENCY,
      active,
      version: 1,
      platformCommissionRate: 0,
      transportConfigs: defaultTransportConfigs(enabledRideTypes),
      delivery: {
        enabled: enabledServices.delivery,
        pricingMode: "city_fixed_driver_quote_outside",
        cityFixedFee: 1.5,
        cityFixedMaxDistanceKm: 4,
        outsideCityMinSuggestedFee: 2,
        outsideCityRequiresDriverQuote: true,
      },
      commissions: {
        ride: defaultCommission("ride_fare"),
        delivery: defaultCommission("delivery_fee"),
        package: defaultCommission("package_fee"),
      },
      updatedAt: serverTimestamp(),
    };
    if (!currentId) fareData.createdAt = serverTimestamp();

    batch.set(doc(state.db, COLLECTIONS.serviceZones, zoneId), zoneData, { merge: true });
    batch.set(doc(state.db, COLLECTIONS.fareConfigs, zoneId), fareData, { merge: true });
    addAdminActionToBatch(batch, { action: currentId ? "update_zone" : "create_zone", targetCollection: COLLECTIONS.serviceZones, targetId: zoneId, targetRole: "zone", reason: displayName, after: { enabledServices, enabledRideTypes, active } });

    await batch.commit();
    closeModal("zoneModal");
    await loadDashboardData();
    showToast("Zona y fare_config guardados correctamente.", "success", "Zona guardada");
  } catch (error) {
    showToast(error.message || "No se pudo guardar la zona.", "error", "Error");
  } finally {
    setFormLoading("zoneForm", false);
  }
}

function openRideTypeModal(id = "") {
  const type = id ? state.indexes.rideTypesById.get(id) : null;
  $("#rideTypeId").value = type?.transportId || "";
  $("#rideTypeTitle").value = type?.transportTitle || "";
  $("#rideTypeDescription").value = type?.description || "";
  $("#rideTypeMaxPassengers").value = type?.maxPassengers || 1;
  $("#rideTypeSortOrder").value = type?.sortOrder || 0;
  $("#rideTypeActiveGlobally").checked = type?.active !== false;
  $("#rideTypeChargesPerPassenger").checked = type?.chargesPerPassenger === true;
  $("#rideTypeRequiresPassengerSelection").checked = type?.requiresPassengerSelection === true;
  setText("rideTypeModalTitle", type ? "Ver categoría" : "Categorías derivadas de fare_configs");
  openModal("rideTypeModal");
}

function handleRideTypeSubmit() {
  showToast("Las categorías de transporte se administran por zona desde fare_configs. Esta pantalla queda como vista derivada para evitar duplicar datos.", "info", "Sin cambios");
  closeModal("rideTypeModal");
}

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
  openNotificationModal();
  if (!detail) return;
  $("#notificationTargetType").value = "single_uid";
  $("#notificationTargetValue").value = notificationRecipientId(detail) || detail.id;
  $("#notificationTitle").value = "Mensaje de NIVO";
}

async function handleNotificationSubmit() {
  const targetType = txt($("#notificationTargetType")?.value);
  const targetValue = txt($("#notificationTargetValue")?.value);
  const title = txt($("#notificationTitle")?.value);
  const body = txt($("#notificationBody")?.value);
  const type = txt($("#notificationType")?.value || "info");

  if (!targetType || !title || !body) return showToast("Completa destino, título y mensaje.", "warning", "Datos requeridos");

  try {
    setFormLoading("notificationForm", true);
    const recipients = notificationRecipients(targetType, targetValue);
    if (!recipients.length) throw new Error("No se encontraron destinatarios.");

    const batch = writeBatch(state.db);
    recipients.slice(0, 450).forEach((recipient) => addNotificationToBatch(batch, {
      recipientId: recipient.id,
      recipientRole: recipient.role,
      title,
      body,
      type,
      category: type,
      priority: type === "warning" ? "high" : "normal",
    }));

    addAdminActionToBatch(batch, {
      action: "notification_created",
      targetCollection: COLLECTIONS.notifications,
      targetId: targetValue || targetType,
      targetRole: "mixed",
      reason: `Notificación a ${recipients.length} destinatario(s)`,
      after: { targetType, targetValue, title, type, recipients: recipients.length },
    });

    await batch.commit();
    closeModal("notificationModal");
    await loadDashboardData();
    showToast(`Notificación creada para ${recipients.length} destinatario(s).`, "success", "Notificación creada");
  } catch (error) {
    showToast(error.message || "No se pudo crear la notificación.", "error", "Error");
  } finally {
    setFormLoading("notificationForm", false);
  }
}

function addAdminActionToBatch(batch, payload) {
  const actionId = `${payload.action || "admin_action"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  batch.set(doc(state.db, COLLECTIONS.adminActions, actionId), {
    actionId,
    action: payload.action || "admin_action",
    adminUid: state.firebaseUser?.uid || state.adminContext?.uid || null,
    adminEmail: state.firebaseUser?.email || state.adminContext?.email || null,
    targetCollection: payload.targetCollection || "",
    targetId: payload.targetId || "",
    targetRole: payload.targetRole || "",
    reason: payload.reason || "",
    before: payload.before || null,
    after: payload.after || null,
    source: "nivo_dashboard_web",
    createdAt: serverTimestamp(),
  });
}

function addNotificationToBatch(batch, payload) {
  const recipientId = payload.recipientId || payload.uid || payload.userId || payload.driverId;
  if (!recipientId) return;

  const role = payload.recipientRole || payload.targetRole || "user";
  const notificationId = `notif_${role}_${recipientId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  batch.set(doc(state.db, COLLECTIONS.notifications, notificationId), {
    notificationId,
    recipientId,
    recipientRole: role,
    uid: recipientId,
    userId: role === "user" ? recipientId : (payload.userId || ""),
    driverId: role === "driver" ? recipientId : (payload.driverId || ""),
    commerceId: role === "commerce" ? (payload.commerceId || "") : (payload.commerceId || ""),
    agentId: role === "agent" ? recipientId : (payload.agentId || ""),
    title: payload.title || "NIVO",
    body: payload.body || payload.message || "",
    message: payload.body || payload.message || "",
    type: payload.type || "info",
    category: payload.category || payload.type || "general",
    notificationCategory: payload.category || payload.type || "general",
    priority: payload.priority || "normal",
    severity: payload.priority || "normal",
    status: payload.status || "unread",
    read: false,
    actionRoute: payload.actionRoute || "",
    actionLabel: payload.actionLabel || "",
    actionArguments: payload.actionArguments || {},
    metadata: payload.metadata || {},
    source: "nivo_dashboard_web",
    createdBy: state.firebaseUser?.uid || "dashboard",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    readAt: null,
    expiresAt: null,
  });
}

function openSanctionCreateNotice() {
  showToast("La creación directa de sanciones queda preparada. Por ahora puedes bloquear desde el drawer de conductor para invalidar operación.", "info", "Sanciones");
}

/* =========================================================
   MODALES / IMAGE VIEWER / UI SHELL
========================================================= */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("is-open", "open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");
  const focusable = modal.querySelector("input, select, textarea, button");
  if (focusable) window.setTimeout(() => focusable.focus(), 50);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("is-open", "open");
  modal.setAttribute("aria-hidden", "true");
  releaseBodyLockIfClean();
}

function closeAllModals() {
  $$(".modal.is-open, .modal.open").forEach((modal) => {
    modal.classList.remove("is-open", "open");
    modal.setAttribute("aria-hidden", "true");
  });
  releaseBodyLockIfClean();
}

function openConfirmModal({ title, message, onConfirm }) {
  setText("confirmModalTitle", title || "Confirmar acción");
  setText("confirmModalMessage", message || "¿Confirmas que deseas realizar esta acción?");
  state.pendingConfirm = onConfirm;

  const button = $("#confirmModalAcceptBtn");
  if (button) {
    button.onclick = async () => {
      if (typeof state.pendingConfirm !== "function") return;
      try {
        button.disabled = true;
        await state.pendingConfirm();
        closeConfirmModal();
      } catch (error) {
        showToast(error.message || "No se pudo completar la acción.", "error", "Error");
      } finally {
        button.disabled = false;
      }
    };
  }

  openModal("confirmModal");
}

function closeConfirmModal() {
  state.pendingConfirm = null;
  closeModal("confirmModal");
}

function openImageViewer(src, title = "Documento") {
  if (!src) return showToast("No hay imagen disponible.", "warning", "Sin imagen");

  setText("imageViewerTitle", title);
  const img = $("#imageViewerImg");
  if (img) {
    img.src = src;
    img.alt = title;
  }

  const modal = $("#imageViewerModal");
  if (modal) {
    modal.classList.add("is-open", "open");
    modal.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("is-locked");
}

function closeImageViewer() {
  const modal = $("#imageViewerModal");
  if (modal) {
    modal.classList.remove("is-open", "open");
    modal.setAttribute("aria-hidden", "true");
  }

  const img = $("#imageViewerImg");
  if (img) img.src = "";

  releaseBodyLockIfClean();
}

function releaseBodyLockIfClean() {
  const hasModal = Boolean($(".modal.is-open, .modal.open"));
  const drawer = $("#detailDrawer");
  const viewer = $("#imageViewerModal");
  const hasDrawer = Boolean(drawer && (drawer.classList.contains("is-open") || drawer.classList.contains("open")));
  const hasViewer = Boolean(viewer && (viewer.classList.contains("is-open") || viewer.classList.contains("open")));

  if (!hasModal && !hasDrawer && !hasViewer && !document.body.classList.contains("sidebar-open")) {
    document.body.classList.remove("is-locked");
  }
}

function showSection(sectionName) {
  if (!sectionName) return;
  state.currentSection = sectionName;

  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.sectionTarget === sectionName));
  $$(".dashboard-section").forEach((section) => {
    const active = section.dataset.section === sectionName;
    section.classList.toggle("active", active);
    section.hidden = !active;
  });

  const [title, breadcrumb] = SECTION_META[sectionName] || SECTION_META.overview;
  setText("dashboardPageTitle", title);
  setText("dashboardBreadcrumb", breadcrumb);

  document.body.classList.remove("sidebar-open");
  releaseBodyLockIfClean();
  renderCurrentSection();
  $("#dashboardMain")?.focus({ preventScroll: true });
}

function setDriverQuickFilter(filter) {
  state.currentDriverQuickFilter = filter || "all";
  $$('[data-driver-filter]').forEach((button) => button.classList.toggle("active", button.dataset.driverFilter === state.currentDriverQuickFilter));
  renderDriversTable();
}

function showDashboardShell() {
  $("#dashboardAuthGate")?.setAttribute("hidden", "");
  $("#dashboardAccessDenied")?.setAttribute("hidden", "");
  $("#dashboardShell")?.removeAttribute("hidden");
}

function showAccessDenied(message) {
  $("#dashboardAuthGate")?.setAttribute("hidden", "");
  $("#dashboardShell")?.setAttribute("hidden", "");
  $("#dashboardAccessDenied")?.removeAttribute("hidden");
  const paragraph = $("#dashboardAccessDenied p:not(.eyebrow)");
  if (paragraph && message) paragraph.textContent = message;
}

function setAdminUi(context) {
  setText("sidebarAdminName", context.displayName || context.fullName || context.email || "Admin NIVO");
  setText("sidebarAdminEmail", context.email || "Sin correo");
  setText("sidebarAdminRole", ROLE_LABELS[context.adminRole] || context.adminRole || "admin");
}

function setDashboardLoading(isLoading) {
  $("#dashboardMain")?.setAttribute("aria-busy", isLoading ? "true" : "false");
  $("#refreshDashboardBtn")?.toggleAttribute("disabled", isLoading);
}

function setFormLoading(formId, isLoading) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.querySelectorAll("button, input, select, textarea").forEach((element) => {
    if (element.type !== "hidden") element.disabled = isLoading;
  });
}

function showToast(message, type = "info", title = "NIVO Dashboard") {
  const region = $("#toastRegion");
  if (!region) {
    console.log(`[${title}] ${message}`);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<strong>${e(title)}</strong><span>${e(message)}</span>`;
  region.appendChild(toast);

  window.setTimeout(() => toast.classList.add("is-visible", "show"), 10);
  window.setTimeout(() => {
    toast.classList.remove("is-visible", "show");
    window.setTimeout(() => toast.remove(), 250);
  }, 4600);
}

/* =========================================================
   HELPERS DE DATOS / UI
========================================================= */

function populateZoneFilters() {
  const options = [...state.serviceZones]
    .sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)))
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
  return driver?.status === DRIVER_STATUS.approved || driver?.status === "active";
}

function commerceOwner(commerce) {
  const uid = commerce?.ownerUid || commerce?.uid || commerce?.ownerId;
  return state.indexes.commerceUsersById.get(uid) || state.indexes.commerceUsersByCommerceId.get(commerce?.commerceId || commerce?.id) || null;
}

function isCommerceActive(commerce) {
  const owner = commerceOwner(commerce);
  return commerce?.active === true && commerce?.verified === true && owner?.status === COMMERCE_USER_STATUS.active;
}

function isCommerceVisible(commerce) {
  return commerce?.active === true && commerce?.verified === true && commerce?.deliveryEnabled === true;
}

function isCommercePending(commerce) {
  const owner = commerceOwner(commerce);
  if (owner && [COMMERCE_USER_STATUS.pendingProfile, COMMERCE_USER_STATUS.pendingVerification].includes(owner.status)) return true;
  if (commerce?.active !== true || commerce?.verified !== true) return true;
  return ["pending_profile", "pending_review", "pending_verification", "correction_required"].includes(commerceStatus(commerce));
}

function commerceStatus(commerce) {
  const owner = commerceOwner(commerce);
  if (owner?.status === COMMERCE_USER_STATUS.suspended) return "suspended";
  if (owner?.status === COMMERCE_USER_STATUS.active && commerce.active === true && commerce.verified === true) return "active";
  return commerce.status || owner?.status || (commerce.active !== true || commerce.verified !== true ? "pending_verification" : "active");
}

function normalizeCommerceFilter(status) {
  if (status === "pending_review") return "pending_verification";
  if (status === "blocked") return "suspended";
  return status;
}

function driverWallet(driverId) {
  return state.indexes.driverWalletsById.get(driverId) || null;
}

function primaryVehicle(driver) {
  const driverId = driver.driverId || driver.uid || driver.id;
  const list = state.indexes.driverVehiclesByDriverId.get(driverId) || [];
  return list.find((vehicle) => vehicle.isPrimary === true) || state.indexes.driverVehiclesById.get(driver.primaryVehicleId || "") || list[0] || null;
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
  return count <= 0 && rating <= 0 ? "Nuevo" : `${rating.toFixed(1)} (${count})`;
}

function normalizeServices(value = {}) {
  return {
    ride: get(value, "ride", false) === true,
    delivery: get(value, "delivery", false) === true,
    package: get(value, "package", false) === true,
    school: get(value, "school", false) === true,
  };
}

function normalizeEnabledRideTypes(value = {}) {
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
    acc[id] = { ...config, transportId: id };
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
    car: { active: enabled.car, transportId: "car", transportTitle: "Vehículo", baseFare: 1, minimumFare: 1.5, pricePerKm: 0.55, pricePerMinute: 0.07, maxPassengers: 4, chargesPerPassenger: false, requiresPassengerSelection: false, zoneFixedFares: {} },
    motorcycle: { active: enabled.motorcycle, transportId: "motorcycle", transportTitle: "Moto", baseFare: 0.75, minimumFare: 1, pricePerKm: 0.4, pricePerMinute: 0.05, maxPassengers: 1, chargesPerPassenger: false, requiresPassengerSelection: false, zoneFixedFares: {} },
    mototaxi: { active: enabled.mototaxi, transportId: "mototaxi", transportTitle: "Mototaxi", baseFare: 0.5, minimumFare: 0.5, pricePerKm: 0.35, pricePerMinute: 0.03, maxPassengers: 3, chargesPerPassenger: true, requiresPassengerSelection: true, zoneFixedFareIsPerPassenger: true, zoneFixedFares: { 1: 0.5, 2: 1, 3: 1.5, 4: 2 } },
    qute: { active: enabled.qute, transportId: "qute", transportTitle: "Qute", baseFare: 0.5, minimumFare: 0.5, pricePerKm: 0.35, pricePerMinute: 0.03, maxPassengers: 3, chargesPerPassenger: true, requiresPassengerSelection: true, zoneFixedFareIsPerPassenger: true, zoneFixedFares: { 1: 0.5, 2: 1, 3: 1.5, 4: 2 } },
  };
}

function defaultCommission(appliesTo) {
  return { enabled: true, rate: 0.08, ratePercent: 8, label: "Comisión NIVO 8%", chargedTo: "driver_wallet", walletDebitEnabled: true, blockIfInsufficientBalance: true, minimumDriverWalletBalance: MINIMUM_DRIVER_BALANCE, appliesTo };
}

function notificationRecipients(type, value) {
  if (type === "all_users") return state.users.map((u) => ({ id: u.id, role: u.role || "user" }));
  if (type === "users_by_zone") return state.users.filter((u) => userZone(u) === value).map((u) => ({ id: u.id, role: u.role || "user" }));
  if (type === "drivers_by_zone") return state.drivers.filter((d) => d.serviceZoneId === value).map((d) => ({ id: d.uid || d.driverId || d.id, role: "driver" }));
  if (type === "commerce_by_zone") return state.commerce.filter((c) => commerceZone(c) === value).map((c) => ({ id: c.ownerUid || c.uid || commerceOwner(c)?.uid || c.id, role: "commerce" }));
  if (type === "agents_by_zone") return state.agents.filter((a) => a.serviceZoneId === value).map((a) => ({ id: a.uid || a.agentId || a.id, role: "agent" }));
  if (type === "single_uid") return value ? [{ id: value, role: inferRole(value) }] : [];
  return [];
}

function inferRole(uid) {
  if (state.indexes.driversById.has(uid)) return "driver";
  if (state.indexes.commerceUsersById.has(uid)) return "commerce";
  if (state.indexes.agentsById.has(uid)) return "agent";
  return state.indexes.usersById.get(uid)?.role || "user";
}

function notificationRecipientId(detail) {
  if (!detail) return "";
  if (detail.role === "driver") return detail.data.uid || detail.data.driverId || detail.id;
  if (detail.role === "commerce") return detail.data.ownerUid || detail.data.uid || commerceOwner(detail.data)?.uid || detail.id;
  if (detail.role === "agent") return detail.data.uid || detail.data.agentId || detail.id;
  return detail.data.uid || detail.id;
}

function servicesText(value = {}) {
  const services = normalizeServices(value);
  const list = Object.entries(services).filter(([, enabled]) => enabled).map(([key]) => SERVICE_LABELS[key] || key);
  return list.length ? list.join(", ") : "Sin servicios";
}

function transportText(value = {}) {
  const types = normalizeEnabledRideTypes(value);
  const list = Object.entries(types).filter(([, enabled]) => enabled).map(([key]) => vehicleLabel(key));
  return list.length ? list.join(", ") : "Sin transportes";
}

function servicesBadges(value = {}) {
  const services = normalizeServices(value);
  const html = Object.entries(services).filter(([, enabled]) => enabled).map(([key]) => badge(SERVICE_LABELS[key] || key)).join("");
  return html || badge("Sin servicios", "status-badge warning");
}

function transportBadges(value = {}) {
  const types = normalizeEnabledRideTypes(value);
  const html = Object.entries(types).filter(([, enabled]) => enabled).map(([key]) => badge(vehicleLabel(key))).join("");
  return html || badge("Sin transportes", "status-badge warning");
}

function profileCell(name, subtitle, imageUrl = "") {
  const image = txt(imageUrl);
  const initials = txt(name || subtitle || "N").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "N";
  return `<div class="profile-cell"><span class="profile-avatar">${image ? `<img src="${ea(image)}" alt="" loading="lazy" />` : e(initials)}</span><span><strong>${e(name || "NIVO")}</strong><small>${e(subtitle || "")}</small></span></div>`;
}

function badge(text, className = "status-badge neutral") {
  return `<span class="${ea(className)}">${e(text || "—")}</span>`;
}

function statusBadge(status = "pending") {
  const clean = txt(status) || "pending";
  let className = "status-badge neutral";
  if (["active", "approved", "delivered", "confirmed", "read", "open"].includes(clean)) className = "status-badge active";
  if (["pending", "pending_review", "pending_documents", "pending_verification", "correction_required", "ready_for_pickup", "pending_driver", "searching_driver", "preparing", "unread"].includes(clean)) className = "status-badge warning";
  if (["blocked", "rejected", "suspended", "cancelled", "fraud_suspected"].includes(clean)) className = "status-badge danger";
  return badge(STATUS_LABELS[clean] || clean, className);
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}"><div class="empty-state compact">${e(message)}</div></td></tr>`;
}

function countLabel(items) {
  return `${items.length} registro${items.length === 1 ? "" : "s"}`;
}

function get(source, path, fallback = undefined) {
  if (!source || !path) return fallback;
  let current = source;
  for (const key of String(path).split(".")) {
    if (current === null || current === undefined || typeof current !== "object" || !(key in current)) return fallback;
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
  return keys.map((key) => String(get(item, key, "") || "").toLowerCase()).join(" ");
}

function countTruthy(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).filter(Boolean).length;
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + (Number(get(item, key, 0)) || 0), 0);
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
  return new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" }).format(dateValue);
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
  if (municipality && department) return `${municipality}, ${department}`;
  return zoneId || "Sin zona";
}

function planLabel(plan) {
  return { basic: "Básico", premium: "Premium", none: "Sin plan", free: "Gratis" }[plan] || plan || "Gratis";
}

function labelKey(key) {
  return String(key || "")
    .replace(/Url$/i, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function cleanDoc(value) {
  if (!value || typeof value !== "object") return value || {};
  const copy = { ...value };
  delete copy.ref;
  return copy;
}

function auditSnapshot(value) {
  return cleanDoc(value || {});
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (item && typeof item.toDate === "function") return item.toDate().toISOString();
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

function removeAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(value) {
  return removeAccents(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildZoneId(country, department, municipality) {
  return `${slugify(country || DEFAULT_COUNTRY)}-${slugify(department)}-${slugify(municipality)}`;
}

function debounce(fn, delay = 120) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

function sleep(msValue) {
  return new Promise((resolve) => setTimeout(resolve, msValue));
}

async function logout() {
  if (state.authCore?.logout) return state.authCore.logout();
  window.location.assign("login.html");
}
