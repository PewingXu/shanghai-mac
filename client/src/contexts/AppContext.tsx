import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import type { PythonAnalysisResult } from "@/lib/pythonApi";
import {
  apiListUsers,
  apiCreateUser,
  apiUpdateUser,
  apiDeleteUsers,
  apiListRecords,
  apiCreateRecord,
  apiDeleteRecord,
} from "@/lib/backendApi";
import type { SolutionSnapshot } from "@/lib/solutionSnapshot";

/** 一次测量的分析结果：Python 指标 + 前端补充（MLI、左右分压/分面积） */
export interface MeasureAnalysis {
  python: PythonAnalysisResult | null;
  mli: { left: number | null; right: number | null };
  /** 平均帧统计（前端算）：左右 ADC 总和与接触面积 cm² */
  frontend: { leftPressure: number; rightPressure: number; leftArea: number; rightArea: number } | null;
  /** 本次采集的原始帧（仅内存传递，用于原始 CSV 落盘存档；不进分析 JSON） */
  rawFrames?: number[][];
}

/** 入库前瘦身：剥掉 base64 图（报告页不用，自己从 peak_frame_data 现算）与原始帧（另存 CSV） */
function slimAnalysisForStorage(a: MeasureAnalysis): Omit<MeasureAnalysis, "rawFrames"> {
  const python = a.python
    ? ({ success: a.python.success, data: a.python.data } as PythonAnalysisResult) // 丢弃 images
    : null;
  return { python, mli: a.mli, frontend: a.frontend };
}

export interface User {
  id: number;
  name: string;
  birthDate?: string;
  gender?: string;
  height?: number;
  weight?: number;
  /** 鞋码（如 "41码"；用户卡展示 + 编辑弹窗录入，后端 shoe_size 字段） */
  shoeSize?: string;
  /** 手机号（展示脱敏为前四****尾四；搜索支持尾号四位） */
  phone?: string;
  /** 联系邮箱 */
  email?: string;
}

export interface CollectionRecord {
  id: number;
  userId: number;
  date: string;   // "2026-5-1"
  time: string;   // "14:30:35"
  /** 最后一次保存解决方案的时间（"2026-08-19 15:07"）；从未编辑过为 undefined */
  solutionUpdatedAt?: string;
}

// 当前视图：home | history | userRecords | measure | report | solution
export type AppView = "home" | "history" | "userRecords" | "measure" | "report" | "solution";

interface AppContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  historyUsers: User[];
  /** 新建用户（走后端持久化，服务端保证 id 唯一；后端不可用时本地兜底），返回创建的用户 */
  createUser: (data: Omit<User, "id"> & { id?: number }) => Promise<User>;
  /** 编辑用户基础信息（走后端持久化；后端不可用时本地兜底），返回更新后的用户 */
  updateUser: (data: User) => Promise<User>;
  removeHistoryUsers: (ids: number[]) => void;
  collectionRecords: CollectionRecord[];
  /** 从后端拉取某用户的全部采集记录（进入采集信息页时调用） */
  loadRecordsForUser: (userId: number) => Promise<void>;
  removeCollectionRecord: (id: number) => void;
  selectedRecord: CollectionRecord | null;
  setSelectedRecord: (r: CollectionRecord | null) => void;
  analysis: MeasureAnalysis | null;
  setAnalysis: (a: MeasureAnalysis | null) => void;
  /**
   * 历史回看时读回的解决方案快照（点「查看」时在跳转前就位，解决方案页挂载即可用）。
   * null = 走系统默认值（新测量 / 该记录从未编辑过方案）。
   */
  selectedSolution: SolutionSnapshot | null;
  setSelectedSolution: (s: SolutionSnapshot | null) => void;
}

const AppContext = createContext<AppContextType>({
  currentUser: null,
  setCurrentUser: () => {},
  currentStep: 1,
  setCurrentStep: () => {},
  currentView: "home",
  setCurrentView: () => {},
  historyUsers: [],
  createUser: async () => ({ id: 0, name: "" }),
  updateUser: async (u) => u,
  removeHistoryUsers: () => {},
  collectionRecords: [],
  loadRecordsForUser: async () => {},
  removeCollectionRecord: () => {},
  selectedRecord: null,
  setSelectedRecord: () => {},
  analysis: null,
  setAnalysis: () => {},
  selectedSolution: null,
  setSelectedSolution: () => {},
});

// 用户种子：已清空（原来 15 条重复"果果"是硬编码演示数据，非数据库；现按需求清空）。
// 名字可重复，id 为唯一标识（新建用户在 Home.handleCreateUser 里生成不撞号的 5 位 id）。
const DEMO_USERS: User[] = [];

// 采集记录种子：清空（原演示记录挂在已删除的果果 userId 上）
const DEMO_RECORDS: CollectionRecord[] = [];

