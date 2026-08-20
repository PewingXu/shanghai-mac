/**
 * UserFormModal — 用户信息表单弹窗（设计稿：582px 卡片 / #9E958C 80% 遮罩 / 暖橙渐变底）。
 *
 * 两种模式共用同一套版式：
 * - create：正式采集前登记（测量页）。ID 前端预生成并随提交传后端
 *   （db_store 未占用则沿用，撞号由服务端换号），提交按钮"开始体验"。
 * - edit：用户管理/采集信息页编辑资料。ID 固定显示，字段预填，提交按钮"确认修改"。
 */
import { useEffect, useState } from "react";
import { useApp, type User } from "@/contexts/AppContext";
import { apiNextUserId } from "@/lib/backendApi";
import { formatUserId } from "@/lib/utils";

/** 今天的本地日期（YYYY-MM-DD）：出生日期上限，不允许选未来 */
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface UserFormData {
  id: number;
  name: string;
  birthDate: string;
  gender: string;
  height?: number;
  weight?: number;
  shoeSize?: string;
  phone?: string;
  email?: string;
}

export default function UserFormModal({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  /** edit 模式必传：待编辑用户（含 id）；create 模式忽略 */
  initial?: User | null;
  onSubmit: (data: UserFormData) => void;
  onCancel: () => void;
}) {
  const isEdit = mode === "edit";
  const { historyUsers } = useApp();
  // create 模式：ID 为连贯自增号（后端 max+1；后端不可用时本地列表 max+1 兜底），展示补零 5 位
  const [pendingId, setPendingId] = useState(() =>
    isEdit && initial ? initial.id : historyUsers.reduce((m, u) => Math.max(m, u.id), 0) + 1,
  );
  useEffect(() => {
    if (isEdit) return;
    let alive = true;
    apiNextUserId()
      .then((id) => {
        if (alive) setPendingId(id);
      })
      .catch(() => {
        /* 后端未就绪：保持本地自增预估，真正分配以创建返回为准 */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [name, setName] = useState(isEdit ? initial?.name ?? "" : "");
  const [birthDate, setBirthDate] = useState(isEdit ? initial?.birthDate ?? "" : "");
  const [gender, setGender] = useState(isEdit ? initial?.gender ?? "" : "");
  const [height, setHeight] = useState(isEdit && initial?.height != null ? String(initial.height) : "");
  const [weight, setWeight] = useState(isEdit && initial?.weight != null ? String(initial.weight) : "");
  const [shoeSize, setShoeSize] = useState(isEdit ? initial?.shoeSize ?? "" : "");
  const [phone, setPhone] = useState(isEdit ? initial?.phone ?? "" : "");
  const [email, setEmail] = useState(isEdit ? initial?.email ?? "" : "");
  // 两步填写：第 1 步基础信息（填写完毕）→ 第 2 步联系方式（手机号 + 邮箱，格式校验后提交）
  const [step, setStep] = useState<1 | 2>(1);
  const canSubmit = name.trim().length > 0;

  // 第 1 步 → 第 2 步：基础信息校验
  const goNextStep = () => {
    if (!canSubmit) return;
    // 兜底：手动键入的未来日期也拦下（正常路径由 input max 挡住）
    if (birthDate && birthDate > todayLocal()) {
      window.alert("出生日期不能晚于今天，请重新选择");
      return;
    }
    setStep(2);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step === 1) {
      goNextStep(); // 回车键提交时同样走分步
      return;
    }
    // 第 2 步：中国大陆手机号（11 位、1 开头、第二位 3-9）+ 标准邮箱格式，均必填
    const phoneDigits = phone.replace(/\D/g, "");
    if (!/^1[3-9]\d{9}$/.test(phoneDigits)) {
      window.alert("请输入正确的中国大陆手机号（11 位，以 13-19 开头）");
      return;
    }
    const mail = email.trim();
    // 基本格式 + 域名主体至少 2 字符（拦 a@q.com 这类），顶级域至少 2 字母
    if (!/^[^\s@]+@[^\s@]{2,}\.[A-Za-z]{2,}$/.test(mail)) {
      window.alert("请输入正确的邮箱地址（如 name@example.com）");
      return;
    }
    // 常见域名手滑校正提示（q.com→qq.com、16.com→163.com 等，一线录入高频错误）
    const domain = mail.split("@")[1].toLowerCase();
    const TYPO_DOMAINS: Record<string, string> = {
      "q.com": "qq.com",
      "qq.co": "qq.com",
      "16.com": "163.com",
      "163.co": "163.com",
      "126.co": "126.com",
      "gmial.com": "gmail.com",
      "gamil.com": "gmail.com",
      "gmai.com": "gmail.com",
      "outlok.com": "outlook.com",
      "foxmial.com": "foxmail.com",
    };
    if (TYPO_DOMAINS[domain]) {
      window.alert(`邮箱域名疑似有误：@${domain} 是否想输入 @${TYPO_DOMAINS[domain]}？请确认后重新提交`);
      return;
    }
    onSubmit({
      id: pendingId,
      name: name.trim(),
      birthDate,
      gender,
      height: height ? Number(height) : undefined,
      weight: weight ? Number(weight) : undefined,
      shoeSize: shoeSize.trim() || undefined,
      phone: phoneDigits,
      email: email.trim(),
    });
  };

  return (
    <div className="user-form-overlay">
      <form className="user-form-card" onSubmit={submit}>
        <div className="user-form-head">
          <h2>
            {isEdit ? "编辑用户" : "创建用户"} <span className="user-form-id">（ID：{formatUserId(pendingId)}）</span>
          </h2>
          <button type="button" className="user-form-close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        {step === 1 && (
          <>
            <div className="user-form-row user-form-row-top">
              <label className="user-form-field" style={{ width: "200px" }}>
                <span>姓名</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="请填写姓名" autoFocus />
              </label>
              <label className="user-form-field" style={{ flex: 1 }}>
                <span>出生年/月/日</span>
                <input type="date" value={birthDate} max={todayLocal()} onChange={(e) => setBirthDate(e.target.value)} placeholder="请选择日期" />
              </label>
            </div>

            <div className="user-form-row">
              <label className="user-form-field" style={{ width: "92px" }}>
                <span>性别</span>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className={gender ? "" : "is-placeholder"}>
                  <option value="" disabled hidden>
                    选择
                  </option>
                  <option value="女">女</option>
                  <option value="男">男</option>
                </select>
              </label>
              <label className="user-form-field" style={{ width: "88px" }}>
                <span>鞋码</span>
                <input value={shoeSize} onChange={(e) => setShoeSize(e.target.value)} placeholder="如 41" />
              </label>
              <label className="user-form-field user-form-unit" style={{ width: "118px" }}>
                <span>身高</span>
                <span className="user-form-unit-box">
                  <input type="number" min="0" max="300" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="身高" />
                  <em>cm</em>
                </span>
              </label>
              <label className="user-form-field user-form-unit" style={{ width: "118px" }}>
                <span>体重</span>
                <span className="user-form-unit-box">
                  <input type="number" min="0" max="500" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="体重" />
                  <em>kg</em>
                </span>
              </label>
            </div>

            <div className="user-form-actions">
              {/* 编辑模式语义是"改完确认"，不是首次登记的"填写完毕" */}
              <button type="button" className="user-form-primary" disabled={!canSubmit} onClick={goNextStep}>
                {isEdit ? "确认修改" : "填写完毕"}
              </button>
              <button type="button" onClick={onCancel}>
                取消
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="user-form-step-hint">请填写联系方式（用于报告联系与查询）</p>
            <div className="user-form-row user-form-row-top">
              <label className="user-form-field" style={{ width: "200px" }}>
                <span>手机号</span>
                <input
                  type="tel"
                  maxLength={11}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="11 位手机号"
                  autoFocus
                />
              </label>
              <label className="user-form-field" style={{ flex: 1 }}>
                <span>联系邮箱</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="如 name@example.com" />
              </label>
            </div>

            <div className="user-form-actions">
              <button type="submit" className="user-form-primary">
                {isEdit ? "确认修改" : "开始体验"}
              </button>
              <button type="button" onClick={() => setStep(1)}>
                上一步
              </button>
            </div>
          </>
        )}

        <style>{styles}</style>
      </form>
    </div>
  );
}

const styles = `
  .user-form-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(158, 149, 140, 0.8);
    animation: user-form-fade 180ms ease-out;
  }

  .user-form-card {
    width: min(582px, calc(100vw - 48px));
    padding: 34px 56px 40px;
    border-radius: 16px;
    background: linear-gradient(180deg, #fff1e2 69%, #fff8ef 99%);
    border: 1.5px solid #F08614;
    box-shadow: 0 4px 6px #b59f88;
    box-sizing: border-box;
    animation: user-form-pop 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .user-form-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 26px;
  }

  .user-form-head h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 4px;
    color: #17191c;
  }

  .user-form-id {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 1px;
  }

  .user-form-close {
    border: 0;
    background: transparent;
    font-size: 26px;
    line-height: 1;
    color: #929292;
    cursor: pointer;
  }

  .user-form-row {
    display: flex;
    gap: 10px;
    justify-content: space-between;
  }

  .user-form-row-top {
    margin-bottom: 22px;
  }

  .user-form-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 2px;
    color: #17191c;
  }

  .user-form-field input,
  .user-form-field select {
    height: 45px;
    width: 100%;
    padding: 0 12px;
    border-radius: 6px;
    border: 1.5px solid #FFB25F;
    background: #ffffff;
    font-size: 15px;
    color: #17191c;
    outline: none;
    box-sizing: border-box;
  }

  .user-form-field input::placeholder {
    color: #b8ab99;
    letter-spacing: 0;
  }

  /* 下拉：去原生箭头，换设计稿的橙色箭头 */
  .user-form-field select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 32px;
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='10' viewBox='0 0 16 10'%3E%3Cpath d='M1 1l7 7 7-7' fill='none' stroke='%23F08614' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
  }

  .user-form-field select.is-placeholder {
    color: #b8ab99;
  }

  .user-form-field input:focus,
  .user-form-field select:focus {
    border-color: #F08614;
    box-shadow: 0 0 0 3px rgba(240, 134, 20, 0.16);
  }

  /* 身高/体重：单位在输入框外侧（设计稿 cm / kg） */
  .user-form-unit-box {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .user-form-unit-box em {
    font-style: normal;
    font-size: 15px;
    font-weight: 700;
    color: #17191c;
  }

  .user-form-actions {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 34px;
  }

  .user-form-actions button {
    height: 48px;
    width: 100%;
    border-radius: 8px;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 6px;
    cursor: pointer;
  }

  /* 主按钮（填写完毕 / 开始体验 / 确认修改）：橙色实底 */
  .user-form-actions .user-form-primary {
    border: 0;
    background: #F08614;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(240, 134, 20, 0.28);
  }

  .user-form-actions .user-form-primary:disabled {
    background: #d8d2ca;
    color: #ffffff;
    box-shadow: none;
    cursor: not-allowed;
  }

  /* 次按钮（取消 / 上一步）：浅橙描边 */
  .user-form-actions button:not(.user-form-primary) {
    border: 1.5px solid #FFB25F;
    background: #fff4e5;
    color: #F08614;
  }

  /* 第二步顶部提示 */
  .user-form-step-hint {
    margin: 0 0 18px;
    font-size: 14px;
    font-weight: 500;
    color: #8a6a40;
  }

  @keyframes user-form-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes user-form-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
`;
