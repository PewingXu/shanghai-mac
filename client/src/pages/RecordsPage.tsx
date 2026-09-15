/**
 * RecordsPage — 体验记录（取代原“用户管理 + 用户测量记录”两级页面）。
 * 体验为主、不登记人名：每条记录只有测量时间 + 是否编辑过方案，点开即回看那次的完整报告。
 */
import { useEffect, useMemo, useState } from "react";
import { useApp, ANON_USER_NAME, type CollectionRecord, type MeasureAnalysis } from "@/contexts/AppContext";
import { apiGetRecordData, apiGetRecordSolution } from "@/lib/backendApi";
import { isSolutionSnapshot, type SolutionSnapshot } from "@/lib/solutionSnapshot";
import ConfirmModal from "@/components/ConfirmModal";
import BrandLogo from "@/components/BrandLogo";

const PAGE_SIZE = 10;

interface RecordsPageProps {
  onBack: () => void;
  /** 点击某条记录：读回该次分析 → 报告页重新渲染那次的完整交互报告 */
  onOpenReport: () => void;
}

/** "2026-09-10" → { y:"2026", md:"09.10" } ；异常格式原样返回 */
function splitDate(date: string): { y: string; md: string } {
  const m = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return { y: "", md: date };
  return { y: m[1], md: `${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}` };
}

/** "14:30:35" → "14:30" */
function shortTime(time: string): string {
  return time.length >= 5 ? time.slice(0, 5) : time;
}

