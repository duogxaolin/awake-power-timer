import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Activity, Cpu, MemoryStick, ArrowDownToLine, ArrowUpFromLine, Clock, Sparkles, Hourglass } from 'lucide-react'
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

export function SystemMonitorCard() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [smart, setSmart] = useState<SmartConfig>(loadSmart)
  const [triggerActive, setTriggerActive] = useState(false)
  const triggerRef = useRef(false)
  const [idle, setIdle] = useState<IdleActionConfig>(DEFAULT_IDLE)
  const idleLoaded = useRef(false)

  useEffect(() => {
    localStorage.setItem(SMART_KEY, JSON.stringify(smart))
  }, [smart])

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

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const s = await invoke<SystemStats>('get_system_stats')
        if (!cancelled) setStats(s)
        if (smart.enabled) await evaluateSmart(s)
      } catch {
        // backend not ready yet
      }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.enabled, smart.cpuThreshold, smart.netThresholdKb])

  // When smart mode turns off, release any trigger-held keep-awake.
  useEffect(() => {
    if (!smart.enabled && triggerRef.current) {
      triggerRef.current = false
      setTriggerActive(false)
      invoke('stop_keep_awake').catch(() => {})
    }
  }, [smart.enabled])

  const evaluateSmart = async (s: SystemStats) => {
    const netKb = (s.net_rx_per_sec + s.net_tx_per_sec) / 1024
    const busy = s.cpu_usage >= smart.cpuThreshold || netKb >= smart.netThresholdKb
    if (busy && !triggerRef.current) {
      triggerRef.current = true
      setTriggerActive(true)
      await invoke('start_keep_awake', { mode: 'both', seconds: 0 }).catch(() => {})
    } else if (!busy && triggerRef.current) {
      triggerRef.current = false
      setTriggerActive(false)
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
    </div>
  )
}
