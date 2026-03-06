import { useState, useEffect, useRef, useCallback } from "react";
import { auth, googleProvider, db } from "./firebase";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  browserLocalPersistence,
  setPersistence,
} from "firebase/auth";
import { doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, query, orderBy, limit } from "firebase/firestore";

// ─── Helpers ───────────────────────────────────────────
const formatTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};
const fmtShort = (s) => {
  if (!s) return "0m";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};
const fmtLong = (s) => (!s ? "Sin registro" : fmtShort(s));

const getDateStr = (d) => {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const parseSessionDate = (s) => {
  if (s.dateISO) return new Date(s.dateISO);
  if (s.date) { const p = s.date.split("/"); if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0]); }
  return new Date();
};
const isToday = (s) => getDateStr(parseSessionDate(s)) === getDateStr();
const isThisWeek = (s) => {
  const now = new Date(), day = now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1)); mon.setHours(0, 0, 0, 0);
  return parseSessionDate(s) >= mon && parseSessionDate(s) <= now;
};
const isWithinDays = (s, d) => (new Date() - parseSessionDate(s)) / 864e5 <= d;

// Calculate elapsed seconds from startedAt
const calcElapsed = (startedAt) => {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
};

// ─── Storage ───────────────────────────────────────────
const THEME_KEY = "task-timer-theme", LOCAL_KEY = "task-timer-data", TAGS_KEY = "task-timer-tags";
const saveTheme = (d) => { try { localStorage.setItem(THEME_KEY, JSON.stringify(d)); } catch (e) {} };
const loadTheme = () => { try { const r = localStorage.getItem(THEME_KEY); if (r !== null) return JSON.parse(r); } catch (e) {} return true; };
const saveLocal = (c) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(c)); } catch (e) {} };
const loadLocal = () => { try { const r = localStorage.getItem(LOCAL_KEY); if (r) return JSON.parse(r); } catch (e) {} return null; };
const saveTags = (t) => { try { localStorage.setItem(TAGS_KEY, JSON.stringify(t)); } catch (e) {} };
const loadTags = () => { try { const r = localStorage.getItem(TAGS_KEY); if (r) return JSON.parse(r); } catch (e) {} return []; };

// ─── Icons ─────────────────────────────────────────────
const I = {
  play: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>,
  pause: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="5" height="18" /><rect x="14" y="3" width="5" height="18" /></svg>,
  plus: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3,6 5,6 21,6" /><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" /></svg>,
  clock: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>,
  chev: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 12,15 18,9" /></svg>,
  x: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  moon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21,12.79A9,9,0,1,1,11.21,3,7,7,0,0,0,21,12.79Z" /></svg>,
  sun: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>,
  reset: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 1,10 7,10" /><path d="M3.51,15a9,9,0,1,0,2.13-9.36L1,10" /></svg>,
  dl: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21,15v4a2,2,0,0,1-2,2H5a2,2,0,0,1-2-2V15" /><polyline points="7,10 12,15 17,10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  ul: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21,15v4a2,2,0,0,1-2,2H5a2,2,0,0,1-2-2V15" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>,
  google: <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9,21H5a2,2,0,0,1-2-2V5A2,2,0,0,1,5,3h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
  cloud: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18,10h-1.26A8,8,0,1,0,9,20h9a5,5,0,0,0,0-10z" /></svg>,
  user: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20,21v-2a4,4,0,0,0-4-4H8a4,4,0,0,0-4,4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  check: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12" /></svg>,
  chart: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  move: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,9 2,12 5,15" /><polyline points="19,9 22,12 19,15" /><line x1="2" y1="12" x2="22" y2="12" /></svg>,
  back: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12,19 5,12 12,5" /></svg>,
  edit: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11,4H4A2,2,0,0,0,2,6V20a2,2,0,0,0,2,2H18a2,2,0,0,0,2-2V13" /><path d="M18.5,2.5a2.121,2.121,0,0,1,3,3L12,15,8,16l1-4Z" /></svg>,
  up: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18,15 12,9 6,15" /></svg>,
  down: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 12,15 18,9" /></svg>,
  note: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14,2H6A2,2,0,0,0,4,4V20a2,2,0,0,0,2,2H18a2,2,0,0,0,2-2V8Z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  target: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>,
  fire: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12,2C6.5,7,4,11,4,14a8,8,0,0,0,16,0C20,11,17.5,7,12,2Z" /></svg>,
  tag: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59,13.41l-7.17,7.17a2,2,0,0,1-2.83,0L2,12V2H12l8.59,8.59A2,2,0,0,1,20.59,13.41Z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  collapseAll: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18,15 12,9 6,15" /><polyline points="18,20 12,14 6,20" /></svg>,
};

const CAT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16", "#eab308", "#a855f7"];

const defaultCategories = [
  { id: "cat-1", name: "Contenido", color: "#6366f1", tasks: [
    { id: "t-1", name: "Creación de contenido RRSS", totalSeconds: 0, isRunning: false, startedAt: null, completed: false, goalDaily: 0, sessions: [], subtasks: [], notes: "" },
    { id: "t-2", name: "Edición de vídeos", totalSeconds: 0, isRunning: false, startedAt: null, completed: false, goalDaily: 0, sessions: [], subtasks: [], notes: "" },
  ]},
  { id: "cat-2", name: "Negocio", color: "#10b981", tasks: [
    { id: "t-3", name: "Análisis competencia", totalSeconds: 0, isRunning: false, startedAt: null, completed: false, goalDaily: 0, sessions: [], subtasks: [], notes: "" },
    { id: "t-4", name: "Estrategia de ventas", totalSeconds: 0, isRunning: false, startedAt: null, completed: false, goalDaily: 0, sessions: [], subtasks: [], notes: "" },
  ]},
];

const ensureTask = (t) => {
  const { currentSeconds, ...rest } = t; // strip currentSeconds from old data
  return { subtasks: [], notes: "", goalDaily: 0, completed: false, startedAt: null, isRunning: false, sessions: [], totalSeconds: 0, ...rest };
};

const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

// ─── Device ID (unique per browser tab) ────────────────
const DEVICE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ─── Cloud Sync ────────────────────────────────────────
function useCloudSync(user) {
  const [syncing, setSyncing] = useState(false);
  const remoteCallbackRef = useRef(null);
  const unsubRef = useRef(null);
  const lastSaveTs = useRef(0); // timestamp of our last save

  useEffect(() => {
    if (!user) { if (unsubRef.current) unsubRef.current(); return; }
    const docRef = doc(db, "users", user.uid);
    let isFirst = true;
    unsubRef.current = onSnapshot(docRef, (snap) => {
      if (isFirst) { isFirst = false; return; }
      if (!snap.exists()) return;
      const data = snap.data();
      // Ignore own writes: if device matches OR if update came within 2s of our save
      if (data._device === DEVICE_ID) return;
      const cloudTs = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
      if (Math.abs(cloudTs - lastSaveTs.current) < 2000) return;
      if (remoteCallbackRef.current) remoteCallbackRef.current(data);
    }, (err) => console.warn("Firestore:", err));
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [user]);

  const saveToCloud = useCallback(async (cats, tgs) => {
    if (!user) return;
    setSyncing(true);
    try {
      const clean = cats.map((c) => ({ ...c, tasks: c.tasks.map((t) => ensureTask(t)) }));
      const now = new Date().toISOString();
      lastSaveTs.current = new Date(now).getTime();
      await setDoc(doc(db, "users", user.uid), { categories: clean, tags: (tgs && tgs.length > 0) ? tgs : (loadTags() || []), updatedAt: now, _device: DEVICE_ID });
    } catch (e) { console.warn("Save:", e); }
    setSyncing(false);
  }, [user]);

  const loadFromCloud = useCallback(async () => {
    if (!user) return null;
    try {
      const { getDoc } = await import("firebase/firestore");
      const snap = await getDoc(doc(db, "users", user.uid));
      return snap.exists() ? snap.data() : null;
    } catch (e) { return null; }
  }, [user]);

  const saveBackup = useCallback(async (cats, tgs) => {
    if (!user) return;
    try {
      const backupRef = collection(db, "users", user.uid, "backups");
      const now = new Date();
      const id = now.toISOString().replace(/[:.]/g, "-");
      const clean = cats.map((c) => ({ ...c, tasks: c.tasks.map((t) => ensureTask(t)) }));
      await setDoc(doc(backupRef, id), { categories: clean, tags: (tgs && tgs.length > 0) ? tgs : (loadTags() || []), createdAt: now.toISOString() });
      // Keep max 24 backups
      const q2 = query(backupRef, orderBy("createdAt", "desc"));
      const snaps = await getDocs(q2);
      const docs = snaps.docs;
      if (docs.length > 24) {
        for (let i = 24; i < docs.length; i++) await deleteDoc(docs[i].ref);
      }
    } catch (e) { console.warn("Backup:", e); }
  }, [user]);

  const listBackups = useCallback(async () => {
    if (!user) return [];
    try {
      const q2 = query(collection(db, "users", user.uid, "backups"), orderBy("createdAt", "desc"), limit(24));
      const snaps = await getDocs(q2);
      return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) { return []; }
  }, [user]);

  const restoreBackup = useCallback(async (backup) => {
    if (!user) return null;
    return { categories: backup.categories, tags: backup.tags };
  }, [user]);

  return { saveToCloud, loadFromCloud, syncing, remoteCallbackRef, saveBackup, listBackups, restoreBackup };
}

// ─── Profile Menu ──────────────────────────────────────
function ProfileMenu({ user, onLogin, onLogout, onBackups, syncing, theme, dk }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{ width: 40, height: 40, borderRadius: "50%", border: user ? "2px solid #10b981" : `1px solid ${theme.border}`, background: user ? "none" : theme.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 0, flexShrink: 0 }}>
        {user?.photoURL ? <img src={user.photoURL} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ color: theme.textSec }}>{I.user}</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", top: 48, right: 0, backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 6, minWidth: 240, boxShadow: dk ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 32px rgba(0,0,0,0.12)", zIndex: 50, animation: "fadeIn .15s" }}>
          {user ? (<>
            <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {user.photoURL && <img src={user.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />}
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.displayName || "Usuario"}</div><div style={{ fontSize: 13, color: theme.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div></div>
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: syncing ? "#f59e0b" : "#10b981" }}>{I.cloud}<span>{syncing ? "Guardando..." : "Sincronizado"}</span></div>
            </div>
            <button onClick={() => { if (onBackups) onBackups(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px", margin: "2px 0", background: "none", border: "none", borderRadius: 8, color: theme.text, fontSize: 15, cursor: "pointer" }}>{I.reset} Backups</button>
            <button onClick={() => { onLogout(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px", margin: "4px 0 2px", background: "none", border: "none", borderRadius: 8, color: "#ef4444", fontSize: 15, cursor: "pointer" }}>{I.logout} Cerrar sesión</button>
          </>) : (<>
            <div style={{ padding: "12px 14px 8px" }}><div style={{ fontSize: 15, fontWeight: 600 }}>Sin sesión</div><div style={{ fontSize: 13, color: theme.textSec, marginTop: 3 }}>Sincroniza entre dispositivos</div></div>
            <button onClick={() => { onLogin(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "calc(100% - 12px)", padding: "12px 14px", margin: "6px", background: dk ? "#1c1c1c" : "#f0f0f0", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{I.google} Continuar con Google</button>
          </>)}
        </div>
      )}
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────
function Modal({ title, message, confirmLabel, confirmColor, onConfirm, onCancel, theme, children, options }) {
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s" }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 24, maxWidth: 380, width: "100%" }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        {message && <div style={{ fontSize: 14, color: theme.textSec, marginBottom: 16, lineHeight: 1.5 }}>{message}</div>}
        {options && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {options.map((o, i) => (
              <button key={i} onClick={o.onSelect} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 15, cursor: "pointer", textAlign: "left" }}>
                <div style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: o.color, flexShrink: 0 }} />
                {o.label}
              </button>
            ))}
          </div>
        )}
        {children}
        {onConfirm && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={onCancel} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 15, cursor: "pointer" }}>Cancelar</button>
            <button onClick={onConfirm} style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: confirmColor || "#ef4444", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{confirmLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function EditModal({ title, value, onSave, onCancel, theme, color, onColorChange, goalDaily, onGoalChange }) {
  const [val, setVal] = useState(value || "");
  const [col, setCol] = useState(color || "");
  const [goal, setGoal] = useState(goalDaily ? Math.round(goalDaily / 60) : 0);
  return (
    <Modal title={title} onCancel={onCancel} theme={theme}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSave(val, col, goal * 60); }} placeholder="Nombre..." style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 16, outline: "none" }} />
        {onColorChange && (
          <div>
            <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 8 }}>Color</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CAT_COLORS.map((c) => <button key={c} onClick={() => setCol(c)} style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: c, border: col === c ? "3px solid " + theme.text : "2px solid transparent", cursor: "pointer" }} />)}
            </div>
          </div>
        )}
        {onGoalChange && (
          <div>
            <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>{I.target} Objetivo diario (minutos)</div>
            <input type="number" value={goal} onChange={(e) => setGoal(Math.max(0, parseInt(e.target.value) || 0))} min="0" step="5" placeholder="0 = sin objetivo" style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 16, outline: "none", width: "100%" }} />
            <div style={{ fontSize: 12, color: theme.textSec, marginTop: 4 }}>0 = sin objetivo</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 15, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => onSave(val, col, goal * 60)} style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: "#6366f1", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

