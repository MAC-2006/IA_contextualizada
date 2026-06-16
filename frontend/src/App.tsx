import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Send, BrainCircuit, Sun, Moon, Menu, X,
  Scale, BookOpen, Stethoscope, ChevronRight, Loader2,
  ArrowLeft, CheckCircle2, FileText, Trash2, LogOut, Plus,
  User, MapPin, Building2, Sparkles, Search, AlertCircle,
  Eye, EyeOff, ShieldCheck, KeyRound, Copy, Check,
} from 'lucide-react';
import axios from 'axios';

// ─── Axios defaults ───────────────────────────────────────────────────────────
// withCredentials = true é OBRIGATÓRIO para que o browser envie/receba
// cookies httpOnly entre o frontend (localhost:5173) e o backend (localhost:8000).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  withCredentials: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen =
  | 'login'
  | 'register'
  | 'twofa_challenge'     // tela de input do código TOTP pós-login
  | 'twofa_recovery'      // usar código de recuperação
  | 'onboarding_identity'
  | 'onboarding_prof'
  | 'onboarding_sub'
  | 'onboarding_context'
  | 'onboarding_auto_index'
  | 'onboarding_upload'
  | 'twofa_setup'         // setup opcional de 2FA após onboarding
  | 'chat';

type ProfessionKey = 'Advogado' | 'Médico' | 'Professor' | 'Outro';

interface SubArea { id: string; label: string; desc: string; }
interface Message { role: 'user' | 'assistant'; content: string; }
interface UploadedFile { name: string; size: number; status: 'pending' | 'done' | 'error'; }

interface UserProfile {
  // from backend /auth/me
  id?: string;
  email: string;
  full_name?: string;
  preferred_name?: string;
  avatar_url?: string;
  totp_enabled?: boolean;
  email_verified?: boolean;
  onboarding_completed?: boolean;
  // local onboarding extras (not persisted in this MVP)
  profession: ProfessionKey | null;
  customProfession: string;
  customProfessionDesc: string;
  subArea: SubArea | null;
  city: string;
  state: string;
  organization: string;
  materia: string;
  nivel: string;
  // form fields (not stored in profile after submit)
  password?: string;
}

// ─── Password strength ────────────────────────────────────────────────────────

