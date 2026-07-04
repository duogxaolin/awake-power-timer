import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Activity, Cpu, MemoryStick, ArrowDownToLine, ArrowUpFromLine, Clock, Sparkles, Hourglass, AppWindow, X, RefreshCw, BatteryLow, BatteryCharging } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatBytes, formatRate, formatUptime } from '@/lib/utils'

interface SystemStats {
  cpu_usage: number
  cpu_per_core: number[]
  memory_total: number
  memory_used: number
  swap_total: number
  swap_used: number
  net_rx_per_sec: number
  net_tx_per_sec: number
  core_count: number
  uptime: number
  battery_percent: number | null
  on_ac_power: boolean | null
}

const SMART_KEY = 'apt-smart-awake'

interface SmartConfig {
  enabled: boolean
  cpuThreshold: number
  netThresholdKb: number
}

const DEFAULT_SMART: SmartConfig = { enabled: false, cpuThreshold: 25, netThresholdKb: 500 }

function loadSmart(): SmartConfig {
  try {
    const raw = localStorage.getItem(SMART_KEY)
    if (raw) return { ...DEFAULT_SMART, ...JSON.parse(raw) }
  } catch {
    // ignore malformed config
  }
  return DEFAULT_SMART
}

const PROC_KEY = 'apt-process-awake'

interface ProcessConfig {
  enabled: boolean
  names: string[]
}

const DEFAULT_PROC: ProcessConfig = { enabled: false, names: [] }

function loadProc(): ProcessConfig {
  try {
    const raw = localStorage.getItem(PROC_KEY)
    if (raw) return { ...DEFAULT_PROC, ...JSON.parse(raw) }
  } catch {
    // ignore malformed config
  }
  return DEFAULT_PROC
}

type ActionType = 'shutdown' | 'restart' | 'sleep' | 'hibernate'

interface IdleActionConfig {
  enabled: boolean
  action: ActionType
  idle_minutes: number
  cpu_threshold: number
  net_threshold_kb: number
  grace_seconds: number
}

const DEFAULT_IDLE: IdleActionConfig = {
  enabled: false,
  action: 'sleep',
  idle_minutes: 15,
  cpu_threshold: 15,
  net_threshold_kb: 200,
  grace_seconds: 120,
}

interface BatteryActionConfig {
  enabled: boolean
  action: ActionType
  threshold_percent: number
  grace_seconds: number
}

const DEFAULT_BATTERY: BatteryActionConfig = {
  enabled: false,
  action: 'hibernate',
  threshold_percent: 15,
  grace_seconds: 120,
}

const ACTION_KEYS: ActionType[] = ['shutdown', 'restart', 'sleep', 'hibernate']

function Gauge({ label, value, sub, icon: Icon, tone = 'primary' }: { label: string; value: string; sub?: string; icon: React.ElementType; tone?: 'primary' | 'blue' | 'amber' }) {
  const toneClass = tone === 'blue' ? 'text-sky-500' : tone === 'amber' ? 'text-amber-500' : 'text-primary'
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-2">
        <Icon className={cn('w-4 h-4', toneClass)} />
        {label}
      </div>
      <div className="text-2xl font-mono font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  )
}

function Bar({ ratio, tone = 'primary' }: { ratio: number; tone?: 'primary' | 'blue' | 'amber' }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  const bg = tone === 'blue' ? 'bg-sky-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-primary'
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div className={cn('h-full transition-all duration-500', bg)} style={{ width: `${pct}%` }} />
    </div>
  )
}

interface ProcessEntry {
  name: string
}

