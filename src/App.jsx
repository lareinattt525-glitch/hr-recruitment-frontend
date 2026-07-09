import { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, Users, Mail, Sparkles, CheckCircle2, Clock, Send, Loader2,
  MessageSquareText, Plus, UserCheck, FileText, RefreshCw, X, ThumbsUp,
  ThumbsDown, Building2, LogOut, ServerCog, ShieldCheck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// design tokens (与原型保持一致的视觉语言)
// ---------------------------------------------------------------------------
const COLORS = {
  ink: '#1E2A38',
  paper: '#EEF1EE',
  text: '#20262B',
  textMuted: '#5B6670',
  amber: '#E3A72E',
  amberSoft: '#F7E4B8',
  teal: '#3F7D6E',
  tealSoft: '#DCEAE6',
  brick: '#B2483A',
  brickSoft: '#F3DEDA',
  line: '#DBE0DC',
};

const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
  .ui-display { font-family: 'Fraunces', 'Songti SC', serif; }
  .ui-body { font-family: 'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  .ui-mono { font-family: 'IBM Plex Mono', 'PingFang SC', monospace; }
`;

const STAGE_META = {
  new: { label: '新简历 · AI评分' },
  hr_interview: { label: 'HR面试' },
  business_pending: { label: '待业务确认' },
  business_1st: { label: '业务一面' },
  business_2nd: { label: '业务二面' },
  final: { label: '终面' },
  offer: { label: 'Offer确认' },
  done: { label: '已完成' },
};
const COLUMNS = ['new', 'hr_interview', 'business_pending', 'business_1st', 'business_2nd', 'final', 'offer', 'done'];
const ROUND_LABEL = { hr: 'HR面试', business_1st: '业务一面', business_2nd: '业务二面', final: '终面' };

const inputStyle = { borderColor: COLORS.line };
const AUTH_STORAGE_KEY = 'naxian_hr_auth';

function loadAuthFromStorage() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveAuthToStorage(state) {
  try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式下可能不可用，不影响本次使用 */ }
}
function clearAuthFromStorage() {
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// API client —— 这是和之前版本最大的区别：不再是本地假数据，是真的打后端接口
// ---------------------------------------------------------------------------
function buildUrl(backendUrl, path) {
  return `${backendUrl.replace(/\/$/, '')}${path}`;
}

async function apiFetch(backendUrl, token, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(buildUrl(backendUrl, path), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`连不上后端地址（${backendUrl}），检查地址是否正确、服务是否在运行`);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 无响应体 */ }
  if (!res.ok) {
    const message = data?.message || `请求失败 (HTTP ${res.status})`;
    const err = new Error(Array.isArray(message) ? message.join('；') : message);
    err.status = res.status;
    throw err;
  }
  return data;
}

function createApiClient(backendUrl, token) {
  const call = (path, opts) => apiFetch(backendUrl, token, path, opts);
  const pub = (path, opts) => apiFetch(backendUrl, null, path, opts);
  return {
    health: () => pub('/health'),
    login: (email, password) => pub('/auth/login', { method: 'POST', body: { email, password } }),
    bootstrapAdmin: (setupKey, email, password, name) =>
      pub('/auth/bootstrap-admin', { method: 'POST', body: { setupKey, email, password, name } }),

    listPositions: () => call('/positions'),
    createPosition: (data) => call('/positions', { method: 'POST', body: data }),
    generateJD: (id) => call(`/positions/${id}/generate-jd`, { method: 'POST' }),
    publishJD: (id, jdGenerated) => call(`/positions/${id}/jd`, { method: 'PUT', body: { jdGenerated } }),

    listResumes: () => call('/resumes'),
    getResume: (id) => call(`/resumes/${id}`),
    ingestResume: (data) => call('/internal/resumes/ingest', { method: 'POST', body: data }),
    rejectResume: (id, reason) => call(`/resumes/${id}/reject`, { method: 'PUT', body: { reason } }),
    getScore: (resumeId) => call(`/resumes/${resumeId}/score`),
    submitFeedback: (scoreRecordId, data) => call(`/score-records/${scoreRecordId}/feedback`, { method: 'POST', body: data }),

    scheduleHRInterview: (resumeId) => call(`/resumes/${resumeId}/hr-interview`, { method: 'POST' }),
    getResumeInterviews: (resumeId) => call(`/resumes/${resumeId}/interviews`),
    getQuestionSuggestions: (interviewId) => call(`/interviews/${interviewId}/question-suggestions`),
    recordInterviewResult: (interviewId, data) => call(`/interviews/${interviewId}/result`, { method: 'PUT', body: data }),
    pushToBusiness: (interviewId, interviewerId) => call(`/interviews/${interviewId}/push-to-business`, { method: 'POST', body: { interviewerId } }),
    interviewerRespond: (data) => pub('/webhooks/feishu/card-callback', { method: 'POST', body: data }),
    getInterviewerInterviews: (interviewerId) => call(`/interviewers/${interviewerId}/interviews`),

    createOffer: (data) => call('/offers', { method: 'POST', body: data }),
    getOfferByResume: (resumeId) => call(`/resumes/${resumeId}/offer`),
    getConfirmationStatus: (offerId) => call(`/offers/${offerId}/confirmation-status`),
    confirmOffer: (offerId, confirmerId) => pub('/webhooks/feishu/offer-confirm-callback', { method: 'POST', body: { offerId, confirmerId } }),
    generateOfferEmail: (offerId) => call(`/offers/${offerId}/generate-email`, { method: 'POST' }),
    sendOfferEmail: (offerId) => call(`/offers/${offerId}/send`, { method: 'POST' }),

    listUsers: () => call('/users'),
    createUser: (data) => call('/users', { method: 'POST', body: data }),
  };
}

// ---------------------------------------------------------------------------
// 小组件
// ---------------------------------------------------------------------------
function Badge({ text, color, bg }) {
  return <span className="ui-mono text-xs px-2 py-1 rounded-full" style={{ color, background: bg }}>{text}</span>;
}

function ScoreRing({ score, size = 56 }) {
  const band = score >= 80 ? COLORS.teal : score >= 60 ? COLORS.amber : COLORS.brick;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.line} strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={band} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="ui-display" fontSize={size * 0.32} fontWeight="600" fill={COLORS.text}>{score}</text>
    </svg>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="ui-mono text-xs uppercase tracking-wide mb-2" style={{ color: COLORS.textMuted }}>{title}</div>
      {children}
    </div>
  );
}

function EmptyHint({ text }) {
  return <div className="ui-body text-sm p-6 text-center rounded-lg" style={{ color: COLORS.textMuted, border: `1px dashed ${COLORS.line}` }}>{text}</div>;
}

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 ui-body text-sm p-6 justify-center" style={{ color: COLORS.textMuted }}>
      <Loader2 size={16} className="animate-spin" />{label || '加载中…'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 登录 / 首次设置
// ---------------------------------------------------------------------------
function LoginScreen({ savedBackendUrl, onLoggedIn, showToast }) {
  const [backendUrl, setBackendUrl] = useState(savedBackendUrl || '');
  const [step, setStep] = useState(savedBackendUrl ? 'auth' : 'url');
  const [mode, setMode] = useState('login'); // 'login' | 'bootstrap'
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', setupKey: '' });

  const checkBackend = async () => {
    if (!backendUrl.trim()) return;
    setBusy(true);
    try {
      const api = createApiClient(backendUrl.trim(), null);
      await api.health();
      setStep('auth');
    } catch (e) {
      showToast('连不上这个地址：' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async () => {
    setBusy(true);
    try {
      const api = createApiClient(backendUrl.trim(), null);
      const result = await api.login(form.email, form.password);
      onLoggedIn(backendUrl.trim(), result.accessToken, result.user);
    } catch (e) {
      showToast('登录失败：' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitBootstrap = async () => {
    setBusy(true);
    try {
      const api = createApiClient(backendUrl.trim(), null);
      const result = await api.bootstrapAdmin(form.setupKey, form.email, form.password, form.name);
      onLoggedIn(backendUrl.trim(), result.accessToken, result.user);
    } catch (e) {
      showToast('创建失败：' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 ui-body" style={{ background: COLORS.ink }}>
      <style>{FONT_STYLE}</style>
      <div className="w-full max-w-sm rounded-lg p-6" style={{ background: '#fff' }}>
        <div className="flex items-center gap-2 mb-1">
          <ServerCog size={20} color={COLORS.amber} />
          <div className="ui-display text-xl" style={{ color: COLORS.text }}>纳贤 · NaXian</div>
        </div>
        <div className="ui-mono text-xs mb-5" style={{ color: COLORS.textMuted }}>连接到你的后端服务</div>

        {step === 'url' && (
          <div className="flex flex-col gap-3">
            <label className="ui-body text-sm" style={{ color: COLORS.text }}>后端地址</label>
            <input
              value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://xxx.up.railway.app"
              className="ui-body text-sm border rounded px-3 py-2" style={inputStyle}
            />
            <button
              disabled={busy || !backendUrl.trim()} onClick={checkBackend}
              className="flex items-center justify-center gap-1 text-sm px-3 py-2 rounded-md text-white disabled:opacity-40"
              style={{ background: COLORS.ink }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}下一步
            </button>
          </div>
        )}

        {step === 'auth' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 mb-1">
              <button onClick={() => setMode('login')} className="flex-1 ui-mono text-xs px-2 py-1.5 rounded-md"
                style={{ background: mode === 'login' ? COLORS.amber : COLORS.paper, color: mode === 'login' ? COLORS.ink : COLORS.textMuted }}>登录</button>
              <button onClick={() => setMode('bootstrap')} className="flex-1 ui-mono text-xs px-2 py-1.5 rounded-md"
                style={{ background: mode === 'bootstrap' ? COLORS.amber : COLORS.paper, color: mode === 'bootstrap' ? COLORS.ink : COLORS.textMuted }}>首次创建管理员</button>
            </div>

            {mode === 'login' ? (
              <>
                <input placeholder="邮箱" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="ui-body text-sm border rounded px-3 py-2" style={inputStyle} />
                <input placeholder="密码" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="ui-body text-sm border rounded px-3 py-2" style={inputStyle} />
                <button disabled={busy || !form.email || !form.password} onClick={submitLogin}
                  className="flex items-center justify-center gap-1 text-sm px-3 py-2 rounded-md text-white disabled:opacity-40" style={{ background: COLORS.ink }}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}登录
                </button>
              </>
            ) : (
              <>
                <p className="ui-body text-xs" style={{ color: COLORS.textMuted }}>
                  只有系统里一个账号都没有时才能用这个创建；ADMIN_SETUP_KEY 是你部署时在后端环境变量里设的那个值。
                </p>
                <input placeholder="setup key" value={form.setupKey} onChange={(e) => setForm({ ...form, setupKey: e.target.value })} className="ui-body text-sm border rounded px-3 py-2" style={inputStyle} />
                <input placeholder="你的邮箱" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="ui-body text-sm border rounded px-3 py-2" style={inputStyle} />
                <input placeholder="你的名字" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="ui-body text-sm border rounded px-3 py-2" style={inputStyle} />
                <input placeholder="设置密码（至少8位）" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="ui-body text-sm border rounded px-3 py-2" style={inputStyle} />
                <button disabled={busy || !form.setupKey || !form.email || !form.password || !form.name} onClick={submitBootstrap}
                  className="flex items-center justify-center gap-1 text-sm px-3 py-2 rounded-md text-white disabled:opacity-40" style={{ background: COLORS.ink }}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}创建管理员账号并登录
                </button>
              </>
            )}
            <button onClick={() => setStep('url')} className="ui-mono text-xs mt-1" style={{ color: COLORS.textMuted }}>换一个后端地址</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------
function PositionFormModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({ title: '', department: '', headcount: 1, salaryMin: '', salaryMax: '', requirementsRaw: '' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,26,32,0.45)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-lg p-5" style={{ background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <h3 className="ui-display text-lg mb-3" style={{ color: COLORS.text }}>提交招聘需求</h3>
        <div className="flex flex-col gap-2">
          <input placeholder="职位名称" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
          <input placeholder="所属部门" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
          <div className="flex gap-2">
            <input placeholder="招聘人数" type="number" value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5 w-1/3" style={inputStyle} />
            <input placeholder="薪资下限(K)" type="number" value={form.salaryMin} onChange={(e) => setForm({ ...form, salaryMin: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5 w-1/3" style={inputStyle} />
            <input placeholder="薪资上限(K)" type="number" value={form.salaryMax} onChange={(e) => setForm({ ...form, salaryMax: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5 w-1/3" style={inputStyle} />
          </div>
          <textarea placeholder="岗位需求描述" rows={4} value={form.requirementsRaw} onChange={(e) => setForm({ ...form, requirementsRaw: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ color: COLORS.textMuted }}>取消</button>
          <button disabled={!form.title} onClick={() => onSubmit(form)} className="text-sm px-3 py-1.5 rounded-md text-white ui-body disabled:opacity-40" style={{ background: COLORS.ink }}>提交</button>
        </div>
      </div>
    </div>
  );
}

function PositionCard({ position, busy, api, showToast, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(position.jdGenerated || '');
  const key = `jd-${position.id}`;

  const doGenerate = async () => {
    onChanged.setBusy(key, true);
    try {
      const updated = await api.generateJD(position.id);
      setDraft(updated.jdGenerated || '');
      showToast('JD已生成', 'success');
      onChanged.refresh();
    } catch (e) {
      showToast('生成失败：' + e.message, 'error');
    } finally {
      onChanged.setBusy(key, false);
    }
  };

  const doPublish = async () => {
    try {
      await api.publishJD(position.id, draft);
      showToast('JD已发布', 'success');
      onChanged.refresh();
    } catch (e) {
      showToast('发布失败：' + e.message, 'error');
    }
  };

  return (
    <div className="rounded-lg p-4" style={{ background: '#fff', border: `1px solid ${COLORS.line}` }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="ui-display text-lg" style={{ color: COLORS.text }}>{position.title}</div>
          <div className="ui-body text-xs" style={{ color: COLORS.textMuted }}>{position.department} · 招{position.headcount}人</div>
        </div>
        <Badge text={position.jdStatus === 'published' ? 'JD已发布' : 'JD草稿'} color={position.jdStatus === 'published' ? COLORS.teal : COLORS.textMuted} bg={position.jdStatus === 'published' ? COLORS.tealSoft : COLORS.paper} />
      </div>
      <p className="ui-body text-sm mt-2" style={{ color: COLORS.textMuted }}>{position.requirementsRaw}</p>
      {position.jdGenerated ? (
        <div className="mt-3 p-3 rounded-md" style={{ background: COLORS.paper }}>
          {editing ? (
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} className="w-full ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
          ) : (
            <pre className="ui-body text-sm whitespace-pre-wrap" style={{ color: COLORS.text }}>{draft}</pre>
          )}
          <div className="flex gap-2 mt-2 flex-wrap">
            {editing ? (
              <button onClick={() => setEditing(false)} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>完成编辑</button>
            ) : (
              <button onClick={() => setEditing(true)} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.text }}>编辑</button>
            )}
            <button onClick={doGenerate} disabled={busy[key]} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md ui-body" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.text }}>
              {busy[key] ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}重新生成
            </button>
            {position.jdStatus !== 'published' && <button onClick={doPublish} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.teal }}>发布</button>}
          </div>
        </div>
      ) : (
        <button onClick={doGenerate} disabled={busy[key]} className="mt-3 flex items-center gap-1 text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>
          {busy[key] ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}AI生成JD
        </button>
      )}
    </div>
  );
}

function PositionsView({ positions, loading, busy, setBusyFlag, api, showToast, refresh }) {
  const [showForm, setShowForm] = useState(false);

  const create = async (form) => {
    try {
      await api.createPosition({ ...form, headcount: Number(form.headcount) || 1, salaryMin: form.salaryMin ? Number(form.salaryMin) : undefined, salaryMax: form.salaryMax ? Number(form.salaryMax) : undefined });
      showToast('职位已创建', 'success');
      setShowForm(false);
      refresh();
    } catch (e) {
      showToast('创建失败：' + e.message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="ui-display text-xl" style={{ color: COLORS.text }}>职位管理</h2>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}><Plus size={14} />新建职位</button>
      </div>
      {loading ? <Spinner /> : (
        <div className="flex flex-col gap-4">
          {positions.length === 0 && <EmptyHint text="还没有职位，点右上角新建一个" />}
          {positions.map((p) => (
            <PositionCard key={p.id} position={p} busy={busy} api={api} showToast={showToast} onChanged={{ refresh, setBusy: setBusyFlag }} />
          ))}
        </div>
      )}
      {showForm && <PositionFormModal onClose={() => setShowForm(false)} onSubmit={create} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
function NewResumeModal({ positions, onClose, onSubmit }) {
  const [form, setForm] = useState({ candidateName: '', candidateEmail: '', positionId: positions[0]?.id || '', rawText: '' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,26,32,0.45)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-lg p-5" style={{ background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <h3 className="ui-display text-lg mb-1" style={{ color: COLORS.text }}>模拟收到简历</h3>
        <p className="ui-mono text-xs mb-3" style={{ color: COLORS.textMuted }}>正式上线后这一步由邮箱轮询服务自动完成</p>
        <div className="flex flex-col gap-2">
          <input placeholder="候选人姓名" value={form.candidateName} onChange={(e) => setForm({ ...form, candidateName: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
          <input placeholder="候选人邮箱（选填）" value={form.candidateEmail} onChange={(e) => setForm({ ...form, candidateEmail: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
          <select value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle}>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <textarea placeholder="粘贴简历文本" rows={6} value={form.rawText} onChange={(e) => setForm({ ...form, rawText: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ color: COLORS.textMuted }}>取消</button>
          <button disabled={!form.candidateName || !form.rawText || !form.positionId} onClick={() => onSubmit({ ...form, fileUrl: 'https://example.com/manual-upload.pdf' })} className="text-sm px-3 py-1.5 rounded-md text-white ui-body disabled:opacity-40" style={{ background: COLORS.ink }}>提交并触发AI评分</button>
        </div>
      </div>
    </div>
  );
}

function PipelineBoard({ resumes, positions, onOpen }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((colKey) => {
        const items = resumes.filter((r) => r.stage === colKey);
        return (
          <div key={colKey} className="flex-shrink-0 rounded-lg p-2" style={{ width: 200, background: '#fff', border: `1px solid ${COLORS.line}`, minHeight: 320 }}>
            <div className="ui-mono text-xs uppercase tracking-wide mb-2 px-1" style={{ color: COLORS.textMuted }}>{STAGE_META[colKey].label} · {items.length}</div>
            <div className="flex flex-col gap-2">
              {items.map((r) => (
                <button key={r.id} onClick={() => onOpen(r.id)} className="text-left rounded-md p-2 hover:shadow-md transition-shadow" style={{ border: `1px solid ${COLORS.line}`, background: '#fff' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="ui-body font-medium text-sm" style={{ color: COLORS.text }}>{r.candidate?.name || '未知'}</span>
                  </div>
                  <div className="ui-body text-xs mt-1" style={{ color: COLORS.textMuted }}>{positions.find((p) => p.id === r.positionId)?.title}</div>
                </button>
              ))}
              {items.length === 0 && <div className="ui-body text-xs px-1" style={{ color: COLORS.textMuted }}>空</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PipelineView({ resumes, positions, loading, api, showToast, refresh, onOpen }) {
  const [showModal, setShowModal] = useState(false);

  const submitResume = async (form) => {
    try {
      await api.ingestResume(form);
      showToast('简历已提交，正在AI评分…', 'info');
      setShowModal(false);
      setTimeout(refresh, 1500); // AI评分是异步的，给点时间再刷新
      refresh();
    } catch (e) {
      showToast('提交失败：' + e.message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="ui-display text-xl" style={{ color: COLORS.text }}>候选人 Pipeline</h2>
        <div className="flex gap-2">
          <button onClick={refresh} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md ui-body" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.text }}><RefreshCw size={14} />刷新</button>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}><Plus size={14} />模拟收到简历</button>
        </div>
      </div>
      {loading ? <Spinner /> : <PipelineBoard resumes={resumes} positions={positions} onOpen={onOpen} />}
      {showModal && <NewResumeModal positions={positions} onClose={() => setShowModal(false)} onSubmit={submitResume} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resume 详情抽屉 —— 所有真实API交互最密集的地方
// ---------------------------------------------------------------------------
function ResumeDrawer({ resumeId, position, api, showToast, onClose, onChanged, currentUser }) {
  const [resume, setResume] = useState(null);
  const [score, setScore] = useState(null);
  const [scoreLoading, setScoreLoading] = useState(true);
  const [interviews, setInterviews] = useState([]);
  const [questions, setQuestions] = useState(null);
  const [offer, setOffer] = useState(null);
  const [confirmStatus, setConfirmStatus] = useState(null);
  const [busy, setBusy] = useState({});
  const [showFbForm, setShowFbForm] = useState(false);
  const [fbForm, setFbForm] = useState({ correctJudgement: '适合', reason: '' });
  const [interviewerEmail, setInterviewerEmail] = useState('');
  const [needNext, setNeedNext] = useState(false);
  const [offerForm, setOfferForm] = useState({ salary: '', hr: '', leader: '', coo: '' });

  const setBusyFlag = (k, v) => setBusy((prev) => ({ ...prev, [k]: v }));

  const loadAll = useCallback(async () => {
    try {
      const r = await api.getResume(resumeId);
      setResume(r);
      const iv = await api.getResumeInterviews(resumeId);
      setInterviews(iv);
      if (r.stage === 'offer' || (r.stage === 'done' && !r.rejectedReason)) {
        try {
          const o = await api.getOfferByResume(resumeId);
          setOffer(o);
          if (o) setConfirmStatus(await api.getConfirmationStatus(o.id));
        } catch (e) { /* 还没有offer，忽略 */ }
      }
    } catch (e) {
      showToast('加载失败：' + e.message, 'error');
    }
    setScoreLoading(true);
    try {
      setScore(await api.getScore(resumeId));
    } catch (e) {
      setScore(null);
    } finally {
      setScoreLoading(false);
    }
  }, [resumeId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const currentInterview = interviews[0]; // 后端按createdAt倒序返回，第一条就是最新一轮

  const doScheduleHR = async () => {
    setBusyFlag('schedule', true);
    try { await api.scheduleHRInterview(resumeId); showToast('HR面试已安排', 'success'); await loadAll(); onChanged(); }
    catch (e) { showToast('操作失败：' + e.message, 'error'); }
    finally { setBusyFlag('schedule', false); }
  };

  const doReject = async () => {
    try { await api.rejectResume(resumeId, 'HR复核后判断不适合'); showToast('已淘汰', 'success'); await loadAll(); onChanged(); }
    catch (e) { showToast('操作失败：' + e.message, 'error'); }
  };

  const doFeedback = async (isAccurate) => {
    if (!score) return;
    try {
      await api.submitFeedback(score.id, { hrUserId: currentUser?.email || 'unknown', isAccurate, ...(isAccurate ? {} : { correctJudgement: fbForm.correctJudgement, feedbackReason: fbForm.reason }) });
      showToast('反馈已提交', 'success');
      setShowFbForm(false);
    } catch (e) { showToast('提交失败：' + e.message, 'error'); }
  };

  const doQuestions = async () => {
    if (!currentInterview) { showToast('还没有面试记录，先安排HR面试', 'error'); return; }
    setBusyFlag('questions', true);
    try {
      const record = await api.getQuestionSuggestions(currentInterview.id);
      setQuestions(record.questions);
    }
    catch (e) { showToast('生成失败：' + e.message, 'error'); }
    finally { setBusyFlag('questions', false); }
  };

  const doHRResult = async (passed) => {
    try {
      await api.recordInterviewResult(currentInterview.id, { result: passed ? 'pass' : 'fail' });
      showToast(passed ? 'HR面试通过' : '已标记未通过', 'success');
      await loadAll(); onChanged();
    } catch (e) { showToast('操作失败：' + e.message, 'error'); }
  };

  const doPush = async () => {
    if (!interviewerEmail.trim()) { showToast('先填业务面试官的邮箱', 'error'); return; }
    setBusyFlag('push', true);
    try {
      await api.pushToBusiness(currentInterview.id, interviewerEmail.trim());
      showToast('已推送给业务面试官', 'success');
      await loadAll(); onChanged();
    } catch (e) { showToast('推送失败：' + e.message, 'error'); }
    finally { setBusyFlag('push', false); }
  };

  const doBusinessResult = async (passed) => {
    try {
      await api.recordInterviewResult(currentInterview.id, { result: passed ? 'pass' : 'fail', needSecondRound: needNext });
      showToast(passed ? '已登记通过' : '已标记未通过', 'success');
      await loadAll(); onChanged();
    } catch (e) { showToast('操作失败：' + e.message, 'error'); }
  };

  const doCreateOffer = async () => {
    if (!offerForm.salary || !offerForm.hr || !offerForm.leader || !offerForm.coo) { showToast('薪资和三方确认人邮箱都要填', 'error'); return; }
    setBusyFlag('offer-create', true);
    try {
      await api.createOffer({
        resumeId, candidateId: resume.candidateId, positionId: resume.positionId, salaryFinal: offerForm.salary,
        confirmers: [
          { confirmerId: offerForm.hr, confirmerRole: 'hr' },
          { confirmerId: offerForm.leader, confirmerRole: 'business_leader' },
          { confirmerId: offerForm.coo, confirmerRole: 'coo' },
        ],
      });
      showToast('Offer已创建，可以开始三方确认', 'success');
      await loadAll();
    } catch (e) { showToast('创建失败：' + e.message, 'error'); }
    finally { setBusyFlag('offer-create', false); }
  };

  const doConfirm = async (confirmerId) => {
    try {
      await api.confirmOffer(offer.id, confirmerId);
      setConfirmStatus(await api.getConfirmationStatus(offer.id));
      showToast('已确认', 'success');
    } catch (e) { showToast('确认失败：' + e.message, 'error'); }
  };

  const doGenerateEmail = async () => {
    setBusyFlag('offer-email', true);
    try { setOffer(await api.generateOfferEmail(offer.id)); showToast('邮件已生成', 'success'); }
    catch (e) { showToast('生成失败（多半是后端还没配DEEPSEEK_API_KEY）：' + e.message, 'error'); }
    finally { setBusyFlag('offer-email', false); }
  };

  const doSendEmail = async () => {
    try { await api.sendOfferEmail(offer.id); showToast('Offer邮件已发送', 'success'); await loadAll(); onChanged(); }
    catch (e) { showToast('发送失败：' + e.message, 'error'); }
  };

  if (!resume) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,26,32,0.45)' }} onClick={onClose}>
        <div className="h-full w-full sm:w-[460px] flex items-center justify-center" style={{ background: COLORS.paper }} onClick={(e) => e.stopPropagation()}>
          <Spinner />
        </div>
      </div>
    );
  }

  const allConfirmed = confirmStatus && confirmStatus.confirmedCount === confirmStatus.total;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,26,32,0.45)' }} onClick={onClose}>
      <div className="h-full overflow-y-auto w-full sm:w-[460px]" style={{ background: COLORS.paper }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5" style={{ background: COLORS.ink }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="ui-display text-xl" style={{ color: '#fff' }}>{resume.candidate?.name}</div>
              <div className="ui-body text-sm" style={{ color: '#B7C2CC' }}>{position?.title}</div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10"><X size={20} color="#fff" /></button>
          </div>
          <div className="mt-3"><Badge text={STAGE_META[resume.stage]?.label || resume.stage} color={COLORS.ink} bg={COLORS.amberSoft} /></div>
        </div>

        <div className="p-5 flex flex-col gap-5">
          <Section title="简历摘要">
            <p className="ui-body text-sm leading-relaxed" style={{ color: COLORS.text }}>{resume.rawText}</p>
          </Section>

          {scoreLoading ? <Spinner label="加载评分中…" /> : score ? (
            <Section title="AI评分">
              <div className="flex items-center gap-4">
                <ScoreRing score={score.score} size={64} />
                <div className="flex-1 grid grid-cols-1 gap-1">
                  {Object.entries(score.dimensionScores || {}).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="ui-body text-xs w-24" style={{ color: COLORS.textMuted }}>{k}</span>
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: COLORS.line }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${v}%`, background: COLORS.amber }} />
                      </div>
                      <span className="ui-mono text-xs" style={{ color: COLORS.textMuted }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="ui-body text-sm mt-2" style={{ color: COLORS.textMuted }}>{score.aiReasoning}</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => doFeedback(true)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md ui-body" style={{ background: COLORS.tealSoft, color: COLORS.teal }}><ThumbsUp size={14} />评分准确</button>
                <button onClick={() => setShowFbForm(true)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md ui-body" style={{ background: COLORS.brickSoft, color: COLORS.brick }}><ThumbsDown size={14} />评分不准确</button>
              </div>
              {showFbForm && (
                <div className="mt-3 p-3 rounded-md" style={{ background: '#fff', border: `1px solid ${COLORS.line}` }}>
                  <select value={fbForm.correctJudgement} onChange={(e) => setFbForm({ ...fbForm, correctJudgement: e.target.value })} className="ui-body text-sm border rounded px-2 py-1 mb-2 w-full" style={inputStyle}>
                    <option value="适合">正确判断：适合，应安排面试</option>
                    <option value="不适合">正确判断：不适合，不应安排面试</option>
                  </select>
                  <textarea placeholder="反馈原因" value={fbForm.reason} onChange={(e) => setFbForm({ ...fbForm, reason: e.target.value })} className="w-full ui-body text-sm border rounded px-2 py-1 mb-2" style={inputStyle} rows={2} />
                  <button onClick={() => doFeedback(false)} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>提交反馈</button>
                </div>
              )}
            </Section>
          ) : (
            <Section title="AI评分">
              <div className="ui-body text-sm" style={{ color: COLORS.textMuted }}>还没有评分记录（可能AI评分还在进行中，或后端未配置DEEPSEEK_API_KEY导致失败——点右上角刷新按钮再看看）</div>
            </Section>
          )}

          {currentInterview && (
            <Section title="AI面试问题建议">
              {!questions ? (
                <button onClick={doQuestions} disabled={busy.questions} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>
                  {busy.questions ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}生成面试问题建议
                </button>
              ) : (
                <div className="flex flex-col gap-3">
                  {questions.map((group) => (
                    <div key={group.category}>
                      <div className="ui-mono text-xs mb-1" style={{ color: COLORS.textMuted }}>{group.category}</div>
                      <ul className="list-disc list-inside ui-body text-sm" style={{ color: COLORS.text }}>{group.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section title="流程操作">
            {resume.stage === 'new' && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={doScheduleHR} disabled={busy.schedule} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>安排HR面试</button>
                <button onClick={doReject} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ background: COLORS.brickSoft, color: COLORS.brick }}>淘汰候选人</button>
              </div>
            )}
            {resume.stage === 'hr_interview' && currentInterview && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => doHRResult(true)} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.teal }}>面试通过</button>
                <button onClick={() => doHRResult(false)} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ background: COLORS.brickSoft, color: COLORS.brick }}>未通过</button>
              </div>
            )}
            {resume.stage === 'business_pending' && currentInterview && !currentInterview.interviewerId && (
              <div className="flex flex-col gap-2">
                <input placeholder="业务面试官的登录邮箱" value={interviewerEmail} onChange={(e) => setInterviewerEmail(e.target.value)} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
                <button onClick={doPush} disabled={busy.push} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>推送给业务面试官</button>
              </div>
            )}
            {resume.stage === 'business_pending' && currentInterview?.interviewerId && (
              <div className="ui-body text-sm" style={{ color: COLORS.textMuted }}>已推送给 {currentInterview.interviewerId}，等待其在「业务面试官」视角响应</div>
            )}
            {(resume.stage === 'business_1st' || resume.stage === 'business_2nd' || resume.stage === 'final') && currentInterview && (
              <div className="ui-body text-sm" style={{ color: COLORS.textMuted }}>
                当前是 {ROUND_LABEL[currentInterview.roundType]}，可切换到「业务面试官」视角登记结果（或直接在此处理，二者共享后端权限）：
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {resume.stage === 'business_1st' && (
                    <label className="flex items-center gap-1"><input type="checkbox" checked={needNext} onChange={(e) => setNeedNext(e.target.checked)} />需要二面</label>
                  )}
                  <button onClick={() => doBusinessResult(true)} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.teal }}>登记通过</button>
                  <button onClick={() => doBusinessResult(false)} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ background: COLORS.brickSoft, color: COLORS.brick }}>登记未通过</button>
                </div>
              </div>
            )}
            {resume.stage === 'offer' && !offer && (
              <div className="flex flex-col gap-2">
                <input placeholder="定薪，例如 30K × 14薪" value={offerForm.salary} onChange={(e) => setOfferForm({ ...offerForm, salary: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
                <input placeholder="HR确认人邮箱" value={offerForm.hr} onChange={(e) => setOfferForm({ ...offerForm, hr: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
                <input placeholder="业务leader确认人邮箱" value={offerForm.leader} onChange={(e) => setOfferForm({ ...offerForm, leader: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
                <input placeholder="COO确认人邮箱" value={offerForm.coo} onChange={(e) => setOfferForm({ ...offerForm, coo: e.target.value })} className="ui-body text-sm border rounded px-2 py-1.5" style={inputStyle} />
                <button onClick={doCreateOffer} disabled={busy['offer-create']} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>创建Offer并发起三方确认</button>
              </div>
            )}
            {offer && (
              <div className="flex flex-col gap-3">
                <div className="ui-body text-sm" style={{ color: COLORS.text }}>定薪：<b>{offer.salaryFinal}</b></div>
                <div className="ui-mono text-xs" style={{ color: COLORS.textMuted }}>模拟飞书群消息确认（真实接入飞书后，这几个按钮的效果会由对方在飞书卡片里点击触发）</div>
                {confirmStatus && (
                  <div className="flex flex-col gap-1.5">
                    {confirmStatus.confirmations.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 ui-body text-sm" style={{ color: COLORS.text }}>
                        <input type="checkbox" checked={c.confirmed} disabled={c.confirmed} onChange={() => doConfirm(c.confirmerId)} />
                        {c.confirmerRole}（{c.confirmerId}） {c.confirmed ? <CheckCircle2 size={14} color={COLORS.teal} /> : <Clock size={14} color={COLORS.textMuted} />}
                      </label>
                    ))}
                  </div>
                )}
                {allConfirmed && !offer.emailDraft && (
                  <button onClick={doGenerateEmail} disabled={busy['offer-email']} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>
                    {busy['offer-email'] ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}三方已确认，生成Offer邮件
                  </button>
                )}
                {offer.emailDraft && offer.status !== 'sent' && (
                  <div className="p-3 rounded-md" style={{ background: '#fff', border: `1px solid ${COLORS.line}` }}>
                    <div className="ui-mono text-xs mb-1" style={{ color: COLORS.textMuted }}>邮件预览</div>
                    <pre className="ui-body text-sm whitespace-pre-wrap" style={{ color: COLORS.text }}>{offer.emailDraft}</pre>
                    <button onClick={doSendEmail} className="mt-2 flex items-center gap-1 text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.teal }}><Send size={14} />发送Offer邮件</button>
                  </div>
                )}
                {offer.status === 'sent' && <div className="ui-body text-sm" style={{ color: COLORS.teal }}>Offer邮件已发送 ✓</div>}
              </div>
            )}
            {resume.stage === 'done' && resume.rejectedReason && (
              <div className="ui-body text-sm" style={{ color: COLORS.textMuted }}>已淘汰：{resume.rejectedReason}</div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 用人部门视角
// ---------------------------------------------------------------------------
function DeptView({ positions, resumes, loading, api, showToast, refresh }) {
  const [showForm, setShowForm] = useState(false);
  const create = async (form) => {
    try {
      await api.createPosition({ ...form, headcount: Number(form.headcount) || 1, salaryMin: form.salaryMin ? Number(form.salaryMin) : undefined, salaryMax: form.salaryMax ? Number(form.salaryMax) : undefined });
      showToast('职位需求已提交', 'success');
      setShowForm(false); refresh();
    } catch (e) { showToast('提交失败：' + e.message, 'error'); }
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="ui-display text-xl" style={{ color: COLORS.text }}>我的招聘需求</h2>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}><Plus size={14} />提交招聘需求</button>
      </div>
      {loading ? <Spinner /> : (
        <div className="flex flex-col gap-3">
          {positions.map((p) => {
            const list = resumes.filter((r) => r.positionId === p.id);
            const counts = COLUMNS.map((c) => ({ c, n: list.filter((r) => r.stage === c).length })).filter((x) => x.n > 0);
            return (
              <div key={p.id} className="rounded-lg p-4" style={{ background: '#fff', border: `1px solid ${COLORS.line}` }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="ui-display text-lg" style={{ color: COLORS.text }}>{p.title}</div>
                  <Badge text={`候选人 ${list.length}`} color={COLORS.ink} bg={COLORS.amberSoft} />
                </div>
                <div className="ui-body text-xs mt-1" style={{ color: COLORS.textMuted }}>{p.department} · {p.jdStatus === 'published' ? 'JD已发布' : 'JD待生成'}</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {counts.map((s) => <span key={s.c} className="ui-mono text-xs px-2 py-1 rounded-full" style={{ background: COLORS.paper, color: COLORS.textMuted }}>{STAGE_META[s.c].label} · {s.n}</span>)}
                  {counts.length === 0 && <span className="ui-body text-xs" style={{ color: COLORS.textMuted }}>暂无候选人</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showForm && <PositionFormModal onClose={() => setShowForm(false)} onSubmit={create} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 业务面试官视角
// ---------------------------------------------------------------------------
function InterviewerView({ currentUser, positions, api, showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.getInterviewerInterviews(currentUser.email);
      // HR轮次的面试记录里interviewerId字段只是"推送给谁"的历史痕迹，不需要展示给面试官
      setItems(all.filter((i) => i.roundType !== 'hr'));
    }
    catch (e) { showToast('加载失败：' + e.message, 'error'); }
    finally { setLoading(false); }
  }, [currentUser.email]);

  useEffect(() => { load(); }, [load]);

  const [respondedIds, setRespondedIds] = useState(new Set());

  const respond = async (interview, willing) => {
    try {
      await api.interviewerRespond({ interviewId: interview.id, interviewerId: currentUser.email, willingToInterview: willing, availableSlots: willing ? ['本周内'] : [] });
      setRespondedIds((prev) => new Set([...prev, interview.id]));
      showToast(willing ? '已确认可以面试' : '已回复暂不安排', 'success');
      load();
    } catch (e) { showToast('操作失败：' + e.message, 'error'); }
  };

  const recordResult = async (interview, passed) => {
    try {
      await api.recordInterviewResult(interview.id, { result: passed ? 'pass' : 'fail' });
      showToast('已登记结果', 'success');
      load();
    } catch (e) { showToast('操作失败：' + e.message, 'error'); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="ui-display text-xl mb-1" style={{ color: COLORS.text }}>推送给我的候选人</h2>
        <p className="ui-mono text-xs mb-3" style={{ color: COLORS.textMuted }}>登录邮箱：{currentUser.email}（真实接入飞书后，这里会自动用你的飞书身份识别，不需要邮箱）</p>
        <div className="flex flex-col gap-3">
          {items.length === 0 && <EmptyHint text="暂无推送给你的候选人" />}
          {items.map((iv) => {
            const p = positions.find((pp) => pp.id === iv.positionId);
            const alreadyResponded = respondedIds.has(iv.id) || iv.status === 'completed' || !!iv.result;
            return (
              <div key={iv.id} className="rounded-lg p-4" style={{ background: '#fff', border: `1px solid ${COLORS.line}` }}>
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquareText size={16} color={COLORS.amber} />
                  <span className="ui-mono text-xs" style={{ color: COLORS.textMuted }}>{ROUND_LABEL[iv.roundType]} · {p?.title}</span>
                </div>
                <div className="ui-body text-sm" style={{ color: COLORS.textMuted }}>状态：{iv.status}{iv.result ? ` · 结果：${iv.result}` : ''}</div>
                {!alreadyResponded && iv.roundType === 'business_1st' && !iv.scheduledTime && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => respond(iv, true)} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.ink }}>同意面试</button>
                    <button onClick={() => respond(iv, false)} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ background: COLORS.brickSoft, color: COLORS.brick }}>暂不安排</button>
                  </div>
                )}
                {!iv.result && iv.status === 'scheduled' && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => recordResult(iv, true)} className="text-sm px-3 py-1.5 rounded-md text-white ui-body" style={{ background: COLORS.teal }}>登记通过</button>
                    <button onClick={() => recordResult(iv, false)} className="text-sm px-3 py-1.5 rounded-md ui-body" style={{ background: COLORS.brickSoft, color: COLORS.brick }}>登记未通过</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App Root
// ---------------------------------------------------------------------------
export default function App() {
  const [authState, setAuthState] = useState(null); // {backendUrl, token, user} | null
  const [authLoaded, setAuthLoaded] = useState(false);
  const [role, setRole] = useState('hr');
  const [hrTab, setHrTab] = useState('positions');
  const [positions, setPositions] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [loadingResumes, setLoadingResumes] = useState(true);
  const [selectedResumeId, setSelectedResumeId] = useState(null);
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = (text, type = 'info') => { setToast({ text, type }); setTimeout(() => setToast(null), 4000); };
  const setBusyFlag = (k, v) => setBusy((prev) => ({ ...prev, [k]: v }));

  // 恢复登录态
  useEffect(() => {
    const saved = loadAuthFromStorage();
    if (saved) {
      setAuthState(saved);
      setRole(saved.user.role === 'admin' ? 'hr' : saved.user.role);
    }
    setAuthLoaded(true);
  }, []);

  const api = authState ? createApiClient(authState.backendUrl, authState.token) : null;

  const refreshPositions = useCallback(async () => {
    if (!api) return;
    setLoadingPositions(true);
    try { setPositions(await api.listPositions()); }
    catch (e) { showToast('加载职位失败：' + e.message, 'error'); }
    finally { setLoadingPositions(false); }
  }, [api]);

  const refreshResumes = useCallback(async () => {
    if (!api) return;
    setLoadingResumes(true);
    try { setResumes(await api.listResumes()); }
    catch (e) { showToast('加载候选人失败：' + e.message, 'error'); }
    finally { setLoadingResumes(false); }
  }, [api]);

  useEffect(() => {
    if (authState) { refreshPositions(); refreshResumes(); }
  }, [authState]);

  const handleLoggedIn = (backendUrl, token, user) => {
    const state = { backendUrl, token, user };
    setAuthState(state);
    setRole(user.role === 'admin' ? 'hr' : user.role);
    saveAuthToStorage(state);
  };

  const handleLogout = () => {
    setAuthState(null);
    clearAuthFromStorage();
  };

  if (!authLoaded) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.ink }}><Loader2 className="animate-spin" color="#fff" /></div>;
  }

  if (!authState) {
    return <LoginScreen savedBackendUrl="" onLoggedIn={handleLoggedIn} showToast={showToast} />;
  }

  const { user } = authState;

  return (
    <div className="min-h-screen ui-body" style={{ background: COLORS.paper }}>
      <style>{FONT_STYLE}</style>
      <div className="flex">
        <aside className="flex-shrink-0 hidden md:flex flex-col" style={{ width: 220, background: COLORS.ink, minHeight: '100vh' }}>
          <div className="p-5">
            <div className="ui-display text-lg" style={{ color: '#fff' }}>纳贤 · NaXian</div>
            <div className="ui-mono text-xs mt-0.5" style={{ color: '#8B96A1' }}>{user.name} · {user.role}</div>
          </div>
          <div className="px-3 flex flex-col gap-1 mt-2">
            {(user.role === 'hr' || user.role === 'admin') && (
              <>
                {[['positions', '职位管理', FileText], ['pipeline', '候选人Pipeline', Users], ['offers', 'Offer管理', Mail]].map(([key, label, Icon]) => (
                  <button key={key} onClick={() => { setRole('hr'); setHrTab(key); }} className="flex items-center gap-2 px-3 py-2 rounded-md text-left ui-body text-sm"
                    style={{ background: role === 'hr' && hrTab === key ? COLORS.amber : 'transparent', color: role === 'hr' && hrTab === key ? COLORS.ink : '#9AA5AF' }}>
                    <Icon size={16} />{label}
                  </button>
                ))}
              </>
            )}
            {user.role === 'dept' && (
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left ui-body text-sm" style={{ background: COLORS.amber, color: COLORS.ink }}><Building2 size={16} />我的招聘需求</button>
            )}
            {user.role === 'interviewer' && (
              <button className="flex items-center gap-2 px-3 py-2 rounded-md text-left ui-body text-sm" style={{ background: COLORS.amber, color: COLORS.ink }}><UserCheck size={16} />推送给我的候选人</button>
            )}
          </div>
          <div className="mt-auto p-4">
            <button onClick={handleLogout} className="flex items-center gap-2 ui-body text-sm" style={{ color: '#9AA5AF' }}><LogOut size={14} />退出登录</button>
          </div>
        </aside>

        <main className="flex-1 p-6 md:p-8 max-w-5xl">
          <div className="flex md:hidden items-center justify-between mb-4">
            <span className="ui-display text-lg" style={{ color: COLORS.text }}>{user.name} · {user.role}</span>
            <button onClick={handleLogout} className="ui-mono text-xs" style={{ color: COLORS.textMuted }}>退出</button>
          </div>

          {(user.role === 'hr' || user.role === 'admin') && (
            <>
              <div className="flex md:hidden gap-2 mb-4 overflow-x-auto">
                {[['positions', '职位'], ['pipeline', 'Pipeline'], ['offers', 'Offer']].map(([key, label]) => (
                  <button key={key} onClick={() => setHrTab(key)} className="ui-mono text-xs px-3 py-1 rounded-full flex-shrink-0"
                    style={{ background: hrTab === key ? COLORS.amber : '#fff', color: hrTab === key ? COLORS.ink : COLORS.textMuted, border: `1px solid ${COLORS.line}` }}>{label}</button>
                ))}
              </div>
              {hrTab === 'positions' && <PositionsView positions={positions} loading={loadingPositions} busy={busy} setBusyFlag={setBusyFlag} api={api} showToast={showToast} refresh={refreshPositions} />}
              {hrTab === 'pipeline' && <PipelineView resumes={resumes} positions={positions} loading={loadingResumes} api={api} showToast={showToast} refresh={refreshResumes} onOpen={setSelectedResumeId} />}
              {hrTab === 'offers' && (
                <div className="flex flex-col gap-4">
                  <h2 className="ui-display text-xl" style={{ color: COLORS.text }}>Offer 管理</h2>
                  <p className="ui-body text-sm" style={{ color: COLORS.textMuted }}>处于Offer阶段的候选人也能在候选人Pipeline里直接点开操作；这里列出所有在途/已完成的：</p>
                  <div className="flex flex-col gap-3">
                    {resumes.filter((r) => r.stage === 'offer' || r.stage === 'done').length === 0 && <EmptyHint text="暂无处于Offer阶段的候选人" />}
                    {resumes.filter((r) => r.stage === 'offer' || r.stage === 'done').map((r) => (
                      <button key={r.id} onClick={() => setSelectedResumeId(r.id)} className="text-left rounded-lg p-4 hover:shadow-md transition-shadow" style={{ background: '#fff', border: `1px solid ${COLORS.line}` }}>
                        <div className="flex items-center justify-between">
                          <div className="ui-display text-lg" style={{ color: COLORS.text }}>{r.candidate?.name}</div>
                          <Badge text={STAGE_META[r.stage].label} color={COLORS.ink} bg={COLORS.amberSoft} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {user.role === 'dept' && <DeptView positions={positions} resumes={resumes} loading={loadingPositions || loadingResumes} api={api} showToast={showToast} refresh={refreshPositions} />}
          {user.role === 'interviewer' && <InterviewerView currentUser={user} positions={positions} api={api} showToast={showToast} />}
        </main>
      </div>

      {selectedResumeId && (
        <ResumeDrawer
          resumeId={selectedResumeId}
          position={positions.find((p) => p.id === resumes.find((r) => r.id === selectedResumeId)?.positionId)}
          api={api} showToast={showToast} currentUser={user}
          onClose={() => setSelectedResumeId(null)}
          onChanged={refreshResumes}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 ui-body text-sm px-4 py-2 rounded-full shadow-lg max-w-md text-center" style={{ background: toast.type === 'error' ? COLORS.brick : COLORS.ink, color: '#fff' }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
