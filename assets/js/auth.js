/* =========================================================
   NIVO AUTH
   Archivo: assets/js/auth.js

   Función:
   - Conectar login.html y register.html con Firebase Auth.
   - Crear perfil base en Firestore.
   - Crear perfil inicial para driver/agent cuando aplique.
   - Resolver redirección por rol.
   - Bloquear registro público de cuentas admin.

   Importante:
   - Esta web usa módulos ES directamente desde CDN de Firebase.
   - No usar import { initializeApp } from "firebase/app";
     porque eso es para proyectos con bundler como Vite/Webpack.
========================================================= */

import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAnalytics,
  isSupported as isAnalyticsSupported,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================================
   FIREBASE CONFIG — NIVO
========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCsLFLAjODC9OXu1H0Zwg7o7gZqEKDKJ7E",
  authDomain: "nivu-572b0.firebaseapp.com",
  projectId: "nivu-572b0",
  storageBucket: "nivu-572b0.firebasestorage.app",
  messagingSenderId: "682562078333",
  appId: "1:682562078333:web:7566c88bd0437c5209d314",
  measurementId: "G-VK3V35RKFS",
};

/* =========================================================
   CONSTANTES
========================================================= */

const COLLECTIONS = Object.freeze({
  users: "users",
  adminProfiles: "admin_profiles",
  driverProfiles: "driver_profiles",
  agentProfiles: "agent_profiles",
});

const PUBLIC_ROLES = Object.freeze({
  user: "user",
  driver: "driver",
  commerce: "commerce",
  agent: "agent",
});

const ROLE_ROUTES = Object.freeze({
  admin: "dashboard.html",
  user: "index.html#usuarios",
  driver: "index.html#conductores",
  commerce: "index.html#comercios",
  agent: "index.html#agentes",
});

const BLOCKED_STATUSES = new Set([
  "blocked",
  "rejected",
  "fraud_suspected",
  "suspended",
  "disabled",
  "account_restricted",
]);

let firebaseApp = null;
let analytics = null;
let auth = null;
let db = null;
let authInitialized = false;

/* =========================================================
   INICIALIZACIÓN FIREBASE
========================================================= */

function initializeFirebaseServices() {
  if (!firebaseApp) {
    firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  }

  if (!auth) {
    auth = getAuth(firebaseApp);
  }

  if (!db) {
    db = getFirestore(firebaseApp);
  }

  if (!analytics && typeof window !== "undefined") {
    isAnalyticsSupported()
      .then((supported) => {
        if (supported) {
          analytics = getAnalytics(firebaseApp);
        }
      })
      .catch(() => {
        analytics = null;
      });
  }

  authInitialized = true;

  return {
    app: firebaseApp,
    analytics,
    auth,
    db,
  };
}

function getServices() {
  if (!authInitialized || !auth || !db) {
    return initializeFirebaseServices();
  }

  return {
    app: firebaseApp,
    analytics,
    auth,
    db,
  };
}

/* =========================================================
   HELPERS GENERALES
========================================================= */

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/[^\d+]/g, "");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

function buildServiceZoneId(country, department, municipality) {
  const safeCountry = slugify(country || "SV");
  const safeDepartment = slugify(department);
  const safeMunicipality = slugify(municipality);

  if (!safeDepartment || !safeMunicipality) return null;

  return `${safeCountry}-${safeDepartment}-${safeMunicipality}`;
}

function safeJsonSet(key, value, storage = window.sessionStorage) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // No bloquear flujo si el navegador restringe storage.
  }
}