function SessionEditModal({ taskId, sessIdx, session, allTags, onSave, onCancel, theme, dk }) {
  const MOODS = ["😫", "😕", "😐", "🙂", "🔥"];
  const [note, setNote] = useState(session.note || "");
  const [mood, setMood] = useState(session.mood || null);
  const [sessTags, setSessTags] = useState(session.tags || []);
  const durH = Math.floor((session.duration || 0) / 3600);
  const durM = Math.floor(((session.duration || 0) % 3600) / 60);
  const durS = (session.duration || 0) % 60;
  const [hours, setHours] = useState(durH);
  const [mins, setMins] = useState(durM);
  const [secs, setSecs] = useState(durS);
  const [endTime, setEndTime] = useState(session.endedAt || "");
  const initStartTime = session.startedAt || (() => {
    // Calculate from endedAt - duration
    if (session.endedAt && session.duration) {
      const [h, m] = session.endedAt.split(":").map(Number);
      const endMins = h * 60 + m;
      const startMins = endMins - Math.floor(session.duration / 60);
      const sh = Math.floor(((startMins % 1440) + 1440) % 1440 / 60);
      const sm = ((startMins % 1440) + 1440) % 1440 % 60;
      return `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
    }
    return "";
  })();
  const [startTime, setStartTime] = useState(initStartTime);
  const recalcFromTimes = (st, et) => {
    if (!st || !et) return;
    const [sh, sm] = st.split(":").map(Number);
    const [eh, em] = et.split(":").map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 1440; // crosses midnight
    const totalSecs = diff * 60;
    setHours(Math.floor(totalSecs / 3600));
    setMins(Math.floor((totalSecs % 3600) / 60));
    setSecs(0);
  };
  // Parse date from dateISO or date string
  const initDate = (() => {
    if (session.dateISO) { const d = new Date(session.dateISO); return d.toISOString().slice(0, 10); }
    if (session.date) { const p = session.date.split("/"); if (p.length === 3) return `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`; }
    return new Date().toISOString().slice(0, 10);
  })();
  const [dateVal, setDateVal] = useState(initDate);
  const newDuration = Math.max(0, hours * 3600 + mins * 60 + secs);
  const toggleTag = (t) => setSessTags((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);
  const recalcStart = (h, m, s) => {
    if (!endTime) return;
    const [eh, em] = endTime.split(":").map(Number);
    const endMins = eh * 60 + em;
    const durMins = h * 60 + m + (s > 0 ? 1 : 0);
    const startMins = ((endMins - durMins) % 1440 + 1440) % 1440;
    const sh = Math.floor(startMins / 60);
    const sm = startMins % 60;
    setStartTime(`${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`);
  };
  return (
    <Modal title="Editar sesión" onCancel={onCancel} theme={theme}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Fecha</div>
          <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} style={{ width: "100%", padding: "10px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none" }} />
        </div>
        <div>
          <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Horario</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} onBlur={() => recalcFromTimes(startTime, endTime)} style={{ width: "100%", padding: "10px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none" }} />
              <div style={{ fontSize: 11, color: theme.textSec, textAlign: "center", marginTop: 3 }}>Inicio</div>
            </div>
            <span style={{ fontSize: 16, color: theme.textSec }}>→</span>
            <div style={{ flex: 1 }}>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} onBlur={() => recalcFromTimes(startTime, endTime)} style={{ width: "100%", padding: "10px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none" }} />
              <div style={{ fontSize: 11, color: theme.textSec, textAlign: "center", marginTop: 3 }}>Fin</div>
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Duración</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <input type="number" value={hours} onChange={(e) => setHours(Math.max(0, parseInt(e.target.value) || 0))} onBlur={() => recalcStart(hours, mins, secs)} min="0" style={{ width: "100%", padding: "10px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 16, outline: "none", textAlign: "center" }} />
              <div style={{ fontSize: 11, color: theme.textSec, textAlign: "center", marginTop: 3 }}>horas</div>
            </div>
            <span style={{ fontSize: 20, color: theme.textSec, fontWeight: 300 }}>:</span>
            <div style={{ flex: 1 }}>
              <input type="number" value={mins} onChange={(e) => setMins(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} onBlur={() => recalcStart(hours, mins, secs)} min="0" max="59" style={{ width: "100%", padding: "10px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 16, outline: "none", textAlign: "center" }} />
              <div style={{ fontSize: 11, color: theme.textSec, textAlign: "center", marginTop: 3 }}>min</div>
            </div>
            <span style={{ fontSize: 20, color: theme.textSec, fontWeight: 300 }}>:</span>
            <div style={{ flex: 1 }}>
              <input type="number" value={secs} onChange={(e) => setSecs(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} onBlur={() => recalcStart(hours, mins, secs)} min="0" max="59" style={{ width: "100%", padding: "10px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 16, outline: "none", textAlign: "center" }} />
              <div style={{ fontSize: 11, color: theme.textSec, textAlign: "center", marginTop: 3 }}>seg</div>
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Estado de ánimo</div>
          <div style={{ display: "flex", gap: 8 }}>
            {MOODS.map((m) => (
              <button key={m} onClick={() => setMood(mood === m ? null : m)} style={{ width: 42, height: 42, borderRadius: 10, border: mood === m ? "2px solid #6366f1" : `1px solid ${theme.border}`, backgroundColor: mood === m ? "#6366f122" : theme.surface, fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{m}</button>
            ))}
          </div>
        </div>
        {allTags && allTags.length > 0 && (
          <div>
            <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Etiquetas</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {allTags.map((tag) => (
                <button key={tag} onClick={() => toggleTag(tag)} style={{ padding: "5px 12px", borderRadius: 16, border: sessTags.includes(tag) ? "2px solid #6366f1" : `1px solid ${theme.border}`, backgroundColor: sessTags.includes(tag) ? "#6366f122" : "transparent", color: sessTags.includes(tag) ? "#6366f1" : theme.textSec, fontSize: 13, cursor: "pointer" }}>{tag}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Nota</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué hiciste?" rows={2} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 15, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => {
            // Build new dateISO from date + time
            const newDateISO = dateVal && endTime ? new Date(`${dateVal}T${endTime}`).toISOString() : session.dateISO;
            const dp = dateVal ? dateVal.split("-") : null;
            const newDate = dp ? `${dp[2]}/${dp[1]}/${dp[0]}` : session.date;
            onSave(taskId, sessIdx, { note, mood, duration: newDuration, tags: sessTags, startedAt: startTime || session.startedAt, endedAt: endTime || session.endedAt, date: newDate, dateISO: newDateISO });
          }} style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: "#6366f1", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

function SubtaskInput({ taskId, onAdd, theme }) {
  const [val, setVal] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) { onAdd(taskId, val); setVal(""); } }} placeholder="Nueva subtarea..." style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none" }} />
      <button onClick={() => { if (val.trim()) { onAdd(taskId, val); setVal(""); } }} style={{ padding: "0 12px", borderRadius: 8, border: "none", backgroundColor: "#6366f1", color: "#fff", fontSize: 13, fontWeight: 600 }}>+</button>
    </div>
  );
}

// ─── Stats View ────────────────────────────────────────
function StatsView({ categories, theme, dk, onClose }) {
  const [period, setPeriod] = useState("today");
  const [filter, setFilter] = useState("all");
  const periods = [{ key: "yesterday", label: "Ayer" }, { key: "today", label: "Hoy" }, { key: "week", label: "Semana" }, { key: "14days", label: "14 días" }, { key: "month", label: "Mes" }, { key: "all", label: "Total" }];
  const isYesterday = (s) => { const y = new Date(); y.setDate(y.getDate() - 1); return getDateStr(parseSessionDate(s)) === getDateStr(y); };
  const filterS = (s) => { if (period === "today") return isToday(s); if (period === "yesterday") return isYesterday(s); if (period === "week") return isThisWeek(s); if (period === "14days") return isWithinDays(s, 14); if (period === "month") return isWithinDays(s, 30); return true; };
  const allTasks = categories.flatMap((c) => c.tasks.map((t) => ({ ...ensureTask(t), catName: c.name, catColor: c.color, catId: c.id })));
  const fTasks = filter === "all" ? allTasks : allTasks.filter((t) => t.catId === filter);
  const tStats = fTasks.map((t) => { const fs = t.sessions.filter(filterS); return { ...t, fSess: fs, pTime: fs.reduce((a, x) => a + x.duration, 0) }; }).filter((t) => t.pTime > 0 || t.sessions.length > 0).sort((a, b) => b.pTime - a.pTime);
  const totalTime = tStats.reduce((a, t) => a + t.pTime, 0);
  const catStats = categories.map((c) => ({ ...c, pTime: allTasks.filter((t) => t.catId === c.id).reduce((a, t) => a + t.sessions.filter(filterS).reduce((s, x) => s + x.duration, 0), 0) })).filter((c) => c.pTime > 0).sort((a, b) => b.pTime - a.pTime);
  const maxT = Math.max(...tStats.map((t) => t.pTime), 1);
  const maxC = Math.max(...catStats.map((c) => c.pTime), 1);
  const days = period === "today" ? 1 : period === "yesterday" ? 1 : period === "week" ? 7 : period === "14days" ? 14 : 30;
  const now = new Date();
  const daily = [];
  const dayOffset = period === "yesterday" ? 1 : 0;
  for (let i = days - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i - dayOffset); const ds = getDateStr(d); let tot = 0; fTasks.forEach((t) => t.sessions.forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) tot += s.duration; })); daily.push({ ds, label: d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" }), tot }); }
  const maxD = Math.max(...daily.map((d) => d.tot), 1);
  const getStreak = () => { let streak = 0; const d = new Date(); for (let i = 0; i < 365; i++) { const ds = getDateStr(d); let dt = 0; allTasks.forEach((t) => t.sessions.forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) dt += s.duration; })); if (dt > 0) streak++; else if (i > 0) break; d.setDate(d.getDate() - 1); } return streak; };
  const daysWithData = daily.filter((d) => d.tot > 0).length;
  const avgDaily = daysWithData > 0 ? Math.round(totalTime / daysWithData) : 0;
  const heatData = []; for (let i = 83; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const ds = getDateStr(d); let tot = 0; allTasks.forEach((t) => t.sessions.forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) tot += s.duration; })); heatData.push({ ds, tot, day: d.getDay(), label: d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) }); }
  const maxHeat = Math.max(...heatData.map((d) => d.tot), 1);
  const heatColor = (tot) => { if (tot === 0) return dk ? "#1a1a1a" : "#eee"; const int = Math.min(tot / maxHeat, 1); if (int < 0.25) return dk ? "#0e4429" : "#9be9a8"; if (int < 0.5) return dk ? "#006d32" : "#40c463"; if (int < 0.75) return dk ? "#26a641" : "#30a14e"; return dk ? "#39d353" : "#216e39"; };
  const weeks = []; let week = []; heatData.forEach((d, i) => { week.push(d); if (d.day === 6 || i === heatData.length - 1) { weeks.push(week); week = []; } });

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: theme.bg, zIndex: 100, overflow: "auto", animation: "fadeIn .2s" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.text, cursor: "pointer", padding: 4, display: "flex" }}>{I.back}</button>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Estadísticas</h1>
        </div>
        <div style={{ display: "flex", gap: 12, padding: "16px 0", overflowX: "auto" }}>
          {[{ label: "Racha", val: `${getStreak()}d`, icon: I.fire, color: "#f59e0b" }, { label: "Media diaria", val: fmtShort(avgDaily), icon: I.clock, color: "#6366f1" }, { label: "Días activos", val: `${daysWithData}`, icon: I.chart, color: "#10b981" }].map((s, i) => (
            <div key={i} style={{ flex: "0 0 auto", padding: "14px 18px", borderRadius: 14, backgroundColor: theme.card, border: `1px solid ${theme.border}`, minWidth: 110, textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 6, color: s.color }}>{s.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{s.val}</div>
              <div style={{ fontSize: 12, color: theme.textSec, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, padding: "16px 0 8px", overflowX: "auto" }}>{periods.map((p) => (<button key={p.key} onClick={() => setPeriod(p.key)} style={{ padding: "8px 14px", borderRadius: 20, border: period === p.key ? "none" : `1px solid ${theme.border}`, backgroundColor: period === p.key ? theme.accent : "transparent", color: period === p.key ? (dk ? "#000" : "#fff") : theme.textSec, fontSize: 14, fontWeight: period === p.key ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{p.label}</button>))}</div>
        <div style={{ display: "flex", gap: 6, padding: "8px 0 16px", overflowX: "auto" }}>
          <button onClick={() => setFilter("all")} style={{ padding: "6px 12px", borderRadius: 16, border: filter === "all" ? "none" : `1px solid ${theme.border}`, backgroundColor: filter === "all" ? (dk ? "#333" : "#ddd") : "transparent", color: filter === "all" ? theme.text : theme.textSec, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>Todas</button>
          {categories.map((c) => (<button key={c.id} onClick={() => setFilter(c.id)} style={{ padding: "6px 12px", borderRadius: 16, border: filter === c.id ? "none" : `1px solid ${theme.border}`, backgroundColor: filter === c.id ? `${c.color}22` : "transparent", color: filter === c.id ? c.color : theme.textSec, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, flexShrink: 0, whiteSpace: "nowrap" }}><div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.color }} />{c.name}</button>))}
        </div>
        <div style={{ padding: "12px 0 16px", textAlign: "center", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>{fmtLong(totalTime)}</div>
          <div style={{ fontSize: 14, color: theme.textSec, marginTop: 4 }}>Tiempo total · {periods.find((p) => p.key === period)?.label}</div>
        </div>
        {daily.length > 1 && (<div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Actividad diaria</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: daily.length > 14 ? 2 : 3, height: 100 }}>{daily.map((d, i) => (<div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}><div style={{ fontSize: 9, color: theme.textSec, opacity: d.tot > 0 ? 1 : 0 }}>{d.tot > 0 ? fmtShort(d.tot) : ""}</div><div style={{ width: "100%", height: Math.max(3, (d.tot / maxD) * 80), backgroundColor: d.tot > 0 ? (filter !== "all" ? categories.find((c) => c.id === filter)?.color || theme.accent : theme.accent) : (dk ? "#1c1c1c" : "#eee"), borderRadius: 3, opacity: d.tot > 0 ? 0.8 : 0.3 }} />{daily.length <= 7 && <div style={{ fontSize: 10, color: theme.textSec, whiteSpace: "nowrap", opacity: 0.7 }}>{d.label.split(" ")[0]}</div>}</div>))}</div>
        </div>)}
        {filter === "all" && catStats.length > 0 && (<div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Por categoría</div>
          {catStats.map((c) => (<div key={c.id} style={{ marginBottom: 14 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.color }} /><span style={{ fontSize: 15, fontWeight: 500 }}>{c.name}</span></div><span style={{ fontSize: 14, fontWeight: 600, color: c.color }}>{fmtShort(c.pTime)}</span></div><div style={{ height: 6, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${(c.pTime / maxC) * 100}%`, backgroundColor: c.color, borderRadius: 3 }} /></div></div>))}
        </div>)}
        {/* Mood analysis */}
        {/* ── Circular Charts ── */}
        {(period === "today" || period === "yesterday") && (() => {
          // Daily clock: 24h donut with category colors per hour
          const targetDate = period === "yesterday" ? (() => { const y = new Date(); y.setDate(y.getDate() - 1); return getDateStr(y); })() : getDateStr();
          // Collect all sessions for target date with category info
          const hourBuckets = Array.from({ length: 24 }, () => ({})); // {catId: seconds}
          categories.forEach((cat) => {
            cat.tasks.forEach((task) => {
              (task.sessions || []).forEach((s) => {
                if (!s.dateISO || !s.duration) return;
                const sessDate = getDateStr(new Date(s.dateISO));
                if (sessDate !== targetDate) return;
                const endDate = new Date(s.dateISO);
                const startDate = new Date(endDate.getTime() - s.duration * 1000);
                // Fill each hour bucket
                for (let h = 0; h < 24; h++) {
                  const hStart = new Date(endDate); hStart.setHours(h, 0, 0, 0);
                  if (hStart.toDateString() !== endDate.toDateString()) { const tmp = new Date(startDate); hStart.setFullYear(tmp.getFullYear()); hStart.setMonth(tmp.getMonth()); hStart.setDate(tmp.getDate()); hStart.setHours(h, 0, 0, 0); }
                  const bucketDate = new Date(targetDate + "T00:00:00"); bucketDate.setHours(h, 0, 0, 0);
                  const hEnd = new Date(bucketDate.getTime() + 3600000);
                  const overlapStart = Math.max(startDate.getTime(), bucketDate.getTime());
                  const overlapEnd = Math.min(endDate.getTime(), hEnd.getTime());
                  if (overlapEnd > overlapStart) {
                    const secs = (overlapEnd - overlapStart) / 1000;
                    hourBuckets[h][cat.id] = (hourBuckets[h][cat.id] || 0) + secs;
                  }
                }
              });
            });
          });
          const catColorMap = {}; categories.forEach((c) => { catColorMap[c.id] = c.color; });
          const catNameMap = {}; categories.forEach((c) => { catNameMap[c.id] = c.name; });
          // Build SVG arcs
          const cx = 100, cy = 100, R = 85, r = 55;
          const segAngle = (2 * Math.PI) / 24;
          const clockArcs = [];
          for (let h = 0; h < 24; h++) {
            const angle0 = -Math.PI / 2 + h * segAngle;
            const bucket = hourBuckets[h];
            const totalSecs = Object.values(bucket).reduce((a, v) => a + v, 0);
            if (totalSecs === 0) {
              // Empty hour - gray
              const gap = 0.008;
              const a0 = angle0 + gap, a1 = angle0 + segAngle - gap;
              const path = `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} L${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)} A${R},${R},0,0,1,${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r},0,0,0,${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}Z`;
              clockArcs.push(<path key={`e-${h}`} d={path} fill={dk ? "#1a1a1a" : "#e8e8e8"} />);
            } else {
              // Split proportionally by category
              const entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
              let offset = 0;
              entries.forEach(([catId, secs], ei) => {
                const frac = secs / 3600;
                const gap = 0.008;
                const a0 = angle0 + gap + offset * (segAngle - 2 * gap);
                const a1 = a0 + frac * (segAngle - 2 * gap);
                offset += frac;
                const largeArc = (a1 - a0) > Math.PI ? 1 : 0;
                const path = `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} L${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)} A${R},${R},0,${largeArc},1,${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r},0,${largeArc},0,${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}Z`;
                clockArcs.push(<path key={`s-${h}-${ei}`} d={path} fill={catColorMap[catId] || "#888"} opacity={0.85} />);
              });
              // Fill remaining fraction as gray if < 3600s
              if (totalSecs < 3600) {
                const frac = (3600 - totalSecs) / 3600;
                const gap = 0.008;
                const a0 = angle0 + gap + offset * (segAngle - 2 * gap);
                const a1 = angle0 + segAngle - gap;
                if (a1 > a0 + 0.001) {
                  const largeArc = (a1 - a0) > Math.PI ? 1 : 0;
                  const path = `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} L${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)} A${R},${R},0,${largeArc},1,${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r},0,${largeArc},0,${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}Z`;
                  clockArcs.push(<path key={`g-${h}`} d={path} fill={dk ? "#1a1a1a" : "#e8e8e8"} />);
                }
              }
            }
          }
          // Hour labels
          const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
            const angle = -Math.PI / 2 + h * segAngle + segAngle / 2;
            const lR = R + 13;
            return <text key={`l-${h}`} x={cx + lR * Math.cos(angle)} y={cy + lR * Math.sin(angle)} textAnchor="middle" dominantBaseline="central" fill={theme.textSec} fontSize="9" fontWeight="500">{h}</text>;
          });
          // Legend
          const usedCats = {}; hourBuckets.forEach((b) => Object.entries(b).forEach(([id, s]) => { usedCats[id] = (usedCats[id] || 0) + s; }));
          const legendItems = Object.entries(usedCats).sort((a, b) => b[1] - a[1]);
          const totalTracked = legendItems.reduce((a, [, s]) => a + s, 0);
          // Base for percentages: today = elapsed so far, yesterday = 24h
          const baseSecs = period === "yesterday" ? 86400 : (() => { const n = new Date(); return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds(); })();
          const untracked = Math.max(0, baseSecs - totalTracked);

          return (
            <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Reloj del día</div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <svg viewBox="0 0 200 200" width="220" height="220">
                  {clockArcs}
                  {hourLabels}
                  <text x={cx} y={cy - 6} textAnchor="middle" fill={theme.text} fontSize="16" fontWeight="700">{fmtShort(Math.round(totalTracked))}</text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fill={theme.textSec} fontSize="9">{baseSecs > 0 ? Math.round((totalTracked / baseSecs) * 100) : 0}% de {fmtShort(baseSecs)}</text>
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                {legendItems.map(([id, secs]) => (
                  <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: catColorMap[id] }} />
                      <span style={{ color: theme.text }}>{catNameMap[id]}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, color: catColorMap[id] }}>{fmtShort(Math.round(secs))}</span>
                      <span style={{ color: theme.textSec, fontSize: 11 }}>{baseSecs > 0 ? Math.round((secs / baseSecs) * 100) : 0}%</span>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, opacity: 0.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: dk ? "#1a1a1a" : "#ddd" }} />
                    <span style={{ color: theme.textSec }}>Sin registro</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: theme.textSec }}>{fmtShort(Math.round(untracked))}</span>
                    <span style={{ color: theme.textSec, fontSize: 11 }}>{baseSecs > 0 ? Math.round((untracked / baseSecs) * 100) : 0}%</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        {period === "week" && (() => {
          // Weekly donut: 168h total, categories + sin actividad
          const WEEK_SECS = 168 * 3600;
          const catTotals = categories.map((cat) => {
            const secs = cat.tasks.reduce((a, task) => a + (task.sessions || []).filter(isThisWeek).reduce((s, x) => s + x.duration, 0), 0);
            return { id: cat.id, name: cat.name, color: cat.color, secs };
          }).filter((c) => c.secs > 0).sort((a, b) => b.secs - a.secs);
          const totalTracked = catTotals.reduce((a, c) => a + c.secs, 0);
          const untracked = WEEK_SECS - totalTracked;
          const slices = [...catTotals, { id: "_free", name: "Sin actividad", color: dk ? "#1a1a1a" : "#ddd", secs: untracked }];
          // Build donut
          const cx = 100, cy = 100, R = 85, r = 55;
          let cumAngle = -Math.PI / 2;
          const donutArcs = slices.map((sl, si) => {
            const frac = sl.secs / WEEK_SECS;
            if (frac < 0.001) return null;
            const sweep = frac * 2 * Math.PI;
            const a0 = cumAngle + 0.005;
            const a1 = cumAngle + sweep - 0.005;
            cumAngle += sweep;
            const largeArc = (a1 - a0) > Math.PI ? 1 : 0;
            const path = `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} L${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)} A${R},${R},0,${largeArc},1,${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r},0,${largeArc},0,${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}Z`;
            return <path key={si} d={path} fill={sl.color} opacity={sl.id === "_free" ? 0.5 : 0.85} />;
          });
          const pct = Math.round((totalTracked / WEEK_SECS) * 100);

          return (
            <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Distribución semanal</div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <svg viewBox="0 0 200 200" width="220" height="220">
                  {donutArcs}
                  <text x={cx} y={cy - 6} textAnchor="middle" fill={theme.text} fontSize="16" fontWeight="700">{fmtShort(totalTracked)}</text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fill={theme.textSec} fontSize="9">{pct}% de 168h</text>
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                {catTotals.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.color }} />
                      <span style={{ color: theme.text }}>{c.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, color: c.color }}>{fmtShort(c.secs)}</span>
                      <span style={{ color: theme.textSec, fontSize: 11 }}>{Math.round((c.secs / WEEK_SECS) * 100)}%</span>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, opacity: 0.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: dk ? "#1a1a1a" : "#ddd" }} />
                    <span style={{ color: theme.textSec }}>Sin actividad</span>
                  </div>
                  <span style={{ color: theme.textSec }}>{fmtShort(untracked)}</span>
                </div>
              </div>
            </div>
          );
        })()}
        <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Por tarea</div>
          {tStats.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: theme.textSec, fontSize: 14 }}>Sin datos</div>}
          {tStats.map((t) => { const moodSess = t.fSess.filter((s) => s.mood); const avgM = moodSess.length > 0 ? ["😫", "😕", "😐", "🙂", "🔥"][Math.round(moodSess.reduce((a, s) => a + ["😫", "😕", "😐", "🙂", "🔥"].indexOf(s.mood), 0) / moodSess.length)] : null; return (<div key={t.id} style={{ marginBottom: 14 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div><div style={{ fontSize: 12, color: theme.textSec, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}><div style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: t.catColor }} />{t.catName} · {t.fSess.length} ses.{avgM && <span> · {avgM}</span>}{t.completed && <span style={{ color: "#10b981" }}> ✓</span>}{t.goalDaily > 0 && <span style={{ color: "#6366f1" }}> · Meta: {Math.round(t.goalDaily / 60)}m/día</span>}</div></div><span style={{ fontSize: 15, fontWeight: 600, color: t.catColor, flexShrink: 0, marginLeft: 12 }}>{fmtShort(t.pTime)}</span></div><div style={{ height: 5, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${(t.pTime / maxT) * 100}%`, backgroundColor: t.catColor, borderRadius: 3, opacity: 0.7 }} /></div></div>); })}
        </div>
        {/* Session frequency */}
        {(() => {
          const freqStats = tStats.filter((t) => t.fSess.length > 0).sort((a, b) => b.fSess.length - a.fSess.length);
          if (freqStats.length === 0) return null;
          const maxSess = freqStats[0].fSess.length;
          const totalSess = freqStats.reduce((a, t) => a + t.fSess.length, 0);
          return (
            <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Frecuencia</div>
              <div style={{ fontSize: 12, color: theme.textSec, marginBottom: 16 }}>{totalSess} sesiones en {periods.find((p) => p.key === period)?.label.toLowerCase()}</div>
              {freqStats.map((t) => (
                <div key={t.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: t.catColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: t.catColor }}>{t.fSess.length}</span>
                      <span style={{ fontSize: 11, color: theme.textSec }}>{totalSess > 0 ? Math.round((t.fSess.length / totalSess) * 100) : 0}%</span>
                    </div>
                  </div>
                  <div style={{ height: 5, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(t.fSess.length / maxSess) * 100}%`, backgroundColor: t.catColor, borderRadius: 3, opacity: 0.6 }} />
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        {/* Tag time stats */}
        {(() => {
          const tagTime = {};
          fTasks.forEach((t) => {
            (t.sessions || []).filter(filterS).forEach((s) => {
              (s.tags || []).forEach((tag) => { tagTime[tag] = (tagTime[tag] || 0) + s.duration; });
            });
          });
          const tagArr = Object.entries(tagTime).sort((a, b) => b[1] - a[1]);
          if (tagArr.length === 0) return null;
          const maxTag = tagArr[0][1];
          const totalTagTime = tagArr.reduce((a, [, s]) => a + s, 0);
          return (
            <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Mientras tanto</div>
              {tagArr.map(([tag, secs]) => (
                <div key={tag} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{tag}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: theme.accent }}>{fmtShort(secs)}</span>
                      <span style={{ fontSize: 11, color: theme.textSec }}>{totalTagTime > 0 ? Math.round((secs / totalTagTime) * 100) : 0}%</span>
                    </div>
                  </div>
                  <div style={{ height: 5, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(secs / maxTag) * 100}%`, backgroundColor: theme.accent, borderRadius: 3, opacity: 0.6 }} />
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        {/* Mood analysis */}
        {(() => {
          const MOODS = ["😫", "😕", "😐", "🙂", "🔥"];
          const moodSessions = fTasks.flatMap((t) => t.sessions.filter(filterS).filter((s) => s.mood).map((s) => ({ ...s, taskName: t.name, catName: t.catName, catColor: t.catColor })));
          if (moodSessions.length < 1) return null;
          const moodCounts = MOODS.map((m) => ({ mood: m, count: moodSessions.filter((s) => s.mood === m).length, totalTime: moodSessions.filter((s) => s.mood === m).reduce((a, s) => a + s.duration, 0) }));
          const maxCount = Math.max(...moodCounts.map((m) => m.count), 1);
          const avgMood = moodSessions.reduce((a, s) => a + MOODS.indexOf(s.mood), 0) / moodSessions.length;
          const taskMoods = {};
          fTasks.forEach((t) => { const ms = t.sessions.filter(filterS).filter((s) => s.mood); if (ms.length >= 3) { const avg = ms.reduce((a, s) => a + MOODS.indexOf(s.mood), 0) / ms.length; taskMoods[t.name] = { avg, count: ms.length, catColor: t.catColor }; } });
          const taskMoodArr = Object.entries(taskMoods).sort((a, b) => b[1].avg - a[1].avg);
          const tagMoods = {};
          moodSessions.forEach((s) => { (s.tags || []).forEach((tag) => { if (!tagMoods[tag]) tagMoods[tag] = []; tagMoods[tag].push(MOODS.indexOf(s.mood)); }); });
          const tagMoodArr = Object.entries(tagMoods).filter(([, v]) => v.length >= 3).map(([tag, vals]) => ({ tag, avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length })).sort((a, b) => b.avg - a.avg);

          return (
            <div style={{ padding: "20px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Estado de ánimo</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 16 }}>
                {moodCounts.map((m) => (
                  <div key={m.mood} style={{ textAlign: "center", flex: "0 0 auto" }}>
                    <div style={{ height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center", marginBottom: 6 }}>
                      <div style={{ width: 24, height: Math.max(4, (m.count / maxCount) * 56), backgroundColor: m.mood === "🔥" ? "#10b981" : m.mood === "🙂" ? "#34d399" : m.mood === "😐" ? "#fbbf24" : m.mood === "😕" ? "#f97316" : "#ef4444", borderRadius: 4, opacity: m.count > 0 ? 0.8 : 0.15 }} />
                    </div>
                    <div style={{ fontSize: 22 }}>{m.mood}</div>
                    <div style={{ fontSize: 11, color: theme.textSec, marginTop: 2 }}>{m.count}</div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "center", fontSize: 14, color: theme.textSec, marginBottom: 16 }}>
                Media: <span style={{ fontSize: 20 }}>{MOODS[Math.round(avgMood)]}</span>
                <span style={{ fontSize: 12, marginLeft: 6 }}>({moodSessions.length} sesiones)</span>
              </div>
              {taskMoodArr.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: theme.textSec, marginBottom: 8 }}>Tareas por ánimo (mín. 3 sesiones)</div>
                  {taskMoodArr.map(([name, data]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                      <span style={{ fontSize: 18 }}>{MOODS[Math.round(data.avg)]}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                        <div style={{ fontSize: 11, color: theme.textSec }}>{data.count} ses.</div>
                      </div>
                      <div style={{ width: 50, height: 4, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(data.avg / 4) * 100}%`, backgroundColor: data.catColor, borderRadius: 2 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tagMoodArr.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, color: theme.textSec, marginBottom: 8 }}>Etiquetas por ánimo (mín. 3 sesiones)</div>
                  {tagMoodArr.map((t) => (
                    <div key={t.tag} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                      <span style={{ fontSize: 18 }}>{MOODS[Math.round(t.avg)]}</span>
                      <span style={{ fontSize: 14, flex: 1 }}>{t.tag}</span>
                      <span style={{ fontSize: 11, color: theme.textSec }}>{t.count} ses.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Últimas 12 semanas</div>
          <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>{weeks.map((w, wi) => (<div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>{w.map((d, di) => (<div key={di} title={`${d.label}: ${fmtShort(d.tot)}`} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: heatColor(d.tot) }} />))}</div>))}</div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, marginTop: 8, fontSize: 11, color: theme.textSec }}><span>Menos</span>{[0, 0.25, 0.5, 0.75, 1].map((v, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: heatColor(v * maxHeat || (i === 0 ? 0 : 1)) }} />)}<span>Más</span></div>
        </div>
        <div style={{ height: 80 }} />
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dk, setDk] = useState(loadTheme);
  const [categories, setCat] = useState(() => {
    const l = loadLocal();
    return l ? l.map((c) => ({ ...c, tasks: c.tasks.map(ensureTask) })) : defaultCategories;
  });
  const [expanded, setExpanded] = useState(() => new Set());
  const [activeId, setActiveId] = useState(null); // ID of running task
  const [elapsed, setElapsed] = useState(0); // display-only seconds counter
  const [showNewCat, setShowNewCat] = useState(false);
  const [showNewTask, setShowNewTask] = useState(null);
  const [newCatName, setNewCatName] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [timerView, setTimerView] = useState(null);
  const [modal, setModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [noteModal, setNoteModal] = useState(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [showSubsMain, setShowSubsMain] = useState(new Set());
  const [editingSubId, setEditingSubId] = useState(null);
  const [editingSubVal, setEditingSubVal] = useState("");
  const [editingTagIdx, setEditingTagIdx] = useState(null);
  const [editingTagVal, setEditingTagVal] = useState("");
  const [showAllTags, setShowAllTags] = useState(false);
  const [editingTaskName, setEditingTaskName] = useState(false);
  const [editingTaskNameVal, setEditingTaskNameVal] = useState("");
  const [tags, setTags] = useState(loadTags);
  const [activeTags, setActiveTags] = useState(() => { try { const r = localStorage.getItem("task-timer-active-tags"); if (r) return JSON.parse(r); } catch (e) {} return []; });
  const [newTagName, setNewTagName] = useState("");
  const [pendingStop, setPendingStop] = useState(null); // { id, duration, tags }
  const [pendingTags, setPendingTags] = useState([]);
  const [showBackups, setShowBackups] = useState(false);
  const [backups, setBackups] = useState([]);
  const [searchQ, setSearchQ] = useState("");
  const intRef = useRef(null);
  const saveRef = useRef(null);
  const initDone = useRef(false);
  const fileRef = useRef(null);
  const catsRef = useRef(categories); // always-current ref for callbacks
  const tagsRef = useRef(tags);

  catsRef.current = categories;
  tagsRef.current = tags;

  const { saveToCloud, loadFromCloud, syncing, remoteCallbackRef, saveBackup, listBackups, restoreBackup } = useCloudSync(user);

  // ─── Auth ──────────────────────────────────────────
  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).then(() => {
      const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
      getRedirectResult(auth).then((r) => { if (r?.user) setUser(r.user); }).catch(() => {});
      return unsub;
    }).catch(() => setAuthLoading(false));
  }, []);
  const handleLogin = async () => {
    try { await setPersistence(auth, browserLocalPersistence); await signInWithPopup(auth, googleProvider); }
    catch (err) { if (err.code?.includes("popup")) { try { await signInWithRedirect(auth, googleProvider); } catch (e) {} } }
  };
  const handleLogout = async () => { if (activeId) doStop(activeId); await signOut(auth); initDone.current = false; };

  // ─── Cloud: initial load ───────────────────────────
  useEffect(() => {
    if (!user || initDone.current) return;
    loadFromCloud().then((data) => {
      initDone.current = true;
      if (!data || !data.categories || data.categories.length === 0) {
        // Nothing in cloud → upload local
        saveToCloud(catsRef.current, tagsRef.current);
        return;
      }
      // Always load from cloud (source of truth)
      const cats = data.categories.map((c) => ({ ...c, tasks: c.tasks.map(ensureTask) }));
      setCat(cats); saveLocal(cats); 
      // Recover tags: merge cloud + local + extracted from sessions
      const cloudTags = data.tags && data.tags.length > 0 ? data.tags : [];
      const localTags = tagsRef.current || [];
      const fromSessions = new Set();
      cats.forEach((c) => c.tasks.forEach((t) => (t.sessions || []).forEach((s) => (s.tags || []).forEach((tag) => fromSessions.add(tag)))));
      const merged = [...new Set([...cloudTags, ...localTags, ...fromSessions])];
      if (merged.length > 0) { setTags(merged); saveTags(merged); if (merged.length !== cloudTags.length) saveToCloud(cats, merged); }
      // Resume any running timer from cloud, expand only its category
      for (const c of cats) {
        for (const t of c.tasks) {
          if (t.isRunning && t.startedAt) {
            const el = calcElapsed(t.startedAt);
            if (el > 0 && el < 86400) { setActiveId(t.id); setElapsed(el); setExpanded(new Set([c.id])); }
            else { setCat((p) => p.map((cat) => ({ ...cat, tasks: cat.tasks.map((tk) => tk.id === t.id ? { ...tk, isRunning: false, startedAt: null } : tk) }))); }
            return;
          }
        }
      }
    });
  }, [user]);

  // ─── Cloud: handle remote changes ──────────────────
  useEffect(() => {
    remoteCallbackRef.current = (data) => {
      if (!initDone.current) return;
      const cats = (data.categories || []).map((c) => ({ ...c, tasks: c.tasks.map(ensureTask) }));
      setCat(cats); saveLocal(cats);
      if (data.tags && data.tags.length > 0) { setTags(data.tags); saveTags(data.tags); }
      // Check if remote stopped/started a timer
      let remoteRunning = null;
      for (const c of cats) { for (const t of c.tasks) { if (t.isRunning && t.startedAt) { remoteRunning = t; break; } } if (remoteRunning) break; }
      if (remoteRunning) {
        setActiveId(remoteRunning.id);
        setElapsed(calcElapsed(remoteRunning.startedAt));
      } else {
        if (intRef.current) clearInterval(intRef.current);
        setActiveId(null);
        setElapsed(0);
      }
    };
  }, []);

  // ─── Save to cloud on real changes (debounced) ─────
  const cloudSave = useCallback((cats, tgs) => {
    if (!user || !initDone.current) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => saveToCloud(cats, tgs), 1500);
  }, [user, saveToCloud]);

  // ─── Auto backup every 6 hours ──────────────────────
  const backupRef2 = useRef(null);
  const lastBackupRef = useRef(0);
  useEffect(() => {
    if (!user) return;
    const doBackup = () => {
      if (!initDone.current) return;
      const now = Date.now();
      const lastKey = `task-timer-last-backup-${user.uid}`;
      const stored = parseInt(localStorage.getItem(lastKey) || "0");
      const lastTs = Math.max(lastBackupRef.current, stored);
      if (now - lastTs > 21600000) { // 6 hours
        lastBackupRef.current = now;
        try { localStorage.setItem(lastKey, String(now)); } catch (e) {}
        saveBackup(catsRef.current, tagsRef.current);
      }
    };
    // Check after short delay to let init finish
    const t = setTimeout(doBackup, 3000);
    backupRef2.current = setInterval(doBackup, 600000); // check every 10 min
    return () => { clearTimeout(t); clearInterval(backupRef2.current); };
  }, [user, saveBackup]);

  const loadBackups = async () => {
    const list = await listBackups();
    setBackups(list);
    setShowBackups(true);
  };

  const doRestore = async (backup) => {
    const data = await restoreBackup(backup);
    if (data) {
      if (activeId) { clearInterval(intRef.current); setActiveId(null); setElapsed(0); }
      const cats = data.categories.map((c) => ({ ...c, tasks: c.tasks.map(ensureTask) }));
      setCat(cats); saveLocal(cats); 
      // Recover tags: backup → current → extract from sessions
      let restoredTags = data.tags && data.tags.length > 0 ? data.tags : tagsRef.current;
      if (!restoredTags || restoredTags.length === 0) {
        const fromSessions = new Set();
        cats.forEach((c) => c.tasks.forEach((t) => (t.sessions || []).forEach((s) => (s.tags || []).forEach((tag) => fromSessions.add(tag)))));
        if (fromSessions.size > 0) restoredTags = [...fromSessions];
      }
      if (restoredTags && restoredTags.length > 0) { setTags(restoredTags); saveTags(restoredTags); }
      saveToCloud(cats, restoredTags || []);
      setShowBackups(false);
      setTimerView(null);
    }
  };

  // ─── Elapsed display timer (NOT modifying categories) ──
  useEffect(() => {
    if (activeId) {
      // Find startedAt
      let startedAt = null;
      for (const c of catsRef.current) { for (const t of c.tasks) { if (t.id === activeId) { startedAt = t.startedAt; break; } } if (startedAt) break; }
      if (startedAt) {
        setElapsed(calcElapsed(startedAt));
        intRef.current = setInterval(() => setElapsed(calcElapsed(startedAt)), 1000);
      }
    } else {
      setElapsed(0);
    }
    return () => clearInterval(intRef.current);
  }, [activeId]);

  // Resume from localStorage on mount
  useEffect(() => {
    for (const c of categories) {
      for (const t of c.tasks) {
        if (t.isRunning && t.startedAt) {
          const el = calcElapsed(t.startedAt);
          if (el > 0 && el < 86400) { setActiveId(t.id); setElapsed(el); }
          return;
        }
      }
    }
  }, []);

  useEffect(() => { const h = (e) => { if (activeId) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [activeId]);

  // Theme
  useEffect(() => { saveTheme(dk); document.body.style.background = dk ? "#0a0a0a" : "#fafafa"; document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dk ? "#0a0a0a" : "#fafafa"); }, [dk]);
  const theme = dk
    ? { bg: "#0a0a0a", card: "#141414", border: "#252525", text: "#f5f5f5", textSec: "#737373", accent: "#ffffff", surface: "#1c1c1c" }
    : { bg: "#fafafa", card: "#ffffff", border: "#e5e5e5", text: "#0a0a0a", textSec: "#737373", accent: "#000000", surface: "#f0f0f0" };

  const toggle = (id) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const getTask = useCallback((id) => { for (const c of categories) { const t = c.tasks.find((x) => x.id === id); if (t) return { task: t, cat: c }; } return {}; }, [categories]);

  // ─── Timer: Start / Stop ───────────────────────────
  const MOODS = ["😫", "😕", "😐", "🙂", "🔥"];

  const doStop = (id) => {
    clearInterval(intRef.current);
    // Calculate duration before clearing
    let duration = 0;
    for (const c of catsRef.current) { for (const t of c.tasks) { if (t.id === id && t.startedAt) { duration = calcElapsed(t.startedAt); break; } } }
    if (duration > 0) {
      // Show emotion picker
      setPendingStop({ id, duration, tags: [...activeTags] });
      setPendingTags([...activeTags]);
    } else {
      // No duration, just stop
      finishStop(id, null);
    }
  };

  const finishStop = (id, mood) => {
    const ps = pendingStop || { id, duration: 0, tags: [...pendingTags] };
    const finalTags = pendingTags.length > 0 ? [...pendingTags] : ps.tags;
    setCat((prev) => {
      const next = prev.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
        if (t.id === id && t.startedAt) {
          const duration = calcElapsed(t.startedAt);
          if (duration > 0) {
            const now = new Date();
            const session = { duration, startedAt: new Date(now.getTime() - duration * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), endedAt: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), date: now.toLocaleDateString("es-ES"), dateISO: now.toISOString(), note: "", tags: finalTags };
            if (mood) session.mood = mood;
            return { ...t, isRunning: false, startedAt: null, totalSeconds: t.totalSeconds + duration, sessions: [...t.sessions, session] };
          }
        }
        return t.id === id ? { ...t, isRunning: false, startedAt: null } : t;
      }) }));
      saveLocal(next);
      cloudSave(next, tagsRef.current);
      return next;
    });
    setActiveId(null);
    setElapsed(0);
    setActiveTags([]);
    try { localStorage.setItem("task-timer-active-tags", "[]"); } catch (e) {}
    setPendingStop(null);
    setPendingTags([]);
  };

  const doStart = (id) => {
    if (activeId) doStop(activeId);
    const now = new Date().toISOString();
    setCat((prev) => {
      const next = prev.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, isRunning: true, startedAt: now } : t) }));
      saveLocal(next);
      cloudSave(next, tagsRef.current);
      return next;
    });
    setActiveId(id);
    setTimerView(id);
  };

  const toggleTimer = (id) => { if (activeId === id) doStop(id); else doStart(id); };

  // ─── CRUD (all save to local + cloud) ──────────────
  const update = (fn) => {
    setCat((prev) => {
      const next = fn(prev);
      saveLocal(next);
      cloudSave(next, tagsRef.current);
      return next;
    });
  };
  const updateTags = (fn) => {
    setTags((prev) => {
      const next = fn(prev);
      saveTags(next);
      cloudSave(catsRef.current, next);
      return next;
    });
  };

  const resetTask = (id) => { if (activeId === id) { clearInterval(intRef.current); setActiveId(null); setElapsed(0); } update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, totalSeconds: 0, isRunning: false, startedAt: null, sessions: [] } : t) }))); setModal(null); };
  const completeTask = (id) => { if (activeId === id) doStop(id); update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, completed: true, completedAt: new Date().toISOString(), isRunning: false, startedAt: null } : t) }))); setModal(null); if (timerView === id) setTimerView(null); };
  const uncomplete = (id) => update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, completed: false, completedAt: null } : t) })));
  const delTask = (id) => { if (activeId === id) { clearInterval(intRef.current); setActiveId(null); } if (timerView === id) setTimerView(null); update((p) => p.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== id) }))); setModal(null); };
  const delCat = (id) => { const c = categories.find((x) => x.id === id); if (c) c.tasks.forEach((t) => { if (activeId === t.id) { clearInterval(intRef.current); setActiveId(null); } if (timerView === t.id) setTimerView(null); }); update((p) => p.filter((x) => x.id !== id)); setModal(null); };
  const addCat = () => { if (!newCatName.trim()) return; const n = { id: `cat-${Date.now()}`, name: newCatName.trim(), color: CAT_COLORS[categories.length % CAT_COLORS.length], tasks: [] }; update((p) => [...p, n]); setExpanded((p) => new Set([...p, n.id])); setNewCatName(""); setShowNewCat(false); };
  const addTask = (cid) => { if (!newTaskName.trim()) return; const n = { id: `t-${Date.now()}`, name: newTaskName.trim(), totalSeconds: 0, isRunning: false, startedAt: null, completed: false, goalDaily: 0, sessions: [], subtasks: [], notes: "" }; update((p) => p.map((c) => c.id === cid ? { ...c, tasks: [...c.tasks, n] } : c)); setNewTaskName(""); setShowNewTask(null); };
  const editCatSave = (id, name, color) => { if (!name.trim()) return; update((p) => p.map((c) => c.id === id ? { ...c, name: name.trim(), color } : c)); setEditModal(null); };
  const editTaskSave = (id, name, _c, goalDaily) => { if (!name.trim()) return; update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, name: name.trim(), ...(goalDaily !== undefined ? { goalDaily } : {}) } : t) }))); setEditModal(null); };
  const moveTaskToCat = (taskId, toCatId) => { update((p) => { let task = null; const without = p.map((c) => { const found = c.tasks.find((t) => t.id === taskId); if (found) task = found; return { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) }; }); if (!task) return p; return without.map((c) => c.id === toCatId ? { ...c, tasks: [...c.tasks, task] } : c); }); setModal(null); };
  const moveCat = (id, dir) => update((p) => { const i = p.findIndex((c) => c.id === id); if ((dir === -1 && i === 0) || (dir === 1 && i === p.length - 1)) return p; const n = [...p]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n; });
  const moveTask = (catId, taskId, dir) => update((p) => p.map((c) => { if (c.id !== catId) return c; const i = c.tasks.findIndex((t) => t.id === taskId); if ((dir === -1 && i === 0) || (dir === 1 && i === c.tasks.length - 1)) return c; const n = [...c.tasks]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return { ...c, tasks: n }; }));
  const addSubtask = (taskId, name) => { if (!name.trim()) return; update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), { id: `st-${Date.now()}`, name: name.trim(), done: false }] } : t) }))); };
  const toggleSubtask = (taskId, stId) => update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === taskId ? { ...t, subtasks: (t.subtasks || []).map((st) => st.id === stId ? { ...st, done: !st.done } : st) } : t) })));
  const delSubtask = (taskId, stId) => update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === taskId ? { ...t, subtasks: (t.subtasks || []).filter((st) => st.id !== stId) } : t) })));
  const renameSubtask = (taskId, stId, name) => { if (!name.trim()) return; update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === taskId ? { ...t, subtasks: (t.subtasks || []).map((st) => st.id === stId ? { ...st, name: name.trim() } : st) } : t) }))); };
  const moveSubtask = (taskId, stId, dir) => update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => { if (t.id !== taskId) return t; const subs = [...(t.subtasks || [])]; const i = subs.findIndex((s) => s.id === stId); if ((dir === -1 && i === 0) || (dir === 1 && i === subs.length - 1)) return t; [subs[i], subs[i + dir]] = [subs[i + dir], subs[i]]; return { ...t, subtasks: subs }; }) })));
  const renameTag = (oldName, newName) => { if (!newName.trim() || newName.trim() === oldName) return; updateTags((p) => p.map((t) => t === oldName ? newName.trim() : t)); setActiveTags((p) => { const next = p.map((t) => t === oldName ? newName.trim() : t); try { localStorage.setItem("task-timer-active-tags", JSON.stringify(next)); } catch (e) {} return next; }); };
  const addTag = (name) => { if (!name.trim() || tags.includes(name.trim())) return; updateTags((p) => [...p, name.trim()]); };
  const delTag = (name) => { setModal({ title: "¿Eliminar etiqueta?", message: `"${name}" se eliminará de la lista.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => { updateTags((p) => p.filter((t) => t !== name)); setActiveTags((p) => { const next = p.filter((t) => t !== name); try { localStorage.setItem("task-timer-active-tags", JSON.stringify(next)); } catch (e) {} return next; }); setModal(null); } }); };
  const toggleActiveTag = (name) => { setActiveTags((p) => { const next = p.includes(name) ? p.filter((t) => t !== name) : [...p, name]; try { localStorage.setItem("task-timer-active-tags", JSON.stringify(next)); } catch (e) {} return next; }); };
  const saveSessionEdit = (taskId, sessIdx, changes) => { update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => { if (t.id !== taskId) return t; const s = [...t.sessions]; const old = s[sessIdx]; const timeDiff = changes.duration - old.duration; s[sessIdx] = { ...old, note: changes.note, mood: changes.mood, duration: changes.duration, tags: changes.tags || old.tags || [], startedAt: changes.startedAt || old.startedAt, endedAt: changes.endedAt || old.endedAt, date: changes.date || old.date, dateISO: changes.dateISO || old.dateISO }; return { ...t, sessions: s, totalSeconds: Math.max(0, t.totalSeconds + timeDiff) }; }) }))); setNoteModal(null); };
  const delSession = (taskId, sessIdx) => { update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => { if (t.id !== taskId) return t; const s = [...t.sessions]; const removed = s.splice(sessIdx, 1)[0]; return { ...t, sessions: s, totalSeconds: Math.max(0, t.totalSeconds - (removed?.duration || 0)) }; }) }))); setModal(null); };

  const exportData = () => { const b = new Blob([JSON.stringify(categories, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `task-timer-${getDateStr()}.json`; a.click(); URL.revokeObjectURL(u); };
  const importData = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => { try {
      const d = JSON.parse(ev.target.result);
      if (Array.isArray(d) && d.length > 0) {
        setModal({ title: "¿Importar datos?", message: `${d.length} categorías, ${d.reduce((s, c) => s + (c.tasks?.length || 0), 0)} tareas. Reemplazará tus datos.`, confirmLabel: "Importar", confirmColor: "#6366f1", onConfirm: () => { if (activeId) { clearInterval(intRef.current); setActiveId(null); setElapsed(0); } const cl = d.map((c) => ({ ...c, tasks: (c.tasks || []).map((t) => ({ ...ensureTask(t), isRunning: false, startedAt: null })) })); update(() => cl); setExpanded(new Set(cl.map((c) => c.id))); setTimerView(null); setModal(null); } });
      } else alert("Formato no válido.");
    } catch (err) { alert("Error: JSON no válido."); } };
    r.readAsText(f); e.target.value = "";
  };

  // ─── Derived state ─────────────────────────────────
  const atd = timerView ? getTask(timerView) : null;
  const todayTime = (task) => {
    const sessToday = (task.sessions || []).filter(isToday).reduce((s, x) => s + x.duration, 0);
    return sessToday + (task.id === activeId ? elapsed : 0);
  };
  const totalToday = categories.reduce((s, c) => s + c.tasks.reduce((a, t) => a + todayTime(t), 0), 0);

  if (authLoading) return (
    <div style={{ minHeight: "100dvh", backgroundColor: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textSec, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>⏱</div><div style={{ fontSize: 15 }}>Cargando...</div></div>
    </div>
  );

  return (
    <div style={{ minHeight: "100dvh", backgroundColor: theme.bg, color: theme.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', WebkitFontSmoothing: "antialiased" }}>

      {showStats && <StatsView categories={categories} theme={theme} dk={dk} onClose={() => setShowStats(false)} />}

      {/* Backups */}
      {showBackups && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: theme.bg, zIndex: 100, overflow: "auto", animation: "fadeIn .2s" }}>
          <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
              <button onClick={() => setShowBackups(false)} style={{ background: "none", border: "none", color: theme.text, cursor: "pointer", padding: 4, display: "flex" }}>{I.back}</button>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Backups</h1>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: theme.textSec, padding: "12px 0" }}>
              <span>Se crean automáticamente cada 6 horas. Máx. 24 copias.</span>
              <button onClick={async () => { await saveBackup(catsRef.current, tagsRef.current); lastBackupRef.current = Date.now(); const list = await listBackups(); setBackups(list); }} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>Crear ahora</button>
            </div>
            {backups.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: theme.textSec }}>No hay backups todavía</div>}
            {backups.map((b) => {
              const d = new Date(b.createdAt);
              const cats = b.categories || [];
              const totalTasks = cats.reduce((s, c) => s + (c.tasks?.length || 0), 0);
              const totalSess = cats.reduce((s, c) => s + (c.tasks || []).reduce((a, t) => a + (t.sessions?.length || 0), 0), 0);
              return (
                <div key={b.id} style={{ padding: "14px 16px", marginBottom: 8, borderRadius: 12, backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })} · {d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
                      <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3 }}>{cats.length} cat. · {totalTasks} tareas · {totalSess} sesiones · {(b.tags || []).length} etiq.</div>
                    </div>
                    <button onClick={() => setModal({ title: "¿Restaurar backup?", message: `Del ${d.toLocaleDateString("es-ES")} a las ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}. Reemplazará todos tus datos actuales.`, confirmLabel: "Restaurar", confirmColor: "#6366f1", onConfirm: () => { doRestore(b); setModal(null); } })} style={{ padding: "8px 16px", borderRadius: 10, border: "none", backgroundColor: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>Restaurar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timer fullscreen */}
      {timerView && atd?.task && (() => {
        const t = ensureTask(atd.task), c = atd.cat;
        const isActive = activeId === timerView;
        const displaySecs = isActive ? elapsed : 0;
        return (
          <div style={{ position: "fixed", inset: 0, backgroundColor: dk ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)", zIndex: 100, display: "flex", flexDirection: "column", animation: "fadeIn .25s" }}>
            <button onClick={() => { setTimerView(null); setEditingTaskName(false); }} style={{ position: "absolute", top: 20, right: 20, background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 10, zIndex: 2 }}>{I.x}</button>
            {/* Fixed top */}
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px 24px" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: c.color, marginBottom: 12, opacity: 0.8 }} />
              <div style={{ fontSize: 13, color: theme.textSec, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>{c.name}</div>
              {editingTaskName ? (
                <input autoFocus value={editingTaskNameVal} onChange={(e) => setEditingTaskNameVal(e.target.value)} onBlur={() => { if (editingTaskNameVal.trim()) editTaskSave(timerView, editingTaskNameVal.trim()); setEditingTaskName(false); }} onKeyDown={(e) => { if (e.key === "Enter") { if (editingTaskNameVal.trim()) editTaskSave(timerView, editingTaskNameVal.trim()); setEditingTaskName(false); } if (e.key === "Escape") setEditingTaskName(false); }} style={{ fontSize: 20, fontWeight: 600, textAlign: "center", padding: "4px 12px", marginBottom: 24, border: `1px solid ${theme.border}`, borderRadius: 10, backgroundColor: theme.surface, color: theme.text, outline: "none", width: "80%", maxWidth: 300, fontFamily: "inherit" }} />
              ) : (
                <div onClick={() => { setEditingTaskName(true); setEditingTaskNameVal(t.name); }} style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, textAlign: "center", padding: "0 20px", cursor: "pointer" }}>{t.name}</div>
              )}
              <div style={{ fontSize: "min(64px, 13vw)", fontWeight: 200, fontVariantNumeric: "tabular-nums", color: isActive ? theme.text : theme.textSec, marginBottom: 24, letterSpacing: 3 }}>{formatTime(displaySecs)}</div>
              <button onClick={() => toggleTimer(timerView)} style={{ width: 72, height: 72, borderRadius: "50%", border: "none", backgroundColor: isActive ? (dk ? "#fff" : "#000") : c.color, color: isActive ? (dk ? "#000" : "#fff") : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 0 40px ${isActive ? (dk ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)") : c.color + "44"}` }}>
                {isActive ? I.pause : I.play}
              </button>
            </div>
            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px 40px", WebkitOverflowScrolling: "touch" }}>

            {/* Goal */}
            {t.goalDaily > 0 && (
              <div style={{ marginTop: 24, width: "80%", maxWidth: 260 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: theme.textSec, marginBottom: 4 }}><span>{I.target} Objetivo diario</span><span>{fmtShort(todayTime(t))} / {fmtShort(t.goalDaily)}</span></div>
                <div style={{ height: 6, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, (todayTime(t) / t.goalDaily) * 100)}%`, backgroundColor: todayTime(t) >= t.goalDaily ? "#10b981" : c.color, borderRadius: 3 }} /></div>
                {todayTime(t) >= t.goalDaily && <div style={{ fontSize: 12, color: "#10b981", textAlign: "center", marginTop: 4, fontWeight: 600 }}>✓ Objetivo alcanzado</div>}
              </div>
            )}

            {/* Tags */}
            {(() => {
              // Sort tags by most recent use in this category
              const catSessions = c.tasks.flatMap((tk) => (tk.sessions || []).filter((s) => s.tags && s.tags.length > 0));
              const tagRecency = {};
              catSessions.forEach((s) => { const ts = s.dateISO ? new Date(s.dateISO).getTime() : 0; (s.tags || []).forEach((tag) => { if (!tagRecency[tag] || ts > tagRecency[tag]) tagRecency[tag] = ts; }); });
              const sorted = [...tags].sort((a, b) => (tagRecency[b] || 0) - (tagRecency[a] || 0));
              // Active tags always shown first
              const activeFirst = [...sorted.filter((t) => activeTags.includes(t)), ...sorted.filter((t) => !activeTags.includes(t))];
              const TAG_LIMIT = 6;
              const visible = showAllTags ? activeFirst : activeFirst.slice(0, TAG_LIMIT);
              const hasMore = activeFirst.length > TAG_LIMIT;

              const renderTag = (tag) => {
                const tgi = tags.indexOf(tag);
                return editingTagIdx === tgi ? (
                  <div key={tag} style={{ display: "flex", gap: 4 }}>
                    <input autoFocus value={editingTagVal} onChange={(e) => setEditingTagVal(e.target.value)} onBlur={() => { renameTag(tag, editingTagVal); setEditingTagIdx(null); }} onKeyDown={(e) => { if (e.key === "Enter") { renameTag(tag, editingTagVal); setEditingTagIdx(null); } if (e.key === "Escape") setEditingTagIdx(null); }} style={{ padding: "5px 10px", borderRadius: 16, border: `1px solid ${c.color}`, backgroundColor: theme.surface, color: theme.text, fontSize: 13, outline: "none", width: 120 }} />
                  </div>
                ) : (
                  <div key={tag} style={{ display: "flex", alignItems: "center", gap: 0, padding: "4px 4px 4px 12px", borderRadius: 20, border: activeTags.includes(tag) ? `2px solid ${c.color}` : `1px solid ${theme.border}`, backgroundColor: activeTags.includes(tag) ? `${c.color}15` : "transparent" }}>
                    <span onClick={() => toggleActiveTag(tag)} style={{ fontSize: 13, fontWeight: activeTags.includes(tag) ? 600 : 400, color: activeTags.includes(tag) ? c.color : theme.textSec, cursor: "pointer" }}>{tag}</span>
                    {showAllTags && <button onClick={() => { setEditingTagIdx(tgi); setEditingTagVal(tag); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: "2px 4px", opacity: 0.4, display: "flex" }}>{I.edit}</button>}
                    {showAllTags && <button onClick={() => setModal({ title: "¿Eliminar etiqueta?", message: `"${tag}" se eliminará permanentemente.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delTag(tag) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: "2px 4px", opacity: 0.4, display: "flex" }}>{I.x}</button>}
                  </div>
                );
              };

              return (
                <div style={{ marginTop: 24, width: "90%", maxWidth: 320 }}>
                  <div style={{ fontSize: 12, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>{I.tag} {isActive ? "Mientras tanto..." : "Etiquetas"}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {visible.map(renderTag)}
                    {hasMore && !showAllTags && (
                      <button onClick={() => setShowAllTags(true)} style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 13, cursor: "pointer" }}>+{activeFirst.length - TAG_LIMIT} más</button>
                    )}
                    {hasMore && showAllTags && (
                      <button onClick={() => setShowAllTags(false)} style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 13, cursor: "pointer" }}>Menos</button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newTagName.trim()) { addTag(newTagName); setNewTagName(""); } }} placeholder="Nueva etiqueta..." style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 13, outline: "none" }} />
                    <button onClick={() => { if (newTagName.trim()) { addTag(newTagName); setNewTagName(""); } }} style={{ padding: "0 10px", borderRadius: 8, border: "none", backgroundColor: c.color, color: "#fff", fontSize: 12, fontWeight: 600 }}>+</button>
                  </div>
                </div>
              );
            })()}

            {/* Stats */}
            <div style={{ marginTop: 28, display: "flex", gap: 32, color: theme.textSec, fontSize: 14 }}>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 600, color: theme.text, opacity: 0.8 }}>{fmtLong(t.totalSeconds + (isActive ? elapsed : 0))}</div><div>Total</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 600, color: theme.text, opacity: 0.8 }}>{t.sessions.length}</div><div>Sesiones</div></div>
            </div>

            {/* Subtasks */}
            {((t.subtasks || []).length > 0 || !t.completed) && (
              <div style={{ marginTop: 24, width: "90%", maxWidth: 320 }}>
                <div style={{ fontSize: 12, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Subtareas ({(t.subtasks || []).filter((s) => s.done).length}/{(t.subtasks || []).length})</div>
                {(t.subtasks || []).map((st, sti) => (
                  <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: `1px solid ${theme.border}` }}>
                    <button onClick={() => toggleSubtask(timerView, st.id)} style={{ width: 22, height: 22, borderRadius: 6, border: st.done ? "none" : `2px solid ${theme.border}`, backgroundColor: st.done ? "#10b981" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>{st.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}</button>
                    {editingSubId === st.id ? (
                      <input autoFocus value={editingSubVal} onChange={(e) => setEditingSubVal(e.target.value)} onBlur={() => { renameSubtask(timerView, st.id, editingSubVal); setEditingSubId(null); }} onKeyDown={(e) => { if (e.key === "Enter") { renameSubtask(timerView, st.id, editingSubVal); setEditingSubId(null); } if (e.key === "Escape") setEditingSubId(null); }} style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none" }} />
                    ) : (
                      <span onClick={() => { setEditingSubId(st.id); setEditingSubVal(st.name); }} style={{ fontSize: 14, textDecoration: st.done ? "line-through" : "none", color: st.done ? theme.textSec : theme.text, flex: 1, cursor: "pointer" }}>{st.name}</span>
                    )}
                    <div style={{ display: "flex", gap: 0, flexShrink: 0 }}>
                      <button onClick={() => moveSubtask(timerView, st.id, -1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 2, opacity: sti === 0 ? 0.15 : 0.4 }}>{I.up}</button>
                      <button onClick={() => moveSubtask(timerView, st.id, 1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 2, opacity: sti === (t.subtasks || []).length - 1 ? 0.15 : 0.4 }}>{I.down}</button>
                      <button onClick={() => delSubtask(timerView, st.id)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 2, opacity: 0.4 }}>{I.trash}</button>
                    </div>
                  </div>
                ))}
                <SubtaskInput taskId={timerView} onAdd={addSubtask} theme={theme} />
              </div>
            )}

            {/* Sessions */}
            {t.sessions.length > 0 && (
              <div style={{ marginTop: 24, maxWidth: 320, width: "90%" }}>
                <div style={{ fontSize: 12, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Sesiones ({t.sessions.length})</div>
                {(showAllSessions ? t.sessions : t.sessions.slice(-5)).slice().reverse().map((s, i) => {
                  const si = t.sessions.length - 1 - i;
                  return (
                    <div key={si} style={{ padding: "7px 0", borderBottom: `1px solid ${theme.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: theme.textSec }}>
                        <span>{s.mood ? `${s.mood} ` : ""}{fmtShort(s.duration)}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{s.date ? `${s.date} · ` : ""}{s.startedAt ? `${s.startedAt} → ` : ""}{s.endedAt}</span>
                          <button onClick={() => setNoteModal({ taskId: timerView, sessIdx: si, session: s })} style={{ background: "none", border: "none", color: (s.note || s.mood) ? "#6366f1" : theme.textSec, cursor: "pointer", padding: 2, opacity: (s.note || s.mood) ? 1 : 0.4 }}>{I.edit}</button>
                          <button onClick={() => setModal({ title: "¿Eliminar sesión?", message: `${fmtShort(s.duration)} · ${s.date || ""} ${s.endedAt || ""}`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delSession(timerView, si) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 2, opacity: 0.4 }}>{I.trash}</button>
                        </div>
                      </div>
                      {s.note && <div style={{ fontSize: 12, color: theme.textSec, marginTop: 3, fontStyle: "italic" }}>{s.note}</div>}
                      {s.tags && s.tags.length > 0 && <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>{s.tags.map((tag) => <span key={tag} style={{ padding: "2px 8px", borderRadius: 10, backgroundColor: dk ? "#1c1c1c" : "#eee", fontSize: 11, color: theme.textSec }}>{tag}</span>)}</div>}
                    </div>
                  );
                })}
                {t.sessions.length > 5 && <button onClick={() => setShowAllSessions(!showAllSessions)} style={{ width: "100%", padding: "8px 0", marginTop: 4, background: "none", border: "none", color: theme.textSec, fontSize: 13, cursor: "pointer" }}>{showAllSessions ? "Ver menos" : `Ver todas (${t.sessions.length})`}</button>}
              </div>
            )}
            </div>{/* end scrollable */}
          </div>
        );
      })()}

      {/* Modals */}
      {modal && <Modal {...modal} onCancel={() => setModal(null)} theme={theme} />}
      {editModal && <EditModal {...editModal} onCancel={() => setEditModal(null)} theme={theme} />}
      {noteModal && <SessionEditModal {...noteModal} allTags={tags} onSave={saveSessionEdit} onCancel={() => setNoteModal(null)} theme={theme} dk={dk} />}

      {/* Mood + Tags picker */}
      {pendingStop && (() => {
        const { task: pt, cat: pc } = getTask(pendingStop.id) || {};
        const togglePendingTag = (tag) => setPendingTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]);
        return (
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s" }} onClick={() => finishStop(pendingStop.id, null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "28px 24px", maxWidth: 380, width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>¿Cómo te ha ido?</div>
              <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>{pt?.name || ""} · {fmtShort(pendingStop.duration)}</div>
              {/* Tags */}
              {tags.length > 0 && (
                <div style={{ margin: "16px 0", textAlign: "left" }}>
                  <div style={{ fontSize: 11, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Mientras tanto...</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {tags.map((tag) => (
                      <button key={tag} onClick={() => togglePendingTag(tag)} style={{ padding: "5px 14px", borderRadius: 20, border: pendingTags.includes(tag) ? `2px solid ${pc?.color || "#6366f1"}` : `1px solid ${theme.border}`, backgroundColor: pendingTags.includes(tag) ? `${pc?.color || "#6366f1"}15` : "transparent", color: pendingTags.includes(tag) ? (pc?.color || "#6366f1") : theme.textSec, fontSize: 13, fontWeight: pendingTags.includes(tag) ? 600 : 400, cursor: "pointer" }}>{tag}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Mood */}
              <div style={{ display: "flex", justifyContent: "center", gap: 12, margin: "20px 0" }}>
                {MOODS.map((m) => (
                  <button key={m} onClick={() => finishStop(pendingStop.id, m)} style={{ width: 52, height: 52, borderRadius: 14, border: `2px solid ${theme.border}`, backgroundColor: theme.surface, fontSize: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform .1s, border-color .15s" }} onMouseEnter={(e) => { e.target.style.transform = "scale(1.15)"; e.target.style.borderColor = pc?.color || "#6366f1"; }} onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.borderColor = theme.border; }}>{m}</button>
                ))}
              </div>
              <button onClick={() => finishStop(pendingStop.id, null)} style={{ background: "none", border: "none", color: theme.textSec, fontSize: 14, cursor: "pointer", padding: "8px 16px" }}>Saltar</button>
            </div>
          </div>
        );
      })()}

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        {/* Header */}
        <div style={{ padding: "20px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Tareas</h1>
              <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>{I.clock}<span>Hoy: {fmtLong(totalToday)}</span></div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <ProfileMenu user={user} onLogin={handleLogin} onLogout={handleLogout} onBackups={loadBackups} syncing={syncing} theme={theme} dk={dk} />
              <button onClick={() => setExpanded((p) => p.size > 0 ? new Set() : new Set(categories.map((c) => c.id)))} title={expanded.size > 0 ? "Contraer todas" : "Expandir todas"} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{expanded.size > 0 ? I.collapseAll : I.chev}</button>
              <button onClick={() => setShowStats(true)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.chart}</button>
              <button onClick={() => setDk(!dk)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{dk ? I.sun : I.moon}</button>
            </div>
          </div>
          {/* Search */}
          <div style={{ marginTop: 12, position: "relative" }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: theme.textSec, display: "flex", opacity: 0.5 }}>{I.search}</div>
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Buscar tareas..." style={{ width: "100%", padding: "10px 14px 10px 38px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none" }} />
            {searchQ && <button onClick={() => setSearchQ("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: theme.textSec, cursor: "pointer", display: "flex", padding: 4 }}>{I.x}</button>}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={() => { setShowNewCat(true); setShowNewTask(null); }} style={{ flex: 1, background: theme.accent, border: "none", borderRadius: 10, color: dk ? "#000" : "#fff", cursor: "pointer", height: 40, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, fontWeight: 600 }}>{I.plus}<span>Nueva categoría</span></button>
            <button onClick={exportData} title="Exportar" style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.dl}</button>
            <button onClick={() => fileRef.current?.click()} title="Importar" style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.ul}</button>
            <input ref={fileRef} type="file" accept=".json" onChange={importData} style={{ display: "none" }} />
          </div>
        </div>

        {/* Active banner */}
        {activeId && (() => { const { task: at, cat: ac } = getTask(activeId); if (!at) return null; return (
          <div onClick={() => setTimerView(activeId)} style={{ margin: "14px 0 0", padding: "14px 16px", borderRadius: 14, background: `linear-gradient(135deg, ${ac.color}22, ${ac.color}08)`, border: `1px solid ${ac.color}33`, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: ac.color, animation: "pulse 1.5s infinite", flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{at.name}</div><div style={{ fontSize: 12, color: theme.textSec }}>{ac.name}</div></div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 300, fontVariantNumeric: "tabular-nums", color: ac.color, flexShrink: 0, marginLeft: 8 }}>{formatTime(elapsed)}</div>
          </div>
        ); })()}

        {/* New category */}
        {showNewCat && (
          <div style={{ margin: "14px 0 0", padding: 16, borderRadius: 14, backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Nueva categoría</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCat(); if (e.key === "Escape") { setShowNewCat(false); setNewCatName(""); } }} placeholder="Nombre..." style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 16, outline: "none" }} />
              <button onClick={addCat} style={{ padding: "0 18px", borderRadius: 10, border: "none", backgroundColor: theme.accent, color: dk ? "#000" : "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Crear</button>
              <button onClick={() => { setShowNewCat(false); setNewCatName(""); }} style={{ padding: "0 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {/* Categories */}
        <div style={{ paddingTop: 4, paddingBottom: 100 }}>
          {categories.map((cat, catIdx) => {
            const sq = searchQ.trim().toLowerCase();
            const aTasks = cat.tasks.filter((t) => !t.completed && (!sq || t.name.toLowerCase().includes(sq)));
            const weekStart = getWeekStart();
            const cTasks = cat.tasks.filter((t) => t.completed && t.completedAt && new Date(t.completedAt) >= weekStart && (!sq || t.name.toLowerCase().includes(sq)));
            const allATasks = cat.tasks.filter((t) => !t.completed);
            // If searching and no matches in this category, hide it
            if (sq && aTasks.length === 0 && cTasks.length === 0) return null;
            // Auto-expand categories when searching
            const isExpanded = sq ? true : expanded.has(cat.id);
            return (
              <div key={cat.id} style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1 }} onClick={() => toggle(cat.id)}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: cat.color, opacity: 0.8 }} />
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{cat.name}</span>
                    <span style={{ fontSize: 14, color: theme.textSec }}>{allATasks.length}</span>
                    {cTasks.length > 0 && <span style={{ fontSize: 12, color: "#10b981" }}>+{cTasks.length} ✓</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button onClick={() => moveCat(cat.id, -1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: catIdx === 0 ? 0.15 : 0.5 }}>{I.up}</button>
                    <button onClick={() => moveCat(cat.id, 1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: catIdx === categories.length - 1 ? 0.15 : 0.5 }}>{I.down}</button>
                    <button onClick={() => setEditModal({ title: "Editar categoría", value: cat.name, color: cat.color, onColorChange: true, onSave: (n, c) => editCatSave(cat.id, n, c) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.5 }}>{I.edit}</button>
                    <button onClick={() => setModal({ title: "¿Eliminar categoría?", message: `"${cat.name}" y todas sus tareas.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delCat(cat.id) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.trash}</button>
                    <div onClick={() => toggle(cat.id)} style={{ transform: isExpanded ? "rotate(0)" : "rotate(-90deg)", transition: "transform .2s", color: theme.textSec, display: "flex", cursor: "pointer", padding: 4 }}>{I.chev}</div>
                  </div>
                </div>

                {isExpanded && (<div>
                  {aTasks.map((task, ti) => {
                    const t = ensureTask(task);
                    const isActive = activeId === t.id;
                    const tToday = todayTime(t);
                    const goalPct = t.goalDaily > 0 ? Math.min(100, (tToday / t.goalDaily) * 100) : -1;
                    return (
                      <div key={t.id} onClick={() => setTimerView(t.id)} style={{ padding: "12px 12px", marginBottom: 5, borderRadius: 12, backgroundColor: isActive ? `${cat.color}12` : theme.card, border: `1px solid ${isActive ? `${cat.color}33` : theme.border}`, cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                            <div style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                            <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                              {I.clock} <span>{fmtLong(t.totalSeconds + (isActive ? elapsed : 0))}</span>
                              {t.sessions.length > 0 && <span>· {t.sessions.length} ses.</span>}
                              {t.goalDaily > 0 && <span style={{ color: goalPct >= 100 ? "#10b981" : "#6366f1" }}>· {goalPct >= 100 ? "✓" : `${Math.round(goalPct)}%`}</span>}
                              {(t.subtasks || []).length > 0 && <span>· {(t.subtasks || []).filter((s) => s.done).length}/{(t.subtasks || []).length} sub</span>}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                            {isActive && <span style={{ fontSize: 14, fontWeight: 300, fontVariantNumeric: "tabular-nums", color: cat.color, marginRight: 2 }}>{formatTime(elapsed)}</span>}
                            <button onClick={(e) => { e.stopPropagation(); toggleTimer(t.id); }} style={{ width: 38, height: 38, borderRadius: "50%", border: "none", backgroundColor: isActive ? cat.color : theme.surface, color: isActive ? "#fff" : theme.textSec, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{isActive ? I.pause : I.play}</button>
                          </div>
                        </div>
                        {t.goalDaily > 0 && (<div style={{ marginTop: 8, height: 4, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${goalPct}%`, backgroundColor: goalPct >= 100 ? "#10b981" : cat.color, borderRadius: 2 }} /></div>)}
                        {/* Inline subtasks */}
                        {(t.subtasks || []).length > 0 && (
                          <div style={{ marginTop: 8, paddingTop: 4, borderTop: `1px solid ${theme.border}` }} onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setShowSubsMain((p) => { const n = new Set(p); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: theme.textSec, fontSize: 12, cursor: "pointer", padding: "2px 0", marginBottom: 2 }}>
                              <div style={{ transform: showSubsMain.has(t.id) ? "rotate(0)" : "rotate(-90deg)", transition: "transform .2s", display: "flex" }}>{I.chev}</div>
                              Subtareas ({(t.subtasks || []).filter((s) => s.done).length}/{(t.subtasks || []).length})
                            </button>
                            {showSubsMain.has(t.id) && (t.subtasks || []).map((st) => (
                              <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0" }}>
                                <button onClick={() => toggleSubtask(t.id, st.id)} style={{ width: 18, height: 18, borderRadius: 5, border: st.done ? "none" : `1.5px solid ${theme.border}`, backgroundColor: st.done ? "#10b981" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>{st.done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}</button>
                                <span style={{ fontSize: 13, textDecoration: st.done ? "line-through" : "none", color: st.done ? theme.textSec : theme.text }}>{st.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 6, justifyContent: "flex-end" }}>
                          <button onClick={(e) => { e.stopPropagation(); moveTask(cat.id, t.id, -1); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: ti === 0 ? 0.15 : 0.4 }}>{I.up}</button>
                          <button onClick={(e) => { e.stopPropagation(); moveTask(cat.id, t.id, 1); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: ti === aTasks.length - 1 ? 0.15 : 0.4 }}>{I.down}</button>
                          <button onClick={(e) => { e.stopPropagation(); setEditModal({ title: "Editar tarea", value: t.name, goalDaily: t.goalDaily, onGoalChange: true, onSave: (n, _c, g) => editTaskSave(t.id, n, _c, g) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.edit}</button>
                          <button onClick={(e) => { e.stopPropagation(); const others = categories.filter((x) => x.id !== cat.id); if (others.length === 0) return; setModal({ title: "Mover tarea", message: `"${t.name}" a:`, options: others.map((o) => ({ label: o.name, color: o.color, onSelect: () => moveTaskToCat(t.id, o.id) })) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.move}</button>
                          <button onClick={(e) => { e.stopPropagation(); setModal({ title: "¿Completar?", message: `"${t.name}" → completadas.`, confirmLabel: "Completar", confirmColor: "#10b981", onConfirm: () => completeTask(t.id) }); }} style={{ background: "none", border: "none", color: "#10b981", cursor: "pointer", padding: 4, opacity: 0.5 }}>{I.check}</button>
                          <button onClick={(e) => { e.stopPropagation(); setModal({ title: "¿Resetear?", message: `Borrar tiempo de "${t.name}".`, confirmLabel: "Resetear", confirmColor: "#f59e0b", onConfirm: () => resetTask(t.id) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.reset}</button>
                          <button onClick={(e) => { e.stopPropagation(); setModal({ title: "¿Eliminar?", message: `"${t.name}" permanentemente.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delTask(t.id) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.trash}</button>
                        </div>
                      </div>
                    );
                  })}
                  {showNewTask === cat.id ? (
                    <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                      <input autoFocus value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTask(cat.id); if (e.key === "Escape") { setShowNewTask(null); setNewTaskName(""); } }} placeholder="Nueva tarea..." style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none" }} />
                      <button onClick={() => addTask(cat.id)} style={{ padding: "0 16px", borderRadius: 10, border: "none", backgroundColor: cat.color, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Añadir</button>
                      <button onClick={() => { setShowNewTask(null); setNewTaskName(""); }} style={{ padding: "0 12px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 15, cursor: "pointer" }}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => { setShowNewTask(cat.id); setShowNewCat(false); setNewTaskName(""); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", margin: "5px 0", borderRadius: 10, border: `1px dashed ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 14, cursor: "pointer", width: "100%" }}>{I.plus} Añadir tarea</button>
                  )}
                  {cTasks.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => setShowDone(showDone === cat.id ? false : cat.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", background: "none", border: "none", color: theme.textSec, fontSize: 14, cursor: "pointer" }}><div style={{ transform: showDone === cat.id ? "rotate(0)" : "rotate(-90deg)", transition: "transform .2s", display: "flex" }}>{I.chev}</div>Completadas ({cTasks.length})</button>
                      {showDone === cat.id && cTasks.map((task) => (
                        <div key={task.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", marginBottom: 4, borderRadius: 12, backgroundColor: theme.card, border: `1px solid ${theme.border}`, opacity: 0.6 }}>
                          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 500, textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</div><div style={{ fontSize: 13, color: theme.textSec, marginTop: 2 }}>{fmtLong(task.totalSeconds)} · {task.sessions.length} ses.</div></div>
                          <div style={{ display: "flex", gap: 4 }}><button onClick={() => uncomplete(task.id)} title="Reactivar" style={{ background: "none", border: "none", color: "#f59e0b", cursor: "pointer", padding: 6 }}>{I.reset}</button><button onClick={() => setModal({ title: "¿Eliminar?", message: `"${task.name}".`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delTask(task.id) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 6, opacity: 0.4 }}>{I.trash}</button></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>)}
              </div>
            );
          })}
          {categories.length === 0 && (<div style={{ textAlign: "center", padding: "60px 20px", color: theme.textSec }}><div style={{ fontSize: 42, marginBottom: 12 }}>⏱</div><div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>Sin categorías</div><div style={{ fontSize: 15 }}>Crea tu primera categoría para empezar</div></div>)}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        * { box-sizing:border-box; -webkit-tap-highlight-color:transparent }
        html,body { overscroll-behavior:none }
        input::placeholder { color:${theme.textSec}88 }
        input { font-size:16px !important }
        button { cursor:pointer }
        button:active { transform:scale(.97) }
      `}</style>
    </div>
  );
}
