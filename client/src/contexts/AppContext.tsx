import React, { createContext, useContext, useState } from "react";

export interface User {
  id: number;
  name: string;
  birthDate?: string;
  gender?: string;
  height?: number;
  weight?: number;
}

export interface CollectionRecord {
  id: number;
  userId: number;
  date: string;   // "2026-5-1"
  time: string;   // "14:30:35"
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
  addHistoryUser: (user: User) => void;
  removeHistoryUsers: (ids: number[]) => void;
  collectionRecords: CollectionRecord[];
  removeCollectionRecord: (id: number) => void;
  selectedRecord: CollectionRecord | null;
  setSelectedRecord: (r: CollectionRecord | null) => void;
}

const AppContext = createContext<AppContextType>({
  currentUser: null,
  setCurrentUser: () => {},
  currentStep: 1,
  setCurrentStep: () => {},
  currentView: "home",
  setCurrentView: () => {},
  historyUsers: [],
  addHistoryUser: () => {},
  removeHistoryUsers: () => {},
  collectionRecords: [],
  removeCollectionRecord: () => {},
  selectedRecord: null,
  setSelectedRecord: () => {},
});

const DEMO_USERS: User[] = [
  { id: 1001, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1002, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1003, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1004, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1005, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1006, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1007, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1008, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1009, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1010, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1011, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1012, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1013, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1014, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
  { id: 1015, name: "果果", gender: "女", height: 158, weight: 50, birthDate: "1998-02-17" },
];

// 演示采集记录（对应 userId=1001 的果果）
const DEMO_RECORDS: CollectionRecord[] = [
  { id: 1, userId: 1001, date: "2026-5-1",  time: "14:30:35" },
  { id: 2, userId: 1001, date: "2026-4-3",  time: "14:30:35" },
  { id: 3, userId: 1001, date: "2026-4-1",  time: "14:30:35" },
  { id: 4, userId: 1001, date: "2026-3-12", time: "14:30:35" },
  { id: 5, userId: 1001, date: "2026-3-9",  time: "14:30:35" },
  { id: 6, userId: 1001, date: "2026-2-5",  time: "14:30:35" },
];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [currentView, setCurrentView] = useState<AppView>("home");
  const [historyUsers, setHistoryUsers] = useState<User[]>(DEMO_USERS);
  const [collectionRecords, setCollectionRecords] = useState<CollectionRecord[]>(DEMO_RECORDS);
  const [selectedRecord, setSelectedRecord] = useState<CollectionRecord | null>(null);

  const addHistoryUser = (user: User) => {
    setHistoryUsers((prev) => {
      const exists = prev.find((u) => u.id === user.id);
      if (exists) return prev;
      return [user, ...prev];
    });
  };

  const removeHistoryUsers = (ids: number[]) => {
    const idSet = new Set(ids);
    setHistoryUsers((prev) => prev.filter((u) => !idSet.has(u.id)));
  };

  const removeCollectionRecord = (id: number) => {
    setCollectionRecords((prev) => prev.filter((r) => r.id !== id));
  };

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
        addHistoryUser,
        removeHistoryUsers,
        collectionRecords,
        removeCollectionRecord,
        selectedRecord,
        setSelectedRecord,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