/** Keep the machine awake while any of the chosen apps/processes is running. */
function ProcessTriggerPanel({
  proc,
  setProc,
  active,
}: {
  proc: ProcessConfig
  setProc: React.Dispatch<React.SetStateAction<ProcessConfig>>
  active: boolean
}) {
  const { t } = useTranslation()
  const [running, setRunning] = useState<ProcessEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await invoke<ProcessEntry[]>('list_processes')
      setRunning(list)
    } catch {
      // backend not ready
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (proc.enabled) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proc.enabled])

  const addName = (name: string) => {
    const clean = name.trim().toLowerCase().replace(/\.exe$/, '')
    if (!clean) return
    setProc((c) => (c.names.includes(clean) ? c : { ...c, names: [...c.names, clean] }))
    setQuery('')
  }

  const removeName = (name: string) => {
    setProc((c) => ({ ...c, names: c.names.filter((n) => n !== name) }))
  }

  const suggestions = query
    ? running
        .filter((p) => p.name.includes(query.toLowerCase()) && !proc.names.includes(p.name))
        .slice(0, 6)
    : []

  return (
    <div className={cn('rounded-2xl border bg-card p-6 shadow-sm transition-all', active ? 'border-sky-500 ring-2 ring-sky-500/30' : proc.enabled ? 'border-sky-500/60' : 'border-border')}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <AppWindow className={cn('w-5 h-5', proc.enabled ? 'text-sky-500' : 'text-muted-foreground')} />
          <h3 className="font-semibold">{t('processAwake')}</h3>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={proc.enabled}
            onChange={(e) => setProc((c) => ({ ...c, enabled: e.target.checked }))}
          />
          <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-sky-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
        </label>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t('processAwakeDesc')}</p>

      {proc.enabled && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {proc.names.length === 0 && <span className="text-sm text-muted-foreground">{t('noProcesses')}</span>}
            {proc.names.map((name) => (
              <span key={name} className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 px-3 py-1 text-sm font-medium">
                {name}
                <button type="button" onClick={() => removeName(name)} className="hover:text-sky-800 dark:hover:text-sky-200" aria-label={t('delete')}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>

          <div className="relative">
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addName(query)
                }}
                placeholder={t('processPlaceholder')}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                aria-label={t('refresh')}
                title={t('refresh')}
              >
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                {suggestions.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => addName(p.name)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={cn('text-sm font-medium flex items-center gap-2', active ? 'text-sky-500' : 'text-muted-foreground')}>
            <span className={cn('w-2 h-2 rounded-full', active ? 'bg-sky-500 animate-pulse' : 'bg-muted-foreground/50')} />
            {active ? t('triggerActive') : t('waitingForTrigger')}
          </div>
        </div>
      )}
    </div>
  )
}

