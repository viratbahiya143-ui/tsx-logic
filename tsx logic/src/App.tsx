import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Code2,
  Clipboard,
  Check,
  Trash2,
  FileCode,
  AlertCircle,
  Sparkles,
  Search,
  Download,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Film,
  Zap,
  RefreshCw,
  Eye,
  Clock,
  X,
  DownloadCloud,
  ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

/* ─── Types ─── */
interface ExtractedBlock {
  id: string;
  code: string;
  type: 'tsx' | 'ts' | 'jsx' | 'js';
}

interface VideoFile {
  name: string;
  size: number;
  downloadUrl: string;
  previewUrl?: string;
}

type WorkflowStatus = 'idle' | 'triggering' | 'queued' | 'in_progress' | 'completed' | 'failed';

const GITHUB_OWNER = 'kunnuEra';
const GITHUB_REPO = 'tsx-code-to-mp4-kux-automation-';

/* ═══════════════════════════════════════════════════════════
   PARTICLE UNIVERSE BACKGROUND (when rendering)
   ═══════════════════════════════════════════════════════════ */
const Particle: React.FC<{ delay: number; x: number; size: number; duration: number }> = ({ delay, x, size, duration }) => (
  <motion.div
    initial={{ y: '110vh', opacity: 0, scale: 0 }}
    animate={{
      y: '-10vh',
      opacity: [0, 0.8, 0.8, 0],
      scale: [0, 1, 1, 0.5],
    }}
    transition={{
      duration,
      delay,
      repeat: Infinity,
      ease: 'linear',
    }}
    style={{
      position: 'absolute',
      left: `${x}%`,
      width: size,
      height: size,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${Math.random() > 0.5 ? 'rgba(99,102,241,0.6)' : 'rgba(236,72,153,0.6)'
        }, transparent)`,
      filter: 'blur(1px)',
      pointerEvents: 'none',
    }}
  />
);

const UniverseBackground: React.FC<{ active: boolean }> = ({ active }) => {
  const particles = useRef(
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: 2 + Math.random() * 6,
      delay: Math.random() * 8,
      duration: 6 + Math.random() * 10,
    }))
  ).current;

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/20 via-transparent to-pink-950/10" />
      {particles.map((p) => (
        <Particle key={p.id} x={p.x} size={p.size} delay={p.delay} duration={p.duration} />
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   VIDEO PREVIEW MODAL
   ═══════════════════════════════════════════════════════════ */
const VideoPreviewModal: React.FC<{
  url: string | null;
  name: string;
  onClose: () => void;
  onDownload: () => void;
}> = ({ url, name, onClose, onDownload }) => {
  if (!url) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0f0f13] border border-white/10 rounded-2xl overflow-hidden max-w-4xl w-full shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Film className="w-5 h-5 text-pink-400" />
            <span className="font-semibold text-white">{name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onDownload}
              className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-lg text-sm font-semibold text-white flex items-center gap-2 hover:brightness-110 transition-all"
            >
              <Download className="w-4 h-4" /> Download
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        {/* Video player */}
        <div className="aspect-video bg-black">
          <video src={url} controls autoPlay className="w-full h-full" />
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════════════
   PROGRESS TRACKER PANEL
   ═══════════════════════════════════════════════════════════ */
const ProgressTracker: React.FC<{
  status: WorkflowStatus;
  message: string;
  startTime: number | null;
  totalBlocks: number;
  completedVideos: number;
  onRefresh: () => void;
}> = ({ status, message, startTime, totalBlocks, onRefresh }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime || status === 'completed' || status === 'failed' || status === 'idle') return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [startTime, status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent =
    status === 'completed' ? 100 :
      status === 'failed' ? 100 :
        status === 'in_progress' ? Math.min(90, Math.floor(elapsed / 3)) :
          status === 'queued' ? 5 :
            0;

  const barColor =
    status === 'completed' ? 'from-green-500 to-emerald-400' :
      status === 'failed' ? 'from-red-500 to-orange-500' :
        'from-indigo-500 via-purple-500 to-pink-500';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl overflow-hidden"
    >
      {/* Progress bar */}
      <div className="h-1.5 bg-white/5 relative overflow-hidden">
        <motion.div
          className={`h-full bg-gradient-to-r ${barColor}`}
          initial={{ width: '0%' }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        {(status === 'in_progress' || status === 'queued') && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Status + message */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(status === 'triggering' || status === 'queued' || status === 'in_progress') && (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Loader2 className="w-5 h-5 text-purple-400" />
              </motion.div>
            )}
            {status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-400" />}
            {status === 'failed' && <XCircle className="w-5 h-5 text-red-400" />}
            <span className="text-sm font-medium text-white">{message}</span>
          </div>
          {(status === 'in_progress' || status === 'queued') && (
            <button onClick={onRefresh} className="text-xs flex items-center gap-1 text-slate-400 hover:text-cyan-400 transition-colors">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          )}
        </div>

        {/* Stats row */}
        {startTime && (
          <div className="flex items-center gap-6 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Elapsed: <span className="text-white font-mono">{formatTime(elapsed)}</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" />
              <span>Videos: <span className="text-white font-mono">{totalBlocks}</span></span>
            </div>
            {status === 'in_progress' && (
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-yellow-400">Rendering...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════ */
export const App: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [extractedBlocks, setExtractedBlocks] = useState<ExtractedBlock[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  /* GitHub Actions state */
  const [githubToken, setGithubToken] = useState<string>(localStorage.getItem('gh_token') || '');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>('idle');
  const [workflowRunId, setWorkflowRunId] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [startTime, setStartTime] = useState<number | null>(null);

  /* Videos */
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [previewVideo, setPreviewVideo] = useState<{ url: string; name: string } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const saveToken = (token: string) => {
    setGithubToken(token);
    localStorage.setItem('gh_token', token);
    setShowTokenInput(false);
  };

  const extractCode = () => {
    setIsProcessing(true);
    const blocks: ExtractedBlock[] = [];
    const mdRegex = /```(tsx|typescript|jsx|javascript)\n([\s\S]*?)```/g;
    let match;
    while ((match = mdRegex.exec(inputText)) !== null) {
      blocks.push({
        id: Math.random().toString(36).substr(2, 9),
        type: (match[1] === 'typescript' ? 'ts' : match[1]) as any,
        code: match[2].trim(),
      });
    }
    if (blocks.length === 0 && (inputText.includes('import') || (inputText.includes('<') && inputText.includes('/>')))) {
      blocks.push({ id: 'auto-1', type: 'tsx', code: inputText.trim() });
    }
    setExtractedBlocks(blocks);
    setIsProcessing(false);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearAll = () => {
    setInputText('');
    setExtractedBlocks([]);
    setWorkflowStatus('idle');
    setWorkflowRunId(null);
    setStatusMessage('');
    setStartTime(null);
    setVideos([]);
  };

  /* ─── GitHub API ─── */
  async function ghApi(method: string, path: string, body?: any): Promise<any> {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    return res.json();
  }

  /* ─── Bulk Render Flow ─── */
  const startBulkRender = async () => {
    if (!githubToken) { setShowTokenInput(true); return; }
    if (extractedBlocks.length === 0) { setStatusMessage('No TSX blocks!'); return; }

    try {
      setWorkflowStatus('triggering');
      setStatusMessage('Uploading TSX codes to GitHub...');
      setStartTime(Date.now());
      setVideos([]);

      // Build input content
      let inputContent = '';
      extractedBlocks.forEach((b) => { inputContent += '```' + b.type + '\n' + b.code + '\n```\n\n'; });

      // Get current file SHA
      const fileData = await ghApi('GET', '/contents/tsx%20logic/automation/input.txt');
      const body: any = {
        message: 'render: ' + extractedBlocks.length + ' videos',
        content: btoa(unescape(encodeURIComponent(inputContent))),
        branch: 'main',
      };
      if (fileData?.sha) body.sha = fileData.sha;

      await ghApi('PUT', '/contents/tsx%20logic/automation/input.txt', body);
      setStatusMessage('Triggering render workflow...');

      await ghApi('POST', '/actions/workflows/playwright.yml/dispatches', { ref: 'main' });
      setWorkflowStatus('queued');
      setStatusMessage('Workflow queued — waiting for runner...');

      // Find the run after a short delay
      setTimeout(async () => {
        const data = await ghApi('GET', '/actions/runs?per_page=1&branch=main');
        const run = data?.workflow_runs?.[0];
        if (run) {
          setWorkflowRunId(run.id);
          setWorkflowStatus(run.status === 'queued' ? 'queued' : 'in_progress');
          setStatusMessage(run.status === 'queued' ? 'Queued — waiting for GitHub runner...' : `Rendering videos... (Run #${run.run_number})`);
        }
      }, 8000);
    } catch (err: any) {
      setWorkflowStatus('failed');
      setStatusMessage('Error: ' + (err.message || 'Unknown'));
    }
  };

  /* ─── Poll ─── */
  const pollStatus = useCallback(async () => {
    if (!workflowRunId || !githubToken) return;
    try {
      const run = await ghApi('GET', `/actions/runs/${workflowRunId}`);
      if (run?.status === 'completed') {
        if (run.conclusion === 'success') {
          setWorkflowStatus('completed');
          setStatusMessage('🎉 All videos rendered successfully!');
          // Fetch artifacts
          const arts = await ghApi('GET', `/actions/runs/${workflowRunId}/artifacts`);
          if (arts?.artifacts?.length > 0) {
            const a = arts.artifacts[0];
            setVideos([{
              name: 'generated-videos.zip',
              size: a.size_in_bytes,
              downloadUrl: a.archive_download_url,
            }]);
          }
        } else {
          setWorkflowStatus('failed');
          setStatusMessage(`Workflow ${run.conclusion}. Check logs on GitHub.`);
        }
      } else {
        setWorkflowStatus(run?.status === 'queued' ? 'queued' : 'in_progress');
        setStatusMessage(run?.status === 'queued' ? 'Queued — waiting for runner...' : 'Rendering videos...');
      }
    } catch { }
  }, [workflowRunId, githubToken]);

  useEffect(() => {
    if (workflowStatus === 'in_progress' || workflowStatus === 'queued') {
      const interval = setInterval(pollStatus, 12000);
      return () => clearInterval(interval);
    }
  }, [workflowStatus, pollStatus]);

  /* ─── Download with animation ─── */
  const handleDownloadZip = async () => {
    if (!videos.length || !githubToken) return;
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      // Simulate progress while fetching
      const progressInterval = setInterval(() => {
        setDownloadProgress((p) => Math.min(p + 5, 90));
      }, 200);

      const res = await fetch(videos[0].downloadUrl, {
        headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
        redirect: 'follow',
      });

      clearInterval(progressInterval);
      setDownloadProgress(95);

      if (res.ok) {
        const blob = await res.blob();
        setDownloadProgress(100);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'generated-videos.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setTimeout(() => {
          setIsDownloading(false);
          setDownloadProgress(0);
        }, 1500);
      }
    } catch {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const isRendering = workflowStatus === 'triggering' || workflowStatus === 'queued' || workflowStatus === 'in_progress';

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-sans selection:bg-cyan-500/30 relative">
      {/* Universe background when rendering */}
      <UniverseBackground active={isRendering} />

      {/* Navbar */}
      <nav className="border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-50 relative">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20"
              animate={isRendering ? { scale: [1, 1.1, 1], boxShadow: ['0 10px 25px rgba(6,182,212,0.2)', '0 10px 35px rgba(168,85,247,0.4)', '0 10px 25px rgba(6,182,212,0.2)'] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Code2 className="text-white w-6 h-6" />
            </motion.div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">
              TSX Extractor
            </span>
            {isRendering && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="ml-2 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold uppercase tracking-wider"
              >
                Rendering...
              </motion.span>
            )}
          </div>
          <button
            onClick={() => setShowTokenInput(!showTokenInput)}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-cyan-500/30 text-slate-400 hover:text-white transition-all"
          >
            {githubToken ? '🔑 Token Set' : '⚙️ Set Token'}
          </button>
        </div>
      </nav>

      {/* Token Modal */}
      <AnimatePresence>
        {showTokenInput && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-6" onClick={() => setShowTokenInput(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()} className="bg-[#121214] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl">
              <h3 className="text-lg font-bold mb-2">GitHub Token</h3>
              <p className="text-sm text-slate-400 mb-6">Token is stored locally in your browser only.</p>
              <input type="password" placeholder="ghp_xxx or github_pat_xxx" defaultValue={githubToken}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-cyan-500/50 mb-4"
                onKeyDown={(e) => { if (e.key === 'Enter') saveToken((e.target as HTMLInputElement).value); }}
                id="token-input" />
              <div className="flex gap-3">
                <button onClick={() => { const el = document.getElementById('token-input') as HTMLInputElement; saveToken(el.value); }}
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl font-semibold text-sm text-white">Save</button>
                <button onClick={() => setShowTokenInput(false)}
                  className="px-6 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-400">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video Preview Modal */}
      <AnimatePresence>
        {previewVideo && (
          <VideoPreviewModal
            url={previewVideo.url}
            name={previewVideo.name}
            onClose={() => setPreviewVideo(null)}
            onDownload={handleDownloadZip}
          />
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-6 py-12 relative z-10">
        <div className="grid lg:grid-cols-2 gap-10">

          {/* ─── LEFT: Input ─── */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-cyan-500 flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Input Source
              </h2>
              {inputText && (
                <button onClick={clearAll} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1 transition-colors">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl blur opacity-20 group-focus-within:opacity-40 transition duration-1000" />
              <textarea value={inputText} onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste your text with TSX code blocks here..."
                className="relative w-full h-[460px] bg-[#121214] border border-white/10 rounded-2xl p-6 text-sm font-mono focus:outline-none focus:border-cyan-500/50 transition-all resize-none placeholder:text-slate-600 shadow-2xl" />
            </div>

            <button onClick={extractCode} disabled={!inputText || isProcessing}
              className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-white shadow-xl shadow-cyan-900/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2">
              {isProcessing ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Search className="w-5 h-5" /> Extract TSX Blocks</>}
            </button>
          </div>

          {/* ─── RIGHT: Results + Actions ─── */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-500 flex items-center gap-2">
                <FileCode className="w-4 h-4" /> Extracted Results
                {extractedBlocks.length > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="ml-2 px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    {extractedBlocks.length} found
                  </motion.span>
                )}
              </h2>
            </div>

            {/* Code Blocks */}
            <div className="space-y-3 max-h-[380px] overflow-y-auto rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-3 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {extractedBlocks.length > 0 ? (
                  extractedBlocks.map((block, idx) => (
                    <motion.div key={block.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.05 }}
                      className="bg-[#121214] border border-white/10 rounded-xl overflow-hidden group/card shadow-lg">
                      <div className="px-4 py-2 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[10px] font-bold uppercase">{block.type}</span>
                          <span className="text-[10px] text-slate-500">Block {idx + 1}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                          <button onClick={() => copyToClipboard(block.code, block.id)}
                            className="p-1.5 hover:bg-white/5 rounded text-slate-400 hover:text-white transition-colors" title="Copy">
                            {copiedId === block.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                      <div className="max-h-[150px] overflow-auto custom-scrollbar">
                        <SyntaxHighlighter language={block.type} style={atomDark}
                          customStyle={{ margin: 0, padding: '0.75rem', background: 'transparent', fontSize: '11px' }}>
                          {block.code}
                        </SyntaxHighlighter>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4 py-16">
                    <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center border border-white/5">
                      <AlertCircle className="w-7 h-7 opacity-20" />
                    </div>
                    <p className="text-center max-w-[220px] leading-relaxed italic opacity-50 text-sm">
                      Paste text and hit Extract
                    </p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* ─── BULK RENDER BUTTON ─── */}
            {extractedBlocks.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <button onClick={startBulkRender} disabled={isRendering}
                  className="w-full py-4 bg-gradient-to-r from-purple-600 via-pink-600 to-red-500 hover:from-purple-500 hover:via-pink-500 hover:to-red-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-white shadow-xl shadow-pink-900/30 transition-all active:scale-[0.98] flex items-center justify-center gap-3 relative overflow-hidden group">
                  <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                    animate={{ x: ['-100%', '200%'] }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} />
                  {isRendering
                    ? <><Loader2 className="w-5 h-5 animate-spin" /> Rendering...</>
                    : <><Film className="w-5 h-5" /><Zap className="w-4 h-4" /> Bulk Render {extractedBlocks.length} Video{extractedBlocks.length > 1 ? 's' : ''} in 4K</>
                  }
                </button>

                {/* Progress Tracker */}
                {workflowStatus !== 'idle' && (
                  <ProgressTracker
                    status={workflowStatus}
                    message={statusMessage}
                    startTime={startTime}
                    totalBlocks={extractedBlocks.length}
                    completedVideos={0}
                    onRefresh={pollStatus}
                  />
                )}

                {/* ─── DOWNLOAD SECTION ─── */}
                {workflowStatus === 'completed' && videos.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', damping: 20 }}
                    className="rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-500/5 to-emerald-500/5 p-5 space-y-4"
                  >
                    <div className="flex items-center gap-2 text-green-400 text-sm font-semibold">
                      <CheckCircle2 className="w-5 h-5" />
                      Videos Ready!
                    </div>

                    {/* Download ZIP button with progress */}
                    <button onClick={handleDownloadZip} disabled={isDownloading}
                      className="w-full relative rounded-xl overflow-hidden group">
                      {/* Progress bg */}
                      {isDownloading && (
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-cyan-600/30 to-blue-600/30"
                          initial={{ width: '0%' }}
                          animate={{ width: `${downloadProgress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      )}
                      <div className={`relative py-4 flex items-center justify-center gap-3 font-bold text-white transition-all ${isDownloading
                          ? 'bg-gradient-to-r from-cyan-700/50 to-blue-700/50'
                          : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 active:scale-[0.98]'
                        }`}>
                        {isDownloading ? (
                          <>
                            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                              <DownloadCloud className="w-5 h-5" />
                            </motion.div>
                            Downloading... {downloadProgress}%
                          </>
                        ) : downloadProgress === 100 ? (
                          <>
                            <CheckCircle2 className="w-5 h-5 text-green-300" />
                            Downloaded!
                          </>
                        ) : (
                          <>
                            <Download className="w-5 h-5" />
                            Download Videos (ZIP)
                            <span className="text-xs opacity-60">
                              ({(videos[0].size / 1024).toFixed(0)} KB)
                            </span>
                          </>
                        )}
                      </div>
                    </button>

                    {/* View on GitHub */}
                    {workflowRunId && (
                      <a href={`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${workflowRunId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="w-full py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:text-white transition-colors flex items-center justify-center gap-2">
                        <Eye className="w-4 h-4" /> View Logs on GitHub
                      </a>
                    )}
                  </motion.div>
                )}

                {/* Failed */}
                {workflowStatus === 'failed' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 space-y-3">
                    <div className="flex items-center gap-2 text-red-400 text-sm font-semibold">
                      <XCircle className="w-5 h-5" /> Render Failed
                    </div>
                    <div className="flex gap-3">
                      <button onClick={startBulkRender}
                        className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-orange-600 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4" /> Retry
                      </button>
                      {workflowRunId && (
                        <a href={`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${workflowRunId}`}
                          target="_blank" rel="noopener noreferrer"
                          className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-400 flex items-center gap-2">
                          View Logs
                        </a>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-10 border-t border-white/5 mt-10 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 opacity-30 hover:opacity-60 transition-opacity duration-500">
          <div className="text-sm">TSX Extractor + Bulk 4K Renderer</div>
          <div className="flex gap-4 text-xs">
            <span>GitHub Actions</span><span>•</span><span>Playwright</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
