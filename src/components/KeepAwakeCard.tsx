import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Zap, Monitor, Cpu, Timer, Infinity as InfinityIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatDuration } from '@/lib/utils'

const PRESETS = [5, 10, 30, 60]
type Mode = 'display' | 'system' | 'both'

export function KeepAwakeCard() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('both')
  const [preset, setPreset] = useState<number | 'custom' | 'indefinite'>(30)
  const [customMinutes, setCustomMinutes] = useState(45)
  const [active, setActive] = useState(false)
  const [remaining, setRemaining] = useState(0)

  const durationSeconds =
    preset === 'indefinite'
      ? Number.POSITIVE_INFINITY
      : preset === 'custom'
        ? customMinutes * 60
        : preset * 60

  useEffect(() => {
    const savedSettings = localStorage.getItem('apt-settings')
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings)
        if (parsed?.defaultMode === 'display' || parsed?.defaultMode === 'system' || parsed?.defaultMode === 'both') {
          setMode(parsed.defaultMode)
        }
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    const fetchStatus = () =>
      invoke<{ active: boolean; remaining_seconds: number }>('get_keep_awake_status').then((s) => {
        setActive(s.active)
        setRemaining(s.remaining_seconds)
      })
    fetchStatus()
    const id = setInterval(fetchStatus, 1000)
    return () => clearInterval(id)
  }, [])

  const start = async () => {
    await invoke('start_keep_awake', {
      mode,
      seconds: durationSeconds === Number.POSITIVE_INFINITY ? 0 : durationSeconds,
    })
    const s = await invoke<{ active: boolean; remaining_seconds: number }>('get_keep_awake_status')
    setActive(s.active)
    setRemaining(s.remaining_seconds)
  }

  const stop = async () => {
    await invoke('stop_keep_awake')
    setActive(false)
    setRemaining(0)
  }

  const progress = durationSeconds === Number.POSITIVE_INFINITY ? 1 : durationSeconds > 0 ? remaining / durationSeconds : 0

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className={cn('rounded-2xl border border-border bg-card p-6 shadow-sm transition-all', active && 'ring-2 ring-primary/30')}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t('keepAwake')}</h2>
              <p className="text-sm text-muted-foreground">{active ? t('active') : t('inactive')}</p>
            </div>
          </div>
          {active && remaining > 0 && (
            <div className="text-right">
              <div className="text-2xl font-mono font-semibold">{formatDuration(remaining)}</div>
              <div className="text-xs text-muted-foreground">{t('remaining')}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {(['display', 'system', 'both'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={active}
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors disabled:opacity-50',
                mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
              )}
            >
              {m === 'display' && <Monitor className="w-4 h-4" />}
              {m === 'system' && <Cpu className="w-4 h-4" />}
              {m === 'both' && <Zap className="w-4 h-4" />}
              {m === 'display' ? t('displayAwake') : m === 'system' ? t('systemAwake') : t('bothAwake')}
            </button>
          ))}
        </div>

        <div className="space-y-3 mb-6">
          <label className="text-sm font-medium">{t('duration')}</label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((min) => (
              <button
                key={min}
                type="button"
                disabled={active}
                onClick={() => setPreset(min)}
                className={cn(
                  'px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50',
                  preset === min ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
                )}
              >
                {min} {t('minutes')}
              </button>
            ))}
            <button
              type="button"
              disabled={active}
              onClick={() => setPreset('custom')}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50',
                preset === 'custom' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
              )}
            >
              {t('custom')}
            </button>
            <button
              type="button"
              disabled={active}
              onClick={() => setPreset('indefinite')}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50',
                preset === 'indefinite' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
              )}
            >
              <InfinityIcon className="w-4 h-4 inline mr-1" />
              {t('indefinite')}
            </button>
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-3">
              <Timer className="w-4 h-4 text-muted-foreground" />
              <input
                type="number"
                min={1}
                max={1440}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(Math.max(1, Number(e.target.value)))}
                disabled={active}
                className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted-foreground">{t('minutes')}</span>
            </div>
          )}
        </div>

        {active ? (
          <button
            type="button"
            onClick={stop}
            className="w-full rounded-xl bg-destructive text-destructive-foreground px-4 py-3 font-medium hover:bg-destructive/90 transition-colors"
          >
            {t('stop')}
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 font-medium hover:bg-primary/90 transition-colors"
          >
            {t('start')}
          </button>
        )}
      </div>

      {active && durationSeconds !== Number.POSITIVE_INFINITY && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
