import { useState, useEffect, useRef, useCallback } from "react";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { auth, googleProvider, db } from "./firebase";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  browserLocalPersistence,
  setPersistence,
  GoogleAuthProvider,
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
  subtasks: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><polyline points="4,6 5,7 7,5" /><polyline points="4,12 5,13 7,11" /><polyline points="4,18 5,19 7,17" /></svg>,
  paste: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16,4h2a2,2,0,0,1,2,2V20a2,2,0,0,1-2,2H6a2,2,0,0,1-2-2V6A2,2,0,0,1,6,4H8" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="16" y2="16" /></svg>,
  sort: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="16" y2="6" /><line x1="4" y1="12" x2="12" y2="12" /><line x1="4" y1="18" x2="8" y2="18" /><polyline points="18,14 21,17 18,20" /><line x1="21" y1="17" x2="21" y2="7" /></svg>,
  grip: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" /></svg>,
  nfc: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6,8.32a7.43,7.43,0,0,1,0,7.36" /><path d="M9.46,6.21a11.76,11.76,0,0,1,0,11.58" /><path d="M12.91,4.1a16.08,16.08,0,0,1,0,15.8" /><path d="M16.37,2a20.4,20.4,0,0,1,0,20" /></svg>,
  list: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>,
  selectAll: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  pin: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" /></svg>,
};

const CAT_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  "#06b6d4", "#84cc16", "#eab308", "#a855f7", "#e11d48", "#0891b2", "#65a30d", "#c026d3",
  "#d946ef", "#0ea5e9", "#22c55e", "#fb923c", "#f43f5e", "#2dd4bf", "#a3e635", "#818cf8",
  "#f472b6", "#34d399", "#fbbf24", "#38bdf8", "#c084fc", "#fb7185", "#4ade80", "#facc15",
];

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
  const { currentSeconds, ...rest } = t;
  return { subtasks: [], notes: "", goalDaily: 0, completed: false, startedAt: null, isRunning: false, sessions: [], totalSeconds: 0, dueDate: null, plannedDate: null, recurring: null, recurringHistory: {}, kanbanStatus: null, kanbanStatusDate: null, emoji: null, permanent: false, calEventId: null, ...rest };
};

