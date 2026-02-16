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
import { doc, setDoc, onSnapshot } from "firebase/firestore";

// ─── Helpers ───────────────────────────────────────────
const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

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

// ─── Storage ───────────────────────────────────────────
const THEME_KEY = "task-timer-theme", LOCAL_KEY = "task-timer-data", TAGS_KEY = "task-timer-tags";
const saveTheme = (d) => { try { localStorage.setItem(THEME_KEY, JSON.stringify(d)); } catch (e) {} };
const loadTheme = () => { try { const r = localStorage.getItem(THEME_KEY); if (r !== null) return JSON.parse(r); } catch (e) {} return true; };
const saveLocal = (c) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(c)); } catch (e) {} };
const loadLocal = () => { try { const r = localStorage.getItem(LOCAL_KEY); if (r) return JSON.parse(r); } catch (e) {} return null; };
const saveTags = (t) => { try { localStorage.setItem(TAGS_KEY, JSON.stringify(t)); } catch (e) {} };
const loadTags = () => { try { const r = localStorage.getItem(TAGS_KEY); if (r) return JSON.parse(r); } catch (e) {} return ["Podcast", "Música", "Llamada", "Reunión"]; };

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
  back: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12,19 5,12 12,5" /></svg>,
  edit: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11,4H4A2,2,0,0,0,2,6V20a2,2,0,0,0,2,2H18a2,2,0,0,0,2-2V13" /><path d="M18.5,2.5a2.121,2.121,0,0,1,3,3L12,15,8,16l1-4Z" /></svg>,
  up: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18,15 12,9 6,15" /></svg>,
  down: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 12,15 18,9" /></svg>,
  note: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14,2H6A2,2,0,0,0,4,4V20a2,2,0,0,0,2,2H18a2,2,0,0,0,2-2V8Z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  target: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>,
  fire: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12,2C6.5,7,4,11,4,14a8,8,0,0,0,16,0C20,11,17.5,7,12,2Z" /></svg>,
  tag: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59,13.41l-7.17,7.17a2,2,0,0,1-2.83,0L2,12V2H12l8.59,8.59A2,2,0,0,1,20.59,13.41Z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>,
};

const CAT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16", "#eab308", "#a855f7"];

const defaultCategories = [
  { id: "cat-1", name: "Contenido", color: "#6366f1", tasks: [
    { id: "t-1", name: "Creación de contenido RRSS", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, goalDaily: 0, startedAt: null, sessions: [], subtasks: [], notes: "" },
    { id: "t-2", name: "Edición de vídeos", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, goalDaily: 0, startedAt: null, sessions: [], subtasks: [], notes: "" },
  ]},
  { id: "cat-2", name: "Negocio", color: "#10b981", tasks: [
    { id: "t-3", name: "Análisis competencia", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, goalDaily: 0, startedAt: null, sessions: [], subtasks: [], notes: "" },
    { id: "t-4", name: "Estrategia de ventas", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, goalDaily: 0, startedAt: null, sessions: [], subtasks: [], notes: "" },
  ]},
];

const ensureTask = (t) => ({ subtasks: [], notes: "", goalDaily: 0, completed: false, startedAt: null, ...t });

// ─── Cloud Sync ────────────────────────────────────────
function useCloudSync(user) {
  const [cloudData, setCloudData] = useState(null);
  const [cloudTags, setCloudTags] = useState(null);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [remoteChange, setRemoteChange] = useState(0); // increments on external changes
  const unsubRef = useRef(null);
  const lastSaveTime = useRef(null);

  useEffect(() => {
    if (!user) { if (unsubRef.current) unsubRef.current(); setCloudData(null); setCloudTags(null); setCloudLoaded(false); return; }
    const docRef = doc(db, "users", user.uid);
    let firstLoad = true;
    unsubRef.current = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setCloudData(data.categories || []);
        setCloudTags(data.tags || null);
        // After first load, check if this is from another device
        if (!firstLoad && lastSaveTime.current) {
          const cloudTime = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
          const diff = Math.abs(cloudTime - lastSaveTime.current);
          // If cloud update is >3s different from our last save, it's from another device
          if (diff > 3000) {
            setRemoteChange((p) => p + 1);
          }
        }
      } else {
        setCloudData([]);
        setCloudTags(null);
      }
      setCloudLoaded(true);
      firstLoad = false;
    }, (err) => console.warn("Firestore error:", err));
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [user]);

  const saveToCloud = useCallback(async (cats, tags) => {
    if (!user) return;
    setSyncing(true);
    try {
      const clean = cats.map((c) => ({ ...c, tasks: c.tasks.map((t) => ({ ...ensureTask(t), currentSeconds: 0 })) }));
      const now = new Date().toISOString();
      lastSaveTime.current = new Date(now).getTime();
      await setDoc(doc(db, "users", user.uid), { categories: clean, tags: tags || [], updatedAt: now });
    } catch (e) { console.warn("Save error:", e); }
    setSyncing(false);
  }, [user]);

  return { cloudData, cloudTags, cloudLoaded, saveToCloud, syncing, remoteChange };
}

