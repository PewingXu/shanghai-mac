/**
 * ShellPickerDrawer — 鞋壳选择抽屉（解决方案页「选择鞋壳形态」）
 *
 * 贴在屏幕底部的一条横向卡片带，每款鞋壳一张灰模形态图 —— 按形状挑，不是按文件名挑
 * （鞋壳文件名根本看不出是哪一款）。**不铺全屏遮罩**：上方主 3D 要一直看得见、还能转，
 * 点一款即换、抽屉不关，可以连着点几款直接比装配效果。
 *
 * 形态图由后端渲（stl_thumb.py → GET /shells/{id}/thumb，几十 KB 的 PNG）。
 * 前端不为了画图去下载 50~84MB 的 STL —— 那样打开抽屉必卡死几秒。
 *
 * 上传件存在后端 data/shells/，刷新/重启后依然在列，所以每一项都用后端主键当
 * ShellSource.id（见 shoeShell.dbShellSource），几何缓存与方案快照都靠它认人。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiDeleteShell, apiListShells, shellFileUrl, shellThumbUrl, type ApiShell } from "@/lib/backendApi";
import { BUILTIN_SHELL, dbShellSource, type ShellAdjust, type ShellSource } from "@/lib/shoeShell";

interface ShellPickerDrawerProps {
  /** 当前选中的 ShellSource.id，用来打 ✓ */
  currentId: string;
  /** 选中一款：adjust 为该鞋壳上次校正过的摆位（后端记着），null = 用默认 */
  onPick: (source: ShellSource, adjust: ShellAdjust | null) => void;
  /** 上传新鞋壳（解析 + 入库由页面负责） */
  onUpload: (file: File) => void;
  /** 页面上传成功后自增，抽屉据此重列表，新传的鞋壳立刻出现在卡片带里 */
  refreshKey: number;
  onClose: () => void;
}

const CARD_W = 152;
const THUMB_H = 96;

/** 字节数 → 人话（鞋壳动辄几十上百 MB） */
function formatSize(bytes?: number): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * 一张鞋壳卡片。缩略图三态：加载中骨架 / 图 / 取不到时的占位（可重试）。
 * 重试靠给 src 挂一个自增参数强制重拉 —— 后端那一侧是「没有就现渲」，
 * 所以第一次 404 之后再点，多半就有了。
 */
function ShellCard({
  label, sub, thumbUrl, active, onSelect, onDelete,
}: {
  label: string;
  sub: string;
  thumbUrl?: string;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const [state, setState] = useState<"loading" | "ok" | "fail">(thumbUrl ? "loading" : "fail");
  const [bust, setBust] = useState(0);
  const [hover, setHover] = useState(false);

  // 换了图源（如上传后 refresh）要重新回到 loading
  useEffect(() => {
    setState(thumbUrl ? "loading" : "fail");
  }, [thumbUrl]);

  const src = thumbUrl ? (bust ? `${thumbUrl}?r=${bust}` : thumbUrl) : "";

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative", flexShrink: 0, width: `${CARD_W}px` }}
    >
      <button
        onClick={onSelect}
        title={label}
        style={{
          width: "100%",
          padding: 0,
          borderRadius: "12px",
          overflow: "hidden",
          cursor: "pointer",
          border: active ? "2px solid #FF8400" : "2px solid rgba(225,194,173,0.75)",
          background: active ? "rgba(255,240,222,0.95)" : "rgba(255,255,255,0.82)",
          boxShadow: active ? "0 4px 14px rgba(255,132,0,0.22)" : "0 2px 8px rgba(160,110,40,0.10)",
          transition: "all 0.16s",
          display: "block",
          textAlign: "left",
        }}
      >
        {/* 形态图区 */}
        <div
          style={{
            height: `${THUMB_H}px`,
            background: "#F4EEE6",
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative",
          }}
        >
          {state !== "ok" && (
            <span style={{ fontSize: "11px", color: "#A79279", padding: "0 8px", textAlign: "center", lineHeight: 1.5 }}>
              {state === "loading" ? "形态图生成中…" : "暂无形态图"}
            </span>
          )}
          {thumbUrl && (
            <img
              src={src}
              alt=""
              onLoad={() => setState("ok")}
              onError={() => setState("fail")}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                objectFit: "contain",
                opacity: state === "ok" ? 1 : 0,
                transition: "opacity 0.2s",
              }}
            />
          )}
        </div>
        {/* 名字 + 体积 */}
        <div style={{ padding: "6px 8px 7px", borderTop: "1px solid rgba(225,194,173,0.5)" }}>
          <div
            style={{
              fontSize: "12px", fontWeight: 700, color: "#17191C",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: "11px", color: "#9A8672", marginTop: "1px" }}>{sub}</div>
        </div>
      </button>

      {/* 选中角标 */}
      {active && (
        <span
          style={{
            position: "absolute", top: "5px", right: "5px",
            width: "20px", height: "20px", borderRadius: "50%",
            background: "#FF8400", color: "#fff",
            fontSize: "12px", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 6px rgba(255,132,0,0.4)",
          }}
        >
          ✓
        </span>
      )}

      {/* 删除：只对后端件、且鼠标在卡上时出现 */}
      {onDelete && hover && !active && (
        <button
          onClick={onDelete}
          title="删除该鞋壳"
          style={{
            position: "absolute", top: "5px", right: "5px",
            width: "22px", height: "22px", borderRadius: "7px",
            border: "none", cursor: "pointer",
            background: "rgba(255,255,255,0.94)",
            boxShadow: "0 1px 5px rgba(90,60,20,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <img src="/assets/icons/history-user-page/delete.svg" alt="" style={{ width: "13px", height: "13px" }} />
        </button>
      )}

      {/* 形态图没出来时给个重试入口（后端「没有就现渲」，再点一次多半就有） */}
      {state === "fail" && thumbUrl && (
        <button
          onClick={() => { setState("loading"); setBust((b) => b + 1); }}
          style={{
            position: "absolute", top: `${THUMB_H - 24}px`, left: "50%", transform: "translateX(-50%)",
            border: "none", background: "rgba(255,255,255,0.9)", cursor: "pointer",
            fontSize: "11px", color: "#FF8400", fontWeight: 600,
            borderRadius: "6px", padding: "2px 8px",
          }}
        >
          重试
        </button>
      )}
    </div>
  );
}