interface StrengthRule { label: string; test: (p: string) => boolean; }
const STRENGTH_RULES: StrengthRule[] = [
  { label: 'Mínimo 10 caracteres',         test: p => p.length >= 10 },
  { label: 'Letra minúscula',              test: p => /[a-z]/.test(p) },
  { label: 'Letra maiúscula',              test: p => /[A-Z]/.test(p) },
  { label: 'Número',                       test: p => /\d/.test(p) },
  { label: 'Caractere especial (!@#...)',  test: p => /[^A-Za-z0-9]/.test(p) },
];
function strengthScore(p: string) { return STRENGTH_RULES.filter(r => r.test(p)).length; }
function strengthLabel(score: number) {
  if (score <= 2) return { label: 'Fraca', color: 'bg-red-500' };
  if (score <= 3) return { label: 'Razoável', color: 'bg-yellow-500' };
  if (score <= 4) return { label: 'Boa', color: 'bg-blue-500' };
  return { label: 'Forte', color: 'bg-emerald-500' };
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const PROFESSIONS: { key: ProfessionKey; icon: React.ReactNode; desc: string }[] = [
  { key: 'Advogado',  icon: <Scale size={22} />,       desc: 'Escritório, tribunal, consultivo' },
  { key: 'Médico',    icon: <Stethoscope size={22} />, desc: 'Clínica, hospital, consultório' },
  { key: 'Professor', icon: <BookOpen size={22} />,    desc: 'Escola, faculdade, cursinho' },
  { key: 'Outro',     icon: <Sparkles size={22} />,    desc: 'Descreva sua área de atuação' },
];

const SUB_AREAS: Record<string, SubArea[]> = {
  Advogado: [
    { id: 'civel', label: 'Direito Cível',      desc: 'Contratos, indenizações, família' },
    { id: 'penal', label: 'Direito Penal',       desc: 'Processo penal, crimes, defesa' },
    { id: 'trab',  label: 'Direito Trabalhista', desc: 'CLT, reclamações, acordos' },
    { id: 'emp',   label: 'Direito Empresarial', desc: 'Societário, contratos comerciais' },
    { id: 'trib',  label: 'Direito Tributário',  desc: 'Impostos, planejamento fiscal' },
    { id: 'pub',   label: 'Direito Público',     desc: 'Administrativo, licitações' },
  ],
  Médico: [
    { id: 'clinica',   label: 'Clínica Geral', desc: 'Atenção primária, prontuários' },
    { id: 'cirurgia',  label: 'Cirurgia',       desc: 'Protocolos cirúrgicos, pós-op' },
    { id: 'pediatria', label: 'Pediatria',      desc: 'Saúde infantil, crescimento' },
    { id: 'psiq',      label: 'Psiquiatria',    desc: 'DSM, medicamentos, laudos' },
    { id: 'cardio',    label: 'Cardiologia',    desc: 'ECG, protocolos cardíacos' },
    { id: 'gineco',    label: 'Ginecologia',    desc: 'Saúde da mulher, obstetrícia' },
  ],
  Professor: [
    { id: 'pub',    label: 'Rede Pública',    desc: 'Estado/Município, BNCC, SARESP' },
    { id: 'priv',   label: 'Rede Privada',    desc: 'Apostilados, projetos pedagógicos' },
    { id: 'sup',    label: 'Ensino Superior', desc: 'Faculdades, pós-graduação' },
    { id: 'idiomas',label: 'Idiomas',         desc: 'Inglês, espanhol, outros' },
    { id: 'tecnico',label: 'Técnico/Profiss.',desc: 'SENAI, SENAC, cursos técnicos' },
  ],
  Outro: [],
};

const STATES_BR = [
  'Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Distrito Federal',
  'Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul',
  'Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí',
  'Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia',
  'Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins',
];

const PROF_PLACEHOLDERS: Record<string, string> = {
  Advogado:  'Ex: Resuma esta petição, analise a jurisprudência...',
  Médico:    'Ex: Resuma este prontuário, liste diagnósticos...',
  Professor: 'Ex: Crie um plano de aula com base neste material...',
  Outro:     'Pergunte qualquer coisa sobre seus documentos...',
};

const AUTO_INDEX_STEPS: Record<string, string[]> = {
  Advogado: [
    'Conectando ao banco de legislação federal...',
    'Baixando jurisprudência do STJ e STF...',
    'Indexando código civil e código de processo civil...',
    'Carregando doutrina da área selecionada...',
    'Base pública indexada com sucesso ✓',
  ],
  Médico: [
    'Conectando a bases DATASUS e CFM...',
    'Baixando protocolos clínicos do Ministério da Saúde...',
    'Indexando CID-11 e tabelas de procedimentos...',
    'Carregando diretrizes da especialidade...',
    'Base pública indexada com sucesso ✓',
  ],
  Professor: [
    'Conectando ao portal MEC e INEP...',
    'Baixando BNCC e diretrizes curriculares...',
    'Indexando cadernos pedagógicos da rede...',
    'Carregando materiais da matéria selecionada...',
    'Base pública indexada com sucesso ✓',
  ],
  Outro: [
    'Mapeando domínio de conhecimento...',
    'Buscando fontes abertas relevantes...',
    'Indexando conteúdo base...',
    'Base personalizada indexada com sucesso ✓',
  ],
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function buildCollectionName(profile: UserProfile): string {
  const prof = (profile.profession === 'Outro'
    ? profile.customProfession
    : profile.profession ?? 'geral'
  ).toLowerCase().replace(/\s+/g, '_');
  const sub = profile.subArea?.id ?? 'geral';
  const st  = profile.state.toLowerCase().replace(/\s+/g, '_') || 'br';
  const base = `${prof}_${sub}_${st}`;
  if (profile.profession === 'Professor' && profile.materia)
    return `${base}_${profile.materia.toLowerCase().replace(/\s+/g, '_')}`;
  return base;
}

const emptyProfile = (): UserProfile => ({
  email: '', profession: null, customProfession: '', customProfessionDesc: '',
  subArea: null, city: '', state: '', organization: '', materia: '', nivel: '',
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]     = useState<Screen>('login');
  const [profile, setProfile]   = useState<UserProfile>(emptyProfile());

  // auth form state
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // 2FA challenge
  const [challengeToken, setChallengeToken] = useState('');
  const [totpCode, setTotpCode]     = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  // 2FA setup
  const [setupSecret, setSetupSecret]   = useState('');
  const [setupQR, setSetupQR]           = useState('');
  const [setupCode, setSetupCode]       = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode]     = useState<string | null>(null);
  const [setupStep, setSetupStep]       = useState<'qr' | 'codes'>('qr');

  // chat & files
  const [uploadedFiles, setUploadedFiles]   = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading]       = useState(false);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [input, setInput]                   = useState('');
  const [isSending, setIsSending]           = useState(false);
  const [isDark, setIsDark]                 = useState(true);
  const [sidebarOpen, setSidebarOpen]       = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // auto-indexer
  const [autoIndexStep, setAutoIndexStep]   = useState(0);
  const [autoIndexDone, setAutoIndexDone]   = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // On mount: try to restore session from httpOnly cookie
  useEffect(() => {
    api.get('/auth/me').then(res => {
      setProfile(p => ({ ...p, ...res.data }));
      if (res.data.onboarding_completed) setScreen('chat');
      else setScreen('onboarding_identity');
    }).catch(() => {
      // Not authenticated — stay on login
    });
  }, []);

  // Auto-indexer animation
  useEffect(() => {
    if (screen !== 'onboarding_auto_index') return;
    setAutoIndexStep(0);
    setAutoIndexDone(false);
    const steps = AUTO_INDEX_STEPS[profile.profession ?? 'Outro'];
    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      setAutoIndexStep(step);
      if (step >= steps.length - 1) clearInterval(interval);
    }, 900);
    api.post('/onboarding/complete', {
      profession: profile.profession,
      sub_area: profile.subArea?.id,
      state: profile.state,
      collection_name: buildCollectionName(profile),
    }).catch(e => console.warn('[onboarding]', e))
      .finally(() => setTimeout(() => setAutoIndexDone(true), steps.length * 900 + 400));
    return () => clearInterval(interval);
  }, [screen]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const upd = useCallback((patch: Partial<UserProfile>) => {
    setProfile(p => ({ ...p, ...patch }));
  }, []);

  function clearAuthForm() {
    setEmail(''); setPassword(''); setFullName('');
    setAuthError(''); setShowPw(false);
  }

  // ── Auth: Register ────────────────────────────────────────────────────────

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (strengthScore(password) < 5) {
      setAuthError('Crie uma senha mais forte antes de continuar.');
      return;
    }
    setAuthLoading(true); setAuthError('');
    try {
      const res = await api.post('/auth/register', {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      setProfile(p => ({ ...p, ...res.data }));
      clearAuthForm();
      setScreen('onboarding_identity');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') setAuthError(detail);
      else if (detail?.errors) setAuthError(detail.errors.join(' · '));
      else setAuthError('Erro ao criar conta. Tente novamente.');
    } finally {
      setAuthLoading(false);
    }
  }

  // ── Auth: Login ───────────────────────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true); setAuthError('');
    try {
      const res = await api.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      clearAuthForm();
      if (res.data.requires_2fa) {
        setChallengeToken(res.data.challenge_token);
        setScreen('twofa_challenge');
      } else {
        setProfile(p => ({ ...p, ...res.data.user }));
        if (res.data.user?.onboarding_completed) setScreen('chat');
        else setScreen('onboarding_identity');
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.detail ?? 'E-mail ou senha incorretos.');
    } finally {
      setAuthLoading(false);
    }
  }

  // ── Auth: Google OAuth ────────────────────────────────────────────────────
  // Backend faz o Authorization Code flow e redireciona de volta para o
  // frontend. Nada de token no frontend — o backend emite o cookie httpOnly.

  function handleGoogleLogin() {
    window.location.href = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/auth/google/login';
  }

  // Handle redirect back from Google (/auth/callback on the frontend)
  useEffect(() => {
    if (window.location.pathname === '/auth/callback') {
      api.get('/auth/me').then(res => {
        setProfile(p => ({ ...p, ...res.data }));
        window.history.replaceState({}, '', '/');
        if (res.data.onboarding_completed) setScreen('chat');
        else setScreen('onboarding_identity');
      }).catch(() => setScreen('login'));
    }
    // Handle 2FA challenge redirect from Google
    const params = new URLSearchParams(window.location.search);
    const twofa = params.get('twofa_challenge');
    if (twofa) {
      setChallengeToken(twofa);
      window.history.replaceState({}, '', '/');
      setScreen('twofa_challenge');
    }
  }, []);

  // ── Auth: 2FA login ───────────────────────────────────────────────────────

  async function handle2FALogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true); setAuthError('');
    try {
      const res = await api.post('/auth/2fa/login', {
        challenge_token: challengeToken,
        code: totpCode.replace(/\s/g, ''),
      });
      setProfile(p => ({ ...p, ...res.data.user }));
      setTotpCode('');
      if (res.data.user?.onboarding_completed) setScreen('chat');
      else setScreen('onboarding_identity');
    } catch (err: any) {
      setAuthError(err.response?.data?.detail ?? 'Código inválido. Tente novamente.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handle2FARecovery(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true); setAuthError('');
    try {
      const res = await api.post('/auth/2fa/login/recovery', {
        challenge_token: challengeToken,
        recovery_code: recoveryCode.trim().toUpperCase(),
      });
      setProfile(p => ({ ...p, ...res.data.user }));
      setRecoveryCode('');
      if (res.data.user?.onboarding_completed) setScreen('chat');
      else setScreen('onboarding_identity');
    } catch (err: any) {
      setAuthError(err.response?.data?.detail ?? 'Código inválido.');
    } finally {
      setAuthLoading(false);
    }
  }

  // ── 2FA setup ─────────────────────────────────────────────────────────────

  async function initiate2FASetup() {
    setAuthError('');
    try {
      const res = await api.post('/auth/2fa/setup');
      setSetupSecret(res.data.secret);
      setSetupQR(res.data.qr_code_base64);
      setSetupStep('qr');
      setSetupCode('');
      setScreen('twofa_setup');
    } catch (err: any) {
      setAuthError(err.response?.data?.detail ?? 'Erro ao iniciar setup de 2FA.');
    }
  }

  async function handleEnable2FA(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true); setAuthError('');
    try {
      const res = await api.post('/auth/2fa/enable', { code: setupCode.replace(/\s/g, '') });
      setRecoveryCodes(res.data.recovery_codes);
      setSetupStep('codes');
      upd({ totp_enabled: true });
    } catch (err: any) {
      setAuthError(err.response?.data?.detail ?? 'Código inválido.');
    } finally {
      setAuthLoading(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async function handleLogout() {
    await api.post('/auth/logout').catch(() => {});
    setProfile(emptyProfile());
    setMessages([]); setUploadedFiles([]);
    setScreen('login');
  }

  // ── File upload ───────────────────────────────────────────────────────────

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const collection = buildCollectionName(profile);
    const newFiles: UploadedFile[] = Array.from(files).map(f => ({
      name: f.name, size: f.size, status: 'pending',
    }));
    setUploadedFiles(prev => [...prev, ...newFiles]);
    setIsUploading(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fd = new FormData();
      fd.append('file', file);
      fd.append('profession', profile.profession ?? 'Geral');
      fd.append('sub_area', profile.subArea?.id ?? 'geral');
      fd.append('collection_name', collection);
      fd.append('estado', profile.state);
      fd.append('materia', profile.materia);
      fd.append('nivel', profile.nivel);
      try {
        await api.post('/upload', fd);
        setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'done' } : f));
      } catch {
        setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'error' } : f));
      }
    }
    setIsUploading(false);
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsSending(true);
    try {
      const res = await api.post('/chat', {
        question: text,
        collection_name: buildCollectionName(profile),
        profession: profile.profession,
        sub_area: profile.subArea?.id,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.answer ?? 'Sem resposta.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Falha na conexão com o servidor.' }]);
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleFinish() {
    const name = profile.preferred_name || profile.full_name?.split(' ')[0] || 'Profissional';
    const prof = profile.profession === 'Outro' ? profile.customProfession : profile.profession;
    const sub  = profile.subArea?.label ?? '';
    const org  = profile.organization ? ` — ${profile.organization}` : '';
    const docs = uploadedFiles.length > 0
      ? `\n\nVocê adicionou **${uploadedFiles.length} arquivo(s)**. Posso responder com base nesses documentos.`
      : '\n\nNenhum arquivo enviado ainda. Use "Adicionar arquivos" quando quiser.';
    setMessages([{
      role: 'assistant',
      content: `Olá, ${name}! Seu espaço está pronto como **${prof}${sub ? ' · ' + sub : ''}**${org}.\n\nJá indexei bases públicas da sua área de atuação.${docs}`,
    }]);
    setScreen('chat');
  }

  // ─── Theme tokens ─────────────────────────────────────────────────────────

  const bg         = isDark ? 'bg-[#080c14]'   : 'bg-slate-50';
  const text       = isDark ? 'text-slate-100'  : 'text-slate-900';
  const muted      = isDark ? 'text-slate-400'  : 'text-slate-500';
  const card       = isDark ? 'bg-[#0f1623] border-slate-800/80' : 'bg-white border-slate-200';
  const inputCls   = isDark
    ? 'bg-[#0f1623] border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500';
  const selectCls  = inputCls;
  const btnPrimary = 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold rounded-xl transition active:scale-[0.98]';
  const btnGhost   = isDark
    ? 'border border-slate-700 hover:border-slate-500 rounded-xl transition'
    : 'border border-slate-200 hover:border-slate-400 rounded-xl transition';
  const activeCard = isDark
    ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30'
    : 'border-blue-500 bg-blue-50 ring-1 ring-blue-200';
  const msgAssistant = isDark
    ? 'bg-[#161d2e] border border-slate-800 text-slate-200'
    : 'bg-white border border-slate-200 text-slate-700 shadow-sm';

  const STEPS: Screen[] = [
    'onboarding_identity','onboarding_prof','onboarding_sub',
    'onboarding_context','onboarding_auto_index','onboarding_upload',
  ];
  const stepIdx = STEPS.indexOf(screen);

  function ProgressBar() {
    return (
      <div className="flex gap-1 mb-6">
        {STEPS.map((_, i) => (
          <div key={i}
            className={`flex-1 h-1 rounded-full transition-all duration-500 ${
              i <= stepIdx ? 'bg-blue-500' : isDark ? 'bg-slate-800' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
    );
  }

  function BackBtn({ to }: { to: Screen }) {
    return (
      <button onClick={() => setScreen(to)}
        className={`flex items-center gap-1.5 text-xs mb-5 ${muted} hover:text-blue-400 transition`}>
        <ArrowLeft size={13} /> Voltar
      </button>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: LOGIN
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'login') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
            <BrainCircuit size={19} className="text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">ProMind</span>
        </div>

        <h1 className="text-2xl font-bold mb-1">Bem-vindo de volta</h1>
        <p className={`text-sm mb-6 ${muted}`}>Seu assistente profissional inteligente.</p>

        {/* Google */}
        <button onClick={handleGoogleLogin}
          className={`w-full flex items-center justify-center gap-2.5 py-2.5 mb-4 text-sm font-medium ${btnGhost}`}>
          <svg width="17" height="17" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57C21.36 18.17 22.56 15.42 22.56 12.25z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Entrar com Google
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
          <span className={`text-xs ${muted}`}>ou continue com e-mail</span>
          <div className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <input type="email" placeholder="seu@email.com" value={email}
            onChange={e => setEmail(e.target.value)} required
            className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
          />
          <div className="relative">
            <input type={showPw ? 'text' : 'password'} placeholder="Senha" value={password}
              onChange={e => setPassword(e.target.value)} required
              className={`w-full border rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none ${inputCls}`}
            />
            <button type="button" tabIndex={-1}
              onClick={() => setShowPw(v => !v)}
              className={`absolute right-3 top-1/2 -translate-y-1/2 ${muted}`}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {authError && (
            <p className="text-red-400 text-xs flex items-center gap-1.5">
              <AlertCircle size={12} /> {authError}
            </p>
          )}
          <button type="submit" disabled={authLoading}
            className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-50 flex items-center justify-center gap-2`}>
            {authLoading && <Loader2 size={14} className="animate-spin" />}
            Entrar
          </button>
        </form>

        <p className={`text-xs text-center mt-4 ${muted}`}>
          Não tem conta?{' '}
          <button onClick={() => { setScreen('register'); setAuthError(''); }}
            className="text-blue-400 hover:underline">Criar grátis</button>
        </p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: REGISTER
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'register') {
    const score = strengthScore(password);
    const { label: swLabel, color: swColor } = strengthLabel(score);
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
        <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <BrainCircuit size={19} className="text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">ProMind</span>
          </div>

          <button onClick={() => { setScreen('login'); setAuthError(''); }}
            className={`flex items-center gap-1.5 text-xs mb-5 ${muted} hover:text-blue-400 transition`}>
            <ArrowLeft size={13} /> Voltar para login
          </button>

          <h1 className="text-2xl font-bold mb-1">Criar conta</h1>
          <p className={`text-sm mb-6 ${muted}`}>Grátis. Sem cartão de crédito.</p>

          {/* Google */}
          <button onClick={handleGoogleLogin}
            className={`w-full flex items-center justify-center gap-2.5 py-2.5 mb-4 text-sm font-medium ${btnGhost}`}>
            <svg width="17" height="17" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57C21.36 18.17 22.56 15.42 22.56 12.25z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Cadastrar com Google
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
            <span className={`text-xs ${muted}`}>ou com e-mail</span>
            <div className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
          </div>

          <form onSubmit={handleRegister} className="space-y-3">
            <input type="text" placeholder="Nome completo" value={fullName}
              onChange={e => setFullName(e.target.value)} required
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
            <input type="email" placeholder="seu@email.com" value={email}
              onChange={e => setEmail(e.target.value)} required
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
            <div>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} placeholder="Senha" value={password}
                  onChange={e => setPassword(e.target.value)} required
                  className={`w-full border rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none ${inputCls}`}
                />
                <button type="button" tabIndex={-1}
                  onClick={() => setShowPw(v => !v)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 ${muted}`}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {/* Strength bar */}
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1.5">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className={`flex-1 h-1 rounded-full transition-all ${i <= score ? swColor : isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                    ))}
                  </div>
                  <p className={`text-xs mb-1 ${muted}`}>Força: <span className="text-white font-medium">{swLabel}</span></p>
                  <div className="space-y-0.5">
                    {STRENGTH_RULES.map(r => (
                      <p key={r.label} className={`text-[10px] flex items-center gap-1 ${r.test(password) ? 'text-emerald-400' : muted}`}>
                        {r.test(password) ? <CheckCircle2 size={10} /> : <span className="w-2.5 h-2.5 rounded-full border border-current inline-block" />}
                        {r.label}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {authError && (
              <p className="text-red-400 text-xs flex items-center gap-1.5">
                <AlertCircle size={12} /> {authError}
              </p>
            )}
            <button type="submit" disabled={authLoading || score < 5}
              className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 flex items-center justify-center gap-2`}>
              {authLoading && <Loader2 size={14} className="animate-spin" />}
              Criar conta
            </button>
          </form>

          <p className={`text-[10px] text-center mt-4 ${muted}`}>
            Ao criar conta, você concorda com nossos Termos de Uso e Política de Privacidade.
          </p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: 2FA CHALLENGE
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'twofa_challenge') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <div className="w-12 h-12 bg-blue-600/10 border border-blue-500/30 rounded-2xl flex items-center justify-center mb-5">
          <ShieldCheck size={22} className="text-blue-400" />
        </div>
        <h2 className="text-xl font-bold mb-1">Verificação em dois fatores</h2>
        <p className={`text-sm mb-6 ${muted}`}>
          Abra o app autenticador (Google Authenticator, Authy…) e insira o código de 6 dígitos.
        </p>
        <form onSubmit={handle2FALogin} className="space-y-3">
          <input
            type="text" inputMode="numeric" placeholder="000 000"
            maxLength={7} value={totpCode}
            onChange={e => setTotpCode(e.target.value.replace(/[^0-9 ]/g, ''))}
            className={`w-full border rounded-xl px-4 py-3 text-lg text-center tracking-[0.3em] font-mono focus:outline-none ${inputCls}`}
          />
          {authError && (
            <p className="text-red-400 text-xs flex items-center gap-1.5">
              <AlertCircle size={12} /> {authError}
            </p>
          )}
          <button type="submit" disabled={authLoading || totpCode.replace(/\s/g,'').length < 6}
            className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 flex items-center justify-center gap-2`}>
            {authLoading && <Loader2 size={14} className="animate-spin" />}
            Verificar
          </button>
        </form>
        <button onClick={() => { setScreen('twofa_recovery'); setAuthError(''); }}
          className={`w-full text-center text-xs mt-4 ${muted} hover:text-blue-400 transition`}>
          Usar código de recuperação
        </button>
        <button onClick={() => { setScreen('login'); setAuthError(''); setChallengeToken(''); }}
          className={`w-full text-center text-xs mt-2 ${muted} hover:text-slate-300 transition`}>
          ← Voltar para o login
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: 2FA RECOVERY
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'twofa_recovery') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <div className="w-12 h-12 bg-amber-600/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mb-5">
          <KeyRound size={22} className="text-amber-400" />
        </div>
        <h2 className="text-xl font-bold mb-1">Código de recuperação</h2>
        <p className={`text-sm mb-6 ${muted}`}>
          Insira um dos seus códigos de recuperação no formato <span className="font-mono">XXXX-XXXX</span>.
          Cada código só funciona uma vez.
        </p>
        <form onSubmit={handle2FARecovery} className="space-y-3">
          <input type="text" placeholder="ABCD-EFGH"
            value={recoveryCode}
            onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
            className={`w-full border rounded-xl px-4 py-2.5 text-sm font-mono tracking-wider text-center focus:outline-none ${inputCls}`}
          />
          {authError && (
            <p className="text-red-400 text-xs flex items-center gap-1.5">
              <AlertCircle size={12} /> {authError}
            </p>
          )}
          <button type="submit" disabled={authLoading || recoveryCode.length < 9}
            className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 flex items-center justify-center gap-2`}>
            {authLoading && <Loader2 size={14} className="animate-spin" />}
            Usar código
          </button>
        </form>
        <button onClick={() => { setScreen('twofa_challenge'); setAuthError(''); }}
          className={`w-full text-center text-xs mt-4 ${muted} hover:text-blue-400 transition`}>
          ← Usar código do autenticador
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: 2FA SETUP (optional, accessible from chat sidebar)
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'twofa_setup') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <div className="flex items-center gap-2 mb-6">
          <ShieldCheck size={20} className="text-blue-400" />
          <h2 className="text-xl font-bold">Ativar autenticação em 2 fatores</h2>
        </div>

        {setupStep === 'qr' ? (
          <>
            <p className={`text-sm mb-4 ${muted}`}>
              Escaneie o QR code abaixo com seu app autenticador (Google Authenticator, Authy, 1Password…).
            </p>
            {setupQR && (
              <div className="flex justify-center mb-4">
                <img src={`data:image/png;base64,${setupQR}`}
                  alt="QR code 2FA" className="w-44 h-44 rounded-xl border border-slate-700" />
              </div>
            )}
            <p className={`text-xs text-center mb-2 ${muted}`}>Ou insira o código manualmente:</p>
            <div className={`font-mono text-sm text-center tracking-widest py-2 px-3 rounded-lg mb-5 ${isDark ? 'bg-slate-900 text-slate-200' : 'bg-slate-100 text-slate-800'}`}>
              {setupSecret}
            </div>
            <p className={`text-sm mb-3 ${muted}`}>Depois, insira o código gerado pelo app para confirmar:</p>
            <form onSubmit={handleEnable2FA} className="space-y-3">
              <input type="text" inputMode="numeric" placeholder="000 000"
                maxLength={7} value={setupCode}
                onChange={e => setSetupCode(e.target.value.replace(/[^0-9 ]/g, ''))}
                className={`w-full border rounded-xl px-4 py-3 text-lg text-center tracking-[0.3em] font-mono focus:outline-none ${inputCls}`}
              />
              {authError && (
                <p className="text-red-400 text-xs flex items-center gap-1.5">
                  <AlertCircle size={12} /> {authError}
                </p>
              )}
              <button type="submit" disabled={authLoading || setupCode.replace(/\s/g,'').length < 6}
                className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 flex items-center justify-center gap-2`}>
                {authLoading && <Loader2 size={14} className="animate-spin" />}
                Confirmar e ativar
              </button>
            </form>
            <button onClick={() => setScreen('chat')}
              className={`w-full text-center text-xs mt-4 ${muted} hover:text-slate-300 transition`}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <div className={`flex items-center gap-2 p-3 rounded-xl mb-4 ${isDark ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-emerald-50 border border-emerald-200'}`}>
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <p className="text-sm text-emerald-400 font-medium">2FA ativado com sucesso!</p>
            </div>
            <p className="text-sm mb-4">
              <strong>Salve esses códigos de recuperação agora.</strong>{' '}
              <span className={muted}>Eles serão exibidos apenas uma vez e são a única forma de acessar
              sua conta caso perca o dispositivo autenticador.</span>
            </p>
            <div className={`rounded-xl border p-4 mb-5 ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-slate-50'}`}>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map(code => (
                  <button key={code} onClick={() => copyCode(code)}
                    className={`font-mono text-sm flex items-center justify-between px-3 py-1.5 rounded-lg transition
                      ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-white hover:bg-slate-100 text-slate-800 border border-slate-200'}`}>
                    {code}
                    {copiedCode === code
                      ? <Check size={12} className="text-emerald-400 shrink-0" />
                      : <Copy size={12} className={`${muted} shrink-0`} />
                    }
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => setScreen('chat')}
              className={`w-full py-2.5 text-sm ${btnPrimary}`}>
              Entendido, salvei os códigos
            </button>
          </>
        )}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'onboarding_identity') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <ProgressBar />
        <div className="flex items-center gap-2 mb-1">
          <User size={18} className="text-blue-400" />
          <h2 className="text-xl font-bold">Quem é você?</h2>
        </div>
        <p className={`text-sm mb-6 ${muted}`}>Vamos personalizar tudo para o seu trabalho.</p>
        <div className="space-y-3 mb-6">
          <div>
            <label className={`block text-xs mb-1.5 ${muted}`}>Nome completo</label>
            <input type="text" placeholder="Ex: João da Silva"
              value={profile.full_name ?? ''}
              onChange={e => upd({ full_name: e.target.value })}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
          </div>
          <div>
            <label className={`block text-xs mb-1.5 ${muted}`}>Como prefere ser chamado?</label>
            <input type="text" placeholder="Ex: João, Dr. Silva, Prof. Ana..."
              value={profile.preferred_name ?? ''}
              onChange={e => upd({ preferred_name: e.target.value })}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
          </div>
          <div>
            <label className={`block text-xs mb-1.5 ${muted}`}>Empresa / Escola / Clínica</label>
            <input type="text" placeholder="Nome do local onde trabalha (opcional)"
              value={profile.organization}
              onChange={e => upd({ organization: e.target.value })}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
          </div>
        </div>
        <button disabled={!profile.full_name}
          onClick={() => setScreen('onboarding_prof')}
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}>
          Continuar
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: PROFESSION
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'onboarding_prof') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <ProgressBar />
        <BackBtn to="onboarding_identity" />
        <h2 className="text-xl font-bold mb-1">Qual é a sua profissão?</h2>
        <p className={`text-sm mb-6 ${muted}`}>Vamos buscar conteúdo público da sua área automaticamente.</p>
        <div className="space-y-2.5 mb-6">
          {PROFESSIONS.map(p => (
            <button key={p.key}
              onClick={() => upd({ profession: p.key, subArea: null })}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition
                ${profile.profession === p.key ? activeCard : isDark ? 'border-slate-800 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center gap-3">
                <span className={profile.profession === p.key ? 'text-blue-400' : muted}>{p.icon}</span>
                <div>
                  <p className="font-medium text-sm">{p.key}</p>
                  <p className={`text-xs ${muted}`}>{p.desc}</p>
                </div>
              </div>
              {profile.profession === p.key && <ChevronRight size={15} className="text-blue-400 shrink-0" />}
            </button>
          ))}
        </div>
        {profile.profession === 'Outro' && (
          <div className="space-y-3 mb-5">
            <input type="text" placeholder="Sua profissão (ex: Contador, Engenheiro...)"
              value={profile.customProfession}
              onChange={e => upd({ customProfession: e.target.value })}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
            <textarea placeholder="Descreva o que você faz no dia a dia..."
              value={profile.customProfessionDesc}
              onChange={e => upd({ customProfessionDesc: e.target.value })}
              rows={3}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none ${inputCls}`}
            />
          </div>
        )}
        <button
          disabled={!profile.profession || (profile.profession === 'Outro' && !profile.customProfession)}
          onClick={() => {
            const hasSubs = SUB_AREAS[profile.profession!]?.length > 0;
            setScreen(hasSubs ? 'onboarding_sub' : 'onboarding_context');
          }}
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}>
          Continuar
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: SUB AREA
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'onboarding_sub') {
    const subs = SUB_AREAS[profile.profession ?? ''] ?? [];
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
        <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
          <ProgressBar />
          <BackBtn to="onboarding_prof" />
          <h2 className="text-xl font-bold mb-1">Área de atuação</h2>
          <p className={`text-sm mb-5 ${muted}`}>Define quais bases de conhecimento buscamos para você.</p>
          <div className="space-y-2 mb-5 max-h-64 overflow-y-auto pr-1">
            {subs.map(s => (
              <button key={s.id} onClick={() => upd({ subArea: s })}
                className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition
                  ${profile.subArea?.id === s.id ? activeCard : isDark ? 'border-slate-800 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'}`}>
                <div>
                  <p className="font-medium text-sm">{s.label}</p>
                  <p className={`text-xs mt-0.5 ${muted}`}>{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
          {profile.profession === 'Professor' && (
            <div className="space-y-3 mb-5">
              <div>
                <label className={`block text-xs mb-1.5 ${muted}`}>Matéria que leciona</label>
                <input type="text" placeholder="Ex: Matemática, Inglês, Biologia..."
                  value={profile.materia}
                  onChange={e => upd({ materia: e.target.value })}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
                />
              </div>
              <div>
                <label className={`block text-xs mb-1.5 ${muted}`}>Nível / Ano / Turma</label>
                <input type="text" placeholder="Ex: 5º ano EF, 2º EM, Faculdade..."
                  value={profile.nivel}
                  onChange={e => upd({ nivel: e.target.value })}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
                />
              </div>
            </div>
          )}
          <button disabled={!profile.subArea} onClick={() => setScreen('onboarding_context')}
            className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}>
            Continuar
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'onboarding_context') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <ProgressBar />
        <BackBtn to={SUB_AREAS[profile.profession ?? '']?.length > 0 ? 'onboarding_sub' : 'onboarding_prof'} />
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={18} className="text-blue-400" />
          <h2 className="text-xl font-bold">Onde você atua?</h2>
        </div>
        <p className={`text-sm mb-6 ${muted}`}>Permite buscar legislação e protocolos da sua região.</p>
        <div className="space-y-3 mb-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs mb-1.5 ${muted}`}>Cidade</label>
              <input type="text" placeholder="Ex: São Paulo" value={profile.city}
                onChange={e => upd({ city: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none ${inputCls}`}
              />
            </div>
            <div>
              <label className={`block text-xs mb-1.5 ${muted}`}>Estado</label>
              <select value={profile.state} onChange={e => upd({ state: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none ${selectCls}`}>
                <option value="">UF</option>
                {STATES_BR.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {!profile.organization && (
            <div>
              <label className={`block text-xs mb-1.5 ${muted}`}>Empresa / Escola / Clínica <span className="opacity-50">(opcional)</span></label>
              <div className="relative">
                <Building2 size={14} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${muted}`} />
                <input type="text" placeholder="Nome do local de trabalho"
                  value={profile.organization}
                  onChange={e => upd({ organization: e.target.value })}
                  className={`w-full border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
                />
              </div>
            </div>
          )}
        </div>
        <button disabled={!profile.state} onClick={() => setScreen('onboarding_auto_index')}
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}>
          Buscar conteúdo da minha área →
        </button>
        <button onClick={() => setScreen('onboarding_auto_index')}
          className={`w-full text-center text-xs mt-3 transition ${muted} hover:text-slate-300`}>
          Pular por agora
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: AUTO INDEXING
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'onboarding_auto_index') {
    const steps = AUTO_INDEX_STEPS[profile.profession ?? 'Outro'];
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
        <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
          <ProgressBar />
          <div className="flex items-center gap-2 mb-1">
            <Search size={18} className="text-blue-400" />
            <h2 className="text-xl font-bold">Buscando sua base</h2>
          </div>
          <p className={`text-sm mb-8 ${muted}`}>Indexando conteúdo público e atualizado da sua área.</p>
          <div className="space-y-3 mb-8">
            {steps.map((step, i) => {
              const done = i < autoIndexStep;
              const current = i === autoIndexStep;
              return (
                <div key={i} className={`flex items-center gap-3 transition-opacity ${i > autoIndexStep ? 'opacity-30' : 'opacity-100'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0
                    ${done ? 'bg-emerald-500' : current ? 'bg-blue-600' : isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                    {done ? <CheckCircle2 size={13} className="text-white" />
                      : current ? <Loader2 size={13} className="animate-spin text-white" />
                      : <span className={`text-[10px] font-bold ${muted}`}>{i + 1}</span>}
                  </div>
                  <span className={`text-sm ${current ? 'text-blue-400 font-medium' : done ? (isDark ? 'text-slate-300' : 'text-slate-700') : muted}`}>
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
          <button disabled={!autoIndexDone} onClick={() => setScreen('onboarding_upload')}
            className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}>
            {autoIndexDone ? 'Ótimo! Continuar →' : 'Aguarde...'}
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'onboarding_upload') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <ProgressBar />
        <BackBtn to="onboarding_auto_index" />
        <h2 className="text-xl font-bold mb-1">Seus materiais pessoais</h2>
        <p className={`text-sm mb-5 ${muted}`}>
          Envie PDF, DOCX, PPTX, XLSX, CSV, TXT ou um <strong>.zip</strong> com vários arquivos.
        </p>
        <div onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition mb-4
            ${isDark ? 'border-slate-700 hover:border-blue-500 hover:bg-blue-500/5' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50'}`}>
          <Upload size={22} className={`mx-auto mb-2 ${muted}`} />
          <p className="text-sm font-medium">Arraste ou clique para selecionar</p>
          <p className={`text-xs mt-1 ${muted}`}>Qualquer formato · .zip com múltiplos arquivos</p>
          <input ref={fileInputRef} type="file" className="hidden" multiple
            accept=".pdf,.docx,.pptx,.xlsx,.txt,.zip,.rar,.csv,.md"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
        {uploadedFiles.length > 0 && (
          <div className={`rounded-xl border p-3 mb-4 max-h-40 overflow-y-auto space-y-1.5 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            {uploadedFiles.map(f => (
              <div key={f.name} className="flex items-center gap-2 text-xs">
                <FileText size={11} className={muted} />
                <span className="flex-1 truncate">{f.name}</span>
                <span className={muted}>{formatBytes(f.size)}</span>
                {f.status === 'pending' && <Loader2 size={11} className="animate-spin text-blue-400 shrink-0" />}
                {f.status === 'done'    && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                {f.status === 'error'   && <AlertCircle size={11} className="text-red-400 shrink-0" />}
                <button onClick={() => setUploadedFiles(p => p.filter(x => x.name !== f.name))}
                  className={`${muted} hover:text-red-400 transition ml-1`}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {isUploading && (
          <p className="text-xs text-blue-400 flex items-center gap-1.5 mb-3">
            <Loader2 size={11} className="animate-spin" /> Processando e indexando arquivos...
          </p>
        )}
        <button onClick={handleFinish} disabled={isUploading}
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-50`}>
          {uploadedFiles.length > 0 ? `Entrar com ${uploadedFiles.length} arquivo(s)` : 'Entrar'}
        </button>
        <button onClick={handleFinish}
          className={`w-full text-center text-xs mt-3 transition ${muted} hover:text-slate-300`}>
          Pular — enviar arquivos depois
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: CHAT
  // ═══════════════════════════════════════════════════════════════════════════

  const profName = profile.profession === 'Outro'
    ? profile.customProfession : (profile.profession ?? '');
  const profIcon: Record<string, React.ReactNode> = {
    Advogado: <Scale size={14} />, Médico: <Stethoscope size={14} />,
    Professor: <BookOpen size={14} />, Outro: <Sparkles size={14} />,
  };

  return (
    <div className={`flex h-screen w-full ${bg} ${text} overflow-hidden`}>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 flex flex-col border-r transform transition-transform duration-300
        lg:relative lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        ${card}
      `}>
        <div className={`p-5 flex items-center justify-between border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div className="flex items-center gap-2 font-bold">
            <BrainCircuit size={20} className="text-blue-500" />
            <span>ProMind</span>
          </div>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>

        <div className="flex-1 p-4 space-y-5 overflow-y-auto">
          {/* Profile card */}
          <div className={`rounded-xl border p-3.5 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-100 bg-slate-50'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-2.5 ${muted}`}>Perfil ativo</p>
            <p className="text-sm font-semibold">{profile.preferred_name || profile.full_name}</p>
            {profile.organization && <p className={`text-xs mt-0.5 ${muted}`}>{profile.organization}</p>}
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-blue-400 shrink-0">{profIcon[profile.profession ?? 'Outro']}</span>
              <span className={`text-xs ${muted}`}>{profName}{profile.subArea ? ` · ${profile.subArea.label}` : ''}</span>
            </div>
            {(profile.city || profile.state) && (
              <div className="flex items-center gap-1.5 mt-1">
                <MapPin size={11} className={muted} />
                <span className={`text-xs ${muted}`}>{[profile.city, profile.state].filter(Boolean).join(', ')}</span>
              </div>
            )}
            {/* 2FA badge */}
            <div className="flex items-center gap-1.5 mt-2">
              <ShieldCheck size={11} className={profile.totp_enabled ? 'text-emerald-400' : muted} />
              <span className={`text-[10px] ${profile.totp_enabled ? 'text-emerald-400' : muted}`}>
                {profile.totp_enabled ? '2FA ativo' : '2FA desativado'}
              </span>
              {!profile.totp_enabled && (
                <button onClick={initiate2FASetup}
                  className="text-[10px] text-blue-400 hover:underline ml-auto">
                  Ativar
                </button>
              )}
            </div>
          </div>

          {/* Files */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${muted}`}>
              Meus arquivos ({uploadedFiles.length})
            </p>
            {uploadedFiles.length === 0
              ? <p className={`text-xs ${isDark ? 'text-slate-700' : 'text-slate-400'}`}>Nenhum arquivo enviado ainda</p>
              : (
                <div className="space-y-1">
                  {uploadedFiles.map(f => (
                    <div key={f.name} className={`flex items-center gap-2 text-xs px-1 py-1 rounded ${isDark ? 'hover:bg-slate-900' : 'hover:bg-slate-100'}`}>
                      <FileText size={11} className={muted} />
                      <span className="flex-1 truncate">{f.name}</span>
                      {f.status === 'done'  && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                      {f.status === 'error' && <AlertCircle size={11} className="text-red-400 shrink-0" />}
                    </div>
                  ))}
                </div>
              )
            }
            <button onClick={() => fileInputRef2.current?.click()}
              className={`mt-2 w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-dashed transition
                ${isDark ? 'border-slate-700 text-slate-500 hover:border-blue-500 hover:text-blue-400' : 'border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500'}`}>
              <Plus size={11} /> Adicionar arquivos
            </button>
            <input ref={fileInputRef2} type="file" className="hidden" multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.zip,.rar,.csv,.md"
              onChange={e => handleFiles(e.target.files)}
            />
          </div>
        </div>

        <div className={`p-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} flex flex-col gap-1`}>
          <button onClick={() => setIsDark(!isDark)}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition ${isDark ? 'hover:bg-slate-900 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}>
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
            {isDark ? 'Modo claro' : 'Modo escuro'}
          </button>
          <button onClick={handleLogout}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition text-red-400 ${isDark ? 'hover:bg-red-500/10' : 'hover:bg-red-50'}`}>
            <LogOut size={13} /> Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className={`h-14 flex items-center justify-between px-4 border-b shrink-0 ${card}`}>
          <div className="flex items-center gap-3">
            <button className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-blue-400">{profIcon[profile.profession ?? 'Outro']}</span>
              <span className="font-semibold">{profName}</span>
              {profile.subArea && (
                <>
                  <span className={muted}>·</span>
                  <span className={`text-xs ${muted}`}>{profile.subArea.label}</span>
                </>
              )}
            </div>
          </div>
          <label className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition
            ${isUploading ? 'opacity-60 cursor-wait' : isDark ? 'border-slate-700 hover:border-blue-500 text-slate-300' : 'border-slate-200 hover:border-blue-400 text-slate-600'}`}>
            {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            <span className="hidden sm:inline">{isUploading ? 'Processando...' : 'Adicionar arquivos'}</span>
            <input type="file" className="hidden" multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.zip,.rar,.csv,.md"
              onChange={e => handleFiles(e.target.files)}
            />
          </label>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center mr-2 shrink-0 mt-0.5">
                  <BrainCircuit size={14} className="text-white" />
                </div>
              )}
              <div className={`max-w-[82%] lg:max-w-[68%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                ${msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : `${msgAssistant} rounded-tl-sm`}`}>
                {msg.content}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center mr-2 shrink-0">
                <BrainCircuit size={14} className="text-white" />
              </div>
              <div className={`px-4 py-3 rounded-2xl rounded-tl-sm text-sm ${msgAssistant}`}>
                <span className="flex gap-1 items-center">
                  {[0,150,300].map(d => (
                    <span key={d} className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                      style={{ animationDelay: `${d}ms` }} />
                  ))}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={`p-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div className="max-w-3xl mx-auto">
            <div className={`flex gap-2 items-center border rounded-2xl px-4 py-2 transition focus-within:ring-2 focus-within:ring-blue-500 ${inputCls}`}>
              <input type="text" value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={PROF_PLACEHOLDERS[profile.profession ?? 'Outro']}
                disabled={isSending}
                className="flex-1 bg-transparent py-1.5 focus:outline-none text-sm disabled:opacity-60"
              />
              <button onClick={handleSend} disabled={!input.trim() || isSending}
                className="p-1.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
                <Send size={15} />
              </button>
            </div>
            <p className={`text-center text-[10px] mt-2 font-medium tracking-wide uppercase ${isDark ? 'text-slate-700' : 'text-slate-400'}`}>
              Respostas baseadas apenas nos seus documentos · Dados privados
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}