export function SystemMonitorCard() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [smart, setSmart] = useState<SmartConfig>(loadSmart)
  const [proc, setProc] = useState<ProcessConfig>(loadProc)
  const [triggerActive, setTriggerActive] = useState(false)
  const [procActive, setProcActive] = useState(false)
  // A single wake lock is shared by the CPU/net and process triggers so they
  // never race to start/stop it; `holdRef` tracks whether we currently hold it.
  const holdRef = useRef(false)
  const smartRef = useRef(smart)
  const procRef = useRef(proc)
  const [idle, setIdle] = useState<IdleActionConfig>(DEFAULT_IDLE)
  const idleLoaded = useRef(false)
  const [battery, setBattery] = useState<BatteryActionConfig>(DEFAULT_BATTERY)
  const batteryLoaded = useRef(false)

  useEffect(() => {
    localStorage.setItem(SMART_KEY, JSON.stringify(smart))
    smartRef.current = smart
  }, [smart])

  useEffect(() => {
    localStorage.setItem(PROC_KEY, JSON.stringify(proc))
    procRef.current = proc
  }, [proc])

  // Idle auto-action config is owned by the Rust backend (it runs the watcher).
  useEffect(() => {
    invoke<IdleActionConfig>('get_idle_action')
      .then((c) => setIdle({ ...DEFAULT_IDLE, ...c }))
      .catch(() => {})
      .finally(() => {
        idleLoaded.current = true
      })
  }, [])

  const updateIdle = (changes: Partial<IdleActionConfig>) => {
    setIdle((prev) => {
      const next = { ...prev, ...changes }
      if (idleLoaded.current) invoke('save_idle_action', { config: next }).catch(() => {})
      return next
    })
  }

  // Low-battery auto-action config is also owned by the Rust backend.
  useEffect(() => {
    invoke<BatteryActionConfig>('get_battery_action')
      .then((c) => setBattery({ ...DEFAULT_BATTERY, ...c }))
      .catch(() => {})
      .finally(() => {
        batteryLoaded.current = true
      })
  }, [])

  const updateBattery = (changes: Partial<BatteryActionConfig>) => {
    setBattery((prev) => {
      const next = { ...prev, ...changes }
      if (batteryLoaded.current) invoke('save_battery_action', { config: next }).catch(() => {})
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      let s: SystemStats | null = null
      try {
        s = await invoke<SystemStats>('get_system_stats')
        if (!cancelled) setStats(s)
      } catch {
        // backend not ready yet
        return
      }
      await evaluateTriggers(s)
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Releases the shared wake lock when both triggers are switched off.
  useEffect(() => {
    if (!smart.enabled && !proc.enabled && holdRef.current) {
      holdRef.current = false
      setTriggerActive(false)
      setProcActive(false)
      invoke('stop_keep_awake').catch(() => {})
    }
  }, [smart.enabled, proc.enabled])

  // Evaluates both the CPU/net trigger and the process trigger, then holds a
  // single wake lock if either wants it. Using one lock avoids the two triggers
  // stopping each other's keep-awake.
  const evaluateTriggers = async (s: SystemStats) => {
    const sm = smartRef.current
    const pr = procRef.current

    let smartBusy = false
    if (sm.enabled) {
      const netKb = (s.net_rx_per_sec + s.net_tx_per_sec) / 1024
      smartBusy = s.cpu_usage >= sm.cpuThreshold || netKb >= sm.netThresholdKb
    }
    setTriggerActive(smartBusy)

    let procBusy = false
    if (pr.enabled && pr.names.length > 0) {
      try {
        procBusy = await invoke<boolean>('any_process_running', { names: pr.names })
      } catch {
        procBusy = false
      }
    }
    setProcActive(procBusy)

    const wantHold = smartBusy || procBusy
    if (wantHold && !holdRef.current) {
      holdRef.current = true
      await invoke('start_keep_awake', { mode: 'both', seconds: 0 }).catch(() => {})
    } else if (!wantHold && holdRef.current) {
      holdRef.current = false
      await invoke('stop_keep_awake').catch(() => {})
    }
  }

  const memRatio = stats && stats.memory_total > 0 ? stats.memory_used / stats.memory_total : 0
  const swapRatio = stats && stats.swap_total > 0 ? stats.swap_used / stats.swap_total : 0

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('systemMonitor')}</h2>
            <p className="text-sm text-muted-foreground">
              {stats ? `${stats.core_count} ${t('cores')} • ${t('uptime')} ${formatUptime(stats.uptime)}` : '…'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <Gauge label={t('cpu')} value={stats ? `${stats.cpu_usage.toFixed(0)}%` : '—'} icon={Cpu} />
          <Gauge
            label={t('memory')}
            value={stats ? `${(memRatio * 100).toFixed(0)}%` : '—'}
            sub={stats ? `${formatBytes(stats.memory_used)} / ${formatBytes(stats.memory_total)}` : undefined}
            icon={MemoryStick}
            tone="amber"
          />
          <Gauge label={t('download')} value={stats ? formatRate(stats.net_rx_per_sec) : '—'} icon={ArrowDownToLine} tone="blue" />
          <Gauge label={t('upload')} value={stats ? formatRate(stats.net_tx_per_sec) : '—'} icon={ArrowUpFromLine} tone="blue" />
        </div>

        {stats && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{t('cpu')}</span>
                <span>{stats.cpu_usage.toFixed(0)}%</span>
              </div>
              <Bar ratio={stats.cpu_usage / 100} />
            </div>
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{t('memory')}</span>
                <span>{(memRatio * 100).toFixed(0)}%</span>
              </div>
              <Bar ratio={memRatio} tone="amber" />
            </div>
            {stats.swap_total > 0 && (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>{t('swap')}</span>
                  <span>{(swapRatio * 100).toFixed(0)}%</span>
                </div>
                <Bar ratio={swapRatio} tone="amber" />
              </div>
            )}
          </div>
        )}

        {stats && stats.cpu_per_core.length > 1 && (
          <div className="mt-5">
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t('perCore')}
            </div>
            <div className="flex items-end gap-1 h-16">
              {stats.cpu_per_core.map((core, i) => (
                <div key={i} className="flex-1 bg-muted rounded-sm overflow-hidden flex flex-col justify-end" title={`Core ${i}: ${core.toFixed(0)}%`}>
                  <div className="bg-primary transition-all duration-500" style={{ height: `${Math.max(2, Math.min(100, core))}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={cn('rounded-2xl border bg-card p-6 shadow-sm transition-all', triggerActive ? 'border-primary ring-2 ring-primary/30' : 'border-border')}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Sparkles className={cn('w-5 h-5', triggerActive ? 'text-primary' : 'text-muted-foreground')} />
            <h3 className="font-semibold">{t('smartAwake')}</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={smart.enabled}
              onChange={(e) => setSmart((c) => ({ ...c, enabled: e.target.checked }))}
            />
            <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t('smartAwakeDesc')}</p>

        {smart.enabled && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{t('cpuThreshold')}</span>
                <span className="font-mono">{smart.cpuThreshold}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={95}
                step={5}
                value={smart.cpuThreshold}
                onChange={(e) => setSmart((c) => ({ ...c, cpuThreshold: Number(e.target.value) }))}
                className="w-full accent-primary"
              />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{t('netThreshold')}</span>
                <span className="font-mono">{formatRate(smart.netThresholdKb * 1024)}</span>
              </div>
              <input
                type="range"
                min={100}
                max={5000}
                step={100}
                value={smart.netThresholdKb}
                onChange={(e) => setSmart((c) => ({ ...c, netThresholdKb: Number(e.target.value) }))}
                className="w-full accent-primary"
              />
            </div>
            <div className={cn('text-sm font-medium flex items-center gap-2', triggerActive ? 'text-primary' : 'text-muted-foreground')}>
              <span className={cn('w-2 h-2 rounded-full', triggerActive ? 'bg-primary animate-pulse' : 'bg-muted-foreground/50')} />
              {triggerActive ? t('triggerActive') : t('waitingForTrigger')}
            </div>
          </div>
        )}
      </div>

      <ProcessTriggerPanel proc={proc} setProc={setProc} active={procActive} />

      <div className={cn('rounded-2xl border bg-card p-6 shadow-sm transition-all', idle.enabled ? 'border-amber-500/60' : 'border-border')}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Hourglass className={cn('w-5 h-5', idle.enabled ? 'text-amber-500' : 'text-muted-foreground')} />
            <h3 className="font-semibold">{t('idleAction')}</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={idle.enabled}
              onChange={(e) => updateIdle({ enabled: e.target.checked })}
            />
            <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-amber-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t('idleActionDesc')}</p>

        {idle.enabled && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ACTION_KEYS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => updateIdle({ action: a })}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    idle.action === a ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-border bg-background hover:bg-accent'
                  )}
                >
                  {t(a)}
                </button>
              ))}
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{t('idleMinutes')}</span>
                <span className="font-mono">{idle.idle_minutes} {t('minutes')}</span>
              </div>
              <input
                type="range"
                min={1}
                max={120}
                step={1}
                value={idle.idle_minutes}
                onChange={(e) => updateIdle({ idle_minutes: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{t('idleCpuThreshold')}</span>
                <span className="font-mono">{idle.cpu_threshold}%</span>
              </div>
              <input
                type="range"
                min={2}
                max={50}
                step={1}
                value={idle.cpu_threshold}
                onChange={(e) => updateIdle({ cpu_threshold: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{t('idleNetThreshold')}</span>
                <span className="font-mono">{formatRate(idle.net_threshold_kb * 1024)}</span>
              </div>
              <input
                type="range"
                min={50}
                max={2000}
                step={50}
                value={idle.net_threshold_kb}
                onChange={(e) => updateIdle({ net_threshold_kb: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </div>
          </div>
        )}
      </div>

      {(!stats || stats.battery_percent !== null) && (
        <div className={cn('rounded-2xl border bg-card p-6 shadow-sm transition-all', battery.enabled ? 'border-rose-500/60' : 'border-border')}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              {stats?.on_ac_power ? (
                <BatteryCharging className={cn('w-5 h-5', battery.enabled ? 'text-rose-500' : 'text-emerald-500')} />
              ) : (
                <BatteryLow className={cn('w-5 h-5', battery.enabled ? 'text-rose-500' : 'text-muted-foreground')} />
              )}
              <h3 className="font-semibold">{t('batteryAction')}</h3>
              {stats?.battery_percent != null && (
                <span className="text-sm font-mono text-muted-foreground">
                  {stats.battery_percent}%{stats.on_ac_power ? ` • ${t('charging')}` : ''}
                </span>
              )}
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={battery.enabled}
                onChange={(e) => updateBattery({ enabled: e.target.checked })}
              />
              <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-rose-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
            </label>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t('batteryActionDesc')}</p>

          {battery.enabled && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ACTION_KEYS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => updateBattery({ action: a })}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                      battery.action === a ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'border-border bg-background hover:bg-accent'
                    )}
                  >
                    {t(a)}
                  </button>
                ))}
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>{t('batteryThreshold')}</span>
                  <span className="font-mono">{battery.threshold_percent}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={1}
                  value={battery.threshold_percent}
                  onChange={(e) => updateBattery({ threshold_percent: Number(e.target.value) })}
                  className="w-full accent-rose-500"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