export default function ShellPickerDrawer({
  currentId, onPick, onUpload, refreshKey, onClose,
}: ShellPickerDrawerProps) {
  const [shells, setShells] = useState<ApiShell[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setShells(await apiListShells());
      setOffline(false);
    } catch {
      setShells([]);
      setOffline(true); // 后端不可用：只剩内置件，但上传仍可用（退回本次会话内存件）
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  // Esc 关抽屉（没有遮罩可点，键盘要留一条路）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleDelete = async (s: ApiShell) => {
    if (!window.confirm(`删除鞋壳「${s.label}」？该文件将从服务器移除。`)) return;
    try {
      await apiDeleteShell(s.id);
    } catch {
      /* 后端不可用：下面 refresh 会把它照原样列回来 */
    }
    await refresh();
    // 删掉的正是当前选中件 → 回落内置件，避免 3D 去拉一个已经没有的 url
    if (`db:${s.id}` === currentId) onPick(BUILTIN_SHELL, null);
  };

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 80,
        background: "linear-gradient(180deg, #FFF8EF 0%, #FFF1E2 100%)",
        borderTop: "1.5px solid #E1C2AD",
        borderTopLeftRadius: "18px", borderTopRightRadius: "18px",
        boxShadow: "0 -14px 40px rgba(150,95,25,0.20)",
        animation: "drawerUp 0.22s ease",
        padding: "12px 20px 14px",
      }}
    >
      {/* 头 */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "#17191C", letterSpacing: "0.04em" }}>选择鞋壳形态</span>
        <span style={{ fontSize: "12px", color: "#9A8672" }}>点一款即换，可连着点几款对比</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            height: "28px", padding: "0 14px", borderRadius: "8px",
            border: "1.5px solid #E1C2AD", background: "rgba(255,255,255,0.8)",
            cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#8A6A40",
          }}
        >
          完成
        </button>
      </div>

      {/* 卡片带 */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", overflowX: "auto", paddingBottom: "4px" }}>
        <ShellCard
          label={BUILTIN_SHELL.label}
          sub="内置"
          thumbUrl={BUILTIN_SHELL.thumbUrl}
          active={BUILTIN_SHELL.id === currentId}
          onSelect={() => onPick(BUILTIN_SHELL, null)}
        />

        {shells.map((s) => (
          <ShellCard
            key={s.id}
            label={s.label}
            sub={formatSize(s.size)}
            thumbUrl={shellThumbUrl(s.id)}
            active={`db:${s.id}` === currentId}
            onSelect={() => onPick(
              dbShellSource(s.id, s.label, shellFileUrl(s.id), undefined, shellThumbUrl(s.id)),
              (s.adjust as ShellAdjust | null) ?? null,
            )}
            onDelete={() => void handleDelete(s)}
          />
        ))}

        {/* 上传卡：虚线框，与真鞋壳卡区分开 */}
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            flexShrink: 0, width: `${CARD_W}px`, height: `${THUMB_H + 40}px`,
            borderRadius: "12px", border: "2px dashed #D9BCA4",
            background: "rgba(255,255,255,0.55)", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px",
            color: "#FF8400",
          }}
        >
          <span style={{ fontSize: "24px", lineHeight: 1 }}>＋</span>
          <span style={{ fontSize: "13px", fontWeight: 700 }}>上传新鞋壳</span>
          <span style={{ fontSize: "11px", color: "#9A8672" }}>.stl</span>
        </button>

        {loading && (
          <span style={{ fontSize: "12px", color: "#9A8672", alignSelf: "center", whiteSpace: "nowrap" }}>
            正在读取鞋壳列表…
          </span>
        )}
        {!loading && offline && (
          <span style={{ fontSize: "12px", color: "#9A8672", alignSelf: "center", maxWidth: "280px", lineHeight: 1.6 }}>
            读取不到已保存的鞋壳（后端服务未运行）。仍可上传新鞋壳，但只在本次会话有效。
          </span>
        )}
      </div>

      {/* 隐藏文件选择器：value 清空以允许重复选同一文件 */}
      <input
        ref={fileRef}
        type="file"
        accept=".stl"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(f);
        }}
      />
    </div>
  );
}
