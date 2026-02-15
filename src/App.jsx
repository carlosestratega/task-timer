import { useState, useEffect, useRef, useCallback } from "react";
import { auth, googleProvider, db } from "./firebase";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

// ─── Helpers ───────────────────────────────────────────
const formatTime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const formatTotalTime = (seconds) => {
  if (!seconds || seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
};

const formatTotalTimeLong = (seconds) => {
  if (!seconds || seconds === 0) return "Sin registro";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
};

const getDateStr = (d) => {
  const date = d || new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const parseSessionDate = (session) => {
  if (session.dateISO) return new Date(session.dateISO);
  if (session.date) {
    const parts = session.date.split("/");
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
  }
  return new Date();
};

const isWithinDays = (session, days) => {
  const now = new Date();
  const sessionDate = parseSessionDate(session);
  const diff = (now - sessionDate) / (1000 * 60 * 60 * 24);
  return diff <= days;
};

const isToday = (session) => {
  return getDateStr(parseSessionDate(session)) === getDateStr(new Date());
};

const isThisWeek = (session) => {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sessionDate = parseSessionDate(session);
  return sessionDate >= monday && sessionDate <= now;
};

// ─── Local Storage ─────────────────────────────────────
const THEME_KEY = "task-timer-theme";
const LOCAL_KEY = "task-timer-data";

const saveTheme = (dark) => { try { localStorage.setItem(THEME_KEY, JSON.stringify(dark)); } catch (e) {} };
const loadTheme = () => { try { const r = localStorage.getItem(THEME_KEY); if (r !== null) return JSON.parse(r); } catch (e) {} return true; };
const saveLocal = (categories) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(categories)); } catch (e) {} };
const loadLocal = () => { try { const r = localStorage.getItem(LOCAL_KEY); if (r) return JSON.parse(r); } catch (e) {} return null; };

// ─── Icons ─────────────────────────────────────────────
const ICONS = {
  play: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6,3 20,12 6,21" /></svg>,
  pause: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="3" width="5" height="18" /><rect x="14" y="3" width="5" height="18" /></svg>,
  plus: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  trash: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3,6 5,6 21,6" /><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" /></svg>,
  clock: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>,
  chevron: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 12,15 18,9" /></svg>,
  x: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  moon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21,12.79A9,9,0,1,1,11.21,3,7,7,0,0,0,21,12.79Z" /></svg>,
  sun: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>,
  reset: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 1,10 7,10" /><path d="M3.51,15a9,9,0,1,0,2.13-9.36L1,10" /></svg>,
  download: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21,15v4a2,2,0,0,1-2,2H5a2,2,0,0,1-2-2V15" /><polyline points="7,10 12,15 17,10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  google: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
  logout: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9,21H5a2,2,0,0,1-2-2V5A2,2,0,0,1,5,3h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
  cloud: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18,10h-1.26A8,8,0,1,0,9,20h9a5,5,0,0,0,0-10z" /></svg>,
  user: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20,21v-2a4,4,0,0,0-4-4H8a4,4,0,0,0-4,4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12" /></svg>,
  chart: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  back: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12,19 5,12 12,5" /></svg>,
  archive: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12" /></svg>,
};

// ─── Default data ──────────────────────────────────────
const defaultCategories = [
  {
    id: "cat-1", name: "Contenido", color: "#6366f1",
    tasks: [
      { id: "t-1", name: "Creación de contenido RRSS", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, sessions: [] },
      { id: "t-2", name: "Edición de vídeos", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, sessions: [] },
    ],
  },
  {
    id: "cat-2", name: "Negocio", color: "#10b981",
    tasks: [
      { id: "t-3", name: "Análisis competencia", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, sessions: [] },
      { id: "t-4", name: "Estrategia de ventas", totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, sessions: [] },
    ],
  },
];

const CAT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

