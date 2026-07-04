import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CalendarClock, Timer, Power, RotateCw, BedDouble, Moon, Plus, Trash2, Repeat, CalendarDays } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatDuration } from '@/lib/utils'

type ActionType = 'shutdown' | 'restart' | 'sleep' | 'hibernate'
type Mode = 'oneTime' | 'recurring'

const ACTION_META: { id: ActionType; icon: React.ElementType; labelKey: string }[] = [
  { id: 'shutdown', icon: Power, labelKey: 'shutdown' },
  { id: 'restart', icon: RotateCw, labelKey: 'restart' },
  { id: 'sleep', icon: BedDouble, labelKey: 'sleep' },
  { id: 'hibernate', icon: Moon, labelKey: 'hibernate' },
]

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

interface RecurringSchedule {
  id: string
  action: ActionType
  hour: number
  minute: number
  days: boolean[]
  enabled: boolean
  grace_seconds: number
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

function OneTimePanel() {
  const { t } = useTranslation()
  const [action, setAction] = useState<ActionType>('shutdown')
  const [time, setTime] = useState('22:00')
  const [active, setActive] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [scheduledAction, setScheduledAction] = useState<ActionType>('shutdown')

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

  const schedule = async () => {
    const [hours, minutes] = time.split(':').map(Number)
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1)
    }
    const seconds = Math.floor((target.getTime() - now.getTime()) / 1000)
    await invoke('start_power_timer', { action, seconds })
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

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
          <CalendarClock className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t('oneTime')}</h2>
          <p className="text-sm text-muted-foreground">
            {active ? `${t(scheduledAction)} • ${formatDuration(remaining)}` : t('inactive')}
          </p>
        </div>
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
        <label className="text-sm font-medium">{t('schedule')}</label>
        <div className="flex items-center gap-3">
          <Timer className="w-4 h-4 text-muted-foreground" />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={active}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-3">
        {active ? (
          <button
            type="button"
            onClick={cancel}
            className="flex-1 rounded-xl bg-muted text-foreground px-4 py-3 font-medium hover:bg-muted/80 transition-colors"
          >
            {t('cancel')}
          </button>
        ) : (
          <button
            type="button"
            onClick={schedule}
            className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-3 font-medium hover:bg-primary/90 transition-colors"
          >
            {t('setTimer')}
          </button>
        )}
      </div>
    </div>
  )
}

function RecurringPanel() {
  const { t } = useTranslation()
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    invoke<RecurringSchedule[]>('get_schedules')
      .then((s) => setSchedules(Array.isArray(s) ? s : []))
      .catch(() => setSchedules([]))
      .finally(() => setLoaded(true))
  }, [])

  const persist = useCallback(async (next: RecurringSchedule[]) => {
    setSchedules(next)
    await invoke('save_schedules', { schedules: next }).catch(() => {})
  }, [])

  const add = () => {
    const item: RecurringSchedule = {
      id: newId(),
      action: 'shutdown',
      hour: 23,
      minute: 0,
      days: [true, true, true, true, true, false, false],
      enabled: true,
      grace_seconds: 60,
    }
    persist([...schedules, item])
  }

  const remove = (id: string) => persist(schedules.filter((s) => s.id !== id))

  const patch = (id: string, changes: Partial<RecurringSchedule>) =>
    persist(schedules.map((s) => (s.id === id ? { ...s, ...changes } : s)))

  const setPreset = (id: string, preset: 'everyday' | 'weekdays' | 'weekends') => {
    const days =
      preset === 'everyday'
        ? [true, true, true, true, true, true, true]
        : preset === 'weekdays'
          ? [true, true, true, true, true, false, false]
          : [false, false, false, false, false, true, true]
    patch(id, { days })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
            <Repeat className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('recurringSchedules')}</h2>
            <p className="text-sm text-muted-foreground">{schedules.length} • {t('recurring')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('addSchedule')}
        </button>
      </div>

      {loaded && schedules.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <CalendarDays className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">{t('noSchedules')}</p>
        </div>
      )}

      <div className="space-y-4">
        {schedules.map((s) => {
          const time = `${s.hour.toString().padStart(2, '0')}:${s.minute.toString().padStart(2, '0')}`
          return (
            <div key={s.id} className={cn('rounded-xl border p-4 transition-all', s.enabled ? 'border-border bg-background' : 'border-border bg-background opacity-60')}>
              <div className="flex items-center justify-between mb-3 gap-3">
                <select
                  value={s.action}
                  onChange={(e) => patch(s.id, { action: e.target.value as ActionType })}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-medium"
                >
                  {ACTION_META.map((a) => (
                    <option key={a.id} value={a.id}>
                      {t(a.labelKey)}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-muted-foreground">{t('at')}</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number)
                    patch(s.id, { hour: h, minute: m })
                  }}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
                <div className="flex-1" />
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={s.enabled}
                    onChange={(e) => patch(s.id, { enabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
                </label>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  aria-label={t('delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-2">
                {DAY_KEYS.map((day, i) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const days = [...s.days]
                      days[i] = !days[i]
                      patch(s.id, { days })
                    }}
                    className={cn(
                      'w-10 h-8 rounded-lg text-xs font-medium transition-colors',
                      s.days[i] ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {t(day)}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 text-xs">
                {(['everyday', 'weekdays', 'weekends'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPreset(s.id, preset)}
                    className="text-muted-foreground hover:text-primary underline-offset-2 hover:underline transition-colors"
                  >
                    {t(preset)}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ScheduleCard() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('oneTime')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="inline-flex gap-1 p-1 rounded-xl bg-muted border border-border">
        {(['oneTime', 'recurring'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {m === 'oneTime' ? <CalendarClock className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
            {t(m)}
          </button>
        ))}
      </div>

      {mode === 'oneTime' ? <OneTimePanel /> : <RecurringPanel />}
    </div>
  )
}