// ─── Profile Menu ──────────────────────────────────────
function ProfileMenu({ user, onLogin, onLogout, syncing, theme, dk }) {
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

// ─── Confirm Modal ─────────────────────────────────────
function Modal({ title, message, confirmLabel, confirmColor, onConfirm, onCancel, theme, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s" }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 24, maxWidth: 380, width: "100%" }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        {message && <div style={{ fontSize: 14, color: theme.textSec, marginBottom: 16, lineHeight: 1.5 }}>{message}</div>}
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

// ─── Edit Modal ────────────────────────────────────────
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
              {CAT_COLORS.map((c) => (
                <button key={c} onClick={() => setCol(c)} style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: c, border: col === c ? "3px solid " + theme.text : "2px solid transparent", cursor: "pointer", transition: "border .15s" }} />
              ))}
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

// ─── Stats View ────────────────────────────────────────
function StatsView({ categories, theme, dk, onClose }) {
  const [period, setPeriod] = useState("week");
  const [filter, setFilter] = useState("all");
  const periods = [{ key: "today", label: "Hoy" }, { key: "week", label: "Semana" }, { key: "14days", label: "14 días" }, { key: "month", label: "Mes" }, { key: "all", label: "Total" }];

  const filterS = (s) => {
    if (period === "today") return isToday(s);
    if (period === "week") return isThisWeek(s);
    if (period === "14days") return isWithinDays(s, 14);
    if (period === "month") return isWithinDays(s, 30);
    return true;
  };

  const allTasks = categories.flatMap((c) => c.tasks.map((t) => ({ ...ensureTask(t), catName: c.name, catColor: c.color, catId: c.id })));
  const fTasks = filter === "all" ? allTasks : allTasks.filter((t) => t.catId === filter);
  const tStats = fTasks.map((t) => { const fs = t.sessions.filter(filterS); return { ...t, fSess: fs, pTime: fs.reduce((a, x) => a + x.duration, 0) }; }).filter((t) => t.pTime > 0 || t.sessions.length > 0).sort((a, b) => b.pTime - a.pTime);
  const totalTime = tStats.reduce((a, t) => a + t.pTime, 0);
  const catStats = categories.map((c) => ({ ...c, pTime: allTasks.filter((t) => t.catId === c.id).reduce((a, t) => a + t.sessions.filter(filterS).reduce((s, x) => s + x.duration, 0), 0) })).filter((c) => c.pTime > 0).sort((a, b) => b.pTime - a.pTime);
  const maxT = Math.max(...tStats.map((t) => t.pTime), 1);
  const maxC = Math.max(...catStats.map((c) => c.pTime), 1);

  // Daily data
  const days = period === "today" ? 1 : period === "week" ? 7 : period === "14days" ? 14 : 30;
  const now = new Date();
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = getDateStr(d);
    let tot = 0;
    fTasks.forEach((t) => t.sessions.forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) tot += s.duration; }));
    daily.push({ ds, label: d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" }), tot });
  }
  const maxD = Math.max(...daily.map((d) => d.tot), 1);

  // Streak
  const getStreak = () => {
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const ds = getDateStr(d);
      let dayTotal = 0;
      allTasks.forEach((t) => t.sessions.forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) dayTotal += s.duration; }));
      if (dayTotal > 0) streak++;
      else if (i > 0) break;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  };

  // Average
  const daysWithData = daily.filter((d) => d.tot > 0).length;
  const avgDaily = daysWithData > 0 ? Math.round(totalTime / daysWithData) : 0;

  // Heat map (last 12 weeks)
  const heatData = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = getDateStr(d);
    let tot = 0;
    allTasks.forEach((t) => t.sessions.forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) tot += s.duration; }));
    heatData.push({ ds, tot, day: d.getDay(), label: d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) });
  }
  const maxHeat = Math.max(...heatData.map((d) => d.tot), 1);
  const heatColor = (tot) => {
    if (tot === 0) return dk ? "#1a1a1a" : "#eee";
    const intensity = Math.min(tot / maxHeat, 1);
    if (intensity < 0.25) return dk ? "#0e4429" : "#9be9a8";
    if (intensity < 0.5) return dk ? "#006d32" : "#40c463";
    if (intensity < 0.75) return dk ? "#26a641" : "#30a14e";
    return dk ? "#39d353" : "#216e39";
  };

  // Group heat map into weeks
  const weeks = [];
  let week = [];
  heatData.forEach((d, i) => {
    week.push(d);
    if (d.day === 6 || i === heatData.length - 1) { weeks.push(week); week = []; }
  });

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: theme.bg, zIndex: 100, overflow: "auto", animation: "fadeIn .2s" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.text, cursor: "pointer", padding: 4, display: "flex" }}>{I.back}</button>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Estadísticas</h1>
        </div>

        {/* Quick stats */}
        <div style={{ display: "flex", gap: 12, padding: "16px 0", overflowX: "auto" }}>
          {[{ label: "Racha", val: `${getStreak()}d`, icon: I.fire, color: "#f59e0b" },
            { label: "Media diaria", val: fmtShort(avgDaily), icon: I.clock, color: "#6366f1" },
            { label: "Días activos", val: `${daysWithData}`, icon: I.chart, color: "#10b981" },
          ].map((s, i) => (
            <div key={i} style={{ flex: "0 0 auto", padding: "14px 18px", borderRadius: 14, backgroundColor: theme.card, border: `1px solid ${theme.border}`, minWidth: 110, textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 6, color: s.color }}>{s.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{s.val}</div>
              <div style={{ fontSize: 12, color: theme.textSec, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Heat map */}
        <div style={{ padding: "12px 0 16px", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Últimas 12 semanas</div>
          <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
            {weeks.map((w, wi) => (
              <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {w.map((d, di) => (
                  <div key={di} title={`${d.label}: ${fmtShort(d.tot)}`} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: heatColor(d.tot), transition: "background .2s" }} />
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, marginTop: 8, fontSize: 11, color: theme.textSec }}>
            <span>Menos</span>
            {[0, 0.25, 0.5, 0.75, 1].map((v, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: heatColor(v * maxHeat || (i === 0 ? 0 : 1)) }} />)}
            <span>Más</span>
          </div>
        </div>

        {/* Period pills */}
        <div style={{ display: "flex", gap: 6, padding: "16px 0 8px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {periods.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{ padding: "8px 14px", borderRadius: 20, border: period === p.key ? "none" : `1px solid ${theme.border}`, backgroundColor: period === p.key ? theme.accent : "transparent", color: period === p.key ? (dk ? "#000" : "#fff") : theme.textSec, fontSize: 14, fontWeight: period === p.key ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{p.label}</button>
          ))}
        </div>

        {/* Category filter */}
        <div style={{ display: "flex", gap: 6, padding: "8px 0 16px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <button onClick={() => setFilter("all")} style={{ padding: "6px 12px", borderRadius: 16, border: filter === "all" ? "none" : `1px solid ${theme.border}`, backgroundColor: filter === "all" ? (dk ? "#333" : "#ddd") : "transparent", color: filter === "all" ? theme.text : theme.textSec, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>Todas</button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setFilter(c.id)} style={{ padding: "6px 12px", borderRadius: 16, border: filter === c.id ? "none" : `1px solid ${theme.border}`, backgroundColor: filter === c.id ? `${c.color}22` : "transparent", color: filter === c.id ? c.color : theme.textSec, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, flexShrink: 0, whiteSpace: "nowrap" }}><div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.color }} />{c.name}</button>
          ))}
        </div>

        {/* Total */}
        <div style={{ padding: "12px 0 16px", textAlign: "center", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>{fmtLong(totalTime)}</div>
          <div style={{ fontSize: 14, color: theme.textSec, marginTop: 4 }}>Tiempo total · {periods.find((p) => p.key === period)?.label}</div>
        </div>

        {/* Daily chart */}
        {daily.length > 1 && (
          <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Actividad diaria</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: daily.length > 14 ? 2 : 3, height: 100 }}>
              {daily.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <div style={{ fontSize: 9, color: theme.textSec, opacity: d.tot > 0 ? 1 : 0 }}>{d.tot > 0 ? fmtShort(d.tot) : ""}</div>
                  <div style={{ width: "100%", height: Math.max(3, (d.tot / maxD) * 80), backgroundColor: d.tot > 0 ? (filter !== "all" ? categories.find((c) => c.id === filter)?.color || theme.accent : theme.accent) : (dk ? "#1c1c1c" : "#eee"), borderRadius: 3, opacity: d.tot > 0 ? 0.8 : 0.3, transition: "height .3s" }} />
                  {daily.length <= 7 && <div style={{ fontSize: 10, color: theme.textSec, whiteSpace: "nowrap", opacity: 0.7 }}>{d.label.split(" ")[0]}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By category */}
        {filter === "all" && catStats.length > 0 && (
          <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Por categoría</div>
            {catStats.map((c) => (
              <div key={c.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.color }} /><span style={{ fontSize: 15, fontWeight: 500 }}>{c.name}</span></div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: c.color }}>{fmtShort(c.pTime)}</span>
                </div>
                <div style={{ height: 6, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${(c.pTime / maxC) * 100}%`, backgroundColor: c.color, borderRadius: 3, transition: "width .3s" }} /></div>
              </div>
            ))}
          </div>
        )}

        {/* By task */}
        <div style={{ padding: "20px 0 100px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Por tarea</div>
          {tStats.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: theme.textSec, fontSize: 14 }}>Sin datos</div>}
          {tStats.map((t) => (
            <div key={t.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: theme.textSec, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: t.catColor }} />{t.catName} · {t.fSess.length} ses.
                    {t.completed && <span style={{ color: "#10b981" }}> ✓</span>}
                    {t.goalDaily > 0 && <span style={{ color: "#6366f1" }}> · Meta: {Math.round(t.goalDaily / 60)}m/día</span>}
                  </div>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: t.catColor, flexShrink: 0, marginLeft: 12 }}>{fmtShort(t.pTime)}</span>
              </div>
              <div style={{ height: 5, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${(t.pTime / maxT) * 100}%`, backgroundColor: t.catColor, borderRadius: 3, opacity: 0.7, transition: "width .3s" }} /></div>
            </div>
          ))}
        </div>
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
    if (!l) return defaultCategories;
    return l.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
      const task = ensureTask(t);
      if (task.isRunning && task.startedAt) {
        const elapsed = Math.floor((Date.now() - new Date(task.startedAt).getTime()) / 1000);
        if (elapsed > 0 && elapsed < 86400) { task.currentSeconds = elapsed; }
        else { task.isRunning = false; task.startedAt = null; task.currentSeconds = 0; }
      }
      return task;
    }) }));
  });
  const [expanded, setExpanded] = useState(() => new Set(categories.map((c) => c.id)));
  const [active, setActive] = useState(null);
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
  const [tags, setTags] = useState(loadTags);
  const [activeTags, setActiveTags] = useState([]);
  const [newTagName, setNewTagName] = useState("");
  const intRef = useRef(null);
  const saveRef = useRef(null);
  const initDone = useRef(false);
  const fileRef = useRef(null);

  const { cloudData, cloudTags, cloudLoaded, saveToCloud, syncing, remoteChange } = useCloudSync(user);

  // Auth
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
  const handleLogout = async () => { if (active) stopTask(active); await signOut(auth); initDone.current = false; };

  // Cloud sync - load once on login
  useEffect(() => {
    if (!user || !cloudLoaded || initDone.current) return;
    initDone.current = true;

    // Check if local has a running timer
    const hasRunningLocal = categories.some((c) => c.tasks.some((t) => t.isRunning && t.startedAt));

    if (hasRunningLocal) {
      // Local has active timer, push to cloud instead of overwriting
      saveToCloud(categories, tags);
      return;
    }

    if (cloudData && cloudData.length > 0) {
      let resumeId = null;
      const data = cloudData.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
        const task = ensureTask(t);
        if (task.isRunning && task.startedAt) {
          const elapsed = Math.floor((Date.now() - new Date(task.startedAt).getTime()) / 1000);
          if (elapsed > 0 && elapsed < 86400) {
            task.currentSeconds = elapsed;
            resumeId = task.id;
          } else {
            task.isRunning = false; task.startedAt = null; task.currentSeconds = 0;
          }
        }
        return task;
      }) }));
      setCat(data); saveLocal(data); setExpanded(new Set(data.map((c) => c.id)));
      if (cloudTags) { setTags(cloudTags); saveTags(cloudTags); }
      if (resumeId) setActive(resumeId);
    } else {
      saveToCloud(categories, tags);
    }
  }, [cloudData, cloudLoaded, user]);

  const immediateSave = useRef(false);

  useEffect(() => {
    saveLocal(categories);
    saveTags(tags);
    if (user && initDone.current) {
      if (saveRef.current) clearTimeout(saveRef.current);
      const delay = immediateSave.current ? 300 : 3000;
      immediateSave.current = false;
      saveRef.current = setTimeout(() => saveToCloud(categories, tags), delay);
    }
  }, [categories, tags, user, saveToCloud]);

  // Handle remote changes from other devices
  useEffect(() => {
    if (remoteChange === 0 || !cloudData || !initDone.current) return;
    let resumeId = null;
    const data = cloudData.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
      const task = ensureTask(t);
      if (task.isRunning && task.startedAt) {
        const elapsed = Math.floor((Date.now() - new Date(task.startedAt).getTime()) / 1000);
        if (elapsed > 0 && elapsed < 86400) {
          task.currentSeconds = elapsed;
          resumeId = task.id;
        } else {
          task.isRunning = false; task.startedAt = null; task.currentSeconds = 0;
        }
      }
      return task;
    }) }));
    setCat(data); saveLocal(data);
    if (cloudTags) { setTags(cloudTags); saveTags(cloudTags); }
    // Update active timer state
    if (resumeId && !active) { setActive(resumeId); }
    if (!resumeId && active) { clearInterval(intRef.current); setActive(null); }
  }, [remoteChange]);

  // Theme
  useEffect(() => { saveTheme(dk); document.body.style.background = dk ? "#0a0a0a" : "#fafafa"; document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dk ? "#0a0a0a" : "#fafafa"); }, [dk]);
  const theme = dk
    ? { bg: "#0a0a0a", card: "#141414", border: "#252525", text: "#f5f5f5", textSec: "#737373", accent: "#ffffff", surface: "#1c1c1c" }
    : { bg: "#fafafa", card: "#ffffff", border: "#e5e5e5", text: "#0a0a0a", textSec: "#737373", accent: "#000000", surface: "#f0f0f0" };

  // Timer
  useEffect(() => {
    if (active) {
      intRef.current = setInterval(() => {
        setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
          if (t.id === active && t.startedAt) {
            return { ...t, currentSeconds: Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000) };
          }
          return t;
        }) })));
      }, 1000);
    }
    return () => clearInterval(intRef.current);
  }, [active]);
  useEffect(() => { const h = (e) => { if (active) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [active]);

  // Resume running timer on app load (from localStorage)
  useEffect(() => {
    for (const c of categories) {
      for (const t of c.tasks) {
        if (t.isRunning && t.startedAt && !active) {
          setActive(t.id);
          return;
        }
      }
    }
  }, []); // only on mount

  const toggle = (id) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const getTask = useCallback((id) => { for (const c of categories) { const t = c.tasks.find((x) => x.id === id); if (t) return { task: t, cat: c }; } return {}; }, [categories]);

  const stopTask = (id) => {
    clearInterval(intRef.current);
    const sessionTags = [...activeTags];
    immediateSave.current = true;
    setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
      if (t.id === id && t.startedAt) {
        const duration = Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000);
        if (duration > 0) {
          const now = new Date();
          return { ...t, isRunning: false, startedAt: null, totalSeconds: t.totalSeconds + duration, sessions: [...t.sessions, { duration, endedAt: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), date: now.toLocaleDateString("es-ES"), dateISO: now.toISOString(), note: "", tags: sessionTags }], currentSeconds: 0 };
        }
        return { ...t, isRunning: false, startedAt: null, currentSeconds: 0 };
      }
      return t.id === id ? { ...t, isRunning: false, startedAt: null, currentSeconds: 0 } : t;
    }) })));
    setActive(null);
    setActiveTags([]);
  };

  const toggleTimer = (id) => {
    if (active === id) stopTask(id);
    else { if (active) stopTask(active); immediateSave.current = true; const now = new Date().toISOString(); setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, isRunning: true, currentSeconds: 0, startedAt: now } : t) }))); setActive(id); setTimerView(id); }
  };

  // CRUD
  const resetTask = (id) => { if (active === id) { clearInterval(intRef.current); setActive(null); } setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, totalSeconds: 0, currentSeconds: 0, isRunning: false, startedAt: null, sessions: [] } : t) }))); setModal(null); };
  const completeTask = (id) => { if (active === id) stopTask(id); setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, completed: true, isRunning: false, startedAt: null, currentSeconds: 0 } : t) }))); setModal(null); if (timerView === id) setTimerView(null); };
  const uncomplete = (id) => setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, completed: false } : t) })));
  const delTask = (id) => { if (active === id) { clearInterval(intRef.current); setActive(null); } if (timerView === id) setTimerView(null); setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== id) }))); setModal(null); };
  const delCat = (id) => { const c = categories.find((x) => x.id === id); if (c) c.tasks.forEach((t) => { if (active === t.id) { clearInterval(intRef.current); setActive(null); } if (timerView === t.id) setTimerView(null); }); setCat((p) => p.filter((x) => x.id !== id)); setModal(null); };
  const addCat = () => { if (!newCatName.trim()) return; const n = { id: `cat-${Date.now()}`, name: newCatName.trim(), color: CAT_COLORS[categories.length % CAT_COLORS.length], tasks: [] }; setCat((p) => [...p, n]); setExpanded((p) => new Set([...p, n.id])); setNewCatName(""); setShowNewCat(false); };
  const addTask = (cid) => { if (!newTaskName.trim()) return; const n = { id: `t-${Date.now()}`, name: newTaskName.trim(), totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, goalDaily: 0, startedAt: null, sessions: [], subtasks: [], notes: "" }; setCat((p) => p.map((c) => c.id === cid ? { ...c, tasks: [...c.tasks, n] } : c)); setNewTaskName(""); setShowNewTask(null); };

  // Edit
  const editCatSave = (id, name, color) => { if (!name.trim()) return; setCat((p) => p.map((c) => c.id === id ? { ...c, name: name.trim(), color } : c)); setEditModal(null); };
  const editTaskSave = (id, name, _c, goalDaily) => { if (!name.trim()) return; setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, name: name.trim(), goalDaily } : t) }))); setEditModal(null); };

  // Reorder
  const moveCat = (id, dir) => { setCat((p) => { const i = p.findIndex((c) => c.id === id); if ((dir === -1 && i === 0) || (dir === 1 && i === p.length - 1)) return p; const n = [...p]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n; }); };
  const moveTask = (catId, taskId, dir) => { setCat((p) => p.map((c) => { if (c.id !== catId) return c; const i = c.tasks.findIndex((t) => t.id === taskId); if ((dir === -1 && i === 0) || (dir === 1 && i === c.tasks.length - 1)) return c; const n = [...c.tasks]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return { ...c, tasks: n }; })); };

  // Subtasks
  const addSubtask = (taskId, name) => { if (!name.trim()) return; setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), { id: `st-${Date.now()}`, name: name.trim(), done: false }] } : t) }))); };
  const toggleSubtask = (taskId, stId) => { setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === taskId ? { ...t, subtasks: (t.subtasks || []).map((st) => st.id === stId ? { ...st, done: !st.done } : st) } : t) }))); };
  const delSubtask = (taskId, stId) => { setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === taskId ? { ...t, subtasks: (t.subtasks || []).filter((st) => st.id !== stId) } : t) }))); };

  // Tags
  const addTag = (name) => { if (!name.trim() || tags.includes(name.trim())) return; setTags((p) => [...p, name.trim()]); };
  const delTag = (name) => { setTags((p) => p.filter((t) => t !== name)); setActiveTags((p) => p.filter((t) => t !== name)); };
  const toggleActiveTag = (name) => { setActiveTags((p) => p.includes(name) ? p.filter((t) => t !== name) : [...p, name]); };

  // Session notes
  const saveSessionNote = (taskId, sessIdx, note) => { setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => { if (t.id !== taskId) return t; const s = [...t.sessions]; s[sessIdx] = { ...s[sessIdx], note }; return { ...t, sessions: s }; }) }))); setNoteModal(null); };
  const delSession = (taskId, sessIdx) => { setCat((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => { if (t.id !== taskId) return t; const s = [...t.sessions]; const removed = s.splice(sessIdx, 1)[0]; return { ...t, sessions: s, totalSeconds: Math.max(0, t.totalSeconds - (removed?.duration || 0)) }; }) }))); setModal(null); };

  // Import/Export
  const exportData = () => { const b = new Blob([JSON.stringify(categories, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `task-timer-${getDateStr()}.json`; a.click(); URL.revokeObjectURL(u); };
  const importData = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => { try {
      const d = JSON.parse(ev.target.result);
      if (Array.isArray(d) && d.length > 0) {
        setModal({ title: "¿Importar datos?", message: `${d.length} categorías, ${d.reduce((s, c) => s + (c.tasks?.length || 0), 0)} tareas. Reemplazará tus datos.`, confirmLabel: "Importar", confirmColor: "#6366f1", onConfirm: () => { if (active) { clearInterval(intRef.current); setActive(null); } const cl = d.map((c) => ({ ...c, tasks: (c.tasks || []).map((t) => ({ ...ensureTask(t), isRunning: false, currentSeconds: 0 })) })); setCat(cl); setExpanded(new Set(cl.map((c) => c.id))); setTimerView(null); setModal(null); } });
      } else alert("Formato no válido.");
    } catch (err) { alert("Error: JSON no válido."); } };
    r.readAsText(f); e.target.value = "";
  };

  const atd = timerView ? getTask(timerView) : null;
  const totalToday = categories.reduce((s, c) => s + c.tasks.reduce((a, t) => a + t.totalSeconds + (t.isRunning ? t.currentSeconds : 0), 0), 0);

  // Goal progress for a task today
  const todayTime = (task) => {
    return task.sessions.filter(isToday).reduce((s, x) => s + x.duration, 0) + (task.isRunning ? task.currentSeconds : 0);
  };

  if (authLoading) return (
    <div style={{ minHeight: "100dvh", backgroundColor: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textSec, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>⏱</div><div style={{ fontSize: 15 }}>Cargando...</div></div>
    </div>
  );

  return (
    <div style={{ minHeight: "100dvh", backgroundColor: theme.bg, color: theme.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', WebkitFontSmoothing: "antialiased" }}>

      {showStats && <StatsView categories={categories} theme={theme} dk={dk} onClose={() => setShowStats(false)} />}

      {/* Timer fullscreen */}
      {timerView && atd?.task && (() => {
        const t = ensureTask(atd.task), c = atd.cat;
        return (
          <div style={{ position: "fixed", inset: 0, backgroundColor: dk ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "60px 20px 40px", overflow: "auto", animation: "fadeIn .25s" }}>
            <button onClick={() => setTimerView(null)} style={{ position: "absolute", top: 20, right: 20, background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 10 }}>{I.x}</button>
            <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: c.color, marginBottom: 12, opacity: 0.8 }} />
            <div style={{ fontSize: 13, color: theme.textSec, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>{c.name}</div>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 32, textAlign: "center", padding: "0 20px" }}>{t.name}</div>
            <div style={{ fontSize: "min(64px, 13vw)", fontWeight: 200, fontVariantNumeric: "tabular-nums", color: active === timerView ? theme.text : theme.textSec, marginBottom: 32, letterSpacing: 3 }}>{formatTime(active === timerView ? t.currentSeconds : 0)}</div>
            <button onClick={() => toggleTimer(timerView)} style={{ width: 72, height: 72, borderRadius: "50%", border: "none", backgroundColor: active === timerView ? (dk ? "#fff" : "#000") : c.color, color: active === timerView ? (dk ? "#000" : "#fff") : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 40px ${active === timerView ? (dk ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)") : c.color + "44"}` }}>
              {active === timerView ? I.pause : I.play}
            </button>

            {/* Goal progress */}
            {t.goalDaily > 0 && (
              <div style={{ marginTop: 24, width: "80%", maxWidth: 260 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: theme.textSec, marginBottom: 4 }}>
                  <span>{I.target} Objetivo diario</span>
                  <span>{fmtShort(todayTime(t))} / {fmtShort(t.goalDaily)}</span>
                </div>
                <div style={{ height: 6, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (todayTime(t) / t.goalDaily) * 100)}%`, backgroundColor: todayTime(t) >= t.goalDaily ? "#10b981" : c.color, borderRadius: 3, transition: "width .3s" }} />
                </div>
                {todayTime(t) >= t.goalDaily && <div style={{ fontSize: 12, color: "#10b981", textAlign: "center", marginTop: 4, fontWeight: 600 }}>✓ Objetivo alcanzado</div>}
              </div>
            )}

            {/* Tags - visible when timer is active */}
            {active === timerView && (
              <div style={{ marginTop: 24, width: "90%", maxWidth: 320 }}>
                <div style={{ fontSize: 12, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>{I.tag} Mientras tanto...</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {tags.map((tag) => (
                    <button key={tag} onClick={() => toggleActiveTag(tag)} style={{ padding: "6px 14px", borderRadius: 20, border: activeTags.includes(tag) ? "none" : `1px solid ${theme.border}`, backgroundColor: activeTags.includes(tag) ? `${c.color}22` : "transparent", color: activeTags.includes(tag) ? c.color : theme.textSec, fontSize: 13, fontWeight: activeTags.includes(tag) ? 600 : 400, cursor: "pointer" }}>
                      {tag}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newTagName.trim()) { addTag(newTagName); setNewTagName(""); } }} placeholder="Nueva etiqueta..." style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 13, outline: "none" }} />
                  <button onClick={() => { if (newTagName.trim()) { addTag(newTagName); setNewTagName(""); } }} style={{ padding: "0 10px", borderRadius: 8, border: "none", backgroundColor: c.color, color: "#fff", fontSize: 12, fontWeight: 600 }}>+</button>
                </div>
              </div>
            )}
            {/* Active tags display when not running */}
            {active !== timerView && t.sessions.length > 0 && (() => {
              const lastSess = t.sessions[t.sessions.length - 1];
              return (lastSess.tags && lastSess.tags.length > 0) ? (
                <div style={{ marginTop: 16, display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
                  {lastSess.tags.map((tag) => (
                    <span key={tag} style={{ padding: "3px 10px", borderRadius: 12, backgroundColor: dk ? "#1c1c1c" : "#eee", fontSize: 11, color: theme.textSec }}>{tag}</span>
                  ))}
                </div>
              ) : null;
            })()}

            {/* Stats */}
            <div style={{ marginTop: 28, display: "flex", gap: 32, color: theme.textSec, fontSize: 14 }}>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 600, color: theme.text, opacity: 0.8 }}>{fmtLong(t.totalSeconds)}</div><div>Total</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 600, color: theme.text, opacity: 0.8 }}>{t.sessions.length}</div><div>Sesiones</div></div>
            </div>

            {/* Subtasks */}
            {((t.subtasks || []).length > 0 || active === timerView) && (
              <div style={{ marginTop: 24, width: "90%", maxWidth: 320 }}>
                <div style={{ fontSize: 12, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Subtareas ({(t.subtasks || []).filter((s) => s.done).length}/{(t.subtasks || []).length})</div>
                {(t.subtasks || []).map((st) => (
                  <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${theme.border}` }}>
                    <button onClick={() => toggleSubtask(timerView, st.id)} style={{ width: 22, height: 22, borderRadius: 6, border: st.done ? "none" : `2px solid ${theme.border}`, backgroundColor: st.done ? "#10b981" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>
                      {st.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}
                    </button>
                    <span style={{ fontSize: 14, textDecoration: st.done ? "line-through" : "none", color: st.done ? theme.textSec : theme.text, flex: 1 }}>{st.name}</span>
                    <button onClick={() => delSubtask(timerView, st.id)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.trash}</button>
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
                  const displayed = showAllSessions ? t.sessions.length : Math.min(5, t.sessions.length);
                  const si = t.sessions.length - 1 - i;
                  return (
                    <div key={si} style={{ padding: "7px 0", borderBottom: `1px solid ${theme.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: theme.textSec }}>
                        <span>{fmtShort(s.duration)}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{s.date ? `${s.date} · ${s.endedAt}` : s.endedAt}</span>
                          <button onClick={() => setNoteModal({ taskId: timerView, sessIdx: si, note: s.note || "" })} style={{ background: "none", border: "none", color: s.note ? "#6366f1" : theme.textSec, cursor: "pointer", padding: 2, opacity: s.note ? 1 : 0.4 }}>{I.note}</button>
                          <button onClick={() => setModal({ title: "¿Eliminar sesión?", message: `${fmtShort(s.duration)} · ${s.date || ""} ${s.endedAt || ""}. Se restará del tiempo total.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delSession(timerView, si) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 2, opacity: 0.4 }}>{I.trash}</button>
                        </div>
                      </div>
                      {s.note && <div style={{ fontSize: 12, color: theme.textSec, marginTop: 3, fontStyle: "italic" }}>{s.note}</div>}
                      {s.tags && s.tags.length > 0 && <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>{s.tags.map((tag) => <span key={tag} style={{ padding: "2px 8px", borderRadius: 10, backgroundColor: dk ? "#1c1c1c" : "#eee", fontSize: 11, color: theme.textSec }}>{tag}</span>)}</div>}
                    </div>
                  );
                })}
                {t.sessions.length > 5 && (
                  <button onClick={() => setShowAllSessions(!showAllSessions)} style={{ width: "100%", padding: "8px 0", marginTop: 4, background: "none", border: "none", color: theme.textSec, fontSize: 13, cursor: "pointer" }}>
                    {showAllSessions ? "Ver menos" : `Ver todas (${t.sessions.length})`}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Modals */}
      {modal && <Modal {...modal} onCancel={() => setModal(null)} theme={theme} />}
      {editModal && <EditModal {...editModal} onCancel={() => setEditModal(null)} theme={theme} />}
      {noteModal && <NoteModal {...noteModal} onSave={saveSessionNote} onCancel={() => setNoteModal(null)} theme={theme} />}

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        {/* Header */}
        <div style={{ padding: "20px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Tareas</h1>
              <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>{I.clock}<span>Hoy: {fmtLong(totalToday)}</span></div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <ProfileMenu user={user} onLogin={handleLogin} onLogout={handleLogout} syncing={syncing} theme={theme} dk={dk} />
              <button onClick={() => setShowStats(true)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.chart}</button>
              <button onClick={() => setDk(!dk)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{dk ? I.sun : I.moon}</button>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={() => { setShowNewCat(true); setShowNewTask(null); }} style={{ flex: 1, background: theme.accent, border: "none", borderRadius: 10, color: dk ? "#000" : "#fff", cursor: "pointer", height: 40, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, fontWeight: 600 }}>{I.plus}<span>Nueva categoría</span></button>
            <button onClick={exportData} title="Exportar" style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.dl}</button>
            <button onClick={() => fileRef.current?.click()} title="Importar" style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.ul}</button>
            <input ref={fileRef} type="file" accept=".json" onChange={importData} style={{ display: "none" }} />
          </div>
        </div>

        {/* Active banner */}
        {active && (() => { const { task: at, cat: ac } = getTask(active); if (!at) return null; return (
          <div onClick={() => setTimerView(active)} style={{ margin: "14px 0 0", padding: "14px 16px", borderRadius: 14, background: `linear-gradient(135deg, ${ac.color}22, ${ac.color}08)`, border: `1px solid ${ac.color}33`, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: ac.color, animation: "pulse 1.5s infinite", flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{at.name}</div><div style={{ fontSize: 12, color: theme.textSec }}>{ac.name}</div></div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 300, fontVariantNumeric: "tabular-nums", color: ac.color, flexShrink: 0, marginLeft: 8 }}>{formatTime(at.currentSeconds)}</div>
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
            const aTasks = cat.tasks.filter((t) => !t.completed);
            const cTasks = cat.tasks.filter((t) => t.completed);
            return (
              <div key={cat.id} style={{ marginTop: 18 }}>
                {/* Category header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1 }} onClick={() => toggle(cat.id)}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: cat.color, opacity: 0.8 }} />
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{cat.name}</span>
                    <span style={{ fontSize: 14, color: theme.textSec }}>{aTasks.length}</span>
                    {cTasks.length > 0 && <span style={{ fontSize: 12, color: "#10b981" }}>+{cTasks.length} ✓</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button onClick={() => moveCat(cat.id, -1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: catIdx === 0 ? 0.15 : 0.5 }}>{I.up}</button>
                    <button onClick={() => moveCat(cat.id, 1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: catIdx === categories.length - 1 ? 0.15 : 0.5 }}>{I.down}</button>
                    <button onClick={() => setEditModal({ title: "Editar categoría", value: cat.name, color: cat.color, onColorChange: true, onSave: (n, c) => editCatSave(cat.id, n, c) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.5 }}>{I.edit}</button>
                    <button onClick={() => setModal({ title: "¿Eliminar categoría?", message: `"${cat.name}" y todas sus tareas.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delCat(cat.id) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.trash}</button>
                    <div onClick={() => toggle(cat.id)} style={{ transform: expanded.has(cat.id) ? "rotate(0)" : "rotate(-90deg)", transition: "transform .2s", color: theme.textSec, display: "flex", cursor: "pointer", padding: 4 }}>{I.chev}</div>
                  </div>
                </div>

                {expanded.has(cat.id) && (<div>
                  {aTasks.map((task, ti) => {
                    const t = ensureTask(task);
                    const tToday = todayTime(t);
                    const goalPct = t.goalDaily > 0 ? Math.min(100, (tToday / t.goalDaily) * 100) : -1;
                    return (
                      <div key={t.id} onClick={() => setTimerView(t.id)} style={{ padding: "12px 12px", marginBottom: 5, borderRadius: 12, backgroundColor: active === t.id ? `${cat.color}12` : theme.card, border: `1px solid ${active === t.id ? `${cat.color}33` : theme.border}`, cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                            <div style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                            <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                              {I.clock} <span>{fmtLong(t.totalSeconds + (t.isRunning ? t.currentSeconds : 0))}</span>
                              {t.sessions.length > 0 && <span>· {t.sessions.length} ses.</span>}
                              {t.goalDaily > 0 && <span style={{ color: goalPct >= 100 ? "#10b981" : "#6366f1" }}>· {goalPct >= 100 ? "✓" : `${Math.round(goalPct)}%`}</span>}
                              {(t.subtasks || []).length > 0 && <span>· {(t.subtasks || []).filter((s) => s.done).length}/{(t.subtasks || []).length} sub</span>}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                            {active === t.id && <span style={{ fontSize: 14, fontWeight: 300, fontVariantNumeric: "tabular-nums", color: cat.color, marginRight: 2 }}>{formatTime(t.currentSeconds)}</span>}
                            <button onClick={(e) => { e.stopPropagation(); toggleTimer(t.id); }} style={{ width: 38, height: 38, borderRadius: "50%", border: "none", backgroundColor: active === t.id ? cat.color : theme.surface, color: active === t.id ? "#fff" : theme.textSec, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{active === t.id ? I.pause : I.play}</button>
                          </div>
                        </div>
                        {/* Goal bar */}
                        {t.goalDaily > 0 && (
                          <div style={{ marginTop: 8, height: 4, backgroundColor: dk ? "#1c1c1c" : "#eee", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${goalPct}%`, backgroundColor: goalPct >= 100 ? "#10b981" : cat.color, borderRadius: 2, transition: "width .3s" }} />
                          </div>
                        )}
                        {/* Action row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 6, justifyContent: "flex-end" }}>
                          <button onClick={(e) => { e.stopPropagation(); moveTask(cat.id, t.id, -1); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: ti === 0 ? 0.15 : 0.4 }}>{I.up}</button>
                          <button onClick={(e) => { e.stopPropagation(); moveTask(cat.id, t.id, 1); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: ti === aTasks.length - 1 ? 0.15 : 0.4 }}>{I.down}</button>
                          <button onClick={(e) => { e.stopPropagation(); setEditModal({ title: "Editar tarea", value: t.name, goalDaily: t.goalDaily, onGoalChange: true, onSave: (n, _c, g) => editTaskSave(t.id, n, _c, g) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.edit}</button>
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
                      <button onClick={() => setShowDone(showDone === cat.id ? false : cat.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", background: "none", border: "none", color: theme.textSec, fontSize: 14, cursor: "pointer" }}>
                        <div style={{ transform: showDone === cat.id ? "rotate(0)" : "rotate(-90deg)", transition: "transform .2s", display: "flex" }}>{I.chev}</div>
                        Completadas ({cTasks.length})
                      </button>
                      {showDone === cat.id && cTasks.map((task) => (
                        <div key={task.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", marginBottom: 4, borderRadius: 12, backgroundColor: theme.card, border: `1px solid ${theme.border}`, opacity: 0.6 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 500, textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</div>
                            <div style={{ fontSize: 13, color: theme.textSec, marginTop: 2 }}>{fmtLong(task.totalSeconds)} · {task.sessions.length} ses.</div>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => uncomplete(task.id)} title="Reactivar" style={{ background: "none", border: "none", color: "#f59e0b", cursor: "pointer", padding: 6 }}>{I.reset}</button>
                            <button onClick={() => setModal({ title: "¿Eliminar?", message: `"${task.name}".`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delTask(task.id) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 6, opacity: 0.4 }}>{I.trash}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>)}
              </div>
            );
          })}

          {categories.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: theme.textSec }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>⏱</div>
              <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>Sin categorías</div>
              <div style={{ fontSize: 15 }}>Crea tu primera categoría para empezar</div>
            </div>
          )}
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

// ─── Small components ──────────────────────────────────
function SubtaskInput({ taskId, onAdd, theme }) {
  const [val, setVal] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) { onAdd(taskId, val); setVal(""); } }} placeholder="Nueva subtarea..." style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none" }} />
      <button onClick={() => { if (val.trim()) { onAdd(taskId, val); setVal(""); } }} style={{ padding: "0 12px", borderRadius: 8, border: "none", backgroundColor: "#6366f1", color: "#fff", fontSize: 13, fontWeight: 600 }}>+</button>
    </div>
  );
}

function NoteModal({ taskId, sessIdx, note, onSave, onCancel, theme }) {
  const [val, setVal] = useState(note || "");
  return (
    <Modal title="Nota de sesión" onCancel={onCancel} theme={theme}>
      <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="¿Qué hiciste en esta sesión?" rows={3} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={onCancel} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 15, cursor: "pointer" }}>Cancelar</button>
        <button onClick={() => onSave(taskId, sessIdx, val)} style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: "#6366f1", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </div>
    </Modal>
  );
}