// ─── Cloud Sync ────────────────────────────────────────
function useCloudSync(user) {
  const [cloudData, setCloudData] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const unsubRef = useRef(null);

  useEffect(() => {
    if (!user) { if (unsubRef.current) unsubRef.current(); setCloudData(null); return; }
    const docRef = doc(db, "users", user.uid);
    unsubRef.current = onSnapshot(docRef, (snap) => {
      if (snap.exists()) setCloudData(snap.data().categories || []);
      else setCloudData(null);
    }, (err) => console.warn("Firestore error:", err));
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [user]);

  const saveToCloud = useCallback(async (categories) => {
    if (!user) return;
    setSyncing(true);
    try {
      const docRef = doc(db, "users", user.uid);
      const clean = categories.map((cat) => ({ ...cat, tasks: cat.tasks.map((t) => ({ ...t, isRunning: false, currentSeconds: 0 })) }));
      await setDoc(docRef, { categories: clean, updatedAt: new Date().toISOString() });
    } catch (err) { console.warn("Save error:", err); }
    setSyncing(false);
  }, [user]);

  return { cloudData, saveToCloud, syncing };
}

// ─── Profile Menu ──────────────────────────────────────
function ProfileMenu({ user, onLogin, onLogout, syncing, theme, darkMode }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{ width: 40, height: 40, borderRadius: "50%", border: user ? "2px solid #10b981" : `1px solid ${theme.border}`, background: user ? "none" : theme.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 0, transition: "all 0.2s" }}>
        {user?.photoURL ? <img src={user.photoURL} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ color: theme.textSec }}>{ICONS.user}</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", top: 48, right: 0, backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 6, minWidth: 240, boxShadow: darkMode ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 32px rgba(0,0,0,0.12)", zIndex: 50, animation: "fadeIn 0.15s ease" }}>
          {user ? (
            <>
              <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${theme.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {user.photoURL && <img src={user.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.displayName || "Usuario"}</div>
                    <div style={{ fontSize: 12, color: theme.textSec, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: syncing ? "#f59e0b" : "#10b981" }}>{ICONS.cloud}<span>{syncing ? "Guardando..." : "Sincronizado"}</span></div>
              </div>
              <button onClick={() => { onLogout(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", margin: "4px 0 2px", background: "none", border: "none", borderRadius: 8, color: "#ef4444", fontSize: 14, cursor: "pointer", textAlign: "left" }}>{ICONS.logout} Cerrar sesión</button>
            </>
          ) : (
            <>
              <div style={{ padding: "12px 14px 8px" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Sin sesión</div>
                <div style={{ fontSize: 12, color: theme.textSec, marginTop: 3, lineHeight: 1.4 }}>Inicia sesión para sincronizar entre dispositivos</div>
              </div>
              <button onClick={() => { onLogin(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "calc(100% - 12px)", padding: "10px 14px", margin: "6px 6px 6px", background: darkMode ? "#1c1c1c" : "#f0f0f0", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.text, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{ICONS.google} Continuar con Google</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stats View ────────────────────────────────────────
function StatsView({ categories, theme, darkMode, onClose }) {
  const [period, setPeriod] = useState("week");
  const [filter, setFilter] = useState("all");

  const periods = [
    { key: "today", label: "Hoy" },
    { key: "week", label: "Semana" },
    { key: "14days", label: "14 días" },
    { key: "month", label: "Mes" },
    { key: "all", label: "Total" },
  ];

  const filterSession = (session) => {
    switch (period) {
      case "today": return isToday(session);
      case "week": return isThisWeek(session);
      case "14days": return isWithinDays(session, 14);
      case "month": return isWithinDays(session, 30);
      case "all": return true;
      default: return true;
    }
  };

  const allTasks = categories.flatMap((cat) =>
    cat.tasks.map((t) => ({ ...t, categoryName: cat.name, categoryColor: cat.color, categoryId: cat.id }))
  );

  const filteredTasks = filter === "all"
    ? allTasks
    : allTasks.filter((t) => t.categoryId === filter);

  const taskStats = filteredTasks.map((task) => {
    const filteredSessions = task.sessions.filter(filterSession);
    const totalTime = filteredSessions.reduce((sum, s) => sum + s.duration, 0);
    return { ...task, filteredSessions, periodTime: totalTime };
  }).filter((t) => t.periodTime > 0 || t.sessions.length > 0);

  taskStats.sort((a, b) => b.periodTime - a.periodTime);

  const totalPeriodTime = taskStats.reduce((sum, t) => sum + t.periodTime, 0);

  const catStats = categories.map((cat) => {
    const catTasks = allTasks.filter((t) => t.categoryId === cat.id);
    const totalTime = catTasks.reduce((sum, t) => {
      return sum + t.sessions.filter(filterSession).reduce((s, sess) => s + sess.duration, 0);
    }, 0);
    return { ...cat, periodTime: totalTime };
  }).filter((c) => c.periodTime > 0);

  catStats.sort((a, b) => b.periodTime - a.periodTime);

  const maxTime = Math.max(...taskStats.map((t) => t.periodTime), 1);
  const maxCatTime = Math.max(...catStats.map((c) => c.periodTime), 1);

  // Daily breakdown for the period
  const getDailyData = () => {
    let days;
    const now = new Date();
    switch (period) {
      case "today": days = 1; break;
      case "week": days = 7; break;
      case "14days": days = 14; break;
      case "month": days = 30; break;
      case "all": days = 30; break;
      default: days = 7;
    }

    const dailyData = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = getDateStr(d);
      const dayLabel = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });

      let dayTotal = 0;
      filteredTasks.forEach((task) => {
        task.sessions.forEach((s) => {
          if (getDateStr(parseSessionDate(s)) === dateStr) {
            dayTotal += s.duration;
          }
        });
      });
      dailyData.push({ date: dateStr, label: dayLabel, total: dayTotal });
    }
    return dailyData;
  };

  const dailyData = getDailyData();
  const maxDayTime = Math.max(...dailyData.map((d) => d.total), 1);

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: theme.bg, zIndex: 100, overflow: "auto", animation: "fadeIn 0.2s ease" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={onClose} style={{ background: "none", border: "none", color: theme.text, cursor: "pointer", padding: 4, display: "flex" }}>{ICONS.back}</button>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Estadísticas</h1>
          </div>
        </div>

        {/* Period selector */}
        <div style={{ display: "flex", gap: 6, padding: "16px 0 8px", overflowX: "auto" }}>
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                padding: "8px 16px",
                borderRadius: 20,
                border: period === p.key ? "none" : `1px solid ${theme.border}`,
                backgroundColor: period === p.key ? theme.accent : "transparent",
                color: period === p.key ? (darkMode ? "#000" : "#fff") : theme.textSec,
                fontSize: 14,
                fontWeight: period === p.key ? 600 : 400,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div style={{ display: "flex", gap: 6, padding: "8px 0 16px", overflowX: "auto", flexWrap: "wrap" }}>
          <button onClick={() => setFilter("all")} style={{ padding: "6px 14px", borderRadius: 16, border: filter === "all" ? "none" : `1px solid ${theme.border}`, backgroundColor: filter === "all" ? (darkMode ? "#333" : "#ddd") : "transparent", color: filter === "all" ? theme.text : theme.textSec, fontSize: 13, cursor: "pointer" }}>
            Todas
          </button>
          {categories.map((cat) => (
            <button key={cat.id} onClick={() => setFilter(cat.id)} style={{ padding: "6px 14px", borderRadius: 16, border: filter === cat.id ? "none" : `1px solid ${theme.border}`, backgroundColor: filter === cat.id ? `${cat.color}22` : "transparent", color: filter === cat.id ? cat.color : theme.textSec, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: cat.color }} />
              {cat.name}
            </button>
          ))}
        </div>

        {/* Total */}
        <div style={{ padding: "16px 0", textAlign: "center", borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>{formatTotalTimeLong(totalPeriodTime)}</div>
          <div style={{ fontSize: 14, color: theme.textSec, marginTop: 4 }}>Tiempo total · {periods.find((p) => p.key === period)?.label}</div>
        </div>

        {/* Daily chart */}
        {dailyData.length > 1 && (
          <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Actividad diaria</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: dailyData.length > 14 ? 2 : 4, height: 120 }}>
              {dailyData.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ fontSize: 10, color: theme.textSec, opacity: d.total > 0 ? 1 : 0.4 }}>
                    {d.total > 0 ? formatTotalTime(d.total) : ""}
                  </div>
                  <div style={{
                    width: "100%",
                    height: Math.max(3, (d.total / maxDayTime) * 90),
                    backgroundColor: d.total > 0 ? (filter !== "all" ? categories.find((c) => c.id === filter)?.color || theme.accent : theme.accent) : (darkMode ? "#1c1c1c" : "#eee"),
                    borderRadius: 4,
                    opacity: d.total > 0 ? 0.8 : 0.3,
                    transition: "height 0.3s ease",
                  }} />
                  {dailyData.length <= 14 && (
                    <div style={{ fontSize: 10, color: theme.textSec, whiteSpace: "nowrap", opacity: 0.7 }}>
                      {d.label.split(" ")[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category breakdown */}
        {filter === "all" && catStats.length > 0 && (
          <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Por categoría</div>
            {catStats.map((cat) => (
              <div key={cat.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: cat.color }} />
                    <span style={{ fontSize: 15, fontWeight: 500 }}>{cat.name}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: cat.color }}>{formatTotalTime(cat.periodTime)}</span>
                </div>
                <div style={{ height: 6, backgroundColor: darkMode ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(cat.periodTime / maxCatTime) * 100}%`, backgroundColor: cat.color, borderRadius: 3, transition: "width 0.3s ease" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Task breakdown */}
        <div style={{ padding: "20px 0 100px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Por tarea</div>
          {taskStats.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: theme.textSec }}>
              <div style={{ fontSize: 14 }}>Sin datos para este periodo</div>
            </div>
          )}
          {taskStats.map((task) => (
            <div key={task.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.name}</div>
                  <div style={{ fontSize: 12, color: theme.textSec, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: task.categoryColor }} />
                    {task.categoryName} · {task.filteredSessions.length} sesiones
                    {task.completed && <span style={{ marginLeft: 4, color: "#10b981" }}>✓</span>}
                  </div>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: task.categoryColor, flexShrink: 0, marginLeft: 12 }}>{formatTotalTime(task.periodTime)}</span>
              </div>
              <div style={{ height: 5, backgroundColor: darkMode ? "#1c1c1c" : "#eee", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(task.periodTime / maxTime) * 100}%`, backgroundColor: task.categoryColor, borderRadius: 3, opacity: 0.7, transition: "width 0.3s ease" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Modal ─────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel, confirmColor, onConfirm, onCancel, theme }) {
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn 0.2s ease" }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 24, maxWidth: 360, width: "100%" }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 14, color: theme.textSec, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 14, cursor: "pointer" }}>Cancelar</button>
          <button onClick={onConfirm} style={{ padding: "9px 18px", borderRadius: 8, border: "none", backgroundColor: confirmColor || "#ef4444", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(loadTheme);
  const [categories, setCategories] = useState(() => loadLocal() || defaultCategories);
  const [expandedCats, setExpandedCats] = useState(() => new Set(categories.map((c) => c.id)));
  const [activeTask, setActiveTask] = useState(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showNewTask, setShowNewTask] = useState(null);
  const [newCatName, setNewCatName] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [timerView, setTimerView] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const intervalRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const initialLoadDone = useRef(false);

  const { cloudData, saveToCloud, syncing } = useCloudSync(user);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    getRedirectResult(auth).catch(() => {});
    return unsub;
  }, []);

  const handleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) {
      if (err.code === "auth/popup-blocked" || err.code === "auth/popup-closed-by-user") {
        try { await signInWithRedirect(auth, googleProvider); } catch (e) {}
      }
    }
  };

  const handleLogout = async () => {
    if (activeTask) stopTask(activeTask);
    await signOut(auth);
    initialLoadDone.current = false;
  };

  useEffect(() => {
    if (cloudData && user && !initialLoadDone.current) {
      initialLoadDone.current = true;
      if (cloudData.length > 0) {
        setCategories(cloudData);
        saveLocal(cloudData);
        setExpandedCats(new Set(cloudData.map((c) => c.id)));
      }
    }
  }, [cloudData, user]);

  useEffect(() => {
    saveLocal(categories);
    if (user && initialLoadDone.current) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { saveToCloud(categories); }, 2000);
    }
  }, [categories, user, saveToCloud]);

  useEffect(() => {
    saveTheme(darkMode);
    document.body.style.background = darkMode ? "#0a0a0a" : "#fafafa";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", darkMode ? "#0a0a0a" : "#fafafa");
  }, [darkMode]);

  const theme = darkMode
    ? { bg: "#0a0a0a", card: "#141414", border: "#252525", text: "#f5f5f5", textSec: "#737373", accent: "#ffffff", surface: "#1c1c1c" }
    : { bg: "#fafafa", card: "#ffffff", border: "#e5e5e5", text: "#0a0a0a", textSec: "#737373", accent: "#000000", surface: "#f0f0f0" };

  useEffect(() => {
    if (activeTask) {
      intervalRef.current = setInterval(() => {
        setCategories((prev) => prev.map((cat) => ({ ...cat, tasks: cat.tasks.map((t) => t.id === activeTask ? { ...t, currentSeconds: t.currentSeconds + 1 } : t) })));
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [activeTask]);

  useEffect(() => {
    const handler = (e) => { if (activeTask) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [activeTask]);

  const toggleCategory = (catId) => {
    setExpandedCats((prev) => { const next = new Set(prev); next.has(catId) ? next.delete(catId) : next.add(catId); return next; });
  };

  const getTask = useCallback((taskId) => {
    for (const cat of categories) { const task = cat.tasks.find((t) => t.id === taskId); if (task) return { task, category: cat }; }
    return {};
  }, [categories]);

  const stopTask = (taskId) => {
    clearInterval(intervalRef.current);
    setCategories((prev) => prev.map((cat) => ({
      ...cat,
      tasks: cat.tasks.map((t) => {
        if (t.id === taskId && t.currentSeconds > 0) {
          const now = new Date();
          return { ...t, isRunning: false, totalSeconds: t.totalSeconds + t.currentSeconds, sessions: [...t.sessions, { duration: t.currentSeconds, endedAt: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), date: now.toLocaleDateString("es-ES"), dateISO: now.toISOString() }], currentSeconds: 0 };
        }
        if (t.id === taskId) return { ...t, isRunning: false, currentSeconds: 0 };
        return t;
      }),
    })));
    setActiveTask(null);
  };

  const toggleTimer = (taskId) => {
    if (activeTask === taskId) { stopTask(taskId); }
    else {
      if (activeTask) stopTask(activeTask);
      setCategories((prev) => prev.map((cat) => ({ ...cat, tasks: cat.tasks.map((t) => (t.id === taskId ? { ...t, isRunning: true, currentSeconds: 0 } : t)) })));
      setActiveTask(taskId);
      setTimerView(taskId);
    }
  };

  const resetTask = (taskId) => {
    if (activeTask === taskId) { clearInterval(intervalRef.current); setActiveTask(null); }
    setCategories((prev) => prev.map((cat) => ({ ...cat, tasks: cat.tasks.map((t) => t.id === taskId ? { ...t, totalSeconds: 0, currentSeconds: 0, isRunning: false, sessions: [] } : t) })));
    setConfirmModal(null);
  };

  const completeTask = (taskId) => {
    if (activeTask === taskId) { stopTask(taskId); }
    setCategories((prev) => prev.map((cat) => ({ ...cat, tasks: cat.tasks.map((t) => t.id === taskId ? { ...t, completed: true, isRunning: false, currentSeconds: 0 } : t) })));
    setConfirmModal(null);
    if (timerView === taskId) setTimerView(null);
  };

  const uncompleteTask = (taskId) => {
    setCategories((prev) => prev.map((cat) => ({ ...cat, tasks: cat.tasks.map((t) => t.id === taskId ? { ...t, completed: false } : t) })));
  };

  const deleteTask = (taskId) => {
    if (activeTask === taskId) { clearInterval(intervalRef.current); setActiveTask(null); }
    if (timerView === taskId) setTimerView(null);
    setCategories((prev) => prev.map((cat) => ({ ...cat, tasks: cat.tasks.filter((t) => t.id !== taskId) })));
    setConfirmModal(null);
  };

  const deleteCategory = (catId) => {
    const cat = categories.find((c) => c.id === catId);
    if (cat) { cat.tasks.forEach((t) => { if (activeTask === t.id) { clearInterval(intervalRef.current); setActiveTask(null); } if (timerView === t.id) setTimerView(null); }); }
    setCategories((prev) => prev.filter((c) => c.id !== catId));
    setConfirmModal(null);
  };

  const addCategory = () => {
    if (!newCatName.trim()) return;
    const newCat = { id: `cat-${Date.now()}`, name: newCatName.trim(), color: CAT_COLORS[categories.length % CAT_COLORS.length], tasks: [] };
    setCategories((prev) => [...prev, newCat]);
    setExpandedCats((prev) => new Set([...prev, newCat.id]));
    setNewCatName(""); setShowNewCategory(false);
  };

  const addTask = (catId) => {
    if (!newTaskName.trim()) return;
    const newTask = { id: `t-${Date.now()}`, name: newTaskName.trim(), totalSeconds: 0, currentSeconds: 0, isRunning: false, completed: false, sessions: [] };
    setCategories((prev) => prev.map((cat) => (cat.id === catId ? { ...cat, tasks: [...cat.tasks, newTask] } : cat)));
    setNewTaskName(""); setShowNewTask(null);
  };

  const exportData = () => {
    const data = JSON.stringify(categories, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `task-timer-${new Date().toISOString().split("T")[0]}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const activeTaskData = timerView ? getTask(timerView) : null;
  const totalToday = categories.reduce((sum, cat) => sum + cat.tasks.reduce((s, t) => s + t.totalSeconds + (t.isRunning ? t.currentSeconds : 0), 0), 0);
  const completedCount = categories.reduce((sum, cat) => sum + cat.tasks.filter((t) => t.completed).length, 0);

  if (authLoading) {
    return (
      <div style={{ minHeight: "100dvh", backgroundColor: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textSec, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' }}>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>⏱</div><div style={{ fontSize: 15 }}>Cargando...</div></div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", backgroundColor: theme.bg, color: theme.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif', transition: "background-color 0.3s, color 0.3s", WebkitFontSmoothing: "antialiased" }}>

      {/* Stats View */}
      {showStats && <StatsView categories={categories} theme={theme} darkMode={darkMode} onClose={() => setShowStats(false)} />}

      {/* Timer Fullscreen */}
      {timerView && activeTaskData?.task && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: darkMode ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.25s ease" }}>
          <button onClick={() => setTimerView(null)} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 10 }}>{ICONS.x}</button>
          <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: activeTaskData.category.color, marginBottom: 12, opacity: 0.8 }} />
          <div style={{ fontSize: 13, color: theme.textSec, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>{activeTaskData.category.name}</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: theme.text, marginBottom: 48 }}>{activeTaskData.task.name}</div>
          <div style={{ fontSize: "min(72px, 14vw)", fontWeight: 200, fontVariantNumeric: "tabular-nums", color: activeTask === timerView ? theme.text : theme.textSec, marginBottom: 48, letterSpacing: 4, transition: "color 0.3s" }}>
            {formatTime(activeTask === timerView ? activeTaskData.task.currentSeconds : 0)}
          </div>
          <button onClick={() => toggleTimer(timerView)} style={{ width: 76, height: 76, borderRadius: "50%", border: "none", backgroundColor: activeTask === timerView ? (darkMode ? "#fff" : "#000") : activeTaskData.category.color, color: activeTask === timerView ? (darkMode ? "#000" : "#fff") : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", boxShadow: activeTask === timerView ? `0 0 40px ${darkMode ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"}` : `0 0 40px ${activeTaskData.category.color}44` }}>
            {activeTask === timerView ? ICONS.pause : ICONS.play}
          </button>
          <div style={{ marginTop: 48, display: "flex", gap: 36, color: theme.textSec, fontSize: 14 }}>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontWeight: 600, color: theme.text, marginBottom: 4, opacity: 0.8 }}>{formatTotalTimeLong(activeTaskData.task.totalSeconds)}</div><div>Total acumulado</div></div>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontWeight: 600, color: theme.text, marginBottom: 4, opacity: 0.8 }}>{activeTaskData.task.sessions.length}</div><div>Sesiones</div></div>
          </div>
          {activeTaskData.task.sessions.length > 0 && (
            <div style={{ marginTop: 32, maxWidth: 320, width: "90%" }}>
              <div style={{ fontSize: 12, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10, opacity: 0.6 }}>Últimas sesiones</div>
              {activeTaskData.task.sessions.slice(-5).reverse().map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${theme.border}`, fontSize: 14, color: theme.textSec }}>
                  <span>{formatTotalTime(s.duration)}</span>
                  <span>{s.date ? `${s.date} · ${s.endedAt}` : s.endedAt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          confirmColor={confirmModal.confirmColor}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
          theme={theme}
        />
      )}

      {/* Main */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>Tareas</h1>
            <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
              {ICONS.clock}<span>Hoy: {formatTotalTimeLong(totalToday)}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ProfileMenu user={user} onLogin={handleLogin} onLogout={handleLogout} syncing={syncing} theme={theme} darkMode={darkMode} />
            <button onClick={() => setShowStats(true)} title="Estadísticas" style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>{ICONS.chart}</button>
            <button onClick={() => setDarkMode(!darkMode)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>{darkMode ? ICONS.sun : ICONS.moon}</button>
            <button onClick={() => { setShowNewCategory(true); setShowNewTask(null); }} style={{ background: theme.accent, border: "none", borderRadius: 10, color: darkMode ? "#000" : "#fff", cursor: "pointer", height: 40, padding: "0 16px", display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600 }}>{ICONS.plus}<span>Categoría</span></button>
          </div>
        </div>

        {/* Active task */}
        {activeTask && (() => {
          const { task: at, category: ac } = getTask(activeTask);
          if (!at) return null;
          return (
            <div onClick={() => setTimerView(activeTask)} style={{ margin: "16px 0 0", padding: "14px 18px", borderRadius: 14, background: `linear-gradient(135deg, ${ac.color}22, ${ac.color}08)`, border: `1px solid ${ac.color}33`, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: ac.color, animation: "pulse 1.5s infinite" }} />
                <div><div style={{ fontSize: 15, fontWeight: 600 }}>{at.name}</div><div style={{ fontSize: 12, color: theme.textSec }}>{ac.name}</div></div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 300, fontVariantNumeric: "tabular-nums", color: ac.color }}>{formatTime(at.currentSeconds)}</div>
            </div>
          );
        })()}

        {/* New category */}
        {showNewCategory && (
          <div style={{ margin: "16px 0 0", padding: 18, borderRadius: 14, backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Nueva categoría</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCategory(); if (e.key === "Escape") { setShowNewCategory(false); setNewCatName(""); } }} placeholder="Nombre..." style={{ flex: 1, padding: "11px 14px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none" }} />
              <button onClick={addCategory} style={{ padding: "0 18px", borderRadius: 8, border: "none", backgroundColor: theme.accent, color: darkMode ? "#000" : "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Crear</button>
              <button onClick={() => { setShowNewCategory(false); setNewCatName(""); }} style={{ padding: "0 14px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 14, cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {/* Categories & Tasks */}
        <div style={{ paddingTop: 8, paddingBottom: 100 }}>
          {categories.map((cat) => {
            const activeTasks = cat.tasks.filter((t) => !t.completed);
            const completedTasks = cat.tasks.filter((t) => t.completed);
            return (
              <div key={cat.id} style={{ marginTop: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer", userSelect: "none" }} onClick={() => toggleCategory(cat.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: cat.color, opacity: 0.8 }} />
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{cat.name}</span>
                    <span style={{ fontSize: 13, color: theme.textSec }}>{activeTasks.length}</span>
                    {completedTasks.length > 0 && <span style={{ fontSize: 12, color: "#10b981" }}>+{completedTasks.length} ✓</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmModal({ title: "¿Eliminar categoría?", message: `Se eliminará "${cat.name}" y todas sus tareas con su historial.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => deleteCategory(cat.id) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{ICONS.trash}</button>
                    <div style={{ transform: expandedCats.has(cat.id) ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", color: theme.textSec, display: "flex" }}>{ICONS.chevron}</div>
                  </div>
                </div>

                {expandedCats.has(cat.id) && (
                  <div>
                    {/* Active tasks */}
                    {activeTasks.map((task) => (
                      <div key={task.id} onClick={() => setTimerView(task.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", marginBottom: 5, borderRadius: 12, backgroundColor: activeTask === task.id ? `${cat.color}12` : theme.card, border: `1px solid ${activeTask === task.id ? `${cat.color}33` : theme.border}`, transition: "all 0.2s", cursor: "pointer" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.name}</div>
                          <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                            {ICONS.clock}{formatTotalTimeLong(task.totalSeconds + (task.isRunning ? task.currentSeconds : 0))}
                            {task.sessions.length > 0 && <span>· {task.sessions.length} sesiones</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                          {activeTask === task.id && <span style={{ fontSize: 16, fontWeight: 300, fontVariantNumeric: "tabular-nums", color: cat.color, marginRight: 4 }}>{formatTime(task.currentSeconds)}</span>}
                          <button onClick={(e) => { e.stopPropagation(); toggleTimer(task.id); }} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", backgroundColor: activeTask === task.id ? cat.color : theme.surface, color: activeTask === task.id ? "#fff" : theme.textSec, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>{activeTask === task.id ? ICONS.pause : ICONS.play}</button>
                          <button onClick={(e) => { e.stopPropagation(); setConfirmModal({ title: "¿Completar tarea?", message: `"${task.name}" se moverá a completadas. El historial se conserva.`, confirmLabel: "Completar", confirmColor: "#10b981", onConfirm: () => completeTask(task.id) }); }} title="Completar" style={{ background: "none", border: "none", color: "#10b981", cursor: "pointer", padding: 4, opacity: 0.5 }}>{ICONS.check}</button>
                          <button onClick={(e) => { e.stopPropagation(); setConfirmModal({ title: "¿Resetear tarea?", message: `Se borrará todo el tiempo y sesiones de "${task.name}". Esta acción no se puede deshacer.`, confirmLabel: "Resetear", confirmColor: "#f59e0b", onConfirm: () => resetTask(task.id) }); }} title="Resetear" style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{ICONS.reset}</button>
                          <button onClick={(e) => { e.stopPropagation(); setConfirmModal({ title: "¿Eliminar tarea?", message: `Se eliminará "${task.name}" permanentemente con todo su historial.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => deleteTask(task.id) }); }} title="Eliminar" style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{ICONS.trash}</button>
                        </div>
                      </div>
                    ))}

                    {/* Add task */}
                    {showNewTask === cat.id ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 5, marginBottom: 5 }}>
                        <input autoFocus value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTask(cat.id); if (e.key === "Escape") { setShowNewTask(null); setNewTaskName(""); } }} placeholder="Nombre de la tarea..." style={{ flex: 1, padding: "11px 14px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none" }} />
                        <button onClick={() => addTask(cat.id)} style={{ padding: "0 16px", borderRadius: 8, border: "none", backgroundColor: cat.color, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Añadir</button>
                        <button onClick={() => { setShowNewTask(null); setNewTaskName(""); }} style={{ padding: "0 12px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 14, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setShowNewTask(cat.id); setShowNewCategory(false); setNewTaskName(""); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", margin: "5px 0", borderRadius: 10, border: `1px dashed ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 13, cursor: "pointer", width: "100%" }}>{ICONS.plus} Añadir tarea</button>
                    )}

                    {/* Completed tasks */}
                    {completedTasks.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <button onClick={() => setShowCompleted(showCompleted === cat.id ? false : cat.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", background: "none", border: "none", color: theme.textSec, fontSize: 13, cursor: "pointer" }}>
                          <div style={{ transform: showCompleted === cat.id ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", display: "flex" }}>{ICONS.chevron}</div>
                          Completadas ({completedTasks.length})
                        </button>
                        {showCompleted === cat.id && completedTasks.map((task) => (
                          <div key={task.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", marginBottom: 4, borderRadius: 12, backgroundColor: theme.card, border: `1px solid ${theme.border}`, opacity: 0.6 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, textDecoration: "line-through", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.name}</div>
                              <div style={{ fontSize: 13, color: theme.textSec, marginTop: 2 }}>{formatTotalTimeLong(task.totalSeconds)} · {task.sessions.length} sesiones</div>
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button onClick={() => uncompleteTask(task.id)} title="Reactivar" style={{ background: "none", border: "none", color: "#f59e0b", cursor: "pointer", padding: 4, fontSize: 12 }}>{ICONS.reset}</button>
                              <button onClick={() => setConfirmModal({ title: "¿Eliminar tarea?", message: `Se eliminará "${task.name}" permanentemente.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => deleteTask(task.id) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{ICONS.trash}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {categories.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: theme.textSec }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>⏱</div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>Sin categorías</div>
              <div style={{ fontSize: 14 }}>Crea tu primera categoría para empezar</div>
            </div>
          )}
        </div>
      </div>

      {/* Export FAB */}
      <button onClick={exportData} title="Exportar datos" style={{ position: "fixed", bottom: 24, right: 24, width: 48, height: 48, borderRadius: "50%", border: `1px solid ${theme.border}`, backgroundColor: theme.card, color: theme.textSec, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: darkMode ? "0 4px 20px rgba(0,0,0,0.4)" : "0 4px 20px rgba(0,0,0,0.1)", zIndex: 40 }}>{ICONS.download}</button>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { overscroll-behavior: none; }
        input::placeholder { color: ${theme.textSec}88; }
        button { cursor: pointer; }
        button:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}
