import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Timer, Power, Moon, RotateCw, BedDouble, Ban } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatDuration } from '@/lib/utils'

const PRESETS = [5, 10, 30, 60]
type ActionType = 'shutdown' | 'restart' | 'sleep' | 'hibernate'

const ACTION_META: { id: ActionType; icon: React.ElementType; labelKey: string }[] = [
  { id: 'shutdown', icon: Power, labelKey: 'shutdown' },
  { id: 'restart', icon: RotateCw, labelKey: 'restart' },
  { id: 'sleep', icon: BedDouble, labelKey: 'sleep' },
  { id: 'hibernate', icon: Moon, labelKey: 'hibernate' },
]

export function PowerTimerCard() {
  const { t } = useTranslation()
  const [action, setAction] = useState<ActionType>('shutdown')
  const [preset, setPreset] = useState<number | 'custom'>(30)
  const [customMinutes, setCustomMinutes] = useState(45)
  const [active, setActive] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [scheduledAction, setScheduledAction] = useState<ActionType>('shutdown')

  const durationSeconds = preset === 'custom' ? customMinutes * 60 : preset * 60

  useEffect(() => {
    const fetchStatus = () =>
      invoke<{ active: boolean; remaining_seconds: number; action?: ActionType }>('get_power_timer_status').then((s) => {
        setActive(s.active)
        setRemaining(s.remaining_seconds)
        if (s.action) setScheduledAction(s.action)
      })
    fetchStatus()
    const id = setInterval(fetchStatus, 1000)
    return () => clearInterval(id)
  }, [])

  const start = async () => {
    await invoke('start_power_timer', { action, seconds: durationSeconds })
    const s = await invoke<{ active: boolean; remaining_seconds: number; action?: ActionType }>('get_power_timer_status')
    setActive(s.active)
    setRemaining(s.remaining_seconds)
    if (s.action) setScheduledAction(s.action)
  }

  const cancel = async () => {
    await invoke('cancel_power_timer')
    setActive(false)
    setRemaining(0)
  }

  const progress = durationSeconds > 0 ? remaining / durationSeconds : 0

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className={cn('rounded-2xl border border-border bg-card p-6 shadow-sm transition-all', active && 'ring-2 ring-destructive/30')}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', active ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground')}>
              <Timer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t('powerTimer')}</h2>
              <p className="text-sm text-muted-foreground">{active ? `${t(scheduledAction)} • ${formatDuration(remaining)}` : t('inactive')}</p>
            </div>
          </div>
          {active && (
            <div className="text-right">
              <div className="text-3xl font-mono font-semibold">{formatDuration(remaining)}</div>
              <div className="text-xs text-muted-foreground">{t('remaining')}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {ACTION_META.map((a) => {
            const Icon = a.icon
            return (
              <button
                key={a.id}
                type="button"
                disabled={active}
                onClick={() => setAction(a.id)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-xl border px-3 py-3 text-sm font-medium transition-colors disabled:opacity-50',
                  action === a.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
                )}
              >
                <Icon className="w-5 h-5" />
                {t(a.labelKey)}
              </button>
            )
          })}
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

        <div className="flex gap-3">
          {active ? (
            <button
              type="button"
              onClick={cancel}
              className="flex-1 rounded-xl bg-muted text-foreground px-4 py-3 font-medium hover:bg-muted/80 transition-colors inline-flex items-center justify-center gap-2"
            >
              <Ban className="w-4 h-4" />
              {t('cancel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-3 font-medium hover:bg-primary/90 transition-colors"
            >
              {t('setTimer')}
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-destructive transition-all duration-1000" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
