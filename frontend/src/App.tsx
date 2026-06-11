  import React, { useState, useRef, useEffect } from 'react';
  import {
  Upload, Send, BrainCircuit, Sun, Moon, Menu, X,
  Scale, BookOpen, Stethoscope, ChevronRight, Loader2,
  ArrowLeft, CheckCircle2, FileText, Trash2, LogOut, Plus,
  User, MapPin, Building2, Sparkles, Search, AlertCircle
  } from 'lucide-react';
  import axios from 'axios';

  // ─── Types ────────────────────────────────────────────────────────────────────

  type Screen =
  | 'login'
  | 'onboarding_identity'
  | 'onboarding_prof'
  | 'onboarding_sub'
  | 'onboarding_context'
  | 'onboarding_auto_index'
  | 'onboarding_upload'
  | 'chat';

  type ProfessionKey = 'Advogado' | 'Médico' | 'Professor' | 'Outro';

  interface SubArea {
  id: string;
  label: string;
  desc: string;
  }

  interface Message {
  role: 'user' | 'assistant';
  content: string;
  }

  interface UploadedFile {
  name: string;
  size: number;
  status: 'pending' | 'done' | 'error';
  }

  interface UserProfile {
  fullName: string;
  preferredName: string;
  email: string;
  password: string;
  profession: ProfessionKey | null;
  customProfession: string;
  customProfessionDesc: string;
  subArea: SubArea | null;
  // context
  city: string;
  state: string;
  organization: string; // empresa/escola/clínica
  // profession-specific
  estado: string;        // advogado
  materia: string;       // professor
  nivel: string;         // professor
  rede: string;         // professor: publica/privada/superior
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
    { id: 'civel',   label: 'Direito Cível',        desc: 'Contratos, indenizações, família' },
    { id: 'penal',   label: 'Direito Penal',         desc: 'Processo penal, crimes, defesa' },
    { id: 'trab',    label: 'Direito Trabalhista',   desc: 'CLT, reclamações, acordos' },
    { id: 'emp',     label: 'Direito Empresarial',   desc: 'Societário, contratos comerciais' },
    { id: 'trib',    label: 'Direito Tributário',    desc: 'Impostos, planejamento fiscal' },
    { id: 'pub',     label: 'Direito Público',       desc: 'Administrativo, licitações' },
  ],
  Médico: [
    { id: 'clinica',   label: 'Clínica Geral',   desc: 'Atenção primária, prontuários' },
    { id: 'cirurgia',  label: 'Cirurgia',        desc: 'Protocolos cirúrgicos, pós-op' },
    { id: 'pediatria', label: 'Pediatria',       desc: 'Saúde infantil, crescimento' },
    { id: 'psiq',      label: 'Psiquiatria',     desc: 'DSM, medicamentos, laudos' },
    { id: 'cardio',    label: 'Cardiologia',     desc: 'ECG, protocolos cardíacos' },
    { id: 'gineco',    label: 'Ginecologia',     desc: 'Saúde da mulher, obstetrícia' },
  ],
  Professor: [
    { id: 'pub',    label: 'Rede Pública',     desc: 'Estado/Município, BNCC, SARESP' },
    { id: 'priv',   label: 'Rede Privada',     desc: 'Apostilados, projetos pedagógicos' },
    { id: 'sup',    label: 'Ensino Superior',  desc: 'Faculdades, pós-graduação' },
    { id: 'idiomas',label: 'Idiomas',          desc: 'Inglês, espanhol, outros' },
    { id: 'tecnico',label: 'Técnico/Profiss.', desc: 'SENAI, SENAC, cursos técnicos' },
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

  function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function buildCollectionName(profile: UserProfile): string {
  const prof = (profile.profession === 'Outro'
    ? profile.customProfession
    : profile.profession ?? 'geral'
  ).toLowerCase().replace(/\s+/g, '_');
  const sub  = profile.subArea?.id ?? 'geral';
  const st   = profile.state.toLowerCase().replace(/\s+/g, '_') || 'br';
  const base = `${prof}_${sub}_${st}`;
  if (profile.profession === 'Professor' && profile.materia)
    return `${base}_${profile.materia.toLowerCase().replace(/\s+/g, '_')}`;
  return base;
  }

  // ─── Fake auto-indexer (simula busca + indexação de bases públicas) ───────────

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

  // ─── Component ────────────────────────────────────────────────────────────────

  const emptyProfile = (): UserProfile => ({
  fullName: '', preferredName: '', email: '', password: '',
  profession: null, customProfession: '', customProfessionDesc: '',
  subArea: null,
  city: '', state: '', organization: '',
  estado: '', materia: '', nivel: '',rede: '',
  });

  export default function App() {
  const [screen, setScreen]       = useState<Screen>('login');
  const [profile, setProfile]     = useState<UserProfile>(emptyProfile());
  const [loginError, setLoginError] = useState('');

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading]     = useState(false);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDark, setIsDark]       = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-index state
  const [autoIndexStep, setAutoIndexStep] = useState(0);
  const [autoIndexDone, setAutoIndexDone] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Run fake auto-indexer when entering that screen
  // Run auto-indexer animation + real backend call when entering that screen
  useEffect(() => {
    if (screen !== 'onboarding_auto_index') return;

    setAutoIndexStep(0);
    setAutoIndexDone(false);

    const steps = AUTO_INDEX_STEPS[profile.profession ?? 'Outro'];

    // Avança um step a cada 900ms para dar feedback visual
    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      setAutoIndexStep(step);
      if (step >= steps.length - 1) {
        clearInterval(interval);
      }
    }, 900);

    // Chama o backend em paralelo
    axios
      .post('http://localhost:8000/onboarding/complete', {
        profession:      profile.profession,
        sub_area:        profile.subArea?.id,
        state:           profile.state,
        collection_name: buildCollectionName(profile),
      })
      .catch(err => console.warn('[onboarding/complete]', err))
      .finally(() => {
        // Garante que todos os steps foram mostrados antes de liberar o botão
        setTimeout(() => setAutoIndexDone(true), steps.length * 900 + 400);
      });

    return () => clearInterval(interval);
  }, [screen]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function upd(patch: Partial<UserProfile>) {
    setProfile(prev => ({ ...prev, ...patch }));
  }

  function getWelcome(): string {
    const name = profile.preferredName || profile.fullName.split(' ')[0] || 'Profissional';
    const prof = profile.profession === 'Outro'
      ? profile.customProfession : profile.profession;
    const sub  = profile.subArea?.label ?? '';
    const org  = profile.organization ? ` — ${profile.organization}` : '';
    const loc  = profile.city ? ` (${profile.city}/${profile.state})` : '';
    const docs = uploadedFiles.length > 0
      ? `\n\nVocê adicionou **${uploadedFiles.length} arquivo(s)**. Posso responder com base exclusivamente nesses documentos.`
      : '\n\nAinde não há arquivos pessoais enviados. Use "Adicionar arquivos" quando quiser.';
    return `Olá, ${name}! Seu espaço está pronto como **${prof}${sub ? ' · ' + sub : ''}**${org}${loc}.\n\nJá indexei bases públicas da sua área de atuação.${docs}`;
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!profile.email || !profile.password) {
      setLoginError('Preencha e-mail e senha.');
      return;
    }
    setLoginError('');
    setScreen('onboarding_identity');
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
      const fd   = new FormData();
      fd.append('file', file);
      fd.append('profession', profile.profession ?? 'Geral');
      fd.append('sub_area',   profile.subArea?.id ?? 'geral');
      fd.append('collection_name', collection);
      fd.append('estado',  profile.state);
      fd.append('materia', profile.materia);
      fd.append('nivel',   profile.nivel);
      try {
        await axios.post('http://localhost:8000/upload', fd);
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
      const res = await axios.post('http://localhost:8000/chat', {
        question:        text,
        collection_name: buildCollectionName(profile),
        profession:      profile.profession,
        sub_area:        profile.subArea?.id,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.answer ?? 'Sem resposta.' }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Falha na conexão com o servidor. Verifique se o backend está rodando.',
      }]);
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleFinish() {
    setMessages([{ role: 'assistant', content: getWelcome() }]);
    setScreen('chat');
  }

  // ─── Theme tokens ─────────────────────────────────────────────────────────

  const bg        = isDark ? 'bg-[#080c14]'     : 'bg-slate-50';
  const text       = isDark ? 'text-slate-100'   : 'text-slate-900';
  const muted      = isDark ? 'text-slate-400'   : 'text-slate-500';
  const card       = isDark ? 'bg-[#0f1623] border-slate-800/80' : 'bg-white border-slate-200';
  const surface    = isDark ? 'bg-[#161d2e]'     : 'bg-slate-100';
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

  // ── Progress bar component ────────────────────────────────────────────────

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
      <button
        onClick={() => setScreen(to)}
        className={`flex items-center gap-1.5 text-xs mb-5 ${muted} hover:text-blue-400 transition`}
      >
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

        <h1 className="text-2xl font-bold mb-1">Boas-vindas</h1>
        <p className={`text-sm mb-6 ${muted}`}>Seu assistente profissional inteligente.</p>

        {/* OAuth */}
        {[
          { label: 'Entrar com Google', svg: <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57C21.36 18.17 22.56 15.42 22.56 12.25z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
          { label: 'Entrar com Apple',  svg: <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.987C24.007 5.367 18.641 0 12.017 0z"/></svg> },
        ].map(b => (
          <button key={b.label}
            onClick={() => setScreen('onboarding_identity')}
            className={`w-full flex items-center justify-center gap-2.5 py-2.5 mb-2 text-sm font-medium ${btnGhost}`}
          >
            {b.svg} {b.label}
          </button>
        ))}

        <div className="flex items-center gap-3 my-4">
          <div className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
          <span className={`text-xs ${muted}`}>ou continue com e-mail</span>
          <div className={`flex-1 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <input type="email" placeholder="seu@email.com"
            value={profile.email}
            onChange={e => upd({ email: e.target.value })}
            className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
          />
          <input type="password" placeholder="Senha"
            value={profile.password}
            onChange={e => upd({ password: e.target.value })}
            className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
          />
          {loginError && (
            <p className="text-red-400 text-xs flex items-center gap-1.5">
              <AlertCircle size={12} /> {loginError}
            </p>
          )}
          <button type="submit" className={`w-full py-2.5 text-sm ${btnPrimary}`}>
            Entrar
          </button>
        </form>

        <p className={`text-xs text-center mt-4 ${muted}`}>
          Não tem conta?{' '}
          <button onClick={() => setScreen('onboarding_identity')} className="text-blue-400 hover:underline">
            Criar grátis
          </button>
        </p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: IDENTITY (nome, como quer ser chamado)
  // ═══════════════════════════════════════════════════════════════════════════

  if (screen === 'onboarding_identity') return (
    <div className={`min-h-screen flex items-center justify-center ${bg} ${text} px-4 py-8`}>
      <div className={`w-full max-w-sm border rounded-2xl p-8 ${card}`}>
        <ProgressBar />
        <BackBtn to="login" />

        <div className="flex items-center gap-2 mb-1">
          <User size={18} className="text-blue-400" />
          <h2 className="text-xl font-bold">Quem é você?</h2>
        </div>
        <p className={`text-sm mb-6 ${muted}`}>Vamos personalizar tudo para o seu trabalho.</p>

        <div className="space-y-3 mb-6">
          <div>
            <label className={`block text-xs mb-1.5 ${muted}`}>Nome completo</label>
            <input type="text" placeholder="Ex: João da Silva"
              value={profile.fullName}
              onChange={e => upd({ fullName: e.target.value })}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
          </div>
          <div>
            <label className={`block text-xs mb-1.5 ${muted}`}>Como prefere ser chamado?</label>
            <input type="text" placeholder="Ex: João, Dr. Silva, Prof. Ana..."
              value={profile.preferredName}
              onChange={e => upd({ preferredName: e.target.value })}
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

        <button
          disabled={!profile.fullName}
          onClick={() => setScreen('onboarding_prof')}
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
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
              onClick={() => { upd({ profession: p.key, subArea: null }); }}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition
                ${profile.profession === p.key ? activeCard : isDark ? 'border-slate-800 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'}`}
            >
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

        {/* Custom profession fields */}
        {profile.profession === 'Outro' && (
          <div className="space-y-3 mb-5">
            <input type="text" placeholder="Sua profissão (ex: Contador, Engenheiro...)"
              value={profile.customProfession}
              onChange={e => upd({ customProfession: e.target.value })}
              className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none ${inputCls}`}
            />
            <textarea placeholder="Descreva o que você faz no dia a dia (quanto mais detalhes, melhor a personalização)"
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
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
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
          <p className={`text-sm mb-5 ${muted}`}>Isso define quais bases de conhecimento buscamos para você.</p>

          <div className="space-y-2 mb-5 max-h-64 overflow-y-auto pr-1">
            {subs.map(s => (
              <button key={s.id}
                onClick={() => upd({ subArea: s })}
                className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition
                  ${profile.subArea?.id === s.id ? activeCard : isDark ? 'border-slate-800 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div>
                  <p className="font-medium text-sm">{s.label}</p>
                  <p className={`text-xs mt-0.5 ${muted}`}>{s.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Professor sub-fields */}
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

          <button
            disabled={!profile.subArea}
            onClick={() => setScreen('onboarding_context')}
            className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SCREEN: CONTEXT (cidade, estado, organização)
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
        <p className={`text-sm mb-6 ${muted}`}>
          Isso permite buscar legislação e protocolos específicos da sua região.
        </p>

        <div className="space-y-3 mb-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs mb-1.5 ${muted}`}>Cidade</label>
              <input type="text" placeholder="Ex: São Paulo"
                value={profile.city}
                onChange={e => upd({ city: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none ${inputCls}`}
              />
            </div>
            <div>
              <label className={`block text-xs mb-1.5 ${muted}`}>Estado</label>
              <select
                value={profile.state}
                onChange={e => upd({ state: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none ${selectCls}`}
              >
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

        <button
          disabled={!profile.state}
          onClick={() => setScreen('onboarding_auto_index')}
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Buscar conteúdo da minha área →
        </button>
        <button
          onClick={() => setScreen('onboarding_auto_index')}
          className={`w-full text-center text-xs mt-3 transition ${muted} hover:text-slate-300`}
        >
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
          <p className={`text-sm mb-8 ${muted}`}>
            Indexando conteúdo público e atualizado da sua área de atuação.
          </p>

          <div className="space-y-3 mb-8">
            {steps.map((step, i) => {
              const done    = i < autoIndexStep;
              const current = i === autoIndexStep;
              return (
                <div key={i} className={`flex items-center gap-3 transition-opacity ${i > autoIndexStep ? 'opacity-30' : 'opacity-100'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0
                    ${done ? 'bg-emerald-500' : current ? 'bg-blue-600' : isDark ? 'bg-slate-800' : 'bg-slate-200'}`}
                  >
                    {done
                      ? <CheckCircle2 size={13} className="text-white" />
                      : current
                        ? <Loader2 size={13} className="animate-spin text-white" />
                        : <span className={`text-[10px] font-bold ${muted}`}>{i + 1}</span>
                    }
                  </div>
                  <span className={`text-sm ${current ? 'text-blue-400 font-medium' : done ? (isDark ? 'text-slate-300' : 'text-slate-700') : muted}`}>
                    {step}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            disabled={!autoIndexDone}
            onClick={() => setScreen('onboarding_upload')}
            className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
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
          A IA responde <em>apenas</em> com o que você enviar — seus documentos ficam privados.
        </p>

        {/* Drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition mb-4
            ${isDark ? 'border-slate-700 hover:border-blue-500 hover:bg-blue-500/5' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50'}`}
        >
          <Upload size={22} className={`mx-auto mb-2 ${muted}`} />
          <p className="text-sm font-medium">Arraste ou clique para selecionar</p>
          <p className={`text-xs mt-1 ${muted}`}>Qualquer formato · .zip com múltiplos arquivos</p>
          <input ref={fileInputRef} type="file" className="hidden" multiple
            accept=".pdf,.docx,.pptx,.xlsx,.txt,.zip,.rar,.csv,.md"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        {/* File list */}
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
                <button onClick={() => setUploadedFiles(prev => prev.filter(x => x.name !== f.name))}
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

        <button
          onClick={handleFinish}
          disabled={isUploading}
          className={`w-full py-2.5 text-sm ${btnPrimary} disabled:opacity-50`}
        >
          {uploadedFiles.length > 0 ? `Entrar com ${uploadedFiles.length} arquivo(s)` : 'Entrar'}
        </button>
        <button
          onClick={handleFinish}
          className={`w-full text-center text-xs mt-3 transition ${muted} hover:text-slate-300`}
        >
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
  const msgAssistant = isDark
    ? 'bg-[#161d2e] border border-slate-800 text-slate-200'
    : 'bg-white border border-slate-200 text-slate-700 shadow-sm';

  return (
    <div className={`flex h-screen w-full ${bg} ${text} overflow-hidden`}>

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
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
            <p className="text-sm font-semibold">{profile.preferredName || profile.fullName}</p>
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
            <button
              onClick={() => fileInputRef2.current?.click()}
              className={`mt-2 w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-dashed transition
                ${isDark ? 'border-slate-700 text-slate-500 hover:border-blue-500 hover:text-blue-400' : 'border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500'}`}
            >
              <Plus size={11} /> Adicionar arquivos
            </button>
            <input ref={fileInputRef2} type="file" className="hidden" multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.zip,.rar,.csv,.md"
              onChange={e => handleFiles(e.target.files)}
            />
          </div>
        </div>

        <div className={`p-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} flex flex-col gap-1`}>
          <button
            onClick={() => setIsDark(!isDark)}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition ${isDark ? 'hover:bg-slate-900 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
          >
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
            {isDark ? 'Modo claro' : 'Modo escuro'}
          </button>
          <button
            onClick={() => { setScreen('login'); setProfile(emptyProfile()); setUploadedFiles([]); setMessages([]); }}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition text-red-400 ${isDark ? 'hover:bg-red-500/10' : 'hover:bg-red-50'}`}
          >
            <LogOut size={13} /> Sair
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">

        {/* Header */}
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
            ${isUploading ? 'opacity-60 cursor-wait' : isDark ? 'border-slate-700 hover:border-blue-500 text-slate-300' : 'border-slate-200 hover:border-blue-400 text-slate-600'}`}
          >
            {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            <span className="hidden sm:inline">{isUploading ? 'Processando...' : 'Adicionar arquivos'}</span>
            <input type="file" className="hidden" multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.zip,.rar,.csv,.md"
              onChange={e => handleFiles(e.target.files)}
            />
          </label>
        </header>

        {/* Messages */}
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
                  : `${msgAssistant} rounded-tl-sm`
                }`}
              >
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
                  {[0, 150, 300].map(d => (
                    <span key={d}
                      className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className={`p-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div className="max-w-3xl mx-auto">
            <div className={`flex gap-2 items-center border rounded-2xl px-4 py-2 transition focus-within:ring-2 focus-within:ring-blue-500 ${inputCls}`}>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={PROF_PLACEHOLDERS[profile.profession ?? 'Outro']}
                disabled={isSending}
                className="flex-1 bg-transparent py-1.5 focus:outline-none text-sm disabled:opacity-60"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="p-1.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <Send size={15} />
              </button>
            </div>
            <p className={`text-center text-[10px] mt-2 font-medium tracking-wide uppercase ${isDark ? 'text-slate-700' : 'text-slate-400'}`}>
              Respostas baseadas apenas nos seus documentos · Dados privados
            </p>
          </div>
        </div>
      </main>

      {/* ── Upload drawer ─────────────────────────────────────────────────── */}
      {uploadDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-2xl border p-6 ${card}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Adicionar arquivos</h3>
              <button onClick={() => setUploadDrawerOpen(false)}><X size={18} /></button>
            </div>
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition mb-4
                ${isDark ? 'border-slate-700 hover:border-blue-500 hover:bg-blue-500/5' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50'}`}
            >
              <Upload size={22} className={`mx-auto mb-2 ${muted}`} />
              <p className="text-sm font-medium">Arraste ou clique</p>
              <p className={`text-xs mt-1 ${muted}`}>PDF, DOCX, PPTX, XLSX, ZIP e mais</p>
              <input ref={fileInputRef} type="file" className="hidden" multiple
                accept=".pdf,.docx,.pptx,.xlsx,.txt,.zip,.rar,.csv,.md"
                onChange={e => { handleFiles(e.target.files); setUploadDrawerOpen(false); }}
              />
            </div>
            <button
              onClick={() => setUploadDrawerOpen(false)}
              className={`w-full py-2 rounded-xl text-sm font-medium ${btnPrimary}`}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
  }