function safeStorageRemove(key) {
  try {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch (_) {
    // No bloquear logout por storage.
  }
}

function getCurrentPathname() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function isAuthPage() {
  const current = getCurrentPathname();

  return (
    current === "login.html" ||
    current === "register.html" ||
    current === "forgot-password.html"
  );
}

function getRouteForRole(role) {
  return ROLE_ROUTES[role] || "index.html";
}

function redirectToRole(role) {
  const route = getRouteForRole(role);
  window.location.assign(route);
}

function setGlobalAuthContext(context) {
  safeJsonSet("nivo_auth_context", {
    uid: context.uid,
    email: context.email || null,
    role: context.role || null,
    status: context.status || null,
    profileSource: context.profileSource || null,
    resolvedAt: new Date().toISOString(),
  });
}

/* =========================================================
   FIRESTORE READS
========================================================= */

async function readUserProfile(uid) {
  const { db } = getServices();

  const userRef = doc(db, COLLECTIONS.users, uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    return null;
  }

  return {
    id: userSnap.id,
    ref: userRef,
    data: userSnap.data(),
  };
}

async function readAdminProfile(uid) {
  const { db } = getServices();

  const adminRef = doc(db, COLLECTIONS.adminProfiles, uid);
  const adminSnap = await getDoc(adminRef);

  if (!adminSnap.exists()) {
    return null;
  }

  return {
    id: adminSnap.id,
    ref: adminRef,
    data: adminSnap.data(),
  };
}

async function touchLastLogin(userRef) {
  try {
    await updateDoc(userRef, {
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (_) {
    // Puede fallar por reglas si el usuario no tiene permiso.
    // No bloqueamos el login por este update.
  }
}

async function resolveUserAccess(firebaseUser) {
  if (!firebaseUser || !firebaseUser.uid) {
    throw new Error("No se pudo resolver la sesión del usuario.");
  }

  const uid = firebaseUser.uid;

  const [adminProfile, userProfile] = await Promise.all([
    readAdminProfile(uid),
    readUserProfile(uid),
  ]);

  if (adminProfile) {
    const adminData = adminProfile.data || {};
    const adminStatus = adminData.status || "inactive";

    if (adminStatus !== "active") {
      throw new Error("Tu cuenta administrativa no está activa. Contacta a soporte NIVO.");
    }

    const context = {
      uid,
      email: firebaseUser.email || adminData.email || null,
      role: "admin",
      adminRole: adminData.role || "admin",
      status: adminStatus,
      profileSource: COLLECTIONS.adminProfiles,
      permissions: adminData.permissions || {},
    };

    setGlobalAuthContext(context);
    await touchLastLogin(adminProfile.ref);

    return context;
  }

  if (!userProfile) {
    throw new Error(
      "Tu cuenta existe en Firebase Auth, pero no tiene perfil NIVO en Firestore. Contacta a soporte."
    );
  }

  const userData = userProfile.data || {};
  const role = userData.role || "user";
  const status = userData.status || "active";

  if (BLOCKED_STATUSES.has(status)) {
    throw new Error("Tu cuenta no está habilitada para acceder. Contacta a soporte NIVO.");
  }

  const context = {
    uid,
    email: firebaseUser.email || userData.email || null,
    role,
    status,
    profileSource: COLLECTIONS.users,
  };

  setGlobalAuthContext(context);
  await touchLastLogin(userProfile.ref);

  return context;
}

/* =========================================================
   CREACIÓN DE PERFILES
========================================================= */

function buildBaseUserProfile({
  uid,
  email,
  fullName,
  phone,
  role,
  country,
  department,
  municipality,
  serviceZoneId,
  source,
}) {
  const isUser = role === PUBLIC_ROLES.user;

  return {
    uid,
    email,
    fullName,
    phone,
    photoUrl: null,
    role,
    status: isUser ? "active" : "pending_profile",
    provider: "password",

    country,
    department,
    municipality,
    registeredZoneId: serviceZoneId,

    profileCompleted: false,
    acceptedCommunityRules: true,
    acceptedCommunityRulesVersion: "1.0",
    acceptedTermsAt: serverTimestamp(),

    source: source || "nivo_web_register",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };
}

function buildDriverProfile({
  uid,
  email,
  fullName,
  phone,
  country,
  department,
  municipality,
  serviceZoneId,
}) {
  return {
    driverId: uid,
    uid,
    email,
    fullName,
    phone,
    photoUrl: null,
    role: "driver",
    status: "pending_documents",
    statusReason: null,

    country,
    department,
    municipality,
    serviceZoneId,

    vehicleType: null,
    vehicleLabel: null,
    primaryVehicleId: null,

    enabledServices: {
      ride: false,
      delivery: false,
      package: false,
      school: false,
    },

    availability: {
      isOnline: false,
      isAvailable: false,
      canReceiveRideOffers: false,
      canReceiveDeliveryOffers: false,
      canReceivePackageOffers: false,
      currentTaskId: null,
      currentTaskType: null,
    },

    registration: {
      profileCompleted: false,
      zoneSelected: Boolean(serviceZoneId),
      vehicleSelected: false,
      servicesSelected: false,
      documentsCompleted: false,
      currentStep: "select_vehicle_type",
    },

    verification: {
      documentsCompleted: false,
      documentsSubmittedAt: null,
      duplicateCheckStatus: "pending",
      duplicateCheckReason: null,
      selfieVerified: false,
      vehicleVerified: false,
      rejectionReason: null,
      reviewReason: null,
      adminNote: null,
      reviewedAt: null,
      reviewedBy: null,
    },

    documentNumbers: {
      duiNumber: null,
      licenseNumber: null,
      circulationCardNumber: null,
      plate: null,
    },

    documents: {
      selfieUrl: null,
      duiFrontUrl: null,
      duiBackUrl: null,
      licenseFrontUrl: null,
      licenseBackUrl: null,
      circulationCardUrl: null,
      vehicleFrontUrl: null,
      vehicleBackUrl: null,
      vehicleLeftUrl: null,
      vehicleRightUrl: null,
    },

    policy: {
      canReceiveTasks: false,
      blockReason: null,
      blockedAt: null,
      blockedBy: null,
    },

    metrics: {
      completedTasks: 0,
      cancelledTasks: 0,
      rating: 0,
      totalEarnings: 0,
    },

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };
}

function buildAgentProfile({
  uid,
  email,
  fullName,
  phone,
  country,
  department,
  municipality,
  serviceZoneId,
}) {
  return {
    agentId: uid,
    uid,
    fullName,
    phone,
    email,
    status: "pending_review",
    statusReason: null,

    country,
    department,
    municipality,
    serviceZoneId,

    businessName: null,
    canProcessTopups: false,
    dailyLimit: 0,
    monthlyLimit: 0,
    commissionRate: 0,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: null,
    adminNote: null,
  };
}

async function createRoleProfileIfNeeded({
  uid,
  email,
  fullName,
  phone,
  role,
  country,
  department,
  municipality,
  serviceZoneId,
}) {
  const { db } = getServices();

  if (role === PUBLIC_ROLES.driver) {
    const driverRef = doc(db, COLLECTIONS.driverProfiles, uid);

    await setDoc(
      driverRef,
      buildDriverProfile({
        uid,
        email,
        fullName,
        phone,
        country,
        department,
        municipality,
        serviceZoneId,
      }),
      { merge: true }
    );

    return;
  }

  if (role === PUBLIC_ROLES.agent) {
    const agentRef = doc(db, COLLECTIONS.agentProfiles, uid);

    await setDoc(
      agentRef,
      buildAgentProfile({
        uid,
        email,
        fullName,
        phone,
        country,
        department,
        municipality,
        serviceZoneId,
      }),
      { merge: true }
    );

    return;
  }

  if (role === PUBLIC_ROLES.commerce) {
    /*
      No se crea commerce_profiles aquí todavía.

      Motivo:
      Antes de programar el módulo web de comercio debemos confirmar
      si la colección final será:
      - commerce_profiles/{commerceId}
      - commerces/{commerceId}

      Por ahora se crea users/{uid} con role="commerce"
      y status="pending_profile".
    */
  }
}

/* =========================================================
   LOGIN HANDLER
   Usado por login.html:
   window.NIVOAuthLoginHandler({ email, password, remember })
========================================================= */

async function handleLogin({ email, password, remember }) {
  const { auth } = getServices();

  const safeEmail = normalizeEmail(email);
  const safePassword = String(password || "");

  if (!safeEmail || !isValidEmail(safeEmail)) {
    throw new Error("Ingresa un correo electrónico válido.");
  }

  if (!safePassword || safePassword.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }

  await setPersistence(
    auth,
    remember ? browserLocalPersistence : browserSessionPersistence
  );

  const credential = await signInWithEmailAndPassword(auth, safeEmail, safePassword);
  const context = await resolveUserAccess(credential.user);

  redirectToRole(context.role);

  return context;
}

/* =========================================================
   REGISTER HANDLER
   Usado por register.html:
   window.NIVOAuthRegisterHandler(payload)
========================================================= */

async function handleRegister(payload) {
  const { auth, db } = getServices();

  const fullName = normalizeText(payload.fullName);
  const phone = normalizePhone(payload.phone);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const role = normalizeText(payload.role);
  const country = normalizeText(payload.country || "SV").toUpperCase();
  const department = normalizeText(payload.department);
  const municipality = normalizeText(payload.municipality);
  const acceptedTerms = Boolean(payload.acceptedTerms);
  const source = normalizeText(payload.source || "nivo_web_register");
  const serviceZoneId = buildServiceZoneId(country, department, municipality);

  if (fullName.length < 3) {
    throw new Error("Ingresa tu nombre completo.");
  }

  if (phone.length < 8) {
    throw new Error("Ingresa un teléfono válido.");
  }

  if (!email || !isValidEmail(email)) {
    throw new Error("Ingresa un correo electrónico válido.");
  }

  if (!Object.values(PUBLIC_ROLES).includes(role)) {
    throw new Error("Selecciona un tipo de cuenta válido.");
  }

  if (role === "admin") {
    throw new Error("Las cuentas administrativas no se registran públicamente.");
  }

  if (department.length < 3) {
    throw new Error("Ingresa tu departamento.");
  }

  if (municipality.length < 3) {
    throw new Error("Ingresa tu municipio.");
  }

  if (!serviceZoneId) {
    throw new Error("No se pudo resolver la zona de servicio.");
  }

  if (!password || password.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }

  if (!acceptedTerms) {
    throw new Error("Debes aceptar los términos y la política de privacidad.");
  }

  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const firebaseUser = credential.user;

  await updateProfile(firebaseUser, {
    displayName: fullName,
  });

  const userRef = doc(db, COLLECTIONS.users, firebaseUser.uid);

  await setDoc(
    userRef,
    buildBaseUserProfile({
      uid: firebaseUser.uid,
      email,
      fullName,
      phone,
      role,
      country,
      department,
      municipality,
      serviceZoneId,
      source,
    }),
    { merge: true }
  );

  await createRoleProfileIfNeeded({
    uid: firebaseUser.uid,
    email,
    fullName,
    phone,
    role,
    country,
    department,
    municipality,
    serviceZoneId,
  });

  const context = await resolveUserAccess(firebaseUser);

  redirectToRole(context.role);

  return context;
}

/* =========================================================
   PASSWORD RESET
   Futuro uso en forgot-password.html
========================================================= */

async function handlePasswordReset(email) {
  const { auth } = getServices();

  const safeEmail = normalizeEmail(email);

  if (!safeEmail || !isValidEmail(safeEmail)) {
    throw new Error("Ingresa un correo electrónico válido.");
  }

  await sendPasswordResetEmail(auth, safeEmail);

  return true;
}

/* =========================================================
   LOGOUT
   Futuro uso en dashboard.html o páginas protegidas.
========================================================= */

async function handleLogout() {
  const { auth } = getServices();

  await signOut(auth);
  safeStorageRemove("nivo_auth_context");

  window.location.assign("login.html");
}

/* =========================================================
   AUTH STATE
========================================================= */

function setupAuthStateListener() {
  const { auth } = getServices();

  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      safeStorageRemove("nivo_auth_context");
      return;
    }

    if (!isAuthPage()) {
      return;
    }

    const url = new URL(window.location.href);
    const stay = url.searchParams.get("stay");

    if (stay === "1") {
      return;
    }

    try {
      const context = await resolveUserAccess(firebaseUser);
      redirectToRole(context.role);
    } catch (_) {
      // Si existe sesión pero falta perfil o hay bloqueo,
      // dejamos que el formulario actúe.
    }
  });
}

/* =========================================================
   API GLOBAL PARA HTML
========================================================= */

window.NIVOAuthLoginHandler = handleLogin;
window.NIVOAuthRegisterHandler = handleRegister;
window.NIVOAuthPasswordResetHandler = handlePasswordReset;
window.NIVOAuthLogoutHandler = handleLogout;
window.NIVOResolveUserAccess = resolveUserAccess;

/* =========================================================
   INIT
========================================================= */

try {
  initializeFirebaseServices();
  setupAuthStateListener();

  console.info("[NIVO Auth] Firebase inicializado correctamente.");
} catch (error) {
  console.error("[NIVO Auth] Error inicializando Firebase:", error);
}