const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
};
const dateColor = (d, completed) => {
  if (!d) return null;
  if (completed) return "#10b981";
  const today = getDateStr();
  if (d < today) return "#ef4444"; // overdue
  if (d === today) return "#f59e0b"; // today
  const ws = getWeekStart();
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const weStr = getDateStr(we);
  if (d >= getDateStr(ws) && d <= weStr) return "#3b82f6"; // this week
  return null; // default
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

  const saveToCloud = useCallback(async (cats, tgs, extras) => {
    if (!user) return;
    setSyncing(true);
    try {
      const clean = cats.map((c) => ({ ...c, tasks: c.tasks.map((t) => ensureTask(t)) }));
      const now = new Date().toISOString();
      lastSaveTs.current = new Date(now).getTime();
      const payload = { categories: clean, tags: (tgs && tgs.length > 0) ? tgs : (loadTags() || []), updatedAt: now, _device: DEVICE_ID };
      if (extras) { if (extras.focusPanel !== undefined) payload.focusPanel = extras.focusPanel; if (extras.habitsOrder !== undefined) payload.habitsOrder = extras.habitsOrder; }
      await setDoc(doc(db, "users", user.uid), payload);
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
function ProfileMenu({ user, onLogin, onLogout, onBackups, onExport, onImport, fileRef, syncing, theme, dk }) {
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
        <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 6, width: "calc(100% - 32px)", maxWidth: 340, boxShadow: dk ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 32px rgba(0,0,0,0.12)", zIndex: 50, animation: "fadeIn .15s" }}>
          {user ? (<>
            <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {user.photoURL && <img src={user.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />}
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.displayName || "Usuario"}</div><div style={{ fontSize: 13, color: theme.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div></div>
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: syncing ? "#f59e0b" : "#10b981" }}>{I.cloud}<span>{syncing ? "Guardando..." : "Sincronizado"}</span></div>
            </div>
            <button onClick={() => { if (onBackups) onBackups(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px", margin: "2px 0", background: "none", border: "none", borderRadius: 8, color: theme.text, fontSize: 15, cursor: "pointer" }}>{I.reset} Backups</button>
            <button onClick={() => { onExport(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px", margin: "2px 0", background: "none", border: "none", borderRadius: 8, color: theme.text, fontSize: 15, cursor: "pointer" }}>{I.dl} Exportar datos</button>
            <button onClick={() => { fileRef.current?.click(); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px", margin: "2px 0", background: "none", border: "none", borderRadius: 8, color: theme.text, fontSize: 15, cursor: "pointer" }}>{I.ul} Importar datos</button>
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
                {o.color && <div style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: o.color, flexShrink: 0 }} />}
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

function EditModal({ title, value, onSave, onCancel, theme, color, onColorChange, goalDaily, onGoalChange, dueDate: initDue, plannedDate: initPlanned, recurring: initRecurring, emoji: initEmoji, permanent: initPermanent, onDatesChange }) {
  const [val, setVal] = useState(value || "");
  const [col, setCol] = useState(color || "");
  const [goal, setGoal] = useState(goalDaily ? Math.round(goalDaily / 60) : 0);
  const [due, setDue] = useState(initDue || "");
  const [planned, setPlanned] = useState(initPlanned || "");
  const [rec, setRec] = useState(initRecurring || []);
  const [emo, setEmo] = useState(initEmoji || "");
  const [perm, setPerm] = useState(!!initPermanent);
  const DAYS = ["D", "L", "M", "X", "J", "V", "S"];
  const toggleRec = (d) => setRec((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort());
  return (
    <Modal title={title} onCancel={onCancel} theme={theme}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSave(val, col, goal * 60, due || null, planned || null, rec.length > 0 ? rec : null, emo || null, perm); }} placeholder="Nombre..." style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 16, outline: "none" }} />
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
          </div>
        )}
        {onDatesChange && (<>
          <div>
            <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>📅 Planificado</div>
            <input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none", width: "100%" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>⚠️ Límite</div>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none", width: "100%" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Repetir</div>
            <div style={{ display: "flex", gap: 6 }}>
              {DAYS.map((d, i) => (
                <button key={i} onClick={() => toggleRec(i)} style={{ width: 36, height: 36, borderRadius: 8, border: rec.includes(i) ? "none" : `1px solid ${theme.border}`, backgroundColor: rec.includes(i) ? "#6366f1" : "transparent", color: rec.includes(i) ? "#fff" : theme.textSec, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{d}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => setRec([1, 2, 3, 4, 5])} style={{ fontSize: 12, color: theme.textSec, background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>L-V</button>
              <button onClick={() => setRec([0, 1, 2, 3, 4, 5, 6])} style={{ fontSize: 12, color: theme.textSec, background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Todos</button>
              <button onClick={() => setRec([])} style={{ fontSize: 12, color: theme.textSec, background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Ninguno</button>
            </div>
          </div>
          {rec.length > 0 && (
            <div>
              <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Emoji del hábito</div>
              <input value={emo} onChange={(e) => setEmo(e.target.value)} placeholder="🏋️ (escribe un emoji)" maxLength={4} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 20, outline: "none", width: 80, textAlign: "center" }} />
            </div>
          )}
        </>)}
        {onDatesChange && (
          <div onClick={() => setPerm(!perm)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: "pointer" }}>
            <div style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: perm ? "#8b5cf6" : theme.surface, position: "relative", transition: "background .2s" }}><div style={{ width: 18, height: 18, borderRadius: "50%", backgroundColor: "#fff", position: "absolute", top: 2, left: perm ? 20 : 2, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} /></div>
            <div><div style={{ fontSize: 13, color: theme.text }}>Permanente</div><div style={{ fontSize: 11, color: theme.textSec }}>No aparece en Kanban (ej: comer, aseo)</div></div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 15, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => onSave(val, col, goal * 60, due || null, planned || null, rec.length > 0 ? rec : null, emo || null, perm)} style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: "#6366f1", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
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

function SortableTask({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, position: "relative", zIndex: isDragging ? 10 : "auto" };
  return <div ref={setNodeRef} style={style}>{children(listeners, attributes)}</div>;
}

function SortableSub({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return <div ref={setNodeRef} style={style}>{children(listeners, attributes)}</div>;
}

function BulkAddModal({ categories, onAdd, onCancel, theme, dk }) {
  const [catId, setCatId] = useState(categories.length > 0 ? categories[0].id : "");
  const [text, setText] = useState("");
  const lines = text.split("\n").filter((l) => l.trim());
  const parseDateLine = (s) => {
    const lm = s.match(/^limit\s+(\d{2})-(\d{2})-(\d{4})$/i);
    if (lm) return { type: "due", date: `${lm[3]}-${lm[2]}-${lm[1]}`, display: `${lm[1]}-${lm[2]}-${lm[3]}` };
    const tm = s.match(/^to\s*do\s+(\d{2})-(\d{2})-(\d{4})$/i);
    if (tm) return { type: "planned", date: `${tm[3]}-${tm[2]}-${tm[1]}`, display: `${tm[1]}-${tm[2]}-${tm[3]}` };
    const old = s.match(/^\d{4}-\d{2}-\d{2}$/);
    if (old) return { type: "due", date: s, display: s };
    return null;
  };
  let preview = [], cur = null;
  lines.forEach((line) => {
    const t = line.trim();
    if (t.startsWith("- ") || t.startsWith("· ") || t.startsWith("* ")) {
      if (cur) cur.subs.push(t.slice(2).trim());
    } else {
      const dl = parseDateLine(t);
      if (dl && cur) {
        if (dl.type === "due") cur.dueDate = dl.date; else cur.plannedDate = dl.date;
        if (dl.type === "due") cur.dueDateDisplay = dl.display; else cur.plannedDateDisplay = dl.display;
      } else {
        if (cur) preview.push(cur);
        cur = { name: t, subs: [], dueDate: null, plannedDate: null };
      }
    }
  });
  if (cur) preview.push(cur);
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: theme.bg, zIndex: 100, overflow: "auto", animation: "fadeIn .2s" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: theme.text, cursor: "pointer", padding: 4, display: "flex" }}>{I.back}</button>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Añadir rápido</h1>
        </div>
        <div style={{ padding: "20px 0" }}>
          <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Categoría</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCatId(c.id)} style={{ padding: "8px 16px", borderRadius: 10, border: catId === c.id ? `2px solid ${c.color}` : `1px solid ${theme.border}`, backgroundColor: catId === c.id ? `${c.color}15` : "transparent", color: catId === c.id ? c.color : theme.textSec, fontSize: 14, fontWeight: catId === c.id ? 600 : 400, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.color }} />{c.name}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 6 }}>Pega tus tareas</div>
          <div style={{ fontSize: 12, color: theme.textSec, marginBottom: 10, opacity: 0.7 }}>Línea = tarea · "- " = subtarea · "limit dd-mm-aaaa" = ⚠️ límite · "to do dd-mm-aaaa" = 📅 planificado</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Grabar contenido\nlimit 20-03-2026\nto do 19-03-2026\n- Preparar editor\n- Grabar con guiones\n\nTest transcripción\nlimit 22-03-2026\n- 5 guiones sin voz\n- 5 guiones con voz"} rows={10} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 15, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
          {preview.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, color: theme.textSec, marginBottom: 10 }}>Vista previa: {preview.length} tarea{preview.length > 1 ? "s" : ""}</div>
              {preview.map((p, i) => (
                <div key={i} style={{ padding: "10px 14px", marginBottom: 6, borderRadius: 10, backgroundColor: theme.card, border: `1px solid ${theme.border}` }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</div>
                  {p.plannedDate && <div style={{ fontSize: 12, color: "#6366f1", marginTop: 2 }}>📅 {p.plannedDateDisplay || p.plannedDate}</div>}
                  {p.dueDate && <div style={{ fontSize: 12, color: "#ef4444", marginTop: 2 }}>⚠️ {p.dueDateDisplay || p.dueDate}</div>}
                  {p.subs.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {p.subs.map((s, si) => (
                        <div key={si} style={{ fontSize: 13, color: theme.textSec, padding: "2px 0", display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${theme.border}`, flexShrink: 0 }} />
                          {s}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.text, fontSize: 15, cursor: "pointer" }}>Cancelar</button>
            <button onClick={() => { if (catId && preview.length > 0) onAdd(catId, text); }} disabled={!catId || preview.length === 0} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", backgroundColor: preview.length > 0 ? (categories.find((c) => c.id === catId)?.color || "#6366f1") : theme.surface, color: preview.length > 0 ? "#fff" : theme.textSec, fontSize: 15, fontWeight: 600, cursor: preview.length > 0 ? "pointer" : "default", opacity: preview.length > 0 ? 1 : 0.5 }}>Crear {preview.length > 0 ? preview.length : ""} tarea{preview.length !== 1 ? "s" : ""}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stats View ────────────────────────────────────────
function BulkDeleteView({ categories, onDelete, onCancel, theme, dk }) {
  const [selected, setSelected] = useState(new Set());
  const toggle = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allTasks = categories.flatMap((c) => c.tasks.map((t) => ({ ...t, catName: c.name, catColor: c.color })));
  const selectAll = () => setSelected(new Set(allTasks.map((t) => t.id)));
  const selectNone = () => setSelected(new Set());
  const selectCat = (catId) => { const ids = categories.find((c) => c.id === catId)?.tasks.map((t) => t.id) || []; setSelected((p) => { const n = new Set(p); ids.forEach((id) => n.add(id)); return n; }); };
  const deselectCat = (catId) => { const ids = categories.find((c) => c.id === catId)?.tasks.map((t) => t.id) || []; setSelected((p) => { const n = new Set(p); ids.forEach((id) => n.delete(id)); return n; }); };
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: theme.bg, zIndex: 100, overflow: "auto", animation: "fadeIn .2s" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: theme.text, cursor: "pointer", padding: 4, display: "flex" }}>{I.back}</button>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, flex: 1 }}>Papelera</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={selectAll} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 12, cursor: "pointer" }}>Todas</button>
            <button onClick={selectNone} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 12, cursor: "pointer" }}>Ninguna</button>
          </div>
        </div>
        <div style={{ padding: "12px 0" }}>
          {categories.map((cat) => {
            const catTaskIds = cat.tasks.map((t) => t.id);
            const allSelected = catTaskIds.length > 0 && catTaskIds.every((id) => selected.has(id));
            if (cat.tasks.length === 0) return null;
            return (
              <div key={cat.id} style={{ marginBottom: 16 }}>
                <div onClick={() => allSelected ? deselectCat(cat.id) : selectCat(cat.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, border: allSelected ? "none" : `2px solid ${theme.border}`, backgroundColor: allSelected ? cat.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{allSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}</div>
                  <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: cat.color }} />
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{cat.name}</span>
                  <span style={{ fontSize: 13, color: theme.textSec }}>{cat.tasks.length}</span>
                </div>
                {cat.tasks.map((t) => (
                  <div key={t.id} onClick={() => toggle(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", marginBottom: 2, borderRadius: 8, backgroundColor: selected.has(t.id) ? "#ef444415" : "transparent", cursor: "pointer" }}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, border: selected.has(t.id) ? "none" : `1.5px solid ${theme.border}`, backgroundColor: selected.has(t.id) ? "#ef4444" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{selected.has(t.id) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: t.completed ? "line-through" : "none", color: t.completed ? theme.textSec : theme.text }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: theme.textSec, marginTop: 1 }}>{fmtShort(t.totalSeconds)} · {(t.sessions || []).length} ses.{t.completed ? " · ✓" : ""}{(t.subtasks || []).length > 0 ? ` · ${(t.subtasks || []).filter((s) => s.done).length}/${(t.subtasks || []).length} sub` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {allTasks.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: theme.textSec }}>No hay tareas</div>}
        </div>
        {selected.size > 0 && (
          <div style={{ position: "sticky", bottom: 0, padding: "16px 0", backgroundColor: theme.bg, borderTop: `1px solid ${theme.border}` }}>
            <button onClick={() => onDelete([...selected])} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", backgroundColor: "#ef4444", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>Eliminar {selected.size} tarea{selected.size !== 1 ? "s" : ""}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewView({ categories, onClose, theme, dk }) {
  const [copyMsg, setCopyMsg] = useState(false);
  const allText = categories.map((c) => {
    const lines = [`── ${c.name} ──`];
    c.tasks.forEach((t) => {
      const status = t.completed ? " ✓" : "";
      const time = t.totalSeconds > 0 ? ` (${fmtShort(t.totalSeconds)})` : "";
      const pd = t.plannedDate ? ` 📅${t.plannedDate.slice(8)}-${t.plannedDate.slice(5,7)}` : "";
      const dd = t.dueDate ? ` ⚠️${t.dueDate.slice(8)}-${t.dueDate.slice(5,7)}` : "";
      const perm = t.permanent ? " ♾️" : "";
      const rec = t.recurring ? " 🔁" : "";
      lines.push(`${t.name}${time}${pd}${dd}${perm}${rec}${status}`);
      (t.subtasks || []).forEach((st) => {
        lines.push(`  ${st.done ? "✓" : "·"} ${st.name}`);
      });
    });
    return lines.join("\n");
  }).join("\n\n");

  const copyAll = () => {
    navigator.clipboard.writeText(allText).then(() => { setCopyMsg(true); setTimeout(() => setCopyMsg(false), 2000); }).catch(() => {});
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: theme.bg, zIndex: 100, overflow: "auto", animation: "fadeIn .2s" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 0 12px", borderBottom: `1px solid ${theme.border}` }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.text, cursor: "pointer", padding: 4, display: "flex" }}>{I.back}</button>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, flex: 1 }}>Vista general</h1>
          <button onClick={copyAll} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: copyMsg ? "#10b981" : theme.surface, color: copyMsg ? "#fff" : theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all .2s" }}>{copyMsg ? "✓ Copiado" : "Copiar"}</button>
        </div>
        <div style={{ padding: "16px 0 100px" }}>
          {categories.map((cat) => (
            <div key={cat.id} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: cat.color }} />
                <span style={{ fontSize: 16, fontWeight: 700 }}>{cat.name}</span>
                <span style={{ fontSize: 13, color: theme.textSec }}>{cat.tasks.length}</span>
              </div>
              {cat.tasks.filter((t) => !t.completed).map((t) => (
                <div key={t.id} style={{ marginBottom: 8, paddingLeft: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</span>
                    {t.totalSeconds > 0 && <span style={{ fontSize: 12, color: cat.color, fontWeight: 600 }}>{fmtShort(t.totalSeconds)}</span>}
                    {t.goalDaily > 0 && <span style={{ fontSize: 11, color: "#6366f1" }}>{I.target}</span>}
                    {t.plannedDate && <span style={{ fontSize: 11, color: dateColor(t.plannedDate, t.completed) || theme.textSec }}>📅 {t.plannedDate.slice(8)}-{t.plannedDate.slice(5,7)}</span>}
                    {t.dueDate && <span style={{ fontSize: 11, color: dateColor(t.dueDate, t.completed) || theme.textSec }}>⚠️ {t.dueDate.slice(8)}-{t.dueDate.slice(5,7)}</span>}
                    {t.permanent && <span style={{ fontSize: 10, color: "#8b5cf6" }}>♾️</span>}
                    {t.recurring && <span style={{ fontSize: 10, color: "#8b5cf6" }}>🔁</span>}
                  </div>
                  {(t.subtasks || []).length > 0 && (
                    <div style={{ paddingLeft: 12, marginTop: 3 }}>
                      {(t.subtasks || []).map((st) => (
                        <div key={st.id} style={{ fontSize: 13, color: st.done ? theme.textSec : theme.text, padding: "1px 0", display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ color: st.done ? "#10b981" : theme.textSec, fontSize: 11 }}>{st.done ? "✓" : "·"}</span>
                          <span style={{ textDecoration: st.done ? "line-through" : "none" }}>{st.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {cat.tasks.filter((t) => t.completed).length > 0 && (
                <div style={{ paddingLeft: 20, marginTop: 4 }}>
                  <div style={{ fontSize: 12, color: theme.textSec, marginBottom: 4 }}>Completadas:</div>
                  {cat.tasks.filter((t) => t.completed).map((t) => (
                    <div key={t.id} style={{ fontSize: 13, color: theme.textSec, padding: "1px 0", textDecoration: "line-through" }}>{t.name} ({fmtShort(t.totalSeconds)})</div>
                  ))}
                </div>
              )}
              {cat.tasks.length === 0 && <div style={{ paddingLeft: 20, fontSize: 13, color: theme.textSec, fontStyle: "italic" }}>Sin tareas</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DroppableArea({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} style={{ borderRadius: 8, outline: isOver ? "2px dashed #6366f1" : "none" }}>{children}</div>;
}

function DraggableCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = { transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : "auto", position: "relative" };
  return <div ref={setNodeRef} {...listeners} {...attributes} style={style}>{children}</div>;
}

function KanbanView({ categories, onUpdate, onTimerView, activeId, elapsed, theme, dk, focusPanel, addToFocus, removeFromFocus, onStopTimer }) {
  const [kFilter, setKFilter] = useState("today");
  const [kSort, setKSort] = useState("due"); // due | planned | category
  const allTasks = categories.flatMap((c) => c.tasks.filter((t) => {
    if (t.permanent && !t.recurring) return false; // permanent non-recurring excluded
    if (t.recurring && t.recurring.length > 0) {
      // Only show on days they're active and not yet done today
      const dow = new Date().getDay();
      if (!t.recurring.includes(dow)) return false;
      const todayDone = (t.recurringHistory || {})[getDateStr()];
      if (todayDone) return false;
      return true;
    }
    return true;
  }).map((t) => ({ ...ensureTask(t), catName: c.name, catColor: c.color, catId: c.id })));
  const today = getDateStr();
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return getDateStr(d); })();
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return getDateStr(d); })();
  const weekStart = getWeekStart();
  const weekEnd = (() => { const d = new Date(getWeekStart()); d.setDate(d.getDate() + 6); return getDateStr(d); })();
  const fmtDDMM = (d) => { if (!d) return ""; const p = d.split("-"); return `${p[2]}-${p[1]}`; };
  const hasDateIn = (t, start, end) => {
    const dates = [t.plannedDate, t.dueDate].filter(Boolean);
    return dates.some((d) => d >= start && d <= end);
  };

  const filtered = kFilter === "today" ? allTasks.filter((t) => t.recurring || t.plannedDate === today || t.dueDate === today || t.isRunning)
    : kFilter === "yesterday" ? allTasks.filter((t) => t.plannedDate === yesterday || t.dueDate === yesterday)
    : kFilter === "tomorrow" ? allTasks.filter((t) => t.plannedDate === tomorrow || t.dueDate === tomorrow)
    : kFilter === "week" ? allTasks.filter((t) => t.recurring || hasDateIn(t, getDateStr(weekStart), weekEnd) || t.isRunning)
    : kFilter === "due" ? allTasks.filter((t) => t.dueDate)
    : kFilter === "planned" ? allTasks.filter((t) => t.plannedDate)
    : allTasks;

  const cols = [
    { key: "todo", label: "Por hacer", color: theme.textSec, emoji: "📋" },
    { key: "doing", label: "Ejecución", color: "#f59e0b", emoji: "⚡" },
    { key: "validating", label: "Validación", color: "#8b5cf6", emoji: "🔍" },
    { key: "done", label: "Hecho", color: "#10b981", emoji: "✅" },
  ];

  const getStatus = (t) => {
    if (t.recurring) {
      // Daily reset: if kanbanStatusDate is today, use saved status. Otherwise "todo"
      if (t.kanbanStatusDate === today && t.kanbanStatus) return t.kanbanStatus;
      return "todo";
    }
    if (t.kanbanStatus) return t.kanbanStatus;
    if (t.completed) return "done";
    if (t.isRunning || t.totalSeconds > 0) return "doing";
    return "todo";
  };

  const grouped = { todo: [], doing: [], validating: [], done: [] };
  filtered.forEach((t) => { const s = getStatus(t); if (grouped[s]) grouped[s].push(t); else grouped.todo.push(t); });
  const sortTasks = (tasks) => [...tasks].sort((a, b) => {
    if (kSort === "planned") return (a.plannedDate || a.dueDate || "9999").localeCompare(b.plannedDate || b.dueDate || "9999");
    if (kSort === "category") return a.catName.localeCompare(b.catName) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
    return (a.dueDate || a.plannedDate || "9999").localeCompare(b.dueDate || b.plannedDate || "9999");
  });
  Object.keys(grouped).forEach((k) => { grouped[k] = sortTasks(grouped[k]); });

  const isOverdue = (t) => t.dueDate && t.dueDate < today && !t.completed;
  const setStatus = (taskId, status) => {
    const todayDs = getDateStr();
    // Stop timer if running on this task
    if (activeId === taskId && (status === "done" || status === "todo")) {
      onStopTimer(taskId);
    }
    onUpdate((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
      if (t.id !== taskId) return t;
      if (t.recurring) {
        if (status === "done") {
          const hist = { ...(t.recurringHistory || {}), [todayDs]: true };
          return { ...t, recurringHistory: hist, kanbanStatus: status, kanbanStatusDate: todayDs };
        }
        return { ...t, kanbanStatus: status, kanbanStatusDate: todayDs };
      }
      if (status === "done") return { ...t, kanbanStatus: status, completed: true, completedAt: new Date().toISOString() };
      return { ...t, kanbanStatus: status, completed: false, completedAt: null };
    }) })));
  };

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const targetCol = cols.find((c) => c.key === over.id);
    if (targetCol) { setStatus(active.id, targetCol.key); return; }
    for (const col of cols) { if (grouped[col.key].find((t) => t.id === over.id)) { setStatus(active.id, col.key); return; } }
  };

  return (
    <div style={{ padding: "12px 0 100px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[{ key: "yesterday", label: "Ayer" }, { key: "today", label: "Hoy" }, { key: "tomorrow", label: "Mañana" }, { key: "week", label: "Semana" }, { key: "all", label: "Todas" }].map((f) => (
          <button key={f.key} onClick={() => setKFilter(f.key)} style={{ padding: "5px 12px", borderRadius: 20, border: kFilter === f.key ? "none" : `1px solid ${theme.border}`, backgroundColor: kFilter === f.key ? theme.accent : "transparent", color: kFilter === f.key ? (dk ? "#000" : "#fff") : theme.textSec, fontSize: 12, fontWeight: kFilter === f.key ? 600 : 400, cursor: "pointer" }}>{f.label}</button>
        ))}
        <span style={{ fontSize: 11, color: theme.textSec, display: "flex", alignItems: "center", marginLeft: "auto" }}>{filtered.length}</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: theme.textSec }}>Ordenar:</span>
        {[{ key: "due", label: "⚠️ Límite" }, { key: "planned", label: "📅 Planificado" }, { key: "category", label: "Categoría" }].map((s) => (
          <button key={s.key} onClick={() => setKSort(s.key)} style={{ padding: "4px 10px", borderRadius: 14, border: kSort === s.key ? "none" : `1px solid ${theme.border}`, backgroundColor: kSort === s.key ? theme.surface : "transparent", color: kSort === s.key ? theme.text : theme.textSec, fontSize: 11, fontWeight: kSort === s.key ? 600 : 400, cursor: "pointer" }}>{s.label}</button>
        ))}
      </div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="kanban-cols">
      {cols.map((col) => (
        <div key={col.key} className="kanban-col" style={{ marginBottom: 16, minWidth: 0 }}>
          <DroppableArea id={col.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", marginBottom: 6, borderRadius: 8, backgroundColor: dk ? "#111" : "#f8f8f8" }}>
              <span style={{ fontSize: 13 }}>{col.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>{col.label}</span>
              <span style={{ fontSize: 11, color: theme.textSec, backgroundColor: theme.surface, padding: "0 6px", borderRadius: 8 }}>{grouped[col.key].length}</span>
            </div>
          </DroppableArea>
          {grouped[col.key].length === 0 && <DroppableArea id={col.key}><div style={{ padding: "20px 8px", fontSize: 11, color: theme.textSec, textAlign: "center", border: `1px dashed ${theme.border}`, borderRadius: 8 }}>Arrastra aquí</div></DroppableArea>}
          {grouped[col.key].map((t) => (
            <DraggableCard key={t.id} id={t.id}>
              <div onClick={() => onTimerView(t.id)} style={{ padding: "8px 10px", marginBottom: 4, borderRadius: 8, backgroundColor: isOverdue(t) ? "#ef444412" : theme.card, border: `1px solid ${isOverdue(t) ? "#ef444433" : theme.border}`, borderLeft: `3px solid ${t.catColor}`, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                  {t.emoji && <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{t.emoji}</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: (t.recurring ? (t.recurringHistory || {})[today] : t.completed) ? "line-through" : "none" }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: theme.textSec, marginTop: 2, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ color: t.catColor }}>{t.catName}</span>
                      {t.totalSeconds > 0 && <span>· {fmtShort(t.totalSeconds + (activeId === t.id ? elapsed : 0))}</span>}
                      {(t.subtasks || []).length > 0 && <span>· {(t.subtasks || []).filter((s) => s.done).length}/{(t.subtasks || []).length}</span>}
                      <button onClick={(e) => { e.stopPropagation(); focusPanel.includes(t.id) ? removeFromFocus(t.id) : addToFocus(t.id); }} style={{ background: "none", border: "none", color: focusPanel.includes(t.id) ? "#6366f1" : theme.textSec, cursor: "pointer", padding: 0, display: "flex", opacity: focusPanel.includes(t.id) ? 1 : 0.4 }}>{I.pin}</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, alignItems: "flex-end" }}>
                    {t.plannedDate && (() => { const dc = dateColor(t.plannedDate, t.completed); return <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, backgroundColor: dc ? dc + "22" : theme.surface, color: dc || theme.textSec }}>📅 {fmtDDMM(t.plannedDate)}</span>; })()}
                    {t.dueDate && (() => { const dc = dateColor(t.dueDate, t.completed); return <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, backgroundColor: dc ? dc + "22" : theme.surface, color: dc || theme.textSec }}>⚠️ {fmtDDMM(t.dueDate)}</span>; })()}
                  </div>
                </div>
              </div>
            </DraggableCard>
          ))}
        </div>
      ))}
      </div>
      </DndContext>
    </div>
  );
}

function HabitsView({ categories, onUpdate, theme, dk, colOrder, onColOrderChange }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [showFullMonth, setShowFullMonth] = useState(false);
  const recurringTasks = categories.flatMap((c) => c.tasks.filter((t) => t.recurring && t.recurring.length > 0).map((t) => ({ ...ensureTask(t), catColor: c.color, catId: c.id })));

  // Apply custom order
  const orderedTasks = colOrder ? colOrder.map((id) => recurringTasks.find((t) => t.id === id)).filter(Boolean) : recurringTasks;
  // Add any new tasks not in order
  const missingTasks = recurringTasks.filter((t) => !colOrder || !colOrder.includes(t.id));
  const finalTasks = colOrder ? [...orderedTasks, ...missingTasks] : recurringTasks;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const todayStr = getDateStr();
  const DAYNAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  const toggleDay = (taskId, dateStr) => {
    onUpdate((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const hist = { ...(t.recurringHistory || {}) };
      hist[dateStr] ? delete hist[dateStr] : hist[dateStr] = true;
      return { ...t, recurringHistory: hist };
    }) })));
  };

  const moveCol = (taskId, dir) => {
    const ids = finalTasks.map((t) => t.id);
    const idx = ids.indexOf(taskId);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ids.length) return;
    const newIds = [...ids];
    [newIds[idx], newIds[newIdx]] = [newIds[newIdx], newIds[idx]];
    onColOrderChange(newIds);
    if (onOrderChange) onOrderChange(newIds);
  };

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); setShowFullMonth(false); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); setShowFullMonth(false); };

  const isCurrentMonth = month === today.getMonth() && year === today.getFullYear();
  const todayDay = today.getDate();
  const startDay = (!showFullMonth && isCurrentMonth) ? todayDay : 1;

  // Stats per task
  const taskStats = finalTasks.map((t) => {
    const hist = t.recurringHistory || {};
    let total = 0, done = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month, d).getDay();
      if ((t.recurring || []).includes(dow)) {
        total++;
        const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (hist[ds]) done++;
      }
    }
    return { ...t, total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  });

  return (
    <div style={{ padding: "12px 0 100px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", fontSize: 22, padding: "4px 12px" }}>‹</button>
        <span style={{ fontSize: 16, fontWeight: 700, textTransform: "capitalize" }}>{monthName}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", fontSize: 22, padding: "4px 12px" }}>›</button>
      </div>
      {colOrder && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={() => onColOrderChange(null)} style={{ padding: "4px 12px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "none", color: theme.textSec, fontSize: 11, cursor: "pointer" }}>↺ Orden original</button>
        </div>
      )}
      {recurringTasks.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: theme.textSec }}>No hay hábitos. Edita una tarea y activa "Repetir" para verla aquí.</div>}
      {recurringTasks.length > 0 && (<>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: finalTasks.length * 44 + 130 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, backgroundColor: theme.bg, zIndex: 2, padding: "6px 8px", textAlign: "left", fontSize: 12, color: theme.textSec, fontWeight: 500, borderBottom: `1px solid ${theme.border}`, minWidth: 120 }}>Día</th>
                {taskStats.map((t, ti) => (
                  <th key={t.id} style={{ padding: "4px 2px", textAlign: "center", borderBottom: `1px solid ${theme.border}`, minWidth: 44 }}>
                    <div style={{ display: "flex", justifyContent: "center", gap: 0, marginBottom: 2 }}>
                      <button onClick={() => moveCol(t.id, -1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: "0 2px", fontSize: 10, opacity: ti === 0 ? 0.15 : 0.5 }}>◀</button>
                      <button onClick={() => moveCol(t.id, 1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: "0 2px", fontSize: 10, opacity: ti === taskStats.length - 1 ? 0.15 : 0.5 }}>▶</button>
                    </div>
                    <div style={{ fontSize: 18 }}>{t.emoji || t.name.charAt(0)}</div>
                    <div style={{ fontSize: 9, color: theme.textSec, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 50 }}>{t.name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: daysInMonth - startDay + 1 }, (_, i) => {
                const day = startDay + i;
                const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dow = new Date(year, month, day).getDay();
                const dayName = DAYNAMES[dow];
                const isToday = ds === todayStr;
                const isPast = ds < todayStr;
                return (
                  <tr key={day} style={{ backgroundColor: isToday ? (dk ? "#1c1c1c" : "#f0f0ff") : "transparent" }}>
                    <td style={{ position: "sticky", left: 0, backgroundColor: isToday ? (dk ? "#1c1c1c" : "#f0f0ff") : theme.bg, zIndex: 1, padding: "5px 8px", borderBottom: `1px solid ${theme.border}`, fontSize: 13, fontWeight: isToday ? 700 : 400, color: isToday ? theme.text : (isPast ? theme.textSec : theme.text), whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 600, marginRight: 6 }}>{day}</span>
                      <span style={{ textTransform: "capitalize", fontSize: 12 }}>{dayName.slice(0, 3)}</span>
                    </td>
                    {taskStats.map((t) => {
                      const isActive = (t.recurring || []).includes(dow);
                      const done = !!(t.recurringHistory || {})[ds];
                      return (
                        <td key={t.id} onClick={() => isActive && toggleDay(t.id, ds)} style={{ padding: "4px", textAlign: "center", borderBottom: `1px solid ${theme.border}`, cursor: isActive ? "pointer" : "default" }}>
                          {isActive ? (
                            <div style={{ width: 28, height: 28, borderRadius: 7, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: done ? t.catColor : (dk ? "#1a1a1a" : "#eee"), color: done ? "#fff" : theme.textSec + "33", fontSize: 14, fontWeight: 700, transition: "all .15s" }}>
                              {done ? "✓" : ""}
                            </div>
                          ) : (
                            <div style={{ width: 28, height: 28, margin: "0 auto", opacity: 0.1 }} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ position: "sticky", left: 0, backgroundColor: theme.bg, padding: "8px", fontSize: 12, fontWeight: 600, color: theme.textSec, borderTop: `2px solid ${theme.border}` }}>Total</td>
                {taskStats.map((t) => (
                  <td key={t.id} style={{ padding: "8px 4px", textAlign: "center", borderTop: `2px solid ${theme.border}` }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.catColor }}>{t.done}/{t.total}</div>
                    <div style={{ fontSize: 10, color: theme.textSec }}>{t.pct}%</div>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        {isCurrentMonth && !showFullMonth && startDay > 1 && (
          <button onClick={() => setShowFullMonth(true)} style={{ display: "block", width: "100%", padding: "10px", marginTop: 8, borderRadius: 8, border: `1px solid ${theme.border}`, background: "none", color: theme.textSec, fontSize: 12, cursor: "pointer", textAlign: "center" }}>▲ Ver mes completo (1 - {todayDay - 1})</button>
        )}
        {showFullMonth && isCurrentMonth && (
          <button onClick={() => setShowFullMonth(false)} style={{ display: "block", width: "100%", padding: "10px", marginTop: 8, borderRadius: 8, border: `1px solid ${theme.border}`, background: "none", color: theme.textSec, fontSize: 12, cursor: "pointer", textAlign: "center" }}>▼ Desde hoy</button>
        )}
      </>)}
    </div>
  );
}

// Google Calendar sync helpers
const gcalSync = async (token, task, catName) => {
  if (!token || (!task.plannedDate && !task.dueDate)) return null;
  const date = task.plannedDate || task.dueDate;
  const nextDay = (d) => { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + 1); return dt.toISOString().split("T")[0]; };
  const body = { summary: `${task.emoji ? task.emoji + " " : ""}${task.name}`, description: `Categoría: ${catName}${task.dueDate ? "\nLímite: " + task.dueDate : ""}${task.plannedDate ? "\nPlanificada: " + task.plannedDate : ""}`, start: { date }, end: { date: nextDay(date) } };
  try {
    if (task.calEventId) {
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${task.calEventId}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return task.calEventId;
    }
    const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { const d = await r.json(); return d.id; }
  } catch (e) { console.log("gcal sync error", e); }
  return null;
};
const gcalDelete = async (token, eventId) => {
  if (!token || !eventId) return;
  try { await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); } catch (e) {}
};

function CalendarView({ categories, onTimerView, theme, dk }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState(null);
  const [calFilter, setCalFilter] = useState("all"); // all | due | planned

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const monthName = new Date(year, month).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const todayStr = getDateStr();

  const allTasks = categories.flatMap((c) => c.tasks.map((t) => ({ ...ensureTask(t), catName: c.name, catColor: c.color })));

  // Tasks by date filtered
  const tasksByDate = {};
  allTasks.forEach((t) => {
    if (calFilter === "due" || calFilter === "all") {
      if (t.dueDate) { if (!tasksByDate[t.dueDate]) tasksByDate[t.dueDate] = []; const already = tasksByDate[t.dueDate].some((x) => x.id === t.id && x.dateType === "due"); if (!already) tasksByDate[t.dueDate].push({ ...t, dateType: "due" }); }
    }
    if (calFilter === "planned" || calFilter === "all") {
      if (t.plannedDate) { if (!tasksByDate[t.plannedDate]) tasksByDate[t.plannedDate] = []; const already = tasksByDate[t.plannedDate].some((x) => x.id === t.id && x.dateType === "planned"); if (!already) tasksByDate[t.plannedDate].push({ ...t, dateType: "planned" }); }
    }
  });

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); setSelectedDay(null); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); setSelectedDay(null); };

  const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
  // Adjust firstDow to Monday-start (0=Mon)
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;

  const selectedDateStr = selectedDay ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}` : null;
  const selectedTasks = selectedDateStr ? (tasksByDate[selectedDateStr] || []) : [];

  return (
    <div style={{ padding: "12px 0 100px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", fontSize: 22, padding: "4px 12px" }}>‹</button>
        <span style={{ fontSize: 16, fontWeight: 700, textTransform: "capitalize" }}>{monthName}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", fontSize: 22, padding: "4px 12px" }}>›</button>
      </div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, justifyContent: "center" }}>
        {[{ key: "all", label: "Todas" }, { key: "due", label: "⚠️ Límite" }, { key: "planned", label: "📅 Planificado" }].map((f) => (
          <button key={f.key} onClick={() => setCalFilter(f.key)} style={{ padding: "5px 12px", borderRadius: 20, border: calFilter === f.key ? "none" : `1px solid ${theme.border}`, backgroundColor: calFilter === f.key ? theme.accent : "transparent", color: calFilter === f.key ? (dk ? "#000" : "#fff") : theme.textSec, fontSize: 12, fontWeight: calFilter === f.key ? 600 : 400, cursor: "pointer" }}>{f.label}</button>
        ))}
      </div>
      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {DAYS.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 11, color: theme.textSec, fontWeight: 600, padding: "4px 0" }}>{d}</div>)}
      </div>
      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {Array.from({ length: startOffset }, (_, i) => <div key={`e-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isToday = ds === todayStr;
          const isSelected = selectedDay === day;
          const tasks = tasksByDate[ds] || [];
          const hasOverdue = tasks.some((t) => t.dueDate === ds && ds < todayStr && !t.completed);
          return (
            <div key={day} onClick={() => setSelectedDay(isSelected ? null : day)} style={{ minHeight: 52, padding: 4, borderRadius: 8, cursor: "pointer", backgroundColor: isSelected ? (dk ? "#1a1a2e" : "#e8e8ff") : isToday ? (dk ? "#1c1c1c" : "#f0f0ff") : "transparent", border: isToday ? `2px solid #6366f1` : `1px solid ${theme.border}22` }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? "#6366f1" : theme.text, textAlign: "right", marginBottom: 2 }}>{day}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                {tasks.slice(0, 3).map((t, ti) => (
                  <div key={ti} style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: hasOverdue && t.dueDate === ds ? "#ef4444" : t.catColor }} />
                ))}
                {tasks.length > 3 && <div style={{ fontSize: 8, color: theme.textSec }}>+{tasks.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {/* Selected day detail */}
      {selectedDay && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{selectedDay} de {new Date(year, month).toLocaleDateString("es-ES", { month: "long" })}</div>
          {selectedTasks.length === 0 && <div style={{ fontSize: 13, color: theme.textSec, fontStyle: "italic" }}>Sin tareas este día</div>}
          {selectedTasks.map((t) => (
            <div key={t.id} onClick={() => onTimerView(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 3, borderRadius: 8, backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderLeft: `3px solid ${t.catColor}`, cursor: "pointer" }}>
              {t.emoji && <span style={{ fontSize: 14 }}>{t.emoji}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: t.completed ? "line-through" : "none" }}>{t.name}</div>
                <div style={{ fontSize: 11, color: theme.textSec, display: "flex", gap: 6 }}>
                  <span style={{ color: t.catColor }}>{t.catName}</span>
                  {t.plannedDate === selectedDateStr && <span style={{ color: "#6366f1" }}>📅 Planificado</span>}
                  {t.dueDate === selectedDateStr && <span style={{ color: "#ef4444" }}>⚠️ Límite</span>}
                  {t.totalSeconds > 0 && <span>· {fmtShort(t.totalSeconds)}</span>}
                </div>
              </div>
              {t.completed && <span style={{ color: "#10b981", fontSize: 14 }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatsView({ categories, theme, dk, onClose }) {
  const [period, setPeriod] = useState("today");
  const [filter, setFilter] = useState("all");
  const initSleep = (() => { try { const r = localStorage.getItem("task-timer-sleep"); if (r) return JSON.parse(r); } catch (e) {} return { from: "00:00", to: "07:00" }; })();
  const [sleepFrom, setSleepFrom] = useState(initSleep.from);
  const [sleepTo, setSleepTo] = useState(initSleep.to);
  const [showSleepSettings, setShowSleepSettings] = useState(false);
  const saveSleep = (f, t) => { try { localStorage.setItem("task-timer-sleep", JSON.stringify({ from: f, to: t })); } catch (e) {} };
  const sleepSecs = (() => { const [fh, fm] = sleepFrom.split(":").map(Number); const [th, tm] = sleepTo.split(":").map(Number); let diff = (th * 60 + tm) - (fh * 60 + fm); if (diff < 0) diff += 1440; return diff * 60; })();
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
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, flex: 1 }}>Estadísticas</h1>
          <button onClick={() => setShowSleepSettings((p) => !p)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 8, color: showSleepSettings ? theme.text : theme.textSec, cursor: "pointer", padding: "6px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>💤 {fmtShort(sleepSecs)}</button>
        </div>
        {showSleepSettings && (
          <div style={{ padding: "12px 0", borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: theme.textSec }}>Sueño:</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="time" value={sleepFrom} onChange={(e) => { setSleepFrom(e.target.value); saveSleep(e.target.value, sleepTo); }} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none" }} />
              <span style={{ color: theme.textSec, fontSize: 13 }}>→</span>
              <input type="time" value={sleepTo} onChange={(e) => { setSleepTo(e.target.value); saveSleep(sleepFrom, e.target.value); }} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none" }} />
            </div>
            <span style={{ fontSize: 13, color: theme.textSec }}>{fmtShort(sleepSecs)}/noche</span>
          </div>
        )}
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
          // Calculate sleep overlap with elapsed time
          const calcSleepOverlap = () => {
            const [fh, fm] = sleepFrom.split(":").map(Number);
            const [th, tm] = sleepTo.split(":").map(Number);
            let sf = fh * 3600 + fm * 60, st = th * 3600 + tm * 60;
            if (st <= sf) st += 86400; // crosses midnight
            if (period === "yesterday") return Math.min(st - sf, 86400);
            const elapsed = baseSecs;
            // Sleep ranges that overlap with 0..elapsed
            let overlap = 0;
            // Range 1: sf..st
            const overlapStart = Math.max(sf, 0), overlapEnd = Math.min(st, elapsed);
            if (overlapEnd > overlapStart) overlap += overlapEnd - overlapStart;
            // If crosses midnight, also check sf-86400..st-86400
            if (sf > 86400 - 1) { const os2 = Math.max(sf - 86400, 0), oe2 = Math.min(st - 86400, elapsed); if (oe2 > os2) overlap += oe2 - os2; }
            return Math.max(0, overlap);
          };
          const sleepInDay = calcSleepOverlap();
          const untracked = Math.max(0, baseSecs - totalTracked - sleepInDay);

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
                {sleepInDay > 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, opacity: 0.6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: "#6366f1" }} />
                      <span style={{ color: theme.textSec }}>💤 Sueño</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: theme.textSec }}>{fmtShort(Math.round(sleepInDay))}</span>
                      <span style={{ color: theme.textSec, fontSize: 11 }}>{baseSecs > 0 ? Math.round((sleepInDay / baseSecs) * 100) : 0}%</span>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, opacity: 0.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: dk ? "#1a1a1a" : "#ddd" }} />
                    <span style={{ color: theme.textSec }}>Sin registro</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: theme.textSec }}>{fmtShort(Math.max(0, Math.round(untracked)))}</span>
                    <span style={{ color: theme.textSec, fontSize: 11 }}>{baseSecs > 0 ? Math.round((Math.max(0, untracked) / baseSecs) * 100) : 0}%</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        {period === "week" && (() => {
          // Weekly donut: 168h total, categories + sleep + sin actividad
          const WEEK_SECS = 168 * 3600;
          const weeklySleep = sleepSecs * 7;
          const catTotals = categories.map((cat) => {
            const secs = cat.tasks.reduce((a, task) => a + (task.sessions || []).filter(isThisWeek).reduce((s, x) => s + x.duration, 0), 0);
            return { id: cat.id, name: cat.name, color: cat.color, secs };
          }).filter((c) => c.secs > 0).sort((a, b) => b.secs - a.secs);
          const totalTracked = catTotals.reduce((a, c) => a + c.secs, 0);
          const untracked = Math.max(0, WEEK_SECS - totalTracked - weeklySleep);
          const slices = [...catTotals, ...(weeklySleep > 0 ? [{ id: "_sleep", name: "Sueño", color: "#6366f1", secs: weeklySleep }] : []), { id: "_free", name: "Sin actividad", color: dk ? "#1a1a1a" : "#ddd", secs: untracked }];
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
            return <path key={si} d={path} fill={sl.color} opacity={sl.id === "_free" ? 0.5 : (sl.id === "_sleep" ? 0.35 : 0.85)} />;
          });
          const awakeSecs = WEEK_SECS - weeklySleep;
          const pct = awakeSecs > 0 ? Math.round((totalTracked / awakeSecs) * 100) : 0;

          return (
            <div style={{ padding: "20px 0", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Distribución semanal</div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <svg viewBox="0 0 200 200" width="220" height="220">
                  {donutArcs}
                  <text x={cx} y={cy - 6} textAnchor="middle" fill={theme.text} fontSize="16" fontWeight="700">{fmtShort(totalTracked)}</text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fill={theme.textSec} fontSize="9">{pct}% del tiempo despierto</text>
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
                {weeklySleep > 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, opacity: 0.6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: "#6366f1" }} />
                      <span style={{ color: theme.textSec }}>💤 Sueño</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: theme.textSec }}>{fmtShort(weeklySleep)}</span>
                      <span style={{ color: theme.textSec, fontSize: 11 }}>{Math.round((weeklySleep / WEEK_SECS) * 100)}%</span>
                    </div>
                  </div>
                )}
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
  const [focusPanel, setFocusPanel] = useState(() => { try { const s = localStorage.getItem("task-timer-focus"); return s ? JSON.parse(s) : []; } catch (e) { return []; } });
  const [habitsOrder, setHabitsOrder] = useState(() => { try { const s = localStorage.getItem("task-timer-habits-order"); return s ? JSON.parse(s) : null; } catch (e) { return null; } });
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
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState(new Set());
  const [mainView, setMainView] = useState("tasks"); // tasks | kanban | habits | calendar
  const intRef = useRef(null);
  const saveRef = useRef(null);
  const initDone = useRef(false);
  const fileRef = useRef(null);
  const catsRef = useRef(categories);
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
  const [calToken, setCalToken] = useState(() => { try { return localStorage.getItem("task-timer-cal-token"); } catch (e) { return null; } });
  const handleLogin = async () => {
    try {
      await setPersistence(auth, browserLocalPersistence);
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) { setCalToken(credential.accessToken); localStorage.setItem("task-timer-cal-token", credential.accessToken); }
    }
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
      if (data.focusPanel) { setFocusPanel(data.focusPanel); localStorage.setItem("task-timer-focus", JSON.stringify(data.focusPanel)); }
      if (data.habitsOrder) { setHabitsOrder(data.habitsOrder); localStorage.setItem("task-timer-habits-order", JSON.stringify(data.habitsOrder)); }
      // Recover tags: merge cloud + local + extracted from sessions
      const cloudTags = data.tags && data.tags.length > 0 ? data.tags : [];
      const localTags = tagsRef.current || [];
      const fromSessions = new Set();
      cats.forEach((c) => c.tasks.forEach((t) => (t.sessions || []).forEach((s) => (s.tags || []).forEach((tag) => fromSessions.add(tag)))));
      const merged = [...new Set([...cloudTags, ...localTags, ...fromSessions])];
      if (merged.length > 0) { setTags(merged); saveTags(merged); if (merged.length !== cloudTags.length) saveToCloud(cats, merged); }
      // Resume any running timer from cloud — clean up zombies
      const runningTasks = [];
      for (const c of cats) { for (const t of c.tasks) { if (t.isRunning && t.startedAt) runningTasks.push({ task: t, cat: c }); } }
      if (runningTasks.length > 0) {
        // Pick the most recent one, stop all others
        const best = runningTasks.sort((a, b) => new Date(b.task.startedAt) - new Date(a.task.startedAt))[0];
        const el = calcElapsed(best.task.startedAt);
        if (el > 0 && el < 86400) {
          setActiveId(best.task.id); setElapsed(el); setExpanded(new Set([best.cat.id]));
        }
        // Clean all others
        const zombieIds = runningTasks.filter((r) => r.task.id !== best.task.id || el <= 0 || el >= 86400).map((r) => r.task.id);
        if (zombieIds.length > 0 || (el <= 0 || el >= 86400)) {
          const cleanIds = el <= 0 || el >= 86400 ? [...zombieIds, best.task.id] : zombieIds;
          setCat((p) => { const next = p.map((cat) => ({ ...cat, tasks: cat.tasks.map((tk) => cleanIds.includes(tk.id) ? { ...tk, isRunning: false, startedAt: null } : tk) })); saveLocal(next); cloudSave(next, tagsRef.current); return next; });
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
      if (data.focusPanel) { setFocusPanel(data.focusPanel); localStorage.setItem("task-timer-focus", JSON.stringify(data.focusPanel)); }
      if (data.habitsOrder !== undefined) { setHabitsOrder(data.habitsOrder && data.habitsOrder.length > 0 ? data.habitsOrder : null); try { if (data.habitsOrder?.length > 0) localStorage.setItem("task-timer-habits-order", JSON.stringify(data.habitsOrder)); else localStorage.removeItem("task-timer-habits-order"); } catch (e) {} }
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

  // NFC: handle URL param ?nfc=taskId
  const nfcHandled = useRef(false);
  useEffect(() => {
    if (nfcHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const nfcId = params.get("nfc");
    if (!nfcId) return;
    // Wait for categories to be loaded
    const found = categories.flatMap((c) => c.tasks).find((t) => t.id === nfcId);
    if (!found && !initDone.current) return; // wait for cloud
    if (found) {
      nfcHandled.current = true;
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      // Toggle timer
      setTimeout(() => { if (activeId === nfcId) { doStop(nfcId); } else { doStart(nfcId); } }, 300);
    } else if (initDone.current) {
      nfcHandled.current = true;
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [categories, activeId]);

  const writeNfc = async (taskId, taskName) => {
    if (!("NDEFReader" in window)) {
      // Fallback: copy URL to clipboard
      const url = `${window.location.origin}${window.location.pathname}?nfc=${taskId}`;
      try { await navigator.clipboard.writeText(url); setModal({ title: "URL copiada", message: `Tu navegador no soporta escritura NFC. Programa este enlace manualmente en tu tag NFC:\n\n${url}`, confirmLabel: "OK", confirmColor: "#6366f1", onConfirm: () => setModal(null) }); } catch (e) { prompt("Copia esta URL y prográmala en tu tag NFC:", url); }
      return;
    }
    try {
      setModal({ title: "Acerca el tag NFC", message: `Acerca tu etiqueta NFC al móvil para asociarla a "${taskName}"...` });
      const writer = new window.NDEFReader();
      await writer.write({ records: [{ recordType: "url", data: `${window.location.origin}${window.location.pathname}?nfc=${taskId}` }] });
      setModal({ title: "✓ Tag NFC grabado", message: `"${taskName}" asociada. Acerca el tag para iniciar/parar el timer.`, confirmLabel: "OK", confirmColor: "#10b981", onConfirm: () => setModal(null) });
    } catch (e) {
      if (e.name !== "AbortError") setModal({ title: "Error NFC", message: e.message || "No se pudo escribir el tag.", confirmLabel: "OK", confirmColor: "#ef4444", onConfirm: () => setModal(null) });
    }
  };

  useEffect(() => { const h = (e) => { if (activeId) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [activeId]);

  // Recurring tasks: auto-reset daily - mark today in history if applicable
  useEffect(() => {
    const todayStr = getDateStr();
    const lastReset = localStorage.getItem("task-timer-last-recurring-reset");
    if (lastReset === todayStr) return;
    localStorage.setItem("task-timer-last-recurring-reset", todayStr);
  }, []);

  // Theme
  useEffect(() => { saveTheme(dk); document.body.style.background = dk ? "#0a0a0a" : "#fafafa"; document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dk ? "#0a0a0a" : "#fafafa"); }, [dk]);

  // Block body scroll when overlays are open
  useEffect(() => {
    document.body.style.overflow = (timerView || showStats || showBackups || showBulkAdd || showBulkDelete || showOverview) ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [timerView, showStats, showBackups, showBulkAdd, showBulkDelete, showOverview]);

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
    if (activeId && activeId !== id) {
      // Instant stop without emotion picker
      clearInterval(intRef.current);
      finishStop(activeId, null);
    }
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
  const saveFocus = (arr) => { setFocusPanel(arr); try { localStorage.setItem("task-timer-focus", JSON.stringify(arr)); } catch (e) {} if (user) saveToCloud(catsRef.current, tagsRef.current, { focusPanel: arr }); };
  const saveHabitsOrder = (arr) => { setHabitsOrder(arr); try { if (arr) localStorage.setItem("task-timer-habits-order", JSON.stringify(arr)); else localStorage.removeItem("task-timer-habits-order"); } catch (e) {} if (user) saveToCloud(catsRef.current, tagsRef.current, { habitsOrder: arr || [] }); };
  const addToFocus = (id) => { if (focusPanel.includes(id)) return; const next = [...focusPanel, id].slice(-7); saveFocus(next); };
  const removeFromFocus = (id) => { saveFocus(focusPanel.filter((x) => x !== id)); };
  const switchFocus = (id) => {
    if (activeId && activeId !== id) {
      clearInterval(intRef.current);
      finishStop(activeId, null);
    }
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
  const editTaskSave = (id, name, _c, goalDaily, dueDate, plannedDate, recurring, emoji, permanent) => {
    if (!name.trim()) return;
    const catName = categories.find((c) => c.tasks.some((t) => t.id === id))?.name || "";
    const oldTask = categories.flatMap((c) => c.tasks).find((t) => t.id === id);
    update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, name: name.trim(), ...(goalDaily !== undefined ? { goalDaily } : {}), dueDate: dueDate !== undefined ? dueDate : t.dueDate, plannedDate: plannedDate !== undefined ? plannedDate : t.plannedDate, recurring: recurring !== undefined ? recurring : t.recurring, emoji: emoji !== undefined ? emoji : t.emoji, permanent: permanent !== undefined ? permanent : t.permanent } : t) })));
    // Gcal sync
    const token = calToken || localStorage.getItem("task-timer-cal-token");
    if (token && (dueDate || plannedDate)) {
      const task = { ...oldTask, name: name.trim(), dueDate, plannedDate, emoji };
      gcalSync(token, task, catName).then((evId) => {
        if (evId && evId !== oldTask?.calEventId) update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, calEventId: evId } : t) })));
      });
    } else if (token && !dueDate && !plannedDate && oldTask?.calEventId) {
      gcalDelete(token, oldTask.calEventId);
      update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => t.id === id ? { ...t, calEventId: null } : t) })));
    }
    setEditModal(null);
  };
  const moveTaskToCat = (taskId, toCatId) => { update((p) => { let task = null; const without = p.map((c) => { const found = c.tasks.find((t) => t.id === taskId); if (found) task = found; return { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) }; }); if (!task) return p; return without.map((c) => c.id === toCatId ? { ...c, tasks: [...c.tasks, task] } : c); }); setModal(null); };
  const moveCat = (id, dir) => update((p) => { const i = p.findIndex((c) => c.id === id); if ((dir === -1 && i === 0) || (dir === 1 && i === p.length - 1)) return p; const n = [...p]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n; });
  const moveTask = (catId, taskId, dir) => update((p) => p.map((c) => { if (c.id !== catId) return c; const i = c.tasks.findIndex((t) => t.id === taskId); if ((dir === -1 && i === 0) || (dir === 1 && i === c.tasks.length - 1)) return c; const n = [...c.tasks]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return { ...c, tasks: n }; }));
  const smartScore = (t, mode) => {
    const today = getDateStr();
    const ws = getDateStr(getWeekStart());
    const we = new Date(getWeekStart()); we.setDate(we.getDate() + 6); const weStr = getDateStr(we);
    const nearestDate = (task) => {
      const dates = [task.plannedDate, task.dueDate].filter(Boolean).sort();
      return dates[0] || "9999";
    };
    const urgency = (d) => { if (!d) return 99; if (d < today) return 0; if (d === today) return 1; if (d >= ws && d <= weStr) return 2; return 3 + d.localeCompare(today); };
    if (mode === "rutina") {
      // permanent first (by sessions desc), then planned, then due
      if (t.permanent) return -100000 + (99999 - (t.sessions || []).length);
      const pd = t.plannedDate || "9999";
      const dd = t.dueDate || "9999";
      return pd.localeCompare("0") * 1000 + dd.localeCompare("0");
    }
    if (mode === "prioridad") {
      // dated first (closest), permanent last
      if (t.permanent) return 999999;
      const nd = nearestDate(t);
      return urgency(nd) * 10000 + nd.localeCompare("0");
    }
    if (mode === "urgente") {
      const nd = nearestDate(t);
      if (t.permanent) return 500000 + (99999 - (t.sessions || []).length);
      return urgency(nd) * 10000 + nd.localeCompare("0");
    }
    return 0;
  };
  const sortTasks = (catId, sortBy) => { update((p) => p.map((c) => { if (catId && c.id !== catId) return c; const sorted = [...c.tasks].sort((a, b) => { if (sortBy === "alpha") return a.name.localeCompare(b.name, "es"); if (sortBy === "alpha-desc") return b.name.localeCompare(a.name, "es"); if (sortBy === "time") return b.totalSeconds - a.totalSeconds; if (sortBy === "time-asc") return a.totalSeconds - b.totalSeconds; if (sortBy === "sessions") return b.sessions.length - a.sessions.length; if (sortBy === "recent") return (b.sessions.length > 0 ? new Date(b.sessions[b.sessions.length - 1].dateISO || 0).getTime() : 0) - (a.sessions.length > 0 ? new Date(a.sessions[a.sessions.length - 1].dateISO || 0).getTime() : 0); if (sortBy === "planned") { const da = a.plannedDate || "9999"; const db = b.plannedDate || "9999"; return da.localeCompare(db) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"); } if (sortBy === "due") { const da = a.dueDate || "9999"; const db = b.dueDate || "9999"; return da.localeCompare(db) || (a.plannedDate || "9999").localeCompare(b.plannedDate || "9999"); } if (sortBy === "rutina" || sortBy === "prioridad" || sortBy === "urgente") return smartScore(a, sortBy) - smartScore(b, sortBy); return 0; }); return { ...c, tasks: sorted }; })); setModal(null); };
  const sortAllTasks = (sortBy) => { sortTasks(null, sortBy); };

  // dnd-kit sensors - only activate from grip handle
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );
  const handleTaskDragEnd = (catId, event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    update((p) => p.map((c) => {
      if (c.id !== catId) return c;
      const oldIdx = c.tasks.findIndex((t) => t.id === active.id);
      const newIdx = c.tasks.findIndex((t) => t.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return c;
      return { ...c, tasks: arrayMove(c.tasks, oldIdx, newIdx) };
    }));
  };
  const handleSubDragEnd = (taskId, event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const subs = t.subtasks || [];
      const oldIdx = subs.findIndex((s) => s.id === active.id);
      const newIdx = subs.findIndex((s) => s.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return t;
      return { ...t, subtasks: arrayMove(subs, oldIdx, newIdx) };
    }) })));
  };

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
  const bulkAdd = (catId, text) => {
    const lines = text.split("\n").filter((l) => l.trim());
    const tasks = [];
    let current = null;
    const parseDateLine = (s) => {
      const lm = s.match(/^limit\s+(\d{2})-(\d{2})-(\d{4})$/i);
      if (lm) return { type: "due", date: `${lm[3]}-${lm[2]}-${lm[1]}` };
      const tm = s.match(/^to\s*do\s+(\d{2})-(\d{2})-(\d{4})$/i);
      if (tm) return { type: "planned", date: `${tm[3]}-${tm[2]}-${tm[1]}` };
      const old = s.match(/^\d{4}-\d{2}-\d{2}$/);
      if (old) return { type: "due", date: s };
      return null;
    };
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ") || trimmed.startsWith("· ") || trimmed.startsWith("* ")) {
        if (current) current.subtasks.push({ id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: trimmed.slice(2).trim(), done: false });
      } else {
        const dl = parseDateLine(trimmed);
        if (dl && current) {
          if (dl.type === "due") current.dueDate = dl.date; else current.plannedDate = dl.date;
        } else {
          if (current) tasks.push(current);
          current = { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: trimmed, totalSeconds: 0, isRunning: false, startedAt: null, completed: false, goalDaily: 0, sessions: [], subtasks: [], notes: "", dueDate: null, plannedDate: null, recurring: null, recurringHistory: {} };
        }
      }
    });
    if (current) tasks.push(current);
    if (tasks.length === 0) return;
    update((p) => p.map((c) => c.id === catId ? { ...c, tasks: [...c.tasks, ...tasks] } : c));
    setExpanded((p) => new Set([...p, catId]));
    setShowBulkAdd(false);
  };
  const bulkDelete = (taskIds) => {
    taskIds.forEach((id) => { if (activeId === id) { clearInterval(intRef.current); setActiveId(null); setElapsed(0); } if (timerView === id) setTimerView(null); });
    update((p) => p.map((c) => ({ ...c, tasks: c.tasks.filter((t) => !taskIds.includes(t.id)) })));
    setShowBulkDelete(false);
  };
  const delSession = (taskId, sessIdx) => { update((p) => p.map((c) => ({ ...c, tasks: c.tasks.map((t) => { if (t.id !== taskId) return t; const s = [...t.sessions]; const removed = s.splice(sessIdx, 1)[0]; return { ...t, sessions: s, totalSeconds: Math.max(0, t.totalSeconds - (removed?.duration || 0)) }; }) }))); setModal(null); };

  const exportData = () => { const b = new Blob([JSON.stringify(categories, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `task-timer-${getDateStr()}.json`; a.click(); URL.revokeObjectURL(u); };

  const generateReport = (reportPeriod) => {
    setModal(null);
    const todayStr = getDateStr();
    const allT = categories.flatMap((c) => c.tasks.map((t) => ({ ...ensureTask(t), catName: c.name, catColor: c.color })));
    const totalAll = allT.reduce((s, t) => s + t.totalSeconds, 0);
    const totalSessions = allT.reduce((s, t) => s + (t.sessions || []).length, 0);

    // Period filter
    const isYesterday = (s) => { const y = new Date(); y.setDate(y.getDate() - 1); return getDateStr(parseSessionDate(s)) === getDateStr(y); };
    const isLastWeek = (s) => { const d = parseSessionDate(s); const now = new Date(); const ws = getWeekStart(); const lwEnd = new Date(ws); lwEnd.setDate(lwEnd.getDate() - 1); const lwStart = new Date(lwEnd); lwStart.setDate(lwStart.getDate() - 6); return d >= lwStart && d <= lwEnd; };
    const isLastMonth = (s) => { const d = parseSessionDate(s); const now = new Date(); const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0); const lmStart = new Date(lmEnd.getFullYear(), lmEnd.getMonth(), 1); return d >= lmStart && d <= lmEnd; };

    const periodLabels = { today: "Hoy", yesterday: "Ayer", lastweek: "Semana pasada", lastmonth: "Mes pasado", all: "Todo" };
    const periodFilter = reportPeriod === "today" ? isToday : reportPeriod === "yesterday" ? isYesterday : reportPeriod === "lastweek" ? isLastWeek : reportPeriod === "lastmonth" ? isLastMonth : () => true;
    const periodLabel = periodLabels[reportPeriod] || "Todo";

    const periodReport = (label, filterFn) => {
      const lines = [];
      const catData = categories.map((c) => {
        const tasks = c.tasks.map((t) => {
          const et = ensureTask(t);
          const fs = (et.sessions || []).filter(filterFn);
          const pTime = fs.reduce((s, x) => s + x.duration, 0);
          const moods = fs.filter((s) => s.mood);
          const avgMood = moods.length > 0 ? ["😫", "😕", "😐", "🙂", "🔥"][Math.round(moods.reduce((a, s) => a + ["😫", "😕", "😐", "🙂", "🔥"].indexOf(s.mood), 0) / moods.length)] : "-";
          const tags = [...new Set(fs.flatMap((s) => s.tags || []))];
          return { name: et.name, pTime, sessions: fs.length, avgMood, tags, completed: et.completed, permanent: et.permanent, recurring: !!et.recurring, plannedDate: et.plannedDate, dueDate: et.dueDate, subtasks: et.subtasks || [], goalDaily: et.goalDaily, emoji: et.emoji };
        }).filter((t) => t.pTime > 0).sort((a, b) => b.pTime - a.pTime);
        const catTime = tasks.reduce((s, t) => s + t.pTime, 0);
        return { name: c.name, catTime, tasks };
      }).filter((c) => c.catTime > 0).sort((a, b) => b.catTime - a.catTime);

      const totalP = catData.reduce((s, c) => s + c.catTime, 0);
      lines.push(`\n## ${label}`);
      lines.push(`Tiempo total: ${fmtLong(totalP)} | Sesiones: ${catData.reduce((s, c) => s + c.tasks.reduce((s2, t) => s2 + t.sessions, 0), 0)}`);
      lines.push("");
      catData.forEach((c) => {
        const pct = totalP > 0 ? Math.round((c.catTime / totalP) * 100) : 0;
        lines.push(`### ${c.name} — ${fmtLong(c.catTime)} (${pct}%)`);
        c.tasks.forEach((t) => {
          const tPct = c.catTime > 0 ? Math.round((t.pTime / c.catTime) * 100) : 0;
          const flags = [t.completed ? "✓" : "", t.permanent ? "♾️" : "", t.recurring ? "🔁" : ""].filter(Boolean).join(" ");
          const dates = [t.plannedDate ? `📅${t.plannedDate}` : "", t.dueDate ? `⚠️${t.dueDate}` : ""].filter(Boolean).join(" ");
          const subs = t.subtasks.length > 0 ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} sub` : "";
          lines.push(`- ${t.emoji || ""}${t.name}: ${fmtLong(t.pTime)} (${tPct}%) | ${t.sessions} ses. | ánimo: ${t.avgMood} ${flags} ${dates} ${subs}`.trim());
          if (t.tags.length > 0) lines.push(`  Tags: ${t.tags.join(", ")}`);
        });
        lines.push("");
      });
      return lines.join("\n");
    };

    // Daily breakdown for the period
    const dailyDays = reportPeriod === "today" ? 1 : reportPeriod === "yesterday" ? 1 : reportPeriod === "lastweek" ? 7 : reportPeriod === "lastmonth" ? new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate() : 14;
    const dailyLines = [`\n## Actividad diaria`];
    const dayStart = reportPeriod === "yesterday" ? 1 : reportPeriod === "lastweek" ? (() => { const ws = getWeekStart(); return Math.ceil((new Date() - new Date(ws)) / 864e5) + 6; })() : reportPeriod === "lastmonth" ? (() => { const d = new Date(); return d.getDate() + new Date(d.getFullYear(), d.getMonth(), 0).getDate() - 1; })() : reportPeriod === "today" ? 0 : 13;
    for (let i = dayStart; i >= dayStart - dailyDays + 1; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = getDateStr(d);
      const dayName = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
      let tot = 0, sess = 0;
      allT.forEach((t) => (t.sessions || []).forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) { tot += s.duration; sess++; } }));
      if (tot > 0) dailyLines.push(`- ${dayName}: ${fmtLong(tot)} (${sess} sesiones)`);
      else dailyLines.push(`- ${dayName}: sin actividad`);
    }

    // Habits
    const habitLines = ["\n## Hábitos (mes actual)"];
    const hMonth = new Date().getMonth(), hYear = new Date().getFullYear();
    const hDays = new Date(hYear, hMonth + 1, 0).getDate();
    const recTasks = allT.filter((t) => t.recurring && t.recurring.length > 0);
    recTasks.forEach((t) => {
      const hist = t.recurringHistory || {};
      let total = 0, done = 0;
      for (let d = 1; d <= hDays; d++) {
        if ((t.recurring || []).includes(new Date(hYear, hMonth, d).getDay())) {
          total++;
          const ds = `${hYear}-${String(hMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (hist[ds]) done++;
        }
      }
      habitLines.push(`- ${t.emoji || ""}${t.name}: ${done}/${total} (${total > 0 ? Math.round((done / total) * 100) : 0}%) | Días: ${["D", "L", "M", "X", "J", "V", "S"].filter((_, i) => (t.recurring || []).includes(i)).join(",")}`);
    });
    if (recTasks.length === 0) habitLines.push("Sin hábitos configurados");

    // Tasks overview
    const overviewLines = ["\n## Todas las tareas"];
    categories.forEach((c) => {
      overviewLines.push(`\n### ${c.name} (${c.tasks.length} tareas)`);
      c.tasks.forEach((t) => {
        const et = ensureTask(t);
        const flags = [et.completed ? "✓ completada" : "", et.permanent ? "♾️ permanente" : "", et.recurring ? "🔁 recurrente" : ""].filter(Boolean).join(", ");
        const dates = [et.plannedDate ? `📅${et.plannedDate}` : "", et.dueDate ? `⚠️${et.dueDate}` : ""].filter(Boolean).join(" ");
        overviewLines.push(`- ${et.emoji || ""}${et.name} | ${fmtLong(et.totalSeconds)} | ${(et.sessions || []).length} ses. ${flags} ${dates}`.trim());
        (et.subtasks || []).forEach((st) => overviewLines.push(`  ${st.done ? "✓" : "·"} ${st.name}`));
      });
    });

    // Streak
    let streak = 0; const sd = new Date();
    for (let i = 0; i < 365; i++) { const ds = getDateStr(sd); let dt = 0; allT.forEach((t) => (t.sessions || []).forEach((s) => { if (getDateStr(parseSessionDate(s)) === ds) dt += s.duration; })); if (dt > 0) streak++; else if (i > 0) break; sd.setDate(sd.getDate() - 1); }

    const md = [
      `# Informe de productividad — ${periodLabel} (${todayStr})`,
      ``,
      `## Resumen general`,
      `- Tiempo total registrado: ${fmtLong(totalAll)}`,
      `- Sesiones totales: ${totalSessions}`,
      `- Categorías: ${categories.length}`,
      `- Tareas activas: ${allT.filter((t) => !t.completed).length}`,
      `- Tareas completadas: ${allT.filter((t) => t.completed).length}`,
      `- Tareas permanentes: ${allT.filter((t) => t.permanent).length}`,
      `- Hábitos: ${recTasks.length}`,
      `- Racha actual: ${streak} días`,
      periodReport(`Desglose: ${periodLabel}`, periodFilter),
      dailyLines.join("\n"),
      habitLines.join("\n"),
      overviewLines.join("\n"),
      `\n---\nGenerado: ${new Date().toLocaleString("es-ES")} | Periodo: ${periodLabel}`
    ].join("\n");

    const b = new Blob([md], { type: "text/markdown" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = `informe-${reportPeriod}-${todayStr}.md`; a.click();
    URL.revokeObjectURL(u);
  };
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

      {/* Bulk Add */}
      {showBulkAdd && <BulkAddModal categories={categories} onAdd={bulkAdd} onCancel={() => setShowBulkAdd(false)} theme={theme} dk={dk} />}
      {showBulkDelete && <BulkDeleteView categories={categories} onDelete={bulkDelete} onCancel={() => setShowBulkDelete(false)} theme={theme} dk={dk} />}
      {showOverview && <OverviewView categories={categories} onClose={() => setShowOverview(false)} theme={theme} dk={dk} />}

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
              <button onClick={() => writeNfc(timerView, t.name)} style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", padding: "6px 14px", fontSize: 12 }}>{I.nfc} NFC</button>
              {/* Focus panel */}
              {focusPanel.length > 0 && (
                <div style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: 360 }}>
                  {focusPanel.map((fId) => {
                    const ft = getTask(fId);
                    if (!ft?.task) return null;
                    const isCurrent = fId === timerView;
                    const isRunning = fId === activeId;
                    return (
                      <div key={fId} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 20, backgroundColor: isCurrent ? `${ft.cat.color}22` : theme.surface, border: `1.5px solid ${isCurrent ? ft.cat.color : theme.border}`, cursor: "pointer", maxWidth: 160 }}>
                        <div onClick={() => { if (!isCurrent) switchFocus(fId); }} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: ft.cat.color, flexShrink: 0, animation: isRunning ? "pulse 1.5s infinite" : "none" }} />
                          <span style={{ fontSize: 11, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? ft.cat.color : theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ft.task.emoji ? ft.task.emoji + " " : ""}{ft.task.name}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); removeFromFocus(fId); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: "0 2px", fontSize: 10, display: "flex", opacity: 0.5 }}>✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {!focusPanel.includes(timerView) && (
                <button onClick={() => addToFocus(timerView)} style={{ marginTop: focusPanel.length > 0 ? 8 : 14, display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", padding: "6px 14px", fontSize: 12 }}>{I.pin} Fijar al foco</button>
              )}
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

            {/* Dates & Status */}
            <div style={{ marginTop: 20, width: "90%", maxWidth: 320 }}>
              {!t.permanent && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <div style={{ fontSize: 11, color: theme.textSec, marginBottom: 3 }}>📅 Planificado</div>
                  <input type="date" value={t.plannedDate || ""} onChange={(e) => update((p) => p.map((cat2) => ({ ...cat2, tasks: cat2.tasks.map((tk) => tk.id === timerView ? { ...tk, plannedDate: e.target.value || null } : tk) })))} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 13, outline: "none" }} />
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <div style={{ fontSize: 11, color: theme.textSec, marginBottom: 3 }}>⚠️ Límite</div>
                  <input type="date" value={t.dueDate || ""} onChange={(e) => update((p) => p.map((cat2) => ({ ...cat2, tasks: cat2.tasks.map((tk) => tk.id === timerView ? { ...tk, dueDate: e.target.value || null } : tk) })))} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: `1px solid ${t.dueDate && t.dueDate < getDateStr() ? "#ef4444" : theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 13, outline: "none" }} />
                </div>
              </div>}
              {!t.permanent && (<>
              <div style={{ fontSize: 11, color: theme.textSec, marginBottom: 4 }}>Estado</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[{ key: "todo", label: "📋 Por hacer" }, { key: "doing", label: "⚡ Ejecución" }, { key: "validating", label: "🔍 Validación" }, { key: "done", label: "✅ Hecho" }].map((s) => {
                  const current = t.kanbanStatus || (t.completed ? "done" : (t.totalSeconds > 0 ? "doing" : "todo"));
                  return <button key={s.key} onClick={() => { update((p) => p.map((cat2) => ({ ...cat2, tasks: cat2.tasks.map((tk) => { if (tk.id !== timerView) return tk; if (s.key === "done") return { ...tk, kanbanStatus: s.key, completed: true, completedAt: new Date().toISOString() }; return { ...tk, kanbanStatus: s.key, completed: false, completedAt: null }; }) }))); if (s.key === "done") setTimerView(null); }} style={{ padding: "5px 10px", borderRadius: 8, border: current === s.key ? `2px solid ${c.color}` : `1px solid ${theme.border}`, backgroundColor: current === s.key ? `${c.color}15` : "transparent", color: current === s.key ? c.color : theme.textSec, fontSize: 12, cursor: "pointer", fontWeight: current === s.key ? 600 : 400 }}>{s.label}</button>;
                })}
              </div>
              </>)}
              {t.permanent && <div style={{ fontSize: 12, color: "#8b5cf6", textAlign: "center", padding: "6px 0" }}>♾️ Tarea permanente</div>}
            </div>

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
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={(e) => handleSubDragEnd(timerView, e)}>
                <SortableContext items={(t.subtasks || []).map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {(t.subtasks || []).map((st, sti) => (
                  <SortableSub key={st.id} id={st.id}>{(subListeners) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: `1px solid ${theme.border}` }}>
                    <div {...subListeners} style={{ color: theme.textSec, opacity: 0.2, cursor: "grab", display: "flex", flexShrink: 0, touchAction: "none", padding: "4px 2px" }}>{I.grip}</div>
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
                  )}</SortableSub>
                ))}
                </SortableContext>
                </DndContext>
                <SubtaskInput taskId={timerView} onAdd={addSubtask} theme={theme} />
              </div>
            )}

            {/* Sessions */}
            {t.sessions.length > 0 && (
              <div style={{ marginTop: 24, maxWidth: 320, width: "90%" }}>
                <div style={{ fontSize: 12, color: theme.textSec, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Sesiones ({t.sessions.length})</div>
                {(showAllSessions ? t.sessions : t.sessions.slice(-7)).slice().reverse().map((s, i) => {
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

      <div style={{ maxWidth: mainView === "kanban" ? 1200 : 640, margin: "0 auto", padding: "0 16px", transition: "max-width .3s" }}>
        {/* Header */}
        <div style={{ padding: "16px 0 8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tareas</h1>
              <div style={{ fontSize: 13, color: theme.textSec, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>{I.clock}<span>Hoy: {fmtLong(totalToday)}</span></div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <ProfileMenu user={user} onLogin={handleLogin} onLogout={handleLogout} onBackups={loadBackups} onExport={exportData} onImport={importData} fileRef={fileRef} syncing={syncing} theme={theme} dk={dk} />
              <button onClick={() => setShowStats(true)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{I.chart}</button>
              <button onClick={() => setDk(!dk)} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textSec, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{dk ? I.sun : I.moon}</button>
            </div>
          </div>
          {/* Search */}
          <div style={{ marginTop: 10, position: "relative" }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: theme.textSec, display: "flex", opacity: 0.5 }}>{I.search}</div>
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Buscar tareas..." style={{ width: "100%", padding: "9px 14px 9px 36px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text, fontSize: 14, outline: "none" }} />
            {searchQ && <button onClick={() => setSearchQ("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: theme.textSec, cursor: "pointer", display: "flex", padding: 4 }}>{I.x}</button>}
          </div>
          {/* Toolbar */}
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {[
              { onClick: () => { setShowNewCat(true); setShowNewTask(null); }, icon: I.plus, label: "Categoría" },
              { onClick: () => setShowBulkAdd(true), icon: I.paste, label: "Pegar" },
              { onClick: () => { setSelectMode((p) => !p); setSelectedTasks(new Set()); }, icon: I.selectAll, label: "Seleccionar", active: selectMode },
              { onClick: () => setExpanded((p) => p.size > 0 ? new Set() : new Set(categories.map((c) => c.id))), icon: expanded.size > 0 ? I.collapseAll : I.chev, label: expanded.size > 0 ? "Cerrar" : "Abrir" },
              { onClick: () => setShowSubsMain((p) => { const allWithSubs = categories.flatMap((c) => c.tasks.filter((t) => !t.completed && (t.subtasks || []).length > 0).map((t) => t.id)); return p.size > 0 ? new Set() : new Set(allWithSubs); }), icon: I.subtasks, label: "Subs", active: showSubsMain.size > 0 },
              { onClick: () => setModal({ title: "Ordenar todas", options: [ { label: "🔄 Rutina", onSelect: () => sortAllTasks("rutina") }, { label: "🎯 Prioridad", onSelect: () => sortAllTasks("prioridad") }, { label: "🔥 Urgente", onSelect: () => sortAllTasks("urgente") }, { label: "📅 Planificado", onSelect: () => sortAllTasks("planned") }, { label: "⚠️ Límite", onSelect: () => sortAllTasks("due") }, { label: "A → Z", onSelect: () => sortAllTasks("alpha") }, { label: "Más tiempo", onSelect: () => sortAllTasks("time") }, { label: "Más reciente", onSelect: () => sortAllTasks("recent") } ] }), icon: I.sort, label: "Ordenar" },
              { onClick: () => setShowOverview(true), icon: I.list, label: "Vista" },
              { onClick: () => setShowBulkDelete(true), icon: I.trash, label: "Papelera" },
              { onClick: () => setModal({ title: "Generar informe", options: [
                { label: "Hoy", onSelect: () => generateReport("today") },
                { label: "Ayer", onSelect: () => generateReport("yesterday") },
                { label: "Semana pasada", onSelect: () => generateReport("lastweek") },
                { label: "Mes pasado", onSelect: () => generateReport("lastmonth") },
                { label: "Todo", onSelect: () => generateReport("all") },
              ] }), icon: I.dl, label: "Informe" },
            ].map((b, i) => (
              <button key={i} onClick={b.onClick} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "8px 2px", borderRadius: 10, border: `1px solid ${b.active ? "#ef4444" : theme.border}`, background: b.active ? "#ef444410" : "none", color: b.active ? "#ef4444" : theme.textSec, fontSize: 9, cursor: "pointer", lineHeight: 1, textAlign: "center" }}>
                {b.icon}
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>{b.label}</span>
              </button>
            ))}
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

        {/* Focus panel on main screen */}
        {focusPanel.length > 1 && (
          <div style={{ margin: "10px 0 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {focusPanel.map((fId) => {
              const ft = getTask(fId);
              if (!ft?.task) return null;
              const isRunning = fId === activeId;
              return (
                <div key={fId} onClick={() => { switchFocus(fId); setTimerView(fId); }} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 16, backgroundColor: isRunning ? `${ft.cat.color}22` : theme.surface, border: `1px solid ${isRunning ? ft.cat.color : theme.border}`, cursor: "pointer" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: ft.cat.color, flexShrink: 0, animation: isRunning ? "pulse 1.5s infinite" : "none" }} />
                  <span style={{ fontSize: 11, fontWeight: isRunning ? 600 : 400, color: isRunning ? ft.cat.color : theme.text, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ft.task.emoji ? ft.task.emoji + " " : ""}{ft.task.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeFromFocus(fId); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: "0 2px", fontSize: 9, display: "flex", opacity: 0.4 }}>✕</button>
                </div>
              );
            })}
          </div>
        )}

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
        {/* View tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${theme.border}` }}>
          {[{ key: "tasks", label: "Tareas" }, { key: "kanban", label: "Kanban" }, { key: "habits", label: "Hábitos" }, { key: "calendar", label: "📅" }].map((v) => (
            <button key={v.key} onClick={() => setMainView(v.key)} style={{ flex: 1, padding: "12px 0", background: "none", border: "none", borderBottom: mainView === v.key ? `2px solid ${theme.accent}` : "2px solid transparent", color: mainView === v.key ? theme.text : theme.textSec, fontSize: 14, fontWeight: mainView === v.key ? 600 : 400, cursor: "pointer" }}>{v.label}</button>
          ))}
        </div>

        {mainView === "kanban" && <KanbanView categories={categories} onUpdate={update} onTimerView={(id) => setTimerView(id)} activeId={activeId} elapsed={elapsed} theme={theme} dk={dk} focusPanel={focusPanel} addToFocus={addToFocus} removeFromFocus={removeFromFocus} onStopTimer={(id) => { if (activeId === id) { clearInterval(intRef.current); finishStop(id, null); } }} />}
        {mainView === "habits" && <HabitsView categories={categories} onUpdate={update} theme={theme} dk={dk} colOrder={habitsOrder} onColOrderChange={saveHabitsOrder} />}
        {mainView === "calendar" && <CalendarView categories={categories} onTimerView={(id) => setTimerView(id)} theme={theme} dk={dk} />}
        {mainView === "tasks" && <div style={{ paddingTop: 4, paddingBottom: 100 }}>
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
                    {selectMode ? (() => {
                      const catIds = aTasks.map((t) => t.id);
                      const allSel = catIds.length > 0 && catIds.every((id) => selectedTasks.has(id));
                      return <button onClick={() => setSelectedTasks((p) => { const n = new Set(p); if (allSel) { catIds.forEach((id) => n.delete(id)); } else { catIds.forEach((id) => n.add(id)); } return n; })} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", gap: 6, color: allSel ? "#ef4444" : theme.textSec, fontSize: 13 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 5, border: allSel ? "none" : `2px solid ${theme.border}`, backgroundColor: allSel ? "#ef4444" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{allSel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}</div>
                        Todas
                      </button>;
                    })() : (<>
                    <button onClick={() => setModal({ title: `Ordenar "${cat.name}"`, options: [ { label: "A → Z", onSelect: () => sortTasks(cat.id, "alpha") }, { label: "Z → A", onSelect: () => sortTasks(cat.id, "alpha-desc") }, { label: "📅 Planificado", onSelect: () => sortTasks(cat.id, "planned") }, { label: "⚠️ Límite", onSelect: () => sortTasks(cat.id, "due") }, { label: "Más tiempo", onSelect: () => sortTasks(cat.id, "time") }, { label: "Menos tiempo", onSelect: () => sortTasks(cat.id, "time-asc") }, { label: "Más sesiones", onSelect: () => sortTasks(cat.id, "sessions") }, { label: "Más reciente", onSelect: () => sortTasks(cat.id, "recent") } ] })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.5 }}>{I.sort}</button>
                    <button onClick={() => moveCat(cat.id, -1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: catIdx === 0 ? 0.15 : 0.5 }}>{I.up}</button>
                    <button onClick={() => moveCat(cat.id, 1)} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: catIdx === categories.length - 1 ? 0.15 : 0.5 }}>{I.down}</button>
                    <button onClick={() => setEditModal({ title: "Editar categoría", value: cat.name, color: cat.color, onColorChange: true, onSave: (n, c) => editCatSave(cat.id, n, c) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.5 }}>{I.edit}</button>
                    <button onClick={() => setModal({ title: "¿Eliminar categoría?", message: `"${cat.name}" y todas sus tareas.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delCat(cat.id) })} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.trash}</button>
                    </>)}
                    <div onClick={() => toggle(cat.id)} style={{ transform: isExpanded ? "rotate(0)" : "rotate(-90deg)", transition: "transform .2s", color: theme.textSec, display: "flex", cursor: "pointer", padding: 4 }}>{I.chev}</div>
                  </div>
                </div>

                {isExpanded && (<div>
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={(e) => handleTaskDragEnd(cat.id, e)}>
                  <SortableContext items={aTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  {aTasks.map((task, ti) => {
                    const t = ensureTask(task);
                    const isActive = activeId === t.id;
                    const tToday = todayTime(t);
                    const goalPct = t.goalDaily > 0 ? Math.min(100, (tToday / t.goalDaily) * 100) : -1;
                    return (
                      <SortableTask key={t.id} id={t.id}>{(listeners) => (
                      <div onClick={() => { if (selectMode) { setSelectedTasks((p) => { const n = new Set(p); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); } else { setTimerView(t.id); } }} style={{ padding: "12px 12px", marginBottom: 5, borderRadius: 12, backgroundColor: selectedTasks.has(t.id) ? "#ef444415" : (isActive ? `${cat.color}12` : theme.card), border: `1px solid ${selectedTasks.has(t.id) ? "#ef444444" : (isActive ? `${cat.color}33` : theme.border)}`, cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, marginRight: 8 }}>
                            {selectMode ? (
                              <div style={{ width: 22, height: 22, borderRadius: 6, border: selectedTasks.has(t.id) ? "none" : `2px solid ${theme.border}`, backgroundColor: selectedTasks.has(t.id) ? "#ef4444" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{selectedTasks.has(t.id) && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}</div>
                            ) : (
                              <div {...listeners} style={{ color: theme.textSec, opacity: 0.25, cursor: "grab", display: "flex", flexShrink: 0, touchAction: "none", padding: "4px 2px" }}>{I.grip}</div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                              <div style={{ fontSize: 13, color: theme.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                                {I.clock} <span>{fmtLong(t.totalSeconds + (isActive ? elapsed : 0))}</span>
                                {t.sessions.length > 0 && <span>· {t.sessions.length} ses.</span>}
                                {t.goalDaily > 0 && <span style={{ color: goalPct >= 100 ? "#10b981" : "#6366f1" }}>· {goalPct >= 100 ? "✓" : `${Math.round(goalPct)}%`}</span>}
                                {(t.subtasks || []).length > 0 && <span>· {(t.subtasks || []).filter((s) => s.done).length}/{(t.subtasks || []).length} sub</span>}
                                {t.plannedDate && <span style={{ color: dateColor(t.plannedDate, t.completed) || theme.textSec }}>· 📅 {t.plannedDate.slice(8)}-{t.plannedDate.slice(5,7)}</span>}
                                {t.dueDate && <span style={{ color: dateColor(t.dueDate, t.completed) || theme.textSec }}>· ⚠️ {t.dueDate.slice(8)}-{t.dueDate.slice(5,7)}</span>}
                                {t.recurring && <span style={{ color: "#8b5cf6" }}>· 🔁</span>}
                              </div>
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
                            {showSubsMain.has(t.id) && (
                              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={(e) => handleSubDragEnd(t.id, e)}>
                              <SortableContext items={(t.subtasks || []).map((s) => s.id)} strategy={verticalListSortingStrategy}>
                              {(t.subtasks || []).map((st) => (
                                <SortableSub key={st.id} id={st.id}>{(subListeners) => (
                                  <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0" }}>
                                    <div {...subListeners} style={{ color: theme.textSec, opacity: 0.2, cursor: "grab", display: "flex", flexShrink: 0, touchAction: "none", padding: "4px 2px" }}>{I.grip}</div>
                                    <button onClick={() => toggleSubtask(t.id, st.id)} style={{ width: 18, height: 18, borderRadius: 5, border: st.done ? "none" : `1.5px solid ${theme.border}`, backgroundColor: st.done ? "#10b981" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>{st.done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>}</button>
                                    <span style={{ fontSize: 13, textDecoration: st.done ? "line-through" : "none", color: st.done ? theme.textSec : theme.text }}>{st.name}</span>
                                  </div>
                                )}</SortableSub>
                              ))}
                              </SortableContext>
                              </DndContext>
                            )}
                          </div>
                        )}
                        {!selectMode && <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 6, justifyContent: "flex-end" }}>
                          <button onClick={(e) => { e.stopPropagation(); moveTask(cat.id, t.id, -1); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: ti === 0 ? 0.15 : 0.4 }}>{I.up}</button>
                          <button onClick={(e) => { e.stopPropagation(); moveTask(cat.id, t.id, 1); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: ti === aTasks.length - 1 ? 0.15 : 0.4 }}>{I.down}</button>
                          <button onClick={(e) => { e.stopPropagation(); setEditModal({ title: "Editar tarea", value: t.name, goalDaily: t.goalDaily, onGoalChange: true, onDatesChange: true, dueDate: t.dueDate, plannedDate: t.plannedDate, recurring: t.recurring, emoji: t.emoji, permanent: t.permanent, onSave: (n, _c, g, dd, pd, rec, emo, perm) => editTaskSave(t.id, n, _c, g, dd, pd, rec, emo, perm) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.edit}</button>
                          <button onClick={(e) => { e.stopPropagation(); const others = categories.filter((x) => x.id !== cat.id); if (others.length === 0) return; setModal({ title: "Mover tarea", message: `"${t.name}" a:`, options: others.map((o) => ({ label: o.name, color: o.color, onSelect: () => moveTaskToCat(t.id, o.id) })) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.move}</button>
                          <button onClick={(e) => { e.stopPropagation(); writeNfc(t.id, t.name); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.nfc}</button>
                          <button onClick={(e) => { e.stopPropagation(); focusPanel.includes(t.id) ? removeFromFocus(t.id) : addToFocus(t.id); }} style={{ background: "none", border: "none", color: focusPanel.includes(t.id) ? "#6366f1" : theme.textSec, cursor: "pointer", padding: 4, opacity: focusPanel.includes(t.id) ? 1 : 0.4 }}>{I.pin}</button>
                          <button onClick={(e) => { e.stopPropagation(); setModal({ title: "¿Completar?", message: `"${t.name}" → completadas.`, confirmLabel: "Completar", confirmColor: "#10b981", onConfirm: () => completeTask(t.id) }); }} style={{ background: "none", border: "none", color: "#10b981", cursor: "pointer", padding: 4, opacity: 0.5 }}>{I.check}</button>
                          <button onClick={(e) => { e.stopPropagation(); setModal({ title: "¿Resetear?", message: `Borrar tiempo de "${t.name}".`, confirmLabel: "Resetear", confirmColor: "#f59e0b", onConfirm: () => resetTask(t.id) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.reset}</button>
                          <button onClick={(e) => { e.stopPropagation(); setModal({ title: "¿Eliminar?", message: `"${t.name}" permanentemente.`, confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => delTask(t.id) }); }} style={{ background: "none", border: "none", color: theme.textSec, cursor: "pointer", padding: 4, opacity: 0.4 }}>{I.trash}</button>
                        </div>}
                      </div>
                      )}</SortableTask>
                    );
                  })}
                  </SortableContext>
                  </DndContext>
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
        </div>}
      </div>

      {/* Select mode floating bar */}
      {selectMode && selectedTasks.size > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px", backgroundColor: theme.card, borderTop: `1px solid ${theme.border}`, zIndex: 50, display: "flex", gap: 10, justifyContent: "center", alignItems: "center", animation: "fadeIn .2s" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{selectedTasks.size} seleccionada{selectedTasks.size !== 1 ? "s" : ""}</span>
          <button onClick={() => { setModal({ title: `¿Eliminar ${selectedTasks.size} tarea${selectedTasks.size !== 1 ? "s" : ""}?`, message: "Esta acción es permanente.", confirmLabel: "Eliminar", confirmColor: "#ef4444", onConfirm: () => { bulkDelete([...selectedTasks]); setSelectMode(false); } }); }} style={{ padding: "10px 20px", borderRadius: 10, border: "none", backgroundColor: "#ef4444", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Eliminar</button>
          <button onClick={() => { const ids = [...selectedTasks]; ids.forEach((id) => completeTask(id)); setSelectedTasks(new Set()); setSelectMode(false); }} style={{ padding: "10px 20px", borderRadius: 10, border: "none", backgroundColor: "#10b981", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Completar</button>
          <button onClick={() => { setSelectedTasks(new Set()); setSelectMode(false); }} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.textSec, fontSize: 14, cursor: "pointer" }}>Cancelar</button>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        * { box-sizing:border-box; -webkit-tap-highlight-color:transparent }
        html,body { overscroll-behavior-y:none }
        input::placeholder { color:${theme.textSec}88 }
        input { font-size:16px !important }
        button { cursor:pointer }
        button:active { transform:scale(.97) }
        @media (min-width: 900px) {
          .kanban-cols { display:flex; gap:12px; align-items:flex-start }
          .kanban-col { flex:1; min-width:0 }
        }
        @media (min-width: 600px) and (max-width: 899px) {
          .kanban-cols { display:flex; gap:10px; overflow-x:auto; -webkit-overflow-scrolling:touch; padding-bottom:8px }
          .kanban-col { flex:0 0 220px; min-width:220px }
        }
      `}</style>
    </div>
  );
}