export default function RecordsPage({ onBack, onOpenReport }: RecordsPageProps) {
  const {
    collectionRecords,
    loadAllRecords,
    removeCollectionRecord,
    setSelectedRecord,
    setAnalysis,
    setSelectedSolution,
    setCurrentUser,
  } = useApp();

  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<"all" | "edited">("all");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadAllRecords().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (filter === "edited" ? collectionRecords.filter((r) => r.solutionUpdatedAt) : collectionRecords),
    [collectionRecords, filter],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const editedCount = useMemo(() => collectionRecords.filter((r) => r.solutionUpdatedAt).length, [collectionRecords]);

  const openRecord = async (record: CollectionRecord) => {
    if (loadingId != null) return;
    setLoadingId(record.id);
    try {
      // 分析结果 + 方案快照一并取回：快照必须在跳转之前就位，解决方案页挂载时直接 seed
      const [data, snap] = await Promise.all([
        apiGetRecordData<MeasureAnalysis>(record.id),
        apiGetRecordSolution<SolutionSnapshot>(record.id).catch(() => null),
      ]);
      setCurrentUser({ id: record.userId, name: ANON_USER_NAME });
      setSelectedRecord(record);
      setAnalysis(data);
      setSelectedSolution(isSolutionSnapshot(snap) ? snap : null);
      onOpenReport();
    } catch (err) {
      console.warn("[record] 读取采集记录失败:", err);
      window.alert("读取该条记录失败，请确认后端服务在运行");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="rec-shell">
      <header className="rec-topbar">
        <BrandLogo size={44} />
        <button type="button" className="rec-back" onClick={onBack}>
          返回
        </button>
      </header>

      <main className="rec-main">
        <div className="rec-head">
          <div>
            <h1 className="rec-title">体验记录</h1>
            <p className="rec-sub">
              共 <b>{collectionRecords.length}</b> 次测量，其中 <b>{editedCount}</b> 次已定制方案
            </p>
          </div>
          <div className="rec-filter" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={filter === "all" ? "on" : ""}
              onClick={() => {
                setFilter("all");
                setPage(0);
              }}
            >
              全部
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "edited"}
              className={filter === "edited" ? "on" : ""}
              onClick={() => {
                setFilter("edited");
                setPage(0);
              }}
            >
              已定制方案
            </button>
          </div>
        </div>

        <div className="rec-list">
          <div className="rec-row rec-row-head" aria-hidden="true">
            <span>#</span>
            <span>测量时间</span>
            <span>方案</span>
            <span>方案更新时间</span>
            <span />
          </div>

          {pageRows.length === 0 && (
            <div className="rec-empty">
              {!loaded ? "读取中…" : filter === "edited" ? "还没有定制过方案的记录" : "暂无体验记录，回到首页开始一次测量"}
            </div>
          )}

          {pageRows.map((r, i) => {
            const d = splitDate(r.date);
            const edited = Boolean(r.solutionUpdatedAt);
            return (
              <div
                key={r.id}
                className={`rec-row${loadingId === r.id ? " loading" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => void openRecord(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openRecord(r);
                }}
              >
                <span className="rec-idx">{String(safePage * PAGE_SIZE + i + 1).padStart(2, "0")}</span>
                <span className="rec-when">
                  <b>{d.md}</b>
                  <em>{shortTime(r.time)}</em>
                  <small>{d.y}</small>
                </span>
                <span>
                  <i className={`rec-chip${edited ? " edited" : ""}`}>{edited ? "已定制" : "未定制"}</i>
                </span>
                <span className="rec-upd">{r.solutionUpdatedAt ?? "—"}</span>
                <span className="rec-actions">
                  <span className="rec-open">{loadingId === r.id ? "读取中…" : "查看报告"}</span>
                  <button
                    type="button"
                    className="rec-del"
                    title="删除记录"
                    aria-label="删除记录"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmId(r.id);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2 3.5h10M5.5 3.5V2h3v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <nav className="rec-pager" aria-label="分页">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              ‹
            </button>
            <span>
              <b>{safePage + 1}</b> / {totalPages}
            </span>
            <button type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
              ›
            </button>
          </nav>
        )}
      </main>

      {confirmId != null && (
        <ConfirmModal
          title="删除记录"
          message="确认删除此项测量记录？"
          confirmText="确认删除"
          onConfirm={() => {
            removeCollectionRecord(confirmId);
            setConfirmId(null);
          }}
          onCancel={() => setConfirmId(null)}
        />
      )}

      <style>{recordsStyles}</style>
    </div>
  );
}

const recordsStyles = `
  .rec-shell {
    --brand: #00359b;
    --pad-x: clamp(28px, 4.2vw, 78px);
    min-height: 100vh;
    background: linear-gradient(180deg, #EEF4FF 0%, #FFFFFF 42%);
    font-family: "Inter", "HarmonyOS Sans SC", "MiSans", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    color: #1f2a44;
  }

  .rec-topbar {
    height: clamp(72px, 9vh, 96px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--pad-x);
  }

  .rec-back {
    border: 1px solid var(--brand);
    background: #fff;
    color: var(--brand);
    border-radius: 999px;
    padding: 8px 20px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 160ms ease, transform 160ms ease;
  }
  .rec-back:hover { background: #eaf1ff; }
  .rec-back:active { transform: scale(0.97); }

  .rec-main {
    max-width: 1180px;
    margin: 0 auto;
    padding: clamp(8px, 2vh, 24px) var(--pad-x) 80px;
  }

  .rec-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: clamp(18px, 3vh, 30px);
  }

  .rec-title {
    margin: 0;
    font-size: clamp(26px, 2.2vw, 34px);
    font-weight: 700;
    letter-spacing: 0.16em;
    color: #17191c;
  }

  .rec-sub {
    margin: 8px 0 0;
    font-size: 13px;
    color: #7c89a6;
    letter-spacing: 0.04em;
  }
  .rec-sub b {
    color: var(--brand);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .rec-filter {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: rgba(0, 53, 155, 0.08);
  }
  .rec-filter button {
    border: 0;
    background: transparent;
    color: #4a5a7e;
    border-radius: 999px;
    padding: 7px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .rec-filter button.on {
    background: #fff;
    color: var(--brand);
    box-shadow: 0 2px 8px rgba(0, 53, 155, 0.14);
  }

  .rec-list {
    display: grid;
    gap: 6px;
  }

  .rec-row {
    display: grid;
    grid-template-columns: 56px minmax(180px, 1.2fr) 120px minmax(160px, 1fr) 190px;
    align-items: center;
    gap: 16px;
    min-height: 64px;
    padding: 0 22px;
    border-radius: 14px;
    background: #fff;
    box-shadow: 0 1px 0 rgba(0, 53, 155, 0.06), 0 6px 20px rgba(0, 53, 155, 0.05);
    cursor: pointer;
    outline: none;
    transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 160ms ease;
  }
  .rec-row:hover,
  .rec-row:focus-visible {
    transform: translateY(-2px);
    box-shadow: 0 1px 0 rgba(0, 53, 155, 0.08), 0 14px 32px rgba(0, 53, 155, 0.12);
  }
  .rec-row.loading { opacity: 0.6; cursor: wait; }

  .rec-row-head {
    min-height: 0;
    padding: 4px 22px 8px;
    background: transparent;
    box-shadow: none;
    cursor: default;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2em;
    color: #8d98b3;
  }
  .rec-row-head:hover { transform: none; box-shadow: none; }

  .rec-idx {
    font-size: 13px;
    font-weight: 600;
    color: #aab3c9;
    font-variant-numeric: tabular-nums;
  }

  .rec-when {
    display: flex;
    align-items: baseline;
    gap: 10px;
    white-space: nowrap;
  }
  .rec-when b {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #17191c;
    font-variant-numeric: tabular-nums;
  }
  .rec-when em {
    font-style: normal;
    font-size: 16px;
    font-weight: 600;
    color: var(--brand);
    font-variant-numeric: tabular-nums;
  }
  .rec-when small {
    font-size: 11px;
    color: #aab3c9;
    letter-spacing: 0.08em;
  }

  .rec-chip {
    display: inline-block;
    font-style: normal;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
    background: #f1f3f8;
    color: #8d98b3;
    letter-spacing: 0.06em;
  }
  .rec-chip.edited {
    background: rgba(0, 53, 155, 0.1);
    color: var(--brand);
  }

  .rec-upd {
    font-size: 13px;
    color: #5a6a8c;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .rec-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
  }
  .rec-open {
    font-size: 13px;
    font-weight: 700;
    color: var(--brand);
    white-space: nowrap;
  }
  .rec-open::after {
    content: " ›";
  }
  .rec-del {
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #aab3c9;
    display: grid;
    place-items: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity 140ms ease, background 140ms ease, color 140ms ease;
  }
  .rec-row:hover .rec-del,
  .rec-row:focus-within .rec-del { opacity: 1; }
  .rec-del:hover { background: #fdeceb; color: #d64545; }

  .rec-empty {
    padding: 80px 0;
    text-align: center;
    font-size: 14px;
    color: #8d98b3;
  }

  .rec-pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    margin-top: 26px;
    font-size: 14px;
    color: #7c89a6;
    font-variant-numeric: tabular-nums;
  }
  .rec-pager b { color: var(--brand); font-weight: 700; }
  .rec-pager button {
    width: 36px;
    height: 36px;
    border: 1px solid rgba(0, 53, 155, 0.2);
    border-radius: 999px;
    background: #fff;
    color: var(--brand);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    transition: background 140ms ease;
  }
  .rec-pager button:hover:not(:disabled) { background: #eaf1ff; }
  .rec-pager button:disabled { opacity: 0.35; cursor: not-allowed; }

  @media (max-width: 900px) {
    .rec-row { grid-template-columns: 40px minmax(150px, 1fr) 100px 150px; }
    .rec-row > :nth-child(4) { display: none; }
  }
`;