// 当前用户随会话持久化：刷新页面 / URL 直达（?view=userRecords 等）不丢选中用户
const CURRENT_USER_KEY = "aciki-current-user";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<User | null>(() => {
    try {
      const raw = window.sessionStorage.getItem(CURRENT_USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });
  const setCurrentUser: React.Dispatch<React.SetStateAction<User | null>> = (action) => {
    setCurrentUserState((prev) => {
      const next = typeof action === "function" ? (action as (p: User | null) => User | null)(prev) : action;
      try {
        if (next) window.sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(next));
        else window.sessionStorage.removeItem(CURRENT_USER_KEY);
      } catch {
        /* sessionStorage 不可用则仅内存态 */
      }
      return next;
    });
  };
  const [currentStep, setCurrentStep] = useState(1);
  const [currentView, setCurrentView] = useState<AppView>("home");
  const [historyUsers, setHistoryUsers] = useState<User[]>(DEMO_USERS);
  const [collectionRecords, setCollectionRecords] = useState<CollectionRecord[]>(DEMO_RECORDS);
  const [selectedRecord, setSelectedRecord] = useState<CollectionRecord | null>(null);
  const [analysis, setAnalysis] = useState<MeasureAnalysis | null>(null);
  const [selectedSolution, setSelectedSolution] = useState<SolutionSnapshot | null>(null);

  // 开机从后端拉取用户列表（后端不可用则保持空，不报错）。
  // 同时校验会话恢复的 currentUser：已被删除（清库/删用户）的幽灵用户直接清掉。
  useEffect(() => {
    let alive = true;
    apiListUsers()
      .then((us) => {
        if (!alive) return;
        setHistoryUsers(us as User[]);
        setCurrentUser((prev) => (prev && !us.some((u) => u.id === prev.id) ? null : prev));
      })
      .catch(() => {
        /* 后端未就绪：保持本地内存 */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createUser = async (data: Omit<User, "id"> & { id?: number }): Promise<User> => {
    try {
      const u = (await apiCreateUser(data as never)) as User;
      setHistoryUsers((prev) => [u, ...prev.filter((p) => p.id !== u.id)]);
      return u;
    } catch {
      // 后端不可用：本地自增 id 兜底（与服务端同规则 max+1；刷新会丢，仅保证流程可用）
      const id = data.id ?? historyUsers.reduce((m, u) => Math.max(m, u.id), 0) + 1;
      const u: User = { ...data, id };
      setHistoryUsers((prev) => [u, ...prev]);
      return u;
    }
  };

  const updateUser = async (data: User): Promise<User> => {
    let updated = data;
    try {
      updated = (await apiUpdateUser(data as never)) as User;
    } catch {
      /* 后端不可用：本地更新兜底（刷新会丢） */
    }
    setHistoryUsers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setCurrentUser((prev) => (prev?.id === updated.id ? updated : prev));
    return updated;
  };

  const removeHistoryUsers = (ids: number[]) => {
    const idSet = new Set(ids);
    setHistoryUsers((prev) => prev.filter((u) => !idSet.has(u.id)));
    // 删除的用户若是当前选中用户：一并清除（避免测量页/采集信息页残留幽灵用户）
    setCurrentUser((prev) => (prev && idSet.has(prev.id) ? null : prev));
    apiDeleteUsers(ids).catch(() => {
      /* 后端不可用：本地已移除，忽略同步失败 */
    });
  };

  const loadRecordsForUser = async (userId: number) => {
    try {
      const recs = await apiListRecords(userId);
      setCollectionRecords(recs);
    } catch {
      setCollectionRecords([]); // 后端不可用：显示为空
    }
  };

  const removeCollectionRecord = (id: number) => {
    setCollectionRecords((prev) => prev.filter((r) => r.id !== id));
    apiDeleteRecord(id).catch(() => {
      /* 后端不可用：本地已移除 */
    });
  };

  // 测量/导入分析完成 → 自动把这次采集存成当前用户的一条记录：
  //   分析结果瘦身后落盘 <id>.json；原始帧落盘 <id>.csv（仿 sit 格式，界面不暴露）
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent<MeasureAnalysis>).detail;
      const user = currentUserRef.current;
      // 只保存真实分析（python.success）；无用户/演示回退不入库
      if (!detail?.python?.success || !user) return;
      const now = new Date();
      const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      // 新测量必须从干净方案开始，否则会带着上一位用户回看时留下的快照
      setSelectedSolution(null);
      apiCreateRecord(user.id, date, time, slimAnalysisForStorage(detail), detail.rawFrames)
        .then((rec) => {
          setCollectionRecords((prev) => [rec, ...prev.filter((r) => r.id !== rec.id)]);
          // 选中它：解决方案页保存参数时要有 record id 可挂
          setSelectedRecord(rec);
        })
        .catch((err) => console.warn("[record] 采集记录入库失败（后端不可用？）:", err));
    };
    window.addEventListener("aciki-analysis-done", h);
    return () => window.removeEventListener("aciki-analysis-done", h);
  }, []);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        currentStep,
        setCurrentStep,
        currentView,
        setCurrentView,
        historyUsers,
        createUser,
        updateUser,
        removeHistoryUsers,
        collectionRecords,
        loadRecordsForUser,
        removeCollectionRecord,
        selectedRecord,
        setSelectedRecord,
        analysis,
        setAnalysis,
        selectedSolution,
        setSelectedSolution